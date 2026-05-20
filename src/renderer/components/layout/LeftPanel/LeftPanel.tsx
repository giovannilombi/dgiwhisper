import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { FileDropZone, FileQueue } from '../../../features/transcription';
import { SettingsPanel } from '../../../features/settings';
import { useAppTranscription } from '../../../contexts';
import { useFFmpegStatus } from '../../../hooks';
import { TranscriptionActions } from './TranscriptionActions';
import { ErrorMessage } from './ErrorMessage';
import { DonationSection } from './DonationSection';
import { Button, SystemWarning } from '../../ui';
import { useTranslation } from '../../../i18n';
import './LeftPanel.css';

function LeftPanel(): React.JSX.Element {
  const {
    settings,
    isTranscribing,
    setSettings,
    setModelDownloaded,
    queue,
    duplicateFilesSkipped,
    pendingDuplicates,
    estimatedTimeRemainingSec,
    showQueueResumePrompt,
    restoredQueueItemsCount,
    selectedQueueItemId,
    handleFilesSelect,
    confirmDuplicate,
    dismissDuplicate,
    removeFromQueue,
    clearCompletedFromQueue,
    handleRetryFailed,
    handleRetryItem,
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

      {/* Pending duplicate alerts — yellow band per file, the user can
          confirm re-add (force a fresh transcription) or dismiss to
          drop the duplicate. Replaces the previous silent skip. */}
      {pendingDuplicates.length > 0 && (
        <div className="duplicate-alerts">
          {pendingDuplicates.map((file) => (
            <div key={file.path} className="duplicate-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <div className="duplicate-alert-body">
                <p className="duplicate-alert-title">
                  {t('duplicate.alert.title', { name: file.name })}
                </p>
                <p className="duplicate-alert-question">{t('duplicate.alert.question')}</p>
              </div>
              <div className="duplicate-alert-actions">
                <Button size="sm" onClick={() => confirmDuplicate(file)}>
                  {t('duplicate.alert.confirm')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<X size={14} />}
                  onClick={() => dismissDuplicate(file)}
                  title={t('duplicate.alert.dismiss')}
                  aria-label={t('duplicate.alert.dismiss')}
                />
              </div>
            </div>
          ))}
        </div>
      )}

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
        onRetryItem={(id) => void handleRetryItem(id)}
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
