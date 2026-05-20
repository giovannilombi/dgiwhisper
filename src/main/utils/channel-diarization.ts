// Channel-based speaker diarization for stereo recordings where each
// speaker sits on one channel (per-channel call recordings, podcasts
// kept separate, some Zoom exports). When the input genuinely is
// per-channel we get a deterministic, near-perfect diarization in
// milliseconds — no ML, no sherpa, no clustering. When it isn't, we
// detect that and let the regular pipeline run instead.
//
// Detection criteria (must hold AT THE SAME TIME):
//   1. Cross-channel sample-wise Pearson correlation is low (channels
//      carry different content).
//   2. A significant fraction of speech frames are dominated by ONE
//      channel (energy ratio above DOMINANCE_RATIO_DB).
// Mixed stereo where both channels carry the same conversation will
// fail #1; symmetric room recordings where both mics hear both
// speakers equally will fail #2.

import fs from 'fs';
import type { DiarizationSegment } from '../../shared/types';

// Per-frame energy is computed over 20 ms hops at 16 kHz.
const FRAME_MS = 20;
const SAMPLES_PER_FRAME_16K = (16_000 * FRAME_MS) / 1000;

// Detection thresholds — tuned to avoid false positives. A false negative
// just means we fall back to the regular pipeline, but a false positive
// would silently produce a terrible diarization for a mixed recording.
const MAX_CORRELATION_FOR_PER_CHANNEL = 0.4;
const MIN_DOMINANCE_FRAME_RATIO = 0.3;
const DOMINANCE_RATIO_DB = 6; // one channel must be ≥6 dB above the other
const SPEECH_FLOOR_DBFS = -45; // below this, treat as silence

// Hangover: don't switch speaker on a single 20 ms frame. We require
// at least this many consecutive dominant frames before we change.
const MIN_TURN_FRAMES = 5; // 5 × 20 ms = 100 ms

export interface ChannelAnalysis {
  /** Whether the recording looks like per-channel stereo. */
  isPerChannel: boolean;
  /** Pearson correlation between the two channels. */
  correlation: number;
  /** Fraction of speech frames dominated by one channel above DOMINANCE_RATIO_DB. */
  dominanceFrameRatio: number;
  /** Total number of frames analyzed. */
  frameCount: number;
}

export interface ParsedStereoWav {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/**
 * Read a 16 kHz stereo PCM-16 WAV file produced by our ffmpeg pipeline
 * and return the two channels as separate Float32Arrays normalized to
 * [-1, 1]. We deliberately keep this tied to our own canonical format
 * — the diarization fast-path only runs against wavs we generated, so
 * we don't need to handle every WAV variant in the wild.
 */
export function parseStereoWav(filePath: string): ParsedStereoWav {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 44) throw new Error(`WAV too small: ${buf.length} bytes`);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a RIFF file');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');

  let offset = 12;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    if (chunkId === 'fmt ') {
      audioFormat = buf.readUInt16LE(payloadStart);
      numChannels = buf.readUInt16LE(payloadStart + 2);
      sampleRate = buf.readUInt32LE(payloadStart + 4);
      bitsPerSample = buf.readUInt16LE(payloadStart + 14);
    } else if (chunkId === 'data') {
      dataStart = payloadStart;
      dataLength = chunkSize;
      break;
    }
    offset = payloadStart + chunkSize + (chunkSize & 1);
  }
  if (dataStart < 0) throw new Error('WAV missing data chunk');
  if (numChannels !== 2) throw new Error(`Expected stereo, got ${numChannels} channels`);
  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error(`Expected PCM-16, got format=${audioFormat} bits=${bitsPerSample}`);
  }

  const frameCount = Math.floor(dataLength / 4); // 2 bytes × 2 channels
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const i16 = new Int16Array(buf.buffer, buf.byteOffset + dataStart, frameCount * 2);
  for (let i = 0; i < frameCount; i++) {
    left[i] = i16[i * 2]! / 32768;
    right[i] = i16[i * 2 + 1]! / 32768;
  }
  return { left, right, sampleRate };
}

interface FrameEnergy {
  startSample: number;
  endSample: number;
  /** Per-channel RMS energy on a dBFS scale. */
  leftDb: number;
  rightDb: number;
}

function rmsDb(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  if (rms <= 1e-10) return -Infinity;
  return 20 * Math.log10(rms);
}

function pearsonCorrelation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom <= 1e-12 ? 0 : cov / denom;
}

