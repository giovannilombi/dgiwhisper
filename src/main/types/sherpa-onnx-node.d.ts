declare module 'sherpa-onnx-node' {
  export interface OfflineSpeakerDiarizationConfig {
    segmentation: { pyannote: { model: string } };
    embedding: { model: string };
    clustering: { numClusters: number; threshold: number };
    minDurationOn?: number;
    minDurationOff?: number;
  }

  export interface OfflineSpeakerDiarizationSegment {
    start: number;
    end: number;
    speaker: number;
  }

  export class OfflineSpeakerDiarization {
    constructor(config: OfflineSpeakerDiarizationConfig);
    readonly sampleRate: number;
    process(samples: Float32Array): OfflineSpeakerDiarizationSegment[];
    setConfig(config: { clustering: { numClusters: number; threshold: number } }): void;
  }

  export interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  export function readWave(path: string): Wave;
}
