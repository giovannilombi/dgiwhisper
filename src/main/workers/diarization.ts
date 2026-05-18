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
import { OfflineSpeakerDiarization } from 'sherpa-onnx-node';

interface RunnerInput {
  wavPath: string;
  modelPaths: { segmentation: string; embedding: string };
  clustering: { numClusters: number; threshold: number };
  minDurationOn?: number;
  minDurationOff?: number;
}

interface RunnerOutput {
  success: boolean;
  segments?: { start: number; end: number; speaker: number }[];
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

function emit(payload: RunnerOutput): void {
  process.stdout.write(JSON.stringify(payload));
  process.stdout.write('\n');
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
    emit({ success: false, error: `Failed to read stdin: ${(err as Error).message}` });
    process.exit(1);
  }

  let input: RunnerInput;
  try {
    input = JSON.parse(raw) as RunnerInput;
  } catch (err) {
    emit({ success: false, error: `Invalid JSON config: ${(err as Error).message}` });
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
      minDurationOn: input.minDurationOn ?? 0.2,
      minDurationOff: input.minDurationOff ?? 0.5,
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
    emit({ success: true, segments });
    process.exit(0);
  } catch (err) {
    log('error', {
      message: err instanceof Error ? err.message : String(err),
    });
    emit({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main();
