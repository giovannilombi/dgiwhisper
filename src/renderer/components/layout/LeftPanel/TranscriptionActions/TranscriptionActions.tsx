import React, { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useAppTranscription } from '../../../../contexts';
import { useTranslation } from '../../../../i18n';

export interface TranscriptionActionsProps {
  isFFmpegAvailable: boolean | null;
}

function TranscriptionActions({ isFFmpegAvailable }: TranscriptionActionsProps): React.JSX.Element {
  const { isTranscribing, modelDownloaded, handleTranscribe, handleCancel, queue } =
    useAppTranscription();
  const { t } = useTranslation();

  const { retryableCount } = useMemo(() => {
    let retryable = 0;
    for (const item of queue) {
      if (item.status === 'pending') {
        retryable++;
      } else if (item.status === 'cancelled' || item.status === 'error') {
        retryable++;
      }
    }
    return { retryableCount: retryable };
  }, [queue]);

  const canTranscribe = retryableCount > 0 && modelDownloaded && isFFmpegAvailable === true;

  const getDisabledReason = (): string => {
    if (!isFFmpegAvailable) return t('queue.disabled.ffmpeg');
    if (!modelDownloaded) return t('queue.disabled.model');
    if (retryableCount === 0) return t('queue.disabled.empty');
    return '';
  };

  return (
    <div className="actions">
      {!isTranscribing ? (
        <Button
          variant="primary"
          size="lg"
          icon={<Zap size={18} />}
          onClick={handleTranscribe}
          disabled={!canTranscribe}
          aria-label={t('queue.startAria')}
          title={getDisabledReason()}
          fullWidth
        >
          {t('queue.transcribe')}
        </Button>
      ) : (
        <Button
          variant="danger"
          size="lg"
          onClick={handleCancel}
          aria-label={t('queue.cancelAria')}
          fullWidth
        >
          {t('queue.cancel')}
        </Button>
      )}
    </div>
  );
}

export { TranscriptionActions };
