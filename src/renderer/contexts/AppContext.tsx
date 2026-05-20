import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranscription, useBatchQueue, useQueueSelection } from '../features/transcription';
import { useHistory } from '../features/history';
import { useTheme, useCopyToClipboard, useElectronMenu } from '../hooks';
import { selectAndProcessFiles } from '../utils';
import type { HistoryItem, SelectedFile, TranscribedSegment } from '../types';
import { getActiveDiarizationVersion } from '../../shared/types';

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
    setActiveDiarizationVersion,
    deleteDiarizationVersion,
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
    onDiarizationVersionsChange: (id, versions, activeVersionId) => {
      // Mirror every per-item diarization mutation (new run completed,
      // version deleted, active version switched) into the disk-backed
      // history entry sharing the same id. This way re-opening the app
      // a session later still finds the same saved runs.
      updateHistoryItem(id, {
        diarizationVersions: versions.map((v) => ({
          id: v.id,
          createdAt: v.createdAt,
          params: {
            numClusters: v.params.numClusters,
            threshold: v.params.threshold,
            strategy: v.strategy ?? 'sherpa-fresh',
          },
          segments: v.segments,
          speakerCount: v.speakerCount,
          labels: v.labels,
        })),
        // Legacy fields kept for back-compat with older history items
        // that the rest of the renderer still reads in places.
        segments: versions[0]?.segments,
        speakerCount: versions[0]?.speakerCount,
      });
      // activeVersionId itself is not persisted yet — when the user
      // re-opens a transcript we always start from the newest version.
      // Mirroring it would require an extra field on HistoryItem and
      // is not part of the Phase 3 deliverable.
      void activeVersionId;
    },
  });

  const selectHistoryItem = useCallback(
    (item: HistoryItem): void => {
      setTranscription(item.fullText);
      setSelectedFile({ name: item.fileName, path: item.filePath });
      // Prefer the new diarizationVersions[] (Phase 3). Fall back to the
      // legacy segments/speakerCount/speakerLabels for items written by
      // earlier versions of the app.
      const newestVersion = item.diarizationVersions?.[0];
      if (newestVersion) {
        setDiarization({
          segments: newestVersion.segments,
          speakerCount: newestVersion.speakerCount,
          labels: newestVersion.labels,
        });
      } else if (item.segments && item.speakerCount !== undefined) {
        setDiarization({
          segments: item.segments,
          speakerCount: item.speakerCount,
          labels: parsePersistedLabels(item.speakerLabels),
        });
      } else {
        setDiarization(null);
      }
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
        // copy or save it. We deliberately keep the displayed transcript
        // text, the selected file (so the inline player still works) and
        // any diarization result already on screen. Only the live
        // selection pointer + the cached source audio are released —
        // the audio could not have been re-diarized anyway once its
        // queue card is gone.
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
    // Mirror the single-item removal contract: clearing the queue cards
    // does NOT wipe the displayed transcript/diarization/selectedFile.
    // Users repeatedly complained that hitting "Pulisci" made the work
    // disappear from the right panel — but they probably just wanted to
    // tidy the sidebar. The result they care about stays visible until
    // they explicitly load a different transcript from history.
    clearCompleted();
    if (audioId) {
      window.electronAPI?.diarizeReleaseAudio?.(audioId).catch(() => {
        /* ignore — cleanup is best-effort */
      });
    }
    setSelectedQueueItemId(null);
    setAudioId(null);
  }, [clearCompleted, audioId, setAudioId]);

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
  // active diarization version. When a fresh run completes (or the user
  // flips the active version chip in the tab) the renderer should pick
  // it up automatically.
  const selectedItem = selectedQueueItemId ? queue.find((q) => q.id === selectedQueueItemId) : null;
  const selectedItemActiveVersion = getActiveDiarizationVersion(selectedItem?.diarization);
  useEffect(() => {
    if (!selectedItemActiveVersion) return;
    setDiarization({
      segments: selectedItemActiveVersion.segments,
      speakerCount: selectedItemActiveVersion.speakerCount,
      labels: selectedItemActiveVersion.labels,
    });
  }, [selectedItemActiveVersion, setDiarization]);

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

  const handleSetActiveVersion = useCallback(
    (versionId: string) => {
      if (!selectedQueueItemId) return;
      setActiveDiarizationVersion(selectedQueueItemId, versionId);
    },
    [selectedQueueItemId, setActiveDiarizationVersion]
  );

  const handleDeleteVersion = useCallback(
    (versionId: string) => {
      if (!selectedQueueItemId) return;
      deleteDiarizationVersion(selectedQueueItemId, versionId);
    },
    [selectedQueueItemId, deleteDiarizationVersion]
  );

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
      setSelectedItemActiveDiarizationVersion: handleSetActiveVersion,
      deleteSelectedItemDiarizationVersion: handleDeleteVersion,
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
      handleSetActiveVersion,
      handleDeleteVersion,
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
