type Translator = (key: string, params?: Record<string, string | number>) => string;

export function toUserFriendlyTranscriptionError(errorMessage: string, t?: Translator): string {
  const normalized = errorMessage.toLowerCase();

  if (
    normalized.includes('output file does not contain any stream') ||
    (normalized.includes('stream map') && normalized.includes('matches no streams')) ||
    normalized.includes('no audio stream')
  ) {
    return t
      ? t('error.transcription.noAudio')
      : 'No audio track found in this file. Please choose a file that contains audio.';
  }

  if (normalized.includes('ffmpeg not found')) {
    return t
      ? t('error.transcription.ffmpegNotAvailable')
      : 'FFmpeg is not available. Install FFmpeg and try again.';
  }

  if (normalized.includes('input file not found')) {
    return t
      ? t('error.transcription.inputMissing')
      : 'Input file not found. Make sure the file still exists and try again.';
  }

  return errorMessage;
}
