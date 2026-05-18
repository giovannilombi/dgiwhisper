import path from 'path';
import fs from 'fs';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import type { DiarizationOptions, DiarizationSegment } from '../../shared/types';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

interface ModelPaths {
  segmentation: string;
  embedding: string;
}

function getModelsBaseDir(): string {
  if (isDev) {
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
    embedding: path.join(baseDir, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'),
  };
}

function getWorkerPath(): string {
  return path.join(__dirname, 'diarization-worker.cjs');
}

export function isDiarizationAvailable(): boolean {
  const paths = getModelPaths();
  return fs.existsSync(paths.segmentation) && fs.existsSync(paths.embedding);
}

export function runDiarization(
  wavPath: string,
  options: DiarizationOptions = {}
): Promise<DiarizationSegment[]> {
  return new Promise((resolve, reject) => {
    const modelPaths = getModelPaths();

    if (!fs.existsSync(modelPaths.segmentation) || !fs.existsSync(modelPaths.embedding)) {
      reject(
        new Error(
          'Speaker diarization models are missing. Run "npm run setup:diarization" or rebuild the app.'
        )
      );
      return;
    }
    if (!fs.existsSync(wavPath)) {
      reject(new Error(`Audio file not found for diarization: ${wavPath}`));
      return;
    }

    const workerPath = getWorkerPath();
    if (!fs.existsSync(workerPath)) {
      reject(new Error(`Diarization worker not found at ${workerPath}`));
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: {
        wavPath,
        modelPaths,
        clustering: {
          numClusters: options.numClusters ?? -1,
          threshold: options.threshold ?? 0.5,
        },
      },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      worker.terminate().catch(() => {});
    };

    worker.on(
      'message',
      (msg: { type: string; segments?: DiarizationSegment[]; message?: string }) => {
        if (msg.type === 'result' && msg.segments) {
          finish(() => resolve(msg.segments as DiarizationSegment[]));
        } else if (msg.type === 'error') {
          finish(() => reject(new Error(msg.message ?? 'Diarization worker error')));
        }
      }
    );

    worker.on('error', (err) => {
      finish(() => reject(err));
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !settled) {
        finish(() => reject(new Error(`Diarization worker exited with code ${code}`)));
      }
    });
  });
}