function computeFrameEnergies(left: Float32Array, right: Float32Array): FrameEnergy[] {
  const frames: FrameEnergy[] = [];
  const total = Math.min(left.length, right.length);
  for (let s = 0; s + SAMPLES_PER_FRAME_16K <= total; s += SAMPLES_PER_FRAME_16K) {
    const e = s + SAMPLES_PER_FRAME_16K;
    frames.push({
      startSample: s,
      endSample: e,
      leftDb: rmsDb(left, s, e),
      rightDb: rmsDb(right, s, e),
    });
  }
  return frames;
}

/**
 * Decide whether a stereo recording is "per-channel" — i.e., one
 * speaker per channel. Returns the decision along with the metrics
 * that fed into it, so callers can log them when they want to
 * understand a particular file's behaviour.
 */
export function analyzeChannels(left: Float32Array, right: Float32Array): ChannelAnalysis {
  const correlation = pearsonCorrelation(left, right);
  const frames = computeFrameEnergies(left, right);

  let speechFrames = 0;
  let dominantFrames = 0;
  for (const f of frames) {
    const louder = Math.max(f.leftDb, f.rightDb);
    if (louder < SPEECH_FLOOR_DBFS) continue;
    speechFrames++;
    if (Math.abs(f.leftDb - f.rightDb) >= DOMINANCE_RATIO_DB) dominantFrames++;
  }
  const dominanceFrameRatio = speechFrames === 0 ? 0 : dominantFrames / speechFrames;

  // We use absolute correlation so phase-inverted mixed stereo (rare but
  // real — same content with one channel flipped) is still rejected.
  // True per-channel recordings cluster near correlation = 0, not at
  // exactly 0, so the cutoff has to allow a small magnitude on either
  // side of zero.
  const isPerChannel =
    Math.abs(correlation) < MAX_CORRELATION_FOR_PER_CHANNEL &&
    dominanceFrameRatio >= MIN_DOMINANCE_FRAME_RATIO;

  return {
    isPerChannel,
    correlation,
    dominanceFrameRatio,
    frameCount: frames.length,
  };
}

/**
 * Build diarization segments from per-channel stereo audio. For each
 * frame, decide which channel (= which speaker) dominates: if neither
 * side reaches the speech floor it counts as silence, otherwise the
 * louder side wins. Consecutive same-speaker frames are merged into a
 * segment; brief excursions shorter than MIN_TURN_FRAMES (100 ms) are
 * absorbed into the surrounding turn so we don't flicker.
 *
 * Speaker IDs: 0 = left-channel speaker, 1 = right-channel speaker.
 */
export function diarizeFromChannels(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number = 16_000
): DiarizationSegment[] {
  const frames = computeFrameEnergies(left, right);
  if (frames.length === 0) return [];

  // First pass: raw frame-level speaker decision. -1 = silence.
  const rawSpeakers = frames.map((f) => {
    if (Math.max(f.leftDb, f.rightDb) < SPEECH_FLOOR_DBFS) return -1;
    if (f.leftDb - f.rightDb >= DOMINANCE_RATIO_DB) return 0;
    if (f.rightDb - f.leftDb >= DOMINANCE_RATIO_DB) return 1;
    // Both channels speaking around the same level → overlap. Attribute
    // to the slightly louder side; this happens rarely on truly
    // per-channel recordings.
    return f.leftDb >= f.rightDb ? 0 : 1;
  });

  // Second pass: absorb runs shorter than MIN_TURN_FRAMES into their
  // surrounding context. This kills micro-stutter where one frame
  // briefly crosses the dominance threshold the wrong way.
  const speakers = [...rawSpeakers];
  let i = 0;
  while (i < speakers.length) {
    let j = i;
    while (j < speakers.length && speakers[j] === speakers[i]) j++;
    const runLen = j - i;
    if (runLen < MIN_TURN_FRAMES && i > 0 && j < speakers.length) {
      const prev = speakers[i - 1]!;
      const next = speakers[j]!;
      if (prev === next) {
        for (let k = i; k < j; k++) speakers[k] = prev;
      }
    }
    i = j;
  }

  // Third pass: collapse same-speaker runs into segments. Silence
  // frames don't generate segments — they stay between turns.
  const segments: DiarizationSegment[] = [];
  i = 0;
  while (i < speakers.length) {
    const sp = speakers[i]!;
    if (sp < 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < speakers.length && speakers[j] === sp) j++;
    const startSample = frames[i]!.startSample;
    const endSample = frames[j - 1]!.endSample;
    segments.push({
      start: startSample / sampleRate,
      end: endSample / sampleRate,
      speaker: sp,
    });
    i = j;
  }
  return segments;
}
