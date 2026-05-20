import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { app } from 'electron';
import os from 'os';
import crypto from 'crypto';
import type {
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionProgress,
  ModelDownloadProgress,
  ModelInfo,
  GpuInfo,
  QualityLevel,
} from '../../shared/types';
import { sanitizePath } from '../../shared/utils';
import { detectGpuStatus } from './gpu-detector';
import { audioCache } from './audio-cache';
import log from 'electron-log';

interface WhisperModelInfo {
  size: string;
  url: string;
  quality: QualityLevel;
  speed: string;
}

export const MODELS: Record<string, WhisperModelInfo> = {
  tiny: {
    size: '75 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    quality: 1,
    speed: '~10x',
  },
  'tiny.en': {
    size: '75 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    quality: 1,
    speed: '~10x',
  },
  base: {
    size: '142 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    quality: 2,
    speed: '~7x',
  },
  'base.en': {
    size: '142 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    quality: 2,
    speed: '~7x',
  },
  small: {
    size: '466 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    quality: 3,
    speed: '~4x',
  },
  'small.en': {
    size: '466 MB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    quality: 3,
    speed: '~4x',
  },
  medium: {
    size: '1.5 GB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    quality: 4,
    speed: '~2x',
  },
  'medium.en': {
    size: '1.5 GB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    quality: 4,
    speed: '~2x',
  },
  'large-v3': {
    size: '3.1 GB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
    quality: 5,
    speed: '~1x',
  },
  'large-v3-turbo': {
    size: '1.6 GB',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    quality: 5,
    speed: '~2x',
  },
};

const MODEL_ALIASES: Record<string, string> = {
  large: 'large-v3',
  turbo: 'large-v3-turbo',
};

const SUBTITLE_MAX_SEGMENT_CHARS = 80;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

export function getWhisperBinaryPath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'bin', 'whisper-cli');
  } else {
    const unpackedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'bin',
      'whisper-cli'
    );
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    return path.join(process.resourcesPath, 'bin', 'whisper-cli');
  }
}

export function getModelsDir(): string {
  if (isDev) {
    const devModelsDir = path.join(process.cwd(), 'models');
    if (!fs.existsSync(devModelsDir)) {
      fs.mkdirSync(devModelsDir, { recursive: true });
    }
    return devModelsDir;
  }

  const userDataPath = app.getPath('userData');
  const modelsDir = path.join(userDataPath, 'models');

  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  return modelsDir;
}

export function getModelPath(modelName: string): string {
  if (!MODELS[modelName] && !MODEL_ALIASES[modelName]) {
    throw new Error(`Invalid model name: ${modelName}`);
  }

  if (modelName.includes('/') || modelName.includes('\\') || modelName.includes('..')) {
    throw new Error(`Invalid model name: ${modelName}`);
  }

  const actualModel = MODEL_ALIASES[modelName] || modelName;
  const modelsDir = getModelsDir();
  return path.join(modelsDir, `ggml-${actualModel}.bin`);
}

export function isModelDownloaded(modelName: string): boolean {
  try {
    const modelPath = getModelPath(modelName);
    return fs.existsSync(modelPath);
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function getActualModelSize(modelName: string): string | null {
  try {
    const modelPath = getModelPath(modelName);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      return formatFileSize(stats.size);
    }
    return null;
  } catch {
    return null;
  }
}

export function listModels(): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const [name, info] of Object.entries(MODELS)) {
    if (name.includes('.en')) continue;

    const downloaded = isModelDownloaded(name);
    const actualSize = downloaded ? getActualModelSize(name) : null;

    result.push({
      name,
      size: actualSize || info.size,
      quality: info.quality,
      speed: info.speed,
      downloaded,
      vram: 'N/A (CPU/Metal)', // whisper.cpp uses different memory model
    });
  }

  result.sort((a, b) => a.quality - b.quality);

  return result;
}

