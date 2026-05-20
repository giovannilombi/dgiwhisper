// Standalone diarization runner.
//
// Executed as a child process via process.execPath (Electron binary) with
// ELECTRON_RUN_AS_NODE=1. We bypass sherpa-onnx-node's readWave() because
// it returns Float32Array views backed by N-API external memory, which V8
// in Electron 39 rejects with "External buffers are not allowed". Instead
// we parse the WAV file ourselves into a regular heap-allocated
// Float32Array and feed THAT to sd.process(). The process() output is a
// plain JS array of segment objects so it crosses the IPC boundary fine.
//
// Protocol: JSON config on stdin, JSON result on stdout, logs on stderr.

import fs from 'fs';
import os from 'os';
import { OfflineSpeakerDiarization, SpeakerEmbeddingExtractor } from 'sherpa-onnx-node';

interface RunnerInput {
  wavPath: string;
  modelPaths: { segmentation: string; embedding: string };
  clustering: { numClusters: number; threshold: number };
  minDurationOn?: number;
  minDurationOff?: number;
  /**
   * When true, the runner additionally extracts a per-segment speaker
   * embedding via SpeakerEmbeddingExtractor and ships it back to the
   * main process so it can be cached. The downstream diarize-service
   * uses the cache to re-cluster instantly when the user tweaks
   * parameters, without re-running the heavy ML pipeline.
   */
  withEmbeddings?: boolean;
}

interface RunnerOutput {
  success: boolean;
  segments?: { start: number; end: number; speaker: number }[];
  embeddings?: { dim: number; count: number; b64: string };
  error?: string;
}

function log(step: string, extra?: Record<string, unknown>): void {
  console.error(`[diarization-runner] ${step}`, extra ?? '');
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

/**
 * Serialize `payload` to stdout and resolve only after the kernel pipe
 * buffer has actually drained. The embedding payload can be hundreds of
 * KB while the OS pipe buffer is ~64 KB, so the previous code that
 * called `process.exit()` right after `write()` was losing everything
 * past the first 64 KB on the receiving side.
 */
function emit(payload: RunnerOutput): Promise<void> {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload) + '\n';
    const flushed = process.stdout.write(data, () => resolve());
    // If `write()` returned true the data was synchronously written and
    // the callback will still fire on the next tick — either way the
    // promise resolves after the byte is actually out.
    void flushed;
  });
}

interface ParsedWav {
  samples: Float32Array;
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
}

/**
 * Minimal RIFF/WAVE parser tailored to the audio our ffmpeg pipeline
 * produces (16 kHz mono PCM 16-bit). It also handles 32-bit float PCM and
 * stereo (mixed down to mono) for robustness. The returned samples are a
 * regular Float32Array backed by a JS heap ArrayBuffer — no external
 * memory — so sd.process() can consume them under V8's sandbox.
 */
