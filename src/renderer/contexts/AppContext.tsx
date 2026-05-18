import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranscription, useBatchQueue, useQueueSelection } from '../features/transcription';
import { useHistory } from '../features/history';
import { useTheme, useCopyToClipboard, useElectronMenu } from '../hooks';
import { selectAndProcessFiles } from '../utils';
import type { HistoryItem, SelectedFile, TranscribedSegment } from '../types';

function parsePersistedLabels(labels?: Record<string, string>): Record<number, string> | undefined {
  if (!labels) return undefined;
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const n = Number.parseInt(key, 10);
    if (!Number.isNaN(n)) out[n] = value;
  }
  return out;
}
import {
  ThemeContext,
  HistoryContext,
  TranscriptionStateContext,
  TranscriptionActionsContext,
} from './contexts';
import type {
  ThemeContextValue,
  HistoryContextValue,
  TranscriptionStateContextValue,
  TranscriptionActionsContextValue,
} from './types';

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps): React.JSX.Element {
  const { theme, toggleTheme, isDark } = useTheme();

  const { copySuccess, copyToClipboard } = useCopyToClipboard();

  const {
    history,
    showHistory,
    setShowHistory,
    toggleHistory,
    addHistoryItem,
    clearHistory,
    removeHistoryItem,
    updateHistoryItem,
  } = useHistory();

  const {
    selectedFile,
    settings,
    transcription,
    diarization,
    error,
    modelDownloaded,
    setSelectedFile,
    setSettings,
    setModelDownloaded,
    setTranscription,
    setDiarization,
    handleSave,
    handleCopy,
  } = useTranscription();

  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);

  const {
    queue,
    isProcessing,
    duplicateFilesSkipped,
    estimatedTimeRemainingSec,
    showQueueResumePrompt,
    restoredQueueItemsCount,
    addFiles,
    removeFile,
    clearCompleted,
    dismissQueueResumePrompt,
    resumePersistedQueue,
    startProcessing,
    retryFailed,
    cancelProcessing,
    getCompletedTranscription,
    getCompletedDiarization,
  } = useBatchQueue({
    settings,
    onHistoryAdd: addHistoryItem,
    onFirstComplete: (id, text, file, diarizationState) => {
      setSelectedQueueItemId(id);
      setTranscription(text);
      setSelectedFile(file);
      setDiarization(diarizationState ?? null);
    },
  });

  const selectHistoryItem = useCallback(
    (item: HistoryItem): void => {
      setTranscription(item.fullText);
      setSelectedFile({ name: item.fileName, path: item.filePath });
      setDiarization(
        item.segments && item.speakerCount !== undefined
          ? {
              segments: item.segments,
              speakerCount: item.speakerCount,
              labels: parsePersistedLabels(item.speakerLabels),
            }
          : null
      );
      setSelectedQueueItemId(item.id);
      setShowHistory(false);
    },
    [setTranscription, setSelectedFile, setShowHistory, setDiarization]
  );

  const updateCurrentDiarization = useCallback(
    (state: { segments: TranscribedSegment[]; labels: Record<number, string> }): void => {
      if (!selectedQueueItemId) return;
      const speakerIds = new Set<number>();
      state.segments.forEach((s) => speakerIds.add(s.speaker ?? 0));
      const speakerCount = speakerIds.size;
      const stringLabels: Record<string, string> = {};
      for (const [k, v] of Object.entries(state.labels)) {
        stringLabels[k] = v;
      }
      updateHistoryItem(selectedQueueItemId, {
        segments: state.segments,
        speakerCount,
        speakerLabels: stringLabels,
      });
    },
    [selectedQueueItemId, updateHistoryItem]
  );

  const onCopy = useCallback(async (): Promise<void> => {
    await handleCopy(copyToClipboard);
  }, [handleCopy, copyToClipboard]);

  const handleFilesSelect = useCallback(
    (files: SelectedFile[]): void => {
      addFiles(files);
    },
    [addFiles]
  );

  const handleFileSelectFromMenu = useCallback(async (): Promise<void> => {
    const files = await selectAndProcessFiles();
    if (files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  const handleTranscribe = useCallback(async (): Promise<void> => {
    await startProcessing();
  }, [startProcessing]);

  const handleRetryFailed = useCallback(async (): Promise<void> => {
    await retryFailed();
  }, [retryFailed]);

  const handleCancel = useCallback(async (): Promise<void> => {
    await cancelProcessing();
  }, [cancelProcessing]);

  const removeFromQueue = useCallback(
    (id: string): void => {
      removeFile(id);
      if (selectedQueueItemId === id) {
        setSelectedQueueItemId(null);
        setTranscription('');
        setSelectedFile(null);
        setDiarization(null);
      }
    },
    [removeFile, selectedQueueItemId, setTranscription, setSelectedFile, setDiarization]
  );

  const clearCompletedFromQueue = useCallback((): void => {
    clearCompleted();
    setSelectedQueueItemId(null);
    setTranscription('');
    setSelectedFile(null);
    setDiarization(null);
  }, [clearCompleted, setTranscription, setSelectedFile, setDiarization]);

  const { selectQueueItem: baseSelectQueueItem } = useQueueSelection(
    queue,
    getCompletedTranscription,
    setTranscription,
    setSelectedFile,
    setSelectedQueueItemId,
    getCompletedDiarization,
    setDiarization
  );

  const selectQueueItem = useCallback(
    (id: string): void => {
      baseSelectQueueItem(id);
      // Prefer history's diarization state — it reflects user edits made
      // after the initial transcription completed.
      const histItem = history.find((h) => h.id === id);
      if (histItem?.segments && histItem.speakerCount !== undefined) {
        setDiarization({
          segments: histItem.segments,
          speakerCount: histItem.speakerCount,
          labels: parsePersistedLabels(histItem.speakerLabels),
        });
      }
    },
    [baseSelectQueueItem, history, setDiarization]
  );

  useElectronMenu({
    onOpenFile: () => {
      if (!isProcessing) {
        handleFileSelectFromMenu();
      }
    },
    onSaveFile: () => {
      if (transcription && !isProcessing) {
        handleSave();
      }
    },
    onCopyTranscription: () => {
      if (transcription) {
        onCopy();
      }
    },
    onStartTranscription: () => {
      const hasProcessableItems = queue.some(
        (item) =>
          item.status === 'pending' || item.status === 'error' || item.status === 'cancelled'
      );
      if (hasProcessableItems && !isProcessing) {
        handleTranscribe();
      }
    },
    onCancelTranscription: () => {
      if (isProcessing) {
        handleCancel();
      }
    },
    onToggleHistory: toggleHistory,
  });

  const themeContextValue = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, isDark }),
    [theme, toggleTheme, isDark]
  );

  const historyContextValue = useMemo<HistoryContextValue>(
    () => ({
      history,
      showHistory,
      setShowHistory,
      toggleHistory,
      clearHistory,
      removeHistoryItem,
      selectHistoryItem,
    }),
    [
      history,
      showHistory,
      setShowHistory,
      toggleHistory,
      clearHistory,
      removeHistoryItem,
      selectHistoryItem,
    ]
  );

  const transcriptionStateValue = useMemo<TranscriptionStateContextValue>(
    () => ({
      selectedFile,
      settings,
      isTranscribing: isProcessing,
      transcription,
      diarization,
      error,
      modelDownloaded,
      duplicateFilesSkipped,
      estimatedTimeRemainingSec,
      showQueueResumePrompt,
      restoredQueueItemsCount,
      copySuccess,
      queue,
      selectedQueueItemId,
    }),
    [
      selectedFile,
      settings,
      isProcessing,
      transcription,
      diarization,
      error,
      modelDownloaded,
      duplicateFilesSkipped,
      estimatedTimeRemainingSec,
      showQueueResumePrompt,
      restoredQueueItemsCount,
      copySuccess,
      queue,
      selectedQueueItemId,
    ]
  );

  const transcriptionActionsValue = useMemo<TranscriptionActionsContextValue>(
    () => ({
      setSelectedFile,
      setSettings,
      setModelDownloaded,
      handleTranscribe,
      handleRetryFailed,
      handleCancel,
      handleSave,
      handleCopy: onCopy,
      handleFilesSelect,
      removeFromQueue,
      clearCompletedFromQueue,
      selectQueueItem,
      dismissQueueResumePrompt,
      resumePersistedQueue,
      updateCurrentDiarization,
    }),
    [
      setSelectedFile,
      setSettings,
      setModelDownloaded,
      handleTranscribe,
      handleRetryFailed,
      handleCancel,
      handleSave,
      onCopy,
      handleFilesSelect,
      removeFromQueue,
      clearCompletedFromQueue,
      selectQueueItem,
      dismissQueueResumePrompt,
      resumePersistedQueue,
      updateCurrentDiarization,
    ]
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <HistoryContext.Provider value={historyContextValue}>
        <TranscriptionStateContext.Provider value={transcriptionStateValue}>
          <TranscriptionActionsContext.Provider value={transcriptionActionsValue}>
            {children}
          </TranscriptionActionsContext.Provider>
        </TranscriptionStateContext.Provider>
      </HistoryContext.Provider>
    </ThemeContext.Provider>
  );
}