export function downloadModel(
  modelName: string,
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<{ success: boolean; model: string; path: string }> {
  return new Promise((resolve, reject) => {
    const actualModel = MODEL_ALIASES[modelName] || modelName;
    const modelInfo = MODELS[actualModel];

    if (!modelInfo) {
      reject(new Error(`Unknown model: ${modelName}`));
      return;
    }

    const modelPath = getModelPath(actualModel);
    const tempPath = modelPath + '.tmp';

    // Create write stream
    const file = fs.createWriteStream(tempPath);

    const downloadWithRedirects = (url: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https
        .get(url, (response) => {
          // Handle redirects
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            downloadWithRedirects(response.headers.location, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedSize = 0;
          const startTime = Date.now();
          let lastUpdateTime = 0;
          const updateThrottle = 1000;

          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            file.write(chunk);

            if (onProgress && totalSize) {
              const now = Date.now();
              if (lastUpdateTime === 0 || now - lastUpdateTime >= updateThrottle) {
                lastUpdateTime = now;
                const percent = Math.round((downloadedSize / totalSize) * 100);

                const elapsedTime = (lastUpdateTime - startTime) / 1000;
                const speed = downloadedSize / elapsedTime;
                const remainingBytes = totalSize - downloadedSize;
                const remainingSeconds = remainingBytes / speed;

                let remainingTime = '';
                if (speed > 0 && Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
                  if (remainingSeconds < 60) {
                    remainingTime = `${Math.round(remainingSeconds)}s`;
                  } else {
                    remainingTime = `${Math.round(remainingSeconds / 60)}m`;
                  }
                } else {
                  remainingTime = '';
                }

                onProgress({
                  status: 'downloading',
                  model: actualModel,
                  percent,
                  downloaded: formatFileSize(downloadedSize),
                  total: formatFileSize(totalSize),
                  remainingTime,
                });
              }
            }
          });

          response.on('end', () => {
            file.end();
            fs.renameSync(tempPath, modelPath);
            resolve({ success: true, model: actualModel, path: modelPath });
          });

          response.on('error', (err) => {
            file.end();
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            reject(err);
          });
        })
        .on('error', (err) => {
          reject(err);
        });
    };

    downloadWithRedirects(modelInfo.url);
  });
}

