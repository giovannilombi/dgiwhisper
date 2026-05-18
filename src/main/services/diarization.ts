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
    embedding: path.join(baseDir, '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'),
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
  error?: string;
}

// Run diarization in a separate Electron-in-Node-mode child process.
// We spawn process.execPath (the Electron binary) with
// ELECTRON_RUN_AS_NODE=1 so the child is a plain Node runtime — outside
// the V8 sandbox of the main process which rejects sherpa-onnx-node's
// N-API external buffers ("External buffers are not allowed").
export function runDiarization(
  wavPath: string,
  options: DiarizationOptions = {},
  signal?: AbortSignal
): Promise<DiarizationSegment[]> {
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

    const payload = JSON.stringify({
      wavPath,
      modelPaths,
      clustering: {
        numClusters: options.numClusters ?? -1,
        // Cosine distance threshold: pairs of embeddings with distance
        // BELOW this value are merged into the same speaker. Higher value
        // = more aggressive merging = fewer clusters. 0.7 works well for
        // common 2-4 speaker recordings; the previous 0.5 was over-
        // segmenting heavily on English audio.
        threshold: options.threshold ?? 0.7,
      },
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

      finish(() => resolve(parsed.segments ?? []));
    });

    // Hand the JSON config to the runner and close stdin
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
