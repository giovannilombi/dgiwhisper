import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import type { DiarizationOptions, DiarizationSegment } from '../../shared/types';

// Evaluated lazily — accessing app.isPackaged at module load time can fail
// in the bundled main.cjs depending on import order with Electron's loader.
function isDevEnv(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

interface ModelPaths {
  segmentation: string;
  embedding: string;
}

function getModelsBaseDir(): string {
  if (isDevEnv()) {
    return path.join(process.cwd(), 'bin', 'diarization-models');
  }
  const unpacked = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'bin',
    'diarization-models'
  );
  if (fs.existsSync(unpacked)) {
    return unpacked;
  }
  return path.join(process.resourcesPath, 'bin', 'diarization-models');
}

function getModelPaths(): ModelPaths {
  const baseDir = getModelsBaseDir();
  return {
    segmentation: path.join(baseDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx'),
    // WeSpeaker ResNet293 + large-margin fine-tuning. State of the art
    // for speaker embedding in our ecosystem (~0.45% EER on VoxCeleb-O,
    // vs ~0.66% for TitaNet Large). VoxCeleb 1+2 contain Italian, French,
    // Spanish, German speakers among many others, so the model generalises
    // well to non-English Western speech. The model is ~3-4× slower than
    // TitaNet but still tractable for offline runs and the diarization
    // quality improvement is worth the extra latency.
    embedding: path.join(baseDir, 'wespeaker_en_voxceleb_resnet293_LM.onnx'),
  };
}

function getRunnerPath(): string {
  return path.join(__dirname, 'diarization-worker.cjs');
}

export function isDiarizationAvailable(): boolean {
  const paths = getModelPaths();
  return fs.existsSync(paths.segmentation) && fs.existsSync(paths.embedding);
}

export class DiarizationAbortedError extends Error {
  constructor() {
    super('Diarization aborted');
    this.name = 'DiarizationAbortedError';
  }
}

interface RunnerResponse {
  success: boolean;
  segments?: DiarizationSegment[];
  embeddings?: { dim: number; count: number; b64: string };
  error?: string;
}

export interface RunDiarizationResult {
  segments: DiarizationSegment[];
  /**
   * When `withEmbeddings: true` was passed, each segment carries a
   * corresponding speaker embedding here (same order, same length).
   * The diarize-service caches these so re-clustering with different
   * params can run in milliseconds without re-touching the audio.
   */
  embeddings?: Float32Array[];
}

export interface RunDiarizationOptions extends DiarizationOptions {
  withEmbeddings?: boolean;
}

function decodeEmbeddings(payload: { dim: number; count: number; b64: string }): Float32Array[] {
  const raw = Buffer.from(payload.b64, 'base64');
  const floats = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  const out: Float32Array[] = new Array(payload.count);
  for (let i = 0; i < payload.count; i++) {
    // Copy each slice into a fresh JS-heap-backed Float32Array so the
    // underlying Buffer can be GC'd without keeping the whole base64
    // payload alive.
    const slice = new Float32Array(payload.dim);
    slice.set(floats.subarray(i * payload.dim, (i + 1) * payload.dim));
    out[i] = slice;
  }
  return out;
}

// Run diarization in a separate Electron-in-Node-mode child process.
// We spawn process.execPath (the Electron binary) with
// ELECTRON_RUN_AS_NODE=1 so the child is a plain Node runtime — outside
// the V8 sandbox of the main process which rejects sherpa-onnx-node's
// N-API external buffers ("External buffers are not allowed").
export function runDiarization(
  wavPath: string,
  options: RunDiarizationOptions = {},
  signal?: AbortSignal
): Promise<RunDiarizationResult> {
  return new Promise((resolve, reject) => {
    log.info('[diarization] runDiarization called', { wavPath });

    if (signal?.aborted) {
      log.warn('[diarization] aborted before start');
      reject(new DiarizationAbortedError());
      return;
    }

    const modelPaths = getModelPaths();
    log.info('[diarization] model paths', modelPaths);

    if (!fs.existsSync(modelPaths.segmentation) || !fs.existsSync(modelPaths.embedding)) {
      log.error('[diarization] model files missing', {
        segmentationExists: fs.existsSync(modelPaths.segmentation),
        embeddingExists: fs.existsSync(modelPaths.embedding),
      });
      reject(
        new Error(
          'Speaker diarization models are missing. Run "npm run setup:diarization" or rebuild the app.'
        )
      );
      return;
    }
    if (!fs.existsSync(wavPath)) {
      log.error('[diarization] wav file missing at runtime', { wavPath });
      reject(new Error(`Audio file not found for diarization: ${wavPath}`));
      return;
    }

    const runnerPath = getRunnerPath();
    if (!fs.existsSync(runnerPath)) {
      reject(new Error(`Diarization runner not found at ${runnerPath}`));
      return;
    }

    // Each of these has a default mirrored in the worker; we still
    // surface them explicitly here so the renderer's "Personalizzata"
    // panel can override them on a per-run basis.
    const clusteringPayload = {
      numClusters: options.numClusters ?? -1,
      // sherpa-onnx FastClustering uses `threshold` as a cosine-DISTANCE
      // cutoff on the agglomerative dendrogram. Higher threshold → cut
      // higher → MORE merges → FEWER clusters. Default 0.5 works for
      // general it/en speech with WeSpeaker ResNet293.
      threshold: options.threshold ?? 0.5,
    };
    const minDurationOn = options.minDurationOn;
    const minDurationOff = options.minDurationOff;

    const payload = JSON.stringify({
      wavPath,
      modelPaths,
      clustering: clusteringPayload,
      withEmbeddings: options.withEmbeddings === true,
      // pyannote segmentation thresholds: only forwarded when the
      // caller actually overrode them, otherwise the worker keeps its
      // own defaults (0.6 / 0.7).
      ...(typeof minDurationOn === 'number' ? { minDurationOn } : {}),
      ...(typeof minDurationOff === 'number' ? { minDurationOff } : {}),
    });

    log.info('[diarization] spawning runner', { runnerPath, execPath: process.execPath });
    const startedAt = Date.now();

    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [runnerPath], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      log.error('[diarization] failed to spawn runner', {
        message: err instanceof Error ? err.message : String(err),
      });
      reject(err);
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let aborted = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    const onAbort = () => {
      aborted = true;
      log.warn('[diarization] abort signal received, killing runner');
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf += data.toString('utf-8');
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString('utf-8');
      stderrBuf += chunk;
      // Forward runner logs to the main electron-log file
      chunk
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .forEach((line) => log.info(line));
    });

    child.on('error', (err) => {
      log.error('[diarization] runner spawn error', {
        message: err.message,
      });
      finish(() => reject(err));
    });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      log.info(`[diarization] runner closed after ${elapsed}s`, {
        code,
        aborted,
        stdoutLength: stdoutBuf.length,
      });
      if (settled) return;
      if (aborted) {
        finish(() => reject(new DiarizationAbortedError()));
        return;
      }

      const trimmed = stdoutBuf.trim();
      if (!trimmed) {
        finish(() =>
          reject(
            new Error(`Diarization runner exited with code ${code} and no output. ${stderrBuf}`)
          )
        );
        return;
      }

      let parsed: RunnerResponse;
      try {
        // Find the JSON payload — runner emits exactly one JSON line.
        const lastLine =
          trimmed
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .pop() ?? '';
        parsed = JSON.parse(lastLine) as RunnerResponse;
      } catch (err) {
        log.error('[diarization] failed to parse runner output', {
          stdout: trimmed.slice(0, 500),
          err: err instanceof Error ? err.message : String(err),
        });
        finish(() =>
          reject(
            new Error(
              `Diarization runner produced invalid JSON. ${err instanceof Error ? err.message : String(err)}`
            )
          )
        );
        return;
      }

      if (!parsed.success) {
        finish(() => reject(new Error(parsed.error ?? 'Diarization runner reported failure')));
        return;
      }

      const result: RunDiarizationResult = {
        segments: parsed.segments ?? [],
      };
      if (parsed.embeddings) {
        try {
          result.embeddings = decodeEmbeddings(parsed.embeddings);
        } catch (err) {
          log.error('[diarization] failed to decode embeddings', {
            err: err instanceof Error ? err.message : String(err),
          });
          // Don't fail the whole call — the segments are still usable
          // without the cache, just without re-iteration speedup.
        }
      }
      finish(() => resolve(result));
    });

    // Hand the JSON config to the runner and close stdin
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
