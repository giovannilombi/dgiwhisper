import type {
  HistoryItem,
  SelectedFile,
  TranscriptionSettings,
  OutputFormat,
  QueueItem,
  TranscribedSegment,
} from '../types';
import type { Theme } from '../hooks';

export interface DiarizationContextState {
  segments: TranscribedSegment[];
  speakerCount: number;
  labels?: Record<number, string>;
}

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

export interface HistoryContextValue {
  history: HistoryItem[];
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  toggleHistory: () => void;
  clearHistory: () => void;
  removeHistoryItem: (itemId: string) => void;
  selectHistoryItem: (item: HistoryItem) => void;
}

export interface DiarizationRunStatus {
  running: boolean;
  error: string | null;
  strategy?: 'channel' | 'sherpa-fresh' | 'sherpa-recluster';
  cached?: boolean;
}

export interface TranscriptionStateContextValue {
  selectedFile: SelectedFile | null;
  settings: TranscriptionSettings;
  isTranscribing: boolean;
  transcription: string;
  diarization: DiarizationContextState | null;
  /** Session-scoped id of the cached audio for the currently-selected transcript. */
  audioId: string | null;
  diarizeStatus: DiarizationRunStatus;
  error: string | null;
  modelDownloaded: boolean;
  duplicateFilesSkipped: number;
  estimatedTimeRemainingSec: number | null;
  showQueueResumePrompt: boolean;
  restoredQueueItemsCount: number;
  copySuccess: boolean;
  queue: QueueItem[];
  selectedQueueItemId: string | null;
}

export interface TranscriptionActionsContextValue {
  setSelectedFile: (file: SelectedFile | null) => void;
  setSettings: (settings: TranscriptionSettings) => void;
  setModelDownloaded: (downloaded: boolean) => void;
  handleTranscribe: () => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleSave: (format?: OutputFormat, contentOverride?: string) => Promise<void>;
  handleCopy: () => Promise<void>;
  handleFilesSelect: (files: SelectedFile[]) => void;
  removeFromQueue: (id: string) => void;
  clearCompletedFromQueue: () => void;
  selectQueueItem: (id: string) => void;
  dismissQueueResumePrompt: () => void;
  resumePersistedQueue: () => Promise<void>;
  updateCurrentDiarization: (state: {
    segments: TranscribedSegment[];
    labels: Record<number, string>;
  }) => void;
  runDiarization: (params?: { numClusters?: number; threshold?: number }) => Promise<void>;
  cancelDiarization: () => Promise<void>;
}

export interface TranscriptionContextValue
  extends TranscriptionStateContextValue, TranscriptionActionsContextValue {}
