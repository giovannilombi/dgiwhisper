import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
    audioId,
    diarizeStatus,
    setSelectedFile,
    setSettings,
    setModelDownloaded,
    setTranscription,
    setDiarization,
    setAudioId,
    runDiarization,
    cancelDiarization,
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
    triggerDiarize,
    cancelDiarize,
    diarizeQueueLength,
    currentDiarizeItemId,
    getCompletedTranscription,
    getCompletedDiarization,
  } = useBatchQueue({
    settings,
    onHistoryAdd: addHistoryItem,
    onFirstComplete: (id, text, file, diarizationState, transcriptAudioId) => {
      setSelectedQueueItemId(id);
      setTranscription(text);
      setSelectedFile(file);
      setDiarization(diarizationState ?? null);
      setAudioId(transcriptAudioId ?? null);
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
      // History items hydrated from a previous session no longer have a
      // live audioId — the audio cache is session-scoped. The renderer
      // will treat this as "rerun diarization is unavailable until you
      // reload the audio".
      setAudioId(item.audioId ?? null);
      setSelectedQueueItemId(item.id);
      setShowHistory(false);
    },
    [setTranscription, setSelectedFile, setShowHistory, setDiarization, setAudioId]
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
        // The file leaves the queue but the transcript that was produced
        // stays on the right panel — the user might still want to read,
        // copy or save it. We only release what becomes meaningless once
        // the queue card is gone: the active selection, and the cached
        // audio (which can't be re-diarized anyway). The DiarizationPanel
        // hides automatically because it's gated on audioId.
        if (audioId) {
          window.electronAPI?.diarizeReleaseAudio?.(audioId).catch(() => {
            /* ignore — cleanup is best-effort */
          });
        }
        setSelectedQueueItemId(null);
        setAudioId(null);
      }
    },
    [removeFile, selectedQueueItemId, audioId, setAudioId]
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
    setDiarization,
    setAudioId
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

  // Keep the displayed diarization synced with the selected queue item's
  // per-item diarization state. When a fresh diarization run completes
  // for the currently-shown item, the renderer should pick it up
  // automatically — without this effect, the user would have to re-
  // select the item to see the new clusters.
  const selectedItem = selectedQueueItemId ? queue.find((q) => q.id === selectedQueueItemId) : null;
  const selectedItemDiarResult = selectedItem?.diarization?.result;
  useEffect(() => {
    if (!selectedItemDiarResult) return;
    setDiarization({
      segments: selectedItemDiarResult.segments,
      speakerCount: selectedItemDiarResult.speakerCount,
      labels: selectedItemDiarResult.labels,
    });
  }, [selectedItemDiarResult, setDiarization]);

  // The DiarizationTab's "predefinita/personalizzata" launch path goes
  // through this wrapper so we can interpose a confirmation when other
  // jobs are still in flight (the modal is owned by the tab UI itself).
  const handleTriggerDiarize = useCallback(
    (params: { numClusters?: number; threshold?: number }) => {
      if (!selectedQueueItemId) return;
      triggerDiarize(selectedQueueItemId, params);
    },
    [selectedQueueItemId, triggerDiarize]
  );

  const handleCancelDiarize = useCallback(async () => {
    if (!selectedQueueItemId) return;
    await cancelDiarize(selectedQueueItemId);
  }, [selectedQueueItemId, cancelDiarize]);

  const pendingTranscribeCount = queue.filter(
    (q) => q.status === 'processing' || q.status === 'pending'
  ).length;

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
      audioId,
      selectedItemDiarization: selectedItem?.diarization ?? null,
      pendingTranscribeCount,
      diarizeQueueLength,
      currentDiarizeItemId,
      diarizeStatus,
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
      audioId,
      selectedItem?.diarization,
      pendingTranscribeCount,
      diarizeQueueLength,
      currentDiarizeItemId,
      diarizeStatus,
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
      runDiarization,
      cancelDiarization,
      triggerSelectedItemDiarize: handleTriggerDiarize,
      cancelSelectedItemDiarize: handleCancelDiarize,
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
      runDiarization,
      cancelDiarization,
      handleTriggerDiarize,
      handleCancelDiarize,
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
