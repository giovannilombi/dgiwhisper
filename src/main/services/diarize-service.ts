// High-level diarization service. Sits on top of the runner (sherpa-onnx
// child process) and the audio cache, and provides the API the UI uses:
//
//   • `diarize(audioId, params)` — orchestrates the full pipeline:
//      1. Try the channel-based fast-path on stereo inputs that look
//         per-channel (no ML at all, ~milliseconds, near-perfect).
//      2. Otherwise, on FIRST run for this audioId: invoke sherpa with
//         `withEmbeddings: true` so we get back both segment boundaries
//         and per-segment speaker embeddings. Cache the embeddings.
//      3. On SUBSEQUENT runs for the same audioId: skip sherpa entirely,
//         re-cluster the cached embeddings with the new params using
//         our in-process JS clustering. Sub-second.
//
//   • `releaseEmbeddings(audioId)` — drop the cached embeddings (called
//      when the audio entry itself is released).
//
//   • `cancel()` — cancel an in-flight ML run via AbortSignal.
//
// The service is stateful but the state is purely in-memory and tied to
// the lifetime of the audio entry in `audio-cache`.

import fs from 'fs';
import log from 'electron-log';
import type { DiarizationSegment, TranscribedSegment } from '../../shared/types';
import { audioCache } from './audio-cache';
import { runDiarization, DiarizationAbortedError } from './diarization';
import { parseStereoWav, analyzeChannels, diarizeFromChannels } from '../utils/channel-diarization';
import { clusterEmbeddings } from '../utils/hierarchical-clustering';
import {
  dropTinyDiarizationClusters,
  parseWhisperJsonFull,
  mergeTokensWithDiarization,
  splitSegmentsBySpeakers,
  parseVtt,
  remapSpeakers,
} from '../utils/diarization-merge';

export interface DiarizeParams {
  /** When set to a positive integer, force exactly that many clusters. */
  numClusters?: number;
  /** Cosine-distance cutoff for the agglomerative dendrogram. Higher ⇒ fewer clusters. */
  threshold?: number;
  /** Drop micro-clusters below this fraction of total speech time (auto-detect only). */
  minDurationRatio?: number;
  /** Minimum speech run (seconds) emitted by pyannote segmentation. */
  minDurationOn?: number;
  /** Minimum silence (seconds) needed to separate two speaker turns. */
  minDurationOff?: number;
  /** Token-smoothing window for mergeTokensWithDiarization (in tokens). */
  minRun?: number;
}

export interface DiarizeResult {
  /** Speaker-tagged transcript ready to render, produced by aligning the
   *  whisper JSON tokens to the diarization timeline. */
  segments: TranscribedSegment[];
  speakerCount: number;
  /** Which path produced the result; useful for telemetry. */
  strategy: 'channel' | 'sherpa-fresh' | 'sherpa-recluster';
  /** True when the result came out of the cached-embeddings recluster. */
  cached: boolean;
}

interface EmbeddingCacheEntry {
  /** Segment time ranges (sherpa-derived). */
  segmentTimestamps: { start: number; end: number }[];
  /** Per-segment speaker embedding, indexed in lockstep with segmentTimestamps. */
  embeddings: Float32Array[];
  /** Segmentation params used to produce these embeddings. If a fresh
   *  request comes in with different minDurationOn/Off, the segments
   *  would shift and the cached embeddings can no longer be trusted —
   *  we invalidate and re-run sherpa from scratch. */
  segmentationParams: {
    minDurationOn: number;
    minDurationOff: number;
  };
}

const DEFAULT_SEGMENTATION = {
  minDurationOn: 0.6,
  minDurationOff: 0.7,
};

function effectiveSegmentationParams(params: DiarizeParams): {
  minDurationOn: number;
  minDurationOff: number;
} {
  return {
    minDurationOn: params.minDurationOn ?? DEFAULT_SEGMENTATION.minDurationOn,
    minDurationOff: params.minDurationOff ?? DEFAULT_SEGMENTATION.minDurationOff,
  };
}

function segmentationParamsMatch(
  a: { minDurationOn: number; minDurationOff: number },
  b: { minDurationOn: number; minDurationOff: number }
): boolean {
  return a.minDurationOn === b.minDurationOn && a.minDurationOff === b.minDurationOff;
}

const embeddingCache = new Map<string, EmbeddingCacheEntry>();

