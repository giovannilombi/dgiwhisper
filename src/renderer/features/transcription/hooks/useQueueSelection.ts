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
  setDiarization?: (state: DiarizationState | null) => void,
  setAudioId?: (audioId: string | null) => void
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
          // Wire the session audio id so the diarization tab knows
          // whether this transcript is re-diarizable in the current
          // session. History items hydrated from disk won't have one.
          if (setAudioId) {
            setAudioId(item.result?.audioId ?? null);
          }
        }
        if (setDiarization) {
          // Prefer the per-item diarization state stored on the queue
          // item itself (Phase 2: each item carries its own diarization
          // result). Fall back to the legacy getCompletedDiarization
          // helper so older queue items still display.
          const diarResult = item?.diarization?.result;
          if (diarResult) {
            setDiarization({
              segments: diarResult.segments,
              speakerCount: diarResult.speakerCount,
              labels: diarResult.labels,
            });
          } else {
            setDiarization(getCompletedDiarization?.(id) ?? null);
          }
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
      setAudioId,
    ]
  );

  return { selectQueueItem };
};
