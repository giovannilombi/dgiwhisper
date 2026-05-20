export interface SelectedFile {
  name: string;
  path: string;
  size?: number;
  fingerprint?: string;
}

export type WhisperModelName =
  | 'tiny'
  | 'tiny.en'
  | 'base'
  | 'base.en'
  | 'small'
  | 'small.en'
  | 'medium'
  | 'medium.en'
  | 'large-v3'
  | 'large-v3-turbo';

export type LanguageCode =
  | 'auto'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'ar'
  | 'hi';

export type OutputFormat = 'vtt' | 'srt' | 'txt' | 'json' | 'docx' | 'pdf' | 'md';

export interface TranscriptionSettings {
  model: WhisperModelName;
  language: LanguageCode;
}

export type QualityLevel = 1 | 2 | 3 | 4 | 5;

export interface ModelInfo {
  name: string;
  size: string;
  speed: string;
  quality: QualityLevel;
  downloaded: boolean;
  vram?: string;
}

export interface GpuInfo {
  available: boolean;
  type: 'metal' | 'cuda' | 'cpu';
  name: string;
}

export interface ModelDownloadProgress {
  status: 'downloading' | 'complete' | 'error';
  model: string;
  percent?: number;
  downloaded?: string;
  total?: string;
  remainingTime?: string;
  error?: string;
}

export type TranscriptionPhase =
  | 'preparing'
  | 'converting'
  | 'transcribing'
  | 'diarizing'
  | 'complete';

export interface TranscriptionProgress {
  percent: number;
  status: string;
  phase?: TranscriptionPhase;
  audioDurationSec?: number;
}

export interface TranscriptionOptions {
  filePath: string;
  model: WhisperModelName;
  language: LanguageCode;
  outputFormat: OutputFormat;
}

export interface TranscribedSegment {
  start: number;
  end: number;
  text: string;
  speaker?: number;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  cancelled?: boolean;
  error?: string;
  /**
   * Opaque session-scoped id of the cached audio entry. Pass it to the
   * diarization IPC to run speaker identification on this transcript
   * without re-loading the audio. Available only while the app session
   * lives — closing the app wipes the cache.
   */
  audioId?: string;
  /**
   * Optional speaker-labeled segments. Legacy field: kept on the type
   * so older history entries deserialize cleanly, but the new pipeline
   * never populates it — diarization lives in a separate result.
   */
  segments?: TranscribedSegment[];
  speakers?: number;
}

/**
 * One run of diarization on a transcript. Multiple versions (up to a
 * small cap) can be saved per transcript so the user can flip between
 * different parameter choices without re-running.
 */
export interface DiarizationVersion {
  id: string;
  createdAt: string;
  params: {
    numClusters?: number;
    threshold?: number;
    /** Indicates whether the channel-based fast-path was used. */
    strategy: 'channel' | 'sherpa-fresh' | 'sherpa-recluster';
  };
  segments: TranscribedSegment[];
  speakerCount: number;
  /** User-supplied labels per speaker id. */
  labels?: Record<number, string>;
}

export interface DiarizationSegment {
  start: number;
  end: number;
  speaker: number;
}

export interface DiarizationOptions {
  numClusters?: number;
  threshold?: number;
}

export interface DiarizationProgress {
  percent: number;
}

export interface DiarizationResult {
  success: boolean;
  segments?: DiarizationSegment[];
  error?: string;
}

export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export type DiarizationJobStatus =
  | 'idle' // never run, awaiting user trigger
  | 'queued' // waiting in the global job queue
  | 'running' // currently running in the diarize-service
  | 'completed'
  | 'cancelled'
  | 'error';

/**
 * Maximum number of diarization runs kept per transcript. Each run
 * captures the parameters used + the produced segments, so the user
 * can flip between alternative results (e.g. "auto-detect" vs
 * "force 3 speakers") without losing previous attempts. The cap
 * prevents unbounded storage growth on long history.
 */
export const MAX_DIARIZATION_VERSIONS = 3;

/**
 * One saved diarization run. The newest version is always at index 0.
 */
export interface DiarizationVersionEntry {
  id: string;
  createdAt: string;
  params: {
    numClusters?: number;
    threshold?: number;
  };
  segments: TranscribedSegment[];
  speakerCount: number;
  labels?: Record<number, string>;
  strategy?: 'channel' | 'sherpa-fresh' | 'sherpa-recluster';
  cached?: boolean;
}