let inFlightAbort: AbortController | null = null;

/**
 * Run diarization on a cached audio entry. Honours the embedding cache:
 * first call extracts and caches; subsequent calls just re-cluster.
 */
export async function diarize(audioId: string, params: DiarizeParams = {}): Promise<DiarizeResult> {
  const entry = audioCache.get(audioId);
  if (!entry) {
    throw new Error(`Audio entry not found in cache: ${audioId}`);
  }

  const diarSegments = await produceDiarizationSegments(audioId, entry, params);
  const merged = alignWithTranscript(entry, diarSegments.segments, params.minRun);
  return {
    segments: merged.segments,
    speakerCount: merged.speakerCount,
    strategy: diarSegments.strategy,
    cached: diarSegments.cached,
  };
}

interface RawDiarOutcome {
  segments: DiarizationSegment[];
  strategy: 'channel' | 'sherpa-fresh' | 'sherpa-recluster';
  cached: boolean;
}

async function produceDiarizationSegments(
  audioId: string,
  entry: { monoWavPath: string; stereoWavPath?: string },
  params: DiarizeParams
): Promise<RawDiarOutcome> {
  // 1) Channel-based fast-path. Only when we have a stereo wav AND the
  //    user did not explicitly request a speaker count other than 2.
  const userExplicitCount = typeof params.numClusters === 'number' && params.numClusters > 0;
  const channelCompatibleCount = !userExplicitCount || params.numClusters === 2;
  if (entry.stereoWavPath && channelCompatibleCount && fs.existsSync(entry.stereoWavPath)) {
    try {
      const stereo = parseStereoWav(entry.stereoWavPath);
      const analysis = analyzeChannels(stereo.left, stereo.right);
      log.info('[diarize-service] channel analysis', {
        audioId,
        correlation: analysis.correlation.toFixed(3),
        dominanceFrameRatio: analysis.dominanceFrameRatio.toFixed(3),
        isPerChannel: analysis.isPerChannel,
      });
      if (analysis.isPerChannel) {
        const segments = diarizeFromChannels(stereo.left, stereo.right, stereo.sampleRate);
        log.info('[diarize-service] channel fast-path used', { audioId });
        return { segments, strategy: 'channel', cached: false };
      }
    } catch (err) {
      log.warn('[diarize-service] channel analysis failed; falling back to sherpa', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2) Cache hit — re-cluster instantly from cached embeddings, BUT
  //    only if the segmentation params still match the ones that
  //    produced those embeddings. minDurationOn/Off changes shift the
  //    segment boundaries themselves, so the cached vectors no longer
  //    line up and we have to re-run sherpa.
  const cachedEmbeddings = embeddingCache.get(audioId);
  const requestedSeg = effectiveSegmentationParams(params);
  if (cachedEmbeddings) {
    if (segmentationParamsMatch(cachedEmbeddings.segmentationParams, requestedSeg)) {
      return reclusterFromCache(audioId, cachedEmbeddings, params);
    }
    log.info('[diarize-service] embedding cache invalidated — segmentation params changed', {
      audioId,
      cached: cachedEmbeddings.segmentationParams,
      requested: requestedSeg,
    });
    embeddingCache.delete(audioId);
  }

  // 3) Fresh sherpa run. Extracts embeddings, caches them, then clusters.
  return runSherpaFresh(audioId, entry.monoWavPath, params);
}

function reclusterFromCache(
  audioId: string,
  cached: EmbeddingCacheEntry,
  params: DiarizeParams
): RawDiarOutcome {
  log.info('[diarize-service] reclustering from cache', {
    audioId,
    segmentCount: cached.segmentTimestamps.length,
  });
  const labels = clusterEmbeddings(cached.embeddings, {
    numClusters: params.numClusters,
    threshold: params.threshold,
  });
  let segments: DiarizationSegment[] = cached.segmentTimestamps.map((s, i) => ({
    start: s.start,
    end: s.end,
    speaker: labels[i] ?? 0,
  }));
  segments = applyAutoCleanup(segments, params);
  return { segments, strategy: 'sherpa-recluster', cached: true };
}

async function runSherpaFresh(
  audioId: string,
  monoWavPath: string,
  params: DiarizeParams
): Promise<RawDiarOutcome> {
  // Cancel any earlier in-flight run before starting a new one. The
  // service intentionally only allows one ML call at a time globally.
  inFlightAbort?.abort();
  const abort = new AbortController();
  inFlightAbort = abort;

  const seg = effectiveSegmentationParams(params);

  try {
    const result = await runDiarization(
      monoWavPath,
      {
        numClusters: params.numClusters,
        threshold: params.threshold,
        minDurationOn: seg.minDurationOn,
        minDurationOff: seg.minDurationOff,
        withEmbeddings: true,
      },
      abort.signal
    );

    if (result.embeddings && result.embeddings.length === result.segments.length) {
      embeddingCache.set(audioId, {
        segmentTimestamps: result.segments.map((s) => ({ start: s.start, end: s.end })),
        embeddings: result.embeddings,
        segmentationParams: seg,
      });
      log.info('[diarize-service] embedding cache populated', {
        audioId,
        count: result.embeddings.length,
        dim: result.embeddings[0]?.length ?? 0,
        seg,
      });
    } else {
      log.warn('[diarize-service] embeddings missing from runner result; cache not populated', {
        embeddingsCount: result.embeddings?.length ?? 0,
        segmentsCount: result.segments.length,
      });
    }

    let segments = result.segments;
    segments = applyAutoCleanup(segments, params);
    return { segments, strategy: 'sherpa-fresh', cached: false };
  } finally {
    if (inFlightAbort === abort) inFlightAbort = null;
  }
}

interface AlignedTranscript {
  segments: TranscribedSegment[];
  speakerCount: number;
}

function alignWithTranscript(
  entry: { whisperJsonPath?: string; whisperVttPath?: string },
  diarSegments: DiarizationSegment[],
  minRun?: number
): AlignedTranscript {
  // Prefer the token-level merge from whisper's --output-json-full. If
  // the JSON is missing or unparseable, fall back to the proportional
  // VTT splitter (less precise but still produces a usable transcript).
  if (entry.whisperJsonPath && fs.existsSync(entry.whisperJsonPath)) {
    try {
      const jsonText = fs.readFileSync(entry.whisperJsonPath, 'utf-8');
      const tokens = parseWhisperJsonFull(jsonText);
      if (tokens.length > 0) {
        const tagged = mergeTokensWithDiarization(tokens, diarSegments, minRun);
        const { segments, speakerCount } = remapSpeakers(tagged);
        return { segments, speakerCount };
      }
    } catch (err) {
      log.warn('[diarize-service] whisper JSON merge failed; falling back to VTT', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (entry.whisperVttPath && fs.existsSync(entry.whisperVttPath)) {
    try {
      const vtt = fs.readFileSync(entry.whisperVttPath, 'utf-8');
      const whisperSegs = parseVtt(vtt);
      const tagged = splitSegmentsBySpeakers(whisperSegs, diarSegments);
      const { segments, speakerCount } = remapSpeakers(tagged);
      return { segments, speakerCount };
    } catch (err) {
      log.warn('[diarize-service] VTT fallback failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // No whisper output to align against — return the bare diarization
  // segments with empty text. The renderer will show speaker bands
  // with no words, which is at least honest about the failure.
  const tagged = diarSegments.map((s) => ({
    start: s.start,
    end: s.end,
    text: '',
    speaker: s.speaker,
  }));
  const remapped = remapSpeakers(tagged);
  return {
    segments: remapped.segments.map<TranscribedSegment>((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
    })),
    speakerCount: remapped.speakerCount,
  };
}

function applyAutoCleanup(
  segments: DiarizationSegment[],
  params: DiarizeParams
): DiarizationSegment[] {
  // Only the auto-detect path benefits from culling micro-clusters; if
  // the caller forced a fixed speaker count we trust their choice.
  if (typeof params.numClusters === 'number' && params.numClusters > 0) return segments;
  return dropTinyDiarizationClusters(segments, params.minDurationRatio ?? 0.05);
}

export function cancel(): void {
  inFlightAbort?.abort();
}

/**
 * Drop the cached embeddings for an audio entry. Called when the audio
 * cache itself releases that entry (transcript removed, etc.) so we
 * don't hold onto stale vectors.
 */
export function releaseEmbeddings(audioId: string): void {
  if (embeddingCache.delete(audioId)) {
    log.info('[diarize-service] embedding cache evicted', { audioId });
  }
}

export function isAbortError(err: unknown): err is DiarizationAbortedError {
  return err instanceof DiarizationAbortedError;
}
