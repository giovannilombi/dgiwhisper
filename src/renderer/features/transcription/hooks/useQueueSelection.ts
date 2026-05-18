import { useCallback } from 'react';
import type { QueueItem, SelectedFile } from '../../../types';
import type { DiarizationState } from './useTranscription';

export const useQueueSelection = (
  queue: QueueItem[],
  getCompletedTranscription: (id: string) => string | undefined,
  setTranscription: (text: string) => void,
  setSelectedFile: (file: SelectedFile | null) => void,
  setSelectedQueueItemId: (id: string | null) => void,
  getCompletedDiarization?: (id: string) => DiarizationState | undefined,
  setDiarization?: (state: DiarizationState | null) => void
) => {
  const selectQueueItem = useCallback(
    (id: string) => {
      setSelectedQueueItemId(id);
      const transcriptionText = getCompletedTranscription(id);
      if (transcriptionText) {
        setTranscription(transcriptionText);
        const item = queue.find((q) => q.id === id);
        if (item) {
          setSelectedFile(item.file);
        }
        if (setDiarization) {
          setDiarization(getCompletedDiarization?.(id) ?? null);
        }
      }
    },
    [
      queue,
      getCompletedTranscription,
      setTranscription,
      setSelectedFile,
      setSelectedQueueItemId,
      getCompletedDiarization,
      setDiarization,
    ]
  );

  return { selectQueueItem };
};
