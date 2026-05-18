import { parentPort, workerData } from 'worker_threads';
import { OfflineSpeakerDiarization, readWave } from 'sherpa-onnx-node';

interface WorkerInput {
  wavPath: string;
  modelPaths: { segmentation: string; embedding: string };
  clustering: { numClusters: number; threshold: number };
  minDurationOn?: number;
  minDurationOff?: number;
}

function main(): void {
  const data = workerData as WorkerInput;

  try {
    const sd = new OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: data.modelPaths.segmentation } },
      embedding: { model: data.modelPaths.embedding },
      clustering: data.clustering,
      minDurationOn: data.minDurationOn ?? 0.2,
      minDurationOff: data.minDurationOff ?? 0.5,
    });

    const wave = readWave(data.wavPath);
    if (sd.sampleRate !== wave.sampleRate) {
      throw new Error(
        `Diarization sample rate mismatch: expected ${sd.sampleRate}, got ${wave.sampleRate}`
      );
    }

    const segments = sd.process(wave.samples);
    parentPort?.postMessage({ type: 'result', segments });
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

main();