export function deleteModel(modelName: string): { success: boolean; error?: string } {
  try {
    const modelPath = getModelPath(modelName);
    const modelsDir = getModelsDir();

    const resolvedPath = path.resolve(modelPath);
    const resolvedModelsDir = path.resolve(modelsDir);

    if (!resolvedPath.startsWith(resolvedModelsDir)) {
      return { success: false, error: 'Invalid model path' };
    }

    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      return { success: true };
    }
    return { success: false, error: 'Model not found' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// System-installed FFmpeg paths (preferred when present) and a bundled
// fallback that ships with the app so the user is not forced to brew install.
const SYSTEM_FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  'ffmpeg',
];

function getBundledFfmpegPath(): string | null {
  try {
    // Lazy require so missing optional install at dev-time doesn't crash.
    // The @ffmpeg-installer/ffmpeg package returns the absolute path of the
    // platform-specific binary, which electron-builder unpacks via asarUnpack.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require('@ffmpeg-installer/ffmpeg') as { path?: string };
    if (!installer?.path) return null;
    // In production the path computed inside app.asar must be rewritten to
    // app.asar.unpacked so the binary is actually executable on disk.
    const unpacked = installer.path.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`
    );
    return fs.existsSync(unpacked) ? unpacked : null;
  } catch {
    return null;
  }
}

function getFfmpegPaths(): string[] {
  const bundled = getBundledFfmpegPath();
  return bundled ? [...SYSTEM_FFMPEG_PATHS, bundled] : SYSTEM_FFMPEG_PATHS;
}

export async function checkFFmpeg(): Promise<boolean> {
  for (const p of getFfmpegPaths()) {
    try {
      if (path.isAbsolute(p) && !fs.existsSync(p)) {
        continue;
      }

      const works = await new Promise<boolean>((resolve) => {
        const proc = spawn(p, ['-version']);
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });
      });

      if (works) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function checkGpuStatus(): GpuInfo {
  return detectGpuStatus();
}

// Pull the input duration out of ffmpeg's stderr. ffmpeg prints exactly one
// line like `Duration: HH:MM:SS.ss, start: ...` for the input stream during
// header parsing; we surface this so the queue can show an ETA before the
// wav file even exists on disk.
const FFMPEG_DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;

// ffmpeg reports the input audio layout on its `Stream #...: Audio: ...`
// line in stderr — e.g. "Audio: pcm_s16le ... 48000 Hz, stereo, ...".
// We match the SOURCE stream (the first occurrence), not our output
// stream, because the output is always mono by our choice.
const FFMPEG_INPUT_AUDIO_RE = /Stream #0:\d+(?:\([\w ]+\))?: Audio: [^\n]*?, (?:\d+) Hz, ([^,\n]+)/;

function parseFfmpegDurationSec(stderrChunk: string): number | null {
  const m = stderrChunk.match(FFMPEG_DURATION_RE);
  if (!m) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mm = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  const frac = m[4] ? parseInt(m[4], 10) / Math.pow(10, m[4].length) : 0;
  const total = h * 3600 + mm * 60 + s + frac;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function parseFfmpegInputChannelCount(stderrChunk: string): number | null {
  const m = stderrChunk.match(FFMPEG_INPUT_AUDIO_RE);
  if (!m) return null;
  const layout = m[1]!.trim().toLowerCase();
  if (layout === 'mono') return 1;
  if (layout === 'stereo') return 2;
  // ffmpeg labels other layouts like "5.1", "5.1(side)", or "8 channels".
  const channelsMatch = layout.match(/^(\d+)\s+channels?$/);
  if (channelsMatch) return parseInt(channelsMatch[1]!, 10);
  if (layout.includes('5.1')) return 6;
  if (layout.includes('7.1')) return 8;
  return null;
}

function findFfmpegBinary(): string {
  for (const p of getFfmpegPaths()) {
    if (p === 'ffmpeg' || fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

interface ConvertResult {
  outputPath: string;
  inputChannelCount: number | null;
}

function convertToWav(
  inputPath: string,
  outputPath: string,
  options?: {
    channels?: 1 | 2;
    onDurationDetected?: (durationSec: number) => void;
  }
): Promise<ConvertResult> {
  const channels = options?.channels ?? 1;
  const onDurationDetected = options?.onDurationDetected;
  return new Promise((resolve, reject) => {
    const ffmpegPath = findFfmpegBinary();

    const args = [
      '-i',
      inputPath,
      '-vn', // Drop video streams if present
      '-ar',
      '16000', // 16kHz sample rate (required by Whisper)
      '-ac',
      String(channels),
      '-c:a',
      'pcm_s16le', // 16-bit PCM
      '-y', // Overwrite output
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let durationEmitted = false;
    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (!durationEmitted && onDurationDetected) {
        const dur = parseFfmpegDurationSec(stderr);
        if (dur !== null) {
          durationEmitted = true;
          onDurationDetected(dur);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ outputPath, inputChannelCount: parseFfmpegInputChannelCount(stderr) });
      } else {
        reject(new Error(`FFmpeg conversion failed: ${stderr}`));
      }
    });

    proc.on('error', (_err) => {
      reject(new Error(`FFmpeg not found. Please install: brew install ffmpeg`));
    });
  });
}

export function transcribe(
  options: TranscriptionOptions,
  onProgress?: (progress: TranscriptionProgress) => void
): Promise<TranscriptionResult> & { cancel?: () => void } {
  const { filePath, model, language, outputFormat } = options;
  let proc: ChildProcess | null = null;
  let cancelled = false;

  const promise = new Promise<TranscriptionResult>((resolve, reject) => {
    const run = async () => {
      const whisperPath = getWhisperBinaryPath();

      if (!fs.existsSync(whisperPath)) {
        reject(new Error('whisper.cpp binary not found. Please run: npm run setup:whisper'));
        return;
      }

      const actualModel = MODEL_ALIASES[model] || model || 'base';
      let modelPath;
      try {
        modelPath = getModelPath(actualModel);
      } catch (err) {
        reject(new Error(`Invalid model: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      if (!fs.existsSync(modelPath)) {
        reject(new Error(`Model '${actualModel}' not downloaded. Please download it first.`));
        return;
      }

      if (!fs.existsSync(filePath)) {
        reject(new Error(`Input file not found: ${filePath}`));
        return;
      }

      onProgress?.({ percent: 5, status: 'Preparing audio...', phase: 'preparing' });

      // We always convert to a 16 kHz mono PCM-16 wav, even when the input
      // is already wav — it might be 44.1 kHz / stereo, and downstream
      // sherpa-onnx needs the canonical format. We additionally produce
      // a stereo version when the source has ≥2 channels, so that the
      // diarize-service can later evaluate the channel-based fast-path.
      let monoWavPath = audioCache.buildTempPath('whisperdesk_mono');
      let stereoWavPath: string | null = null;
      let inputChannelCount: number | null = null;
      let audioDurationSec: number | undefined;
      let audioPath = monoWavPath;

      try {
        const convertResult = await convertToWav(filePath, monoWavPath, {
          channels: 1,
          onDurationDetected: (durationSec) => {
            audioDurationSec = durationSec;
            onProgress?.({
              percent: 10,
              status: 'Converting audio...',
              phase: 'converting',
              audioDurationSec,
            });
          },
        });
        monoWavPath = convertResult.outputPath;
        audioPath = monoWavPath;
        inputChannelCount = convertResult.inputChannelCount;
        onProgress?.({
          percent: 15,
          status: 'Audio converted. Starting transcription...',
          phase: 'converting',
          audioDurationSec,
        });
      } catch (err) {
        try {
          if (fs.existsSync(monoWavPath)) fs.unlinkSync(monoWavPath);
        } catch (e) {
          console.error('Failed to delete temp wav file on conversion error:', e);
        }
        reject(err);
        return;
      }

      if (inputChannelCount !== null && inputChannelCount >= 2) {
        // Worth keeping the stereo around in case the user later kicks off
        // diarization — the channel-based fast-path needs it. Failures
        // here are non-fatal: we just won't have the fast-path option.
        const candidate = audioCache.buildTempPath('whisperdesk_stereo');
        try {
          await convertToWav(filePath, candidate, { channels: 2 });
          stereoWavPath = candidate;
        } catch (err) {
          log.warn('[transcribe] stereo conversion failed; channel fast-path unavailable', {
            message: err instanceof Error ? err.message : String(err),
          });
          try {
            if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
          } catch {
            /* ignore */
          }
        }
      }

      // Fallback duration estimate when ffmpeg didn't report one — derive
      // from the wav file size (1 s ≈ 32_000 bytes at 16 kHz mono PCM-16).
      if (audioDurationSec === undefined) {
        try {
          if (fs.existsSync(audioPath)) {
            const sizeBytes = fs.statSync(audioPath).size;
            audioDurationSec = Math.max(0, (sizeBytes - 44) / 32_000);
          }
        } catch {
          audioDurationSec = undefined;
        }
      }

      onProgress?.({
        percent: 20,
        status: 'Transcribing...',
        phase: 'transcribing',
        audioDurationSec,
      });

      const outputBase = path.join(app.getPath('temp'), `whisper_output_${crypto.randomUUID()}`);
      const txtPath = outputBase + '.txt';
      const vttPath = outputBase + '.vtt';
      const jsonPath = outputBase + '.json';

      // Only the .txt file is a transient artefact; the .vtt and .json
      // outputs are kept and handed to the audio cache so the diarize-
      // service can align tokens against the diarization timeline later
      // without re-transcribing.
      const cleanupTransientOnly = () => {
        try {
          if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
        } catch (e) {
          console.error('Failed to delete transient transcript files:', e);
        }
      };

      const cleanupEverything = () => {
        try {
          if (fs.existsSync(monoWavPath)) fs.unlinkSync(monoWavPath);
          if (stereoWavPath && fs.existsSync(stereoWavPath)) fs.unlinkSync(stereoWavPath);
        } catch (e) {
          console.error('Failed to delete temp wav file:', e);
        }
        try {
          if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
          if (fs.existsSync(vttPath)) fs.unlinkSync(vttPath);
          if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        } catch (e) {
          console.error('Failed to delete whisper output files:', e);
        }
      };

      const args = [
        '-m',
        modelPath,
        '-f',
        audioPath,
        '--output-txt', // Output plain text
        '--output-vtt', // Output VTT subtitles
        '--output-json-full', // Token-level timings, consumed by diarize-service
        '--no-timestamps', // Don't print timestamps in main output (we use VTT)
        '--max-len',
        String(SUBTITLE_MAX_SEGMENT_CHARS),
        '--split-on-word',
        '-pp', // Print progress
        '-of',
        outputBase,
      ];

      // whisper.cpp defaults to English when -l is omitted.
      // Pass 'auto' explicitly to enable language auto-detection.
      if (language) {
        args.push('-l', language);
      }

      const cpuCount = os.cpus().length;
      args.push('-t', String(Math.min(cpuCount, 8)));

      const child = spawn(whisperPath, args);
      proc = child;

      if (!child.stdout || !child.stderr) {
        cleanupEverything();
        reject(new Error('Failed to spawn whisper process'));
        return;
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        stderr += message;

        const progressMatch = message.match(/progress\s*=\s*(\d+)%/);
        if (progressMatch && progressMatch[1]) {
          const percent = Math.min(100, parseInt(progressMatch[1], 10));
          const scaledPercent = 20 + Math.round((percent / 100) * 70);
          onProgress?.({
            percent: scaledPercent,
            status: `Transcribing... ${percent}%`,
            phase: 'transcribing',
            audioDurationSec,
          });
        }
      });

      child.on('close', async (code: number) => {
        if (cancelled) {
          cleanupEverything();
          resolve({ success: true, cancelled: true, text: '' });
          return;
        }

        if (code !== 0) {
          cleanupEverything();
          console.error('Transcription process exited with code', code);
          console.error('Stderr:', stderr);
          reject(new Error(stderr || 'Transcription failed'));
          return;
        }

        let text = stdout.trim();
        if (fs.existsSync(txtPath) && !text) {
          text = fs.readFileSync(txtPath, 'utf-8').trim();
        }

        let vtt: string | null = null;
        if (fs.existsSync(vttPath)) {
          vtt = fs.readFileSync(vttPath, 'utf-8');
        }

        if (!text && !vtt) {
          cleanupEverything();
          console.error('Transcription failed: No output generated.', {
            txtPath: sanitizePath(txtPath),
            vttPath: sanitizePath(vttPath),
            stdoutLength: stdout.length,
          });
          reject(
            new Error(
              'Transcription produced no output. The audio file might be empty, silent, or contain no valid audio stream.'
            )
          );
          return;
        }

        // Hand the wavs + whisper output to the session-scoped audio
        // cache. From here on, the file lifecycle is the cache's
        // responsibility — including deletion at app quit or on explicit
        // release from the renderer.
        const cacheEntry = audioCache.register({
          originalFileName: path.basename(filePath),
          monoWavPath,
          stereoWavPath: stereoWavPath ?? undefined,
          whisperJsonPath: fs.existsSync(jsonPath) ? jsonPath : undefined,
          whisperVttPath: fs.existsSync(vttPath) ? vttPath : undefined,
          durationSec: audioDurationSec,
        });
        log.info('[transcribe] complete', {
          audioId: cacheEntry.id,
          originalFileName: cacheEntry.originalFileName,
          hasStereo: Boolean(cacheEntry.stereoWavPath),
          hasJson: Boolean(cacheEntry.whisperJsonPath),
        });
        cleanupTransientOnly();
        onProgress?.({ percent: 100, status: 'Complete!', phase: 'complete' });

        resolve({
          success: true,
          text: outputFormat === 'vtt' && vtt ? vtt : text,
          audioId: cacheEntry.id,
        });
      });

      child.on('error', (err: Error) => {
        console.error('Failed to spawn whisper process:', err);
        cleanupEverything();
        reject(err);
      });
    };
    run();
  }) as Promise<TranscriptionResult> & { cancel?: () => void };

  promise.cancel = () => {
    cancelled = true;
    if (proc) {
      proc.kill();
    }
  };

  return promise;
}
