declare module 'sherpa-onnx-node' {
  export interface OfflineSpeakerDiarizationConfig {
    segmentation: {
      pyannote: { model: string };
      numThreads?: number;
      debug?: boolean | number;
      provider?: string;
    };
    embedding: {
      model: string;
      numThreads?: number;
      debug?: boolean | number;
      provider?: string;
    };
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

  /**
   * Used by SpeakerEmbeddingExtractor (and other streaming primitives) as
   * the in-memory audio buffer wrapper. We only need a tiny subset of its
   * API for offline embedding extraction.
   */
  export class OnlineStream {
    acceptWaveform(arg: { sampleRate: number; samples: Float32Array }): void;
    inputFinished(): void;
  }

  export interface SpeakerEmbeddingExtractorConfig {
    model: string;
    numThreads?: number;
    debug?: boolean | number;
    provider?: string;
  }

  export class SpeakerEmbeddingExtractor {
    constructor(config: SpeakerEmbeddingExtractorConfig);
    readonly dim: number;
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    compute(stream: OnlineStream, enableExternalBuffer?: boolean): Float32Array;
  }
}
