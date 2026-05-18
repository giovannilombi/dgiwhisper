import { useState, useCallback } from 'react';
import type {
  SelectedFile,
  TranscriptionSettings,
  OutputFormat,
  TranscribedSegment,
} from '../../../types';
import { saveFile, showItemInFolder } from '../../../services/electronAPI';
import { logger } from '../../../services/logger';
import { sanitizePath } from '../../../../shared/utils';

function shouldRevealInFinderAfterSave(): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }

  const confirmFn = window.confirm as unknown as {
    (message?: string): boolean;
    mock?: unknown;
  };
  const isJSDOM = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');

  if (isJSDOM && !confirmFn.mock) {
    return false;
  }

  try {
    return confirmFn('File saved successfully. Show in Finder?');
  } catch {
    return false;
  }
}

export interface DiarizationState {
  segments: TranscribedSegment[];
  speakerCount: number;
}

export interface UseTranscriptionReturn {
  selectedFile: SelectedFile | null;
  settings: TranscriptionSettings;
  transcription: string;
  diarization: DiarizationState | null;
  error: string | null;
  modelDownloaded: boolean;

  setSelectedFile: (file: SelectedFile | null) => void;
  setSettings: (settings: TranscriptionSettings) => void;
  setModelDownloaded: (downloaded: boolean) => void;
  setTranscription: (text: string) => void;
  setDiarization: (state: DiarizationState | null) => void;
  setError: (error: string | null) => void;

  handleSave: (format?: OutputFormat, contentOverride?: string) => Promise<void>;
  handleCopy: (copyToClipboard: (text: string) => Promise<boolean>) => Promise<boolean>;
  clearError: () => void;
}

export function useTranscription(): UseTranscriptionReturn {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [settings, setSettings] = useState<TranscriptionSettings>({
    model: 'base',
    language: 'auto',
  });
  const [transcription, setTranscription] = useState<string>('');
  const [diarization, setDiarization] = useState<DiarizationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelDownloaded, setModelDownloaded] = useState<boolean>(true);

  const handleSave = useCallback(
    async (format: OutputFormat = 'vtt', contentOverride?: string): Promise<void> => {
      if (!transcription && !contentOverride) return;

      const fileName = selectedFile?.name?.replace(/\.[^/.]+$/, '') || 'transcription';
      let content: string = contentOverride ?? transcription;

      if (contentOverride !== undefined) {
        // Caller already produced the final content (e.g. diarized export).
        // Skip the format-specific transformations below.
      } else if (format === 'txt') {
        content = transcription
          .split('\n')
          .filter((line) => !line.startsWith('WEBVTT') && !line.match(/^\d{2}:\d{2}/))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } else if (format === 'srt') {
        const lines = transcription.split('\n').filter((l) => l.trim());
        const srtLines: string[] = [];
        let index = 1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && line.includes('-->')) {
            srtLines.push(String(index++));
            srtLines.push(line.replace(/\./g, ','));
          } else if (line && !line.startsWith('WEBVTT')) {
            srtLines.push(line);
            const nextLine = lines[i + 1];
            if (nextLine?.includes('-->') || i === lines.length - 1) {
              srtLines.push('');
            }
          }
        }
        content = srtLines.join('\n');
      }

      // For docx, pdf, md formats, the main process will handle the conversion

      const result = await saveFile({
        defaultName: `${fileName}.${format}`,
        content,
        format,
      });

      if (result?.success && result.filePath) {
        logger.info('File saved', { path: sanitizePath(result.filePath), format });

        if (shouldRevealInFinderAfterSave()) {
          const revealResult = await showItemInFolder(result.filePath);
          if (!revealResult.success) {
            logger.warn('Failed to reveal saved file in Finder', {
              path: sanitizePath(result.filePath),
              error: revealResult.error || 'Unknown error',
            });
          }
        }
      } else if (result?.error) {
        setError(`Failed to save: ${result.error}`);
        logger.error('Failed to save file', { error: result.error, format });
      }
    },
    [transcription, selectedFile]
  );

  const handleCopy = useCallback(
    async (copyToClipboard: (text: string) => Promise<boolean>): Promise<boolean> => {
      if (!transcription) return false;
      const success = await copyToClipboard(transcription);
      if (!success) {
        setError('Failed to copy to clipboard');
        logger.error('Failed to copy transcription to clipboard');
      } else {
        logger.info('Copied transcription to clipboard');
      }
      return success;
    },
    [transcription]
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
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
    setError,
    handleSave,
    handleCopy,
    clearError,
  };
}