function parseWav(filePath: string): ParsedWav {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 44) throw new Error(`WAV file too small: ${buf.length} bytes`);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a RIFF file');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');

  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
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

    offset = payloadStart + chunkSize + (chunkSize & 1); // pad to even
  }

  if (dataStart < 0) throw new Error('WAV file is missing a data chunk');
  if (numChannels < 1) throw new Error(`Invalid channel count: ${numChannels}`);
  if (sampleRate < 1) throw new Error(`Invalid sample rate: ${sampleRate}`);

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataLength / frameSize);
  const samples = new Float32Array(frameCount);

  if (audioFormat === 1 && bitsPerSample === 16) {
    // PCM 16-bit signed little-endian. For the common 16 kHz mono case
    // produced by our ffmpeg pipeline we can decode via a single typed
    // array view + bulk loop instead of a per-sample Buffer.readInt16LE,
    // which is roughly an order of magnitude faster on long audio.
    if (numChannels === 1) {
      const i16 = new Int16Array(buf.buffer, buf.byteOffset + dataStart, frameCount);
      for (let i = 0; i < frameCount; i++) {
        samples[i] = i16[i]! / 32768;
      }
    } else {
      for (let i = 0; i < frameCount; i++) {
        let acc = 0;
        const base = dataStart + i * frameSize;
        for (let c = 0; c < numChannels; c++) {
          acc += buf.readInt16LE(base + c * 2);
        }
        samples[i] = acc / numChannels / 32768;
      }
    }
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    // IEEE float 32-bit
    for (let i = 0; i < frameCount; i++) {
      let acc = 0;
      const base = dataStart + i * frameSize;
      for (let c = 0; c < numChannels; c++) {
        acc += buf.readFloatLE(base + c * 4);
      }
      samples[i] = acc / numChannels;
    }
  } else if (audioFormat === 1 && bitsPerSample === 8) {
    // PCM 8-bit unsigned
    for (let i = 0; i < frameCount; i++) {
      let acc = 0;
      const base = dataStart + i * frameSize;
      for (let c = 0; c < numChannels; c++) {
        acc += buf.readUInt8(base + c) - 128;
      }
      samples[i] = acc / numChannels / 128;
    }
  } else {
    throw new Error(
      `Unsupported WAV format: audioFormat=${audioFormat}, bitsPerSample=${bitsPerSample}`
    );
  }

  return { samples, sampleRate, numChannels, bitsPerSample };
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readAllStdin();
  } catch (err) {
    await emit({ success: false, error: `Failed to read stdin: ${(err as Error).message}` });
    process.exit(1);
  }

  let input: RunnerInput;
  try {
    input = JSON.parse(raw) as RunnerInput;
  } catch (err) {
    await emit({ success: false, error: `Invalid JSON config: ${(err as Error).message}` });
    process.exit(1);
  }

  log('start', { wavPath: input.wavPath });

  // Both ONNX models default to a single inference thread; on modern Macs
  // that leaves most of the CPU idle. Use roughly half the available cores
  // (capped at 6) — the embedding extractor is invoked many times in
  // sequence and benefits the most, while leaving enough headroom for
  // whisper.cpp which is potentially running in parallel.
  const numThreads = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));
  log('thread config', { numThreads });

  try {
    const sd = new OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: input.modelPaths.segmentation },
        numThreads,
      },
      embedding: { model: input.modelPaths.embedding, numThreads },
      clustering: input.clustering,
      // minDurationOn = shortest speech run pyannote will emit. The
      // upstream default of 0.2s gives sub-500ms segments that are too
      // short to extract a reliable embedding. 0.6s is the sweet spot
      // with WeSpeaker ResNet293: long enough to give the embedding
      // model a meaningful window, short enough to keep genuine short
      // interjections (1–2 words). With weaker embeddings (e.g. TitaNet)
      // we had to push this to 1.2s to compensate for noisier vectors —
      // ResNet293 doesn't need that crutch.
      minDurationOn: input.minDurationOn ?? 0.6,
      // minDurationOff = shortest silence pyannote will treat as a
      // boundary between two speaker turns. 0.7s prevents a single
      // breath pause from splitting one speaker's run into two
      // separate cluster-target segments.
      minDurationOff: input.minDurationOff ?? 0.7,
    });
    log('OfflineSpeakerDiarization ready', { sampleRate: sd.sampleRate });

    const wave = parseWav(input.wavPath);
    log('wav parsed', {
      sampleRate: wave.sampleRate,
      sampleCount: wave.samples.length,
      numChannels: wave.numChannels,
      bitsPerSample: wave.bitsPerSample,
    });
    if (sd.sampleRate !== wave.sampleRate) {
      throw new Error(
        `Diarization sample rate mismatch: expected ${sd.sampleRate}, got ${wave.sampleRate}`
      );
    }

    const rawSegments = sd.process(wave.samples);
    const segments = Array.from(rawSegments, (s) => ({
      start: Number(s.start),
      end: Number(s.end),
      speaker: Number(s.speaker),
    }));
    log('process complete', { segmentCount: segments.length });

    let embeddingsPayload: RunnerOutput['embeddings'] | undefined;
    if (input.withEmbeddings && segments.length > 0) {
      log('extracting per-segment embeddings');
      const extractor = new SpeakerEmbeddingExtractor({
        model: input.modelPaths.embedding,
        numThreads,
      });
      const dim = extractor.dim;
      log('embedding extractor ready', { dim });

      const flat = new Float32Array(segments.length * dim);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const startSample = Math.max(0, Math.floor(seg.start * wave.sampleRate));
        const endSample = Math.min(wave.samples.length, Math.floor(seg.end * wave.sampleRate));
        if (endSample <= startSample) {
          // Empty/invalid segment — emit a zero embedding so indices stay aligned.
          continue;
        }
        const clip = wave.samples.subarray(startSample, endSample);
        const stream = extractor.createStream();
        stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: clip });
        stream.inputFinished();
        if (!extractor.isReady(stream)) {
          log('extractor not ready for segment, skipping', { segmentIndex: i });
          continue;
        }
        // `enableExternalBuffer=false` gives us a JS-heap-backed Float32Array,
        // not an N-API external buffer — necessary because we then copy it
        // into the `flat` array via Buffer write under V8's strict mode.
        const emb = extractor.compute(stream, false);
        flat.set(emb, i * dim);
      }

      const b64 = Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
      embeddingsPayload = { dim, count: segments.length, b64 };
      log('embeddings extracted', {
        count: segments.length,
        dim,
        bytesB64: b64.length,
      });
    }

    await emit({ success: true, segments, embeddings: embeddingsPayload });
    process.exit(0);
  } catch (err) {
    log('error', {
      message: err instanceof Error ? err.message : String(err),
    });
    await emit({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main();