export interface DiarizationJobState {
  status: DiarizationJobStatus;
  /** Last params used (or about to be used). Persisted so the UI can
   *  show what produced the current result and pre-fill the form on
   *  next launch. */
  params?: {
    numClusters?: number;
    threshold?: number;
  };
  /** Friendly error message when status === 'error'. */
  error?: string;
  /** Started timestamp of the current/last run. */
  startedAt?: string;
  /**
   * Saved diarization runs for this transcript, newest first, capped
   * to MAX_DIARIZATION_VERSIONS. The active version is `versions[0]`
   * unless `activeVersionId` overrides — which the UI sets when the
   * user clicks a version chip to compare.
   */
  versions?: DiarizationVersionEntry[];
  /** Override pointer; null/undefined means "newest". */
  activeVersionId?: string;
}

/**
 * Resolve which saved version the UI should currently display: the one
 * the user explicitly selected (if still around) or the newest run.
 */
export function getActiveDiarizationVersion(
  state: DiarizationJobState | undefined | null
): DiarizationVersionEntry | null {
  if (!state?.versions || state.versions.length === 0) return null;
  if (state.activeVersionId) {
    const match = state.versions.find((v) => v.id === state.activeVersionId);
    if (match) return match;
  }
  return state.versions[0] ?? null;
}

export interface QueueItem {
  id: string;
  file: SelectedFile;
  status: QueueItemStatus;
  progress: TranscriptionProgress;
  result?: TranscriptionResult;
  error?: string;
  startTime?: number;
  endTime?: number;
  /** Per-item diarization state. Initially undefined; populated when
   *  the user first opens the diarization tab or queues a job. */
  diarization?: DiarizationJobState;
}

export interface HistoryItem {
  id: string;
  fileName: string;
  filePath: string;
  model: WhisperModelName;
  language: LanguageCode;
  format?: OutputFormat;
  date: string;
  duration: number;
  preview: string;
  fullText: string;
  /**
   * Session-scoped audio id, valid while the audio cache hasn't been
   * wiped. Lets the renderer drive a new diarization run on this
   * transcript without re-loading the source file. The field is
   * omitted on history items hydrated from disk in a fresh session.
   */
  audioId?: string;
  /**
   * Persisted diarization runs for this transcript. Capped to 3 by the
   * storage layer; older versions are evicted in FIFO order unless the
   * user explicitly deletes a different one to make room.
   */
  diarizationVersions?: DiarizationVersion[];
  // Legacy single-version fields kept so previously-saved history items
  // hydrate without crashing. The new code path writes diarizationVersions.
  segments?: TranscribedSegment[];
  speakerCount?: number;
  speakerLabels?: Record<string, string>;
}

export interface SaveFileOptions {
  defaultName: string;
  content: string;
  format: OutputFormat;
}

export interface SaveFileResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export type MediaSourceType = 'audio' | 'video';

export interface MediaSourceResult {
  success: boolean;
  url?: string;
  mediaType?: MediaSourceType;
  error?: string;
}

export interface AppInfo {
  isDev: boolean;
  version: string;
  platform: NodeJS.Platform;
  osVersion?: string;
}

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  isTranscribing: boolean;
}

export interface LanguageOption {
  value: LanguageCode;
  label: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
] as const;

export interface OutputFormatOption {
  value: OutputFormat;
  label: string;
  ext: string;
}

export const OUTPUT_FORMATS: readonly OutputFormatOption[] = [
  { value: 'vtt', label: 'VTT Subtitles', ext: '.vtt' },
  { value: 'srt', label: 'SRT Subtitles', ext: '.srt' },
  { value: 'txt', label: 'Plain Text', ext: '.txt' },
] as const;

export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'flac',
  'ogg',
  'opus',
  'oga',
  'amr',
  'wma',
  'aac',
  'aiff',
] as const;

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v'] as const;

export const SUPPORTED_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export type Unsubscribe = () => void;

export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export const QUALITY_STARS: readonly string[] = [
  '★☆☆☆☆',
  '★★☆☆☆',
  '★★★☆☆',
  '★★★★☆',
  '★★★★★',
] as const;

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
}
