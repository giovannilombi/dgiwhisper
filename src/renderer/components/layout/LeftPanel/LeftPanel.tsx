import React from 'react';
import { FileDropZone, FileQueue } from '../../../features/transcription';
import { SettingsPanel } from '../../../features/settings';
import { useAppTranscription } from '../../../contexts';
import { useFFmpegStatus } from '../../../hooks';
import { TranscriptionActions } from './TranscriptionActions';
import { ErrorMessage } from './ErrorMessage';
import { DonationSection } from './DonationSection';
import { Button, SystemWarning } from '../../ui';
import { useTranslation } from '../../../i18n';

function LeftPanel(): React.JSX.Element {
  const {
    settings,
    isTranscribing,
    setSettings,
    setModelDownloaded,
    queue,
    duplicateFilesSkipped,
    estimatedTimeRemainingSec,
    showQueueResumePrompt,
    restoredQueueItemsCount,
    selectedQueueItemId,
    handleFilesSelect,
    removeFromQueue,
    clearCompletedFromQueue,
    handleRetryFailed,
    selectQueueItem,
    dismissQueueResumePrompt,
    resumePersistedQueue,
  } = useAppTranscription();

  const { isFFmpegAvailable, isChecking, recheckStatus } = useFFmpegStatus();
  const { t } = useTranslation();

  return (
    <div className="left-panel">
      {isChecking && isFFmpegAvailable === null && (
        <div className="system-check-loading" role="status" aria-live="polite">
          {t('system.checking')}
        </div>
      )}
      {isFFmpegAvailable === false && <SystemWarning onRefresh={recheckStatus} />}

      <FileDropZone
        onFilesSelect={handleFilesSelect}
        queueCount={queue.length}
        duplicateFilesSkipped={duplicateFilesSkipped}
        disabled={isTranscribing}
      />

      {showQueueResumePrompt && restoredQueueItemsCount > 0 && (
        <div className="queue-resume-banner" role="status" aria-live="polite">
          <p className="queue-resume-banner-title">
            {t(
              restoredQueueItemsCount === 1
                ? 'queue.resumePrompt.restoredOne'
                : 'queue.resumePrompt.restoredMany',
              { count: restoredQueueItemsCount }
            )}
          </p>
          <div className="queue-resume-banner-actions">
            <Button onClick={() => void resumePersistedQueue()} disabled={isTranscribing}>
              {t('queue.resumePrompt.resume')}
            </Button>
            <Button variant="ghost" onClick={dismissQueueResumePrompt} disabled={isTranscribing}>
              {t('queue.resumePrompt.dismiss')}
            </Button>
          </div>
        </div>
      )}

      <FileQueue
        queue={queue}
        onRemove={removeFromQueue}
        onClearCompleted={clearCompletedFromQueue}
        onRetryFailed={handleRetryFailed}
        onSelectItem={selectQueueItem}
        selectedItemId={selectedQueueItemId}
        estimatedTimeRemainingSec={estimatedTimeRemainingSec}
        disabled={isTranscribing}
      />

      <SettingsPanel
        settings={settings}
        onChange={setSettings}
        disabled={isTranscribing}
        onModelStatusChange={setModelDownloaded}
      />

      <TranscriptionActions isFFmpegAvailable={isFFmpegAvailable} />

      <ErrorMessage />

      <DonationSection />
    </div>
  );
}

export { LeftPanel };
