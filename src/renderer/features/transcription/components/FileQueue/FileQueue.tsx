import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader, Clock, XCircle, Slash, X, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { formatFileSize } from '../../../../utils';
import type { QueueItem, QueueItemStatus, TranscriptionProgress } from '../../../../types';
import { toUserFriendlyTranscriptionError } from '../../utils/errorMessages';
import { useTranslation, type TranslationKey } from '../../../../i18n';

type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

const DIARIZING_MESSAGE_KEYS = [
  'progress.diarizing.msg.1',
  'progress.diarizing.msg.2',
  'progress.diarizing.msg.3',
  'progress.diarizing.msg.4',
  'progress.diarizing.msg.5',
  'progress.diarizing.msg.6',
  'progress.diarizing.msg.7',
  'progress.diarizing.msg.8',
  'progress.diarizing.msg.9',
  'progress.diarizing.msg.10',
  'progress.diarizing.msg.11',
  'progress.diarizing.msg.12',
  'progress.diarizing.msg.13',
  'progress.diarizing.msg.14',
  'progress.diarizing.msg.15',
  'progress.diarizing.msg.16',
  'progress.diarizing.msg.17',
  'progress.diarizing.msg.18',
  'progress.diarizing.msg.19',
  'progress.diarizing.msg.20',
] as const satisfies readonly TranslationKey[];

function translateProgressPhase(
  progress: TranscriptionProgress,
  t: Translator,
  diarizingMessageIndex: number
): string {
  const phase = progress.phase;
  switch (phase) {
    case 'preparing':
      return t('progress.preparing');
    case 'converting':
      return t('progress.converting');
    case 'transcribing':
      return t('progress.transcribingPercent', {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    case 'diarizing': {
      const msgKey = DIARIZING_MESSAGE_KEYS[diarizingMessageIndex % DIARIZING_MESSAGE_KEYS.length];
      return msgKey ? t(msgKey) : t('progress.diarizing');
    }
    case 'complete':
      return t('progress.complete');
    default:
      return progress.status;
  }
}
import './FileQueue.css';

export interface FileQueueProps {
  queue: QueueItem[];
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
  onRetryFailed: () => void;
  onSelectItem?: (id: string) => void;
  selectedItemId?: string | null;
  estimatedTimeRemainingSec?: number | null;
  disabled?: boolean;
}

const REMOVE_ERROR_TOAST_DURATION_MS = 5000;

function getStatusIcon(status: QueueItemStatus): React.ReactNode {
  switch (status) {
    case 'completed':
      return <CheckCircle size={16} className="status-icon completed" />;
    case 'processing':
      return <Loader size={16} className="status-icon processing spin" />;
    case 'pending':
      return <Clock size={16} className="status-icon pending" />;
    case 'error':
      return <XCircle size={16} className="status-icon error" />;
    case 'cancelled':
      return <Slash size={16} className="status-icon cancelled" />;
    default:
      return null;
  }
}

function formatEstimatedTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function FileQueue({
  queue,
  onRemove,
  onClearCompleted,
  onRetryFailed,
  onSelectItem,
  selectedItemId,
  estimatedTimeRemainingSec = null,
  disabled = false,
}: FileQueueProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [removeErrorToastMessage, setRemoveErrorToastMessage] = useState<string | null>(null);
  const [diarizingMessageIndex, setDiarizingMessageIndex] = useState(0);
  const removeErrorToastTimeoutRef = useRef<number | null>(null);

  const isAnyDiarizing = queue.some(
    (q) => q.status === 'processing' && q.progress.phase === 'diarizing'
  );

  useEffect(() => {
    if (!isAnyDiarizing) {
      setDiarizingMessageIndex(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setDiarizingMessageIndex((idx) => (idx + 1) % DIARIZING_MESSAGE_KEYS.length);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [isAnyDiarizing]);

  const clearRemoveErrorToastTimer = useCallback(() => {
    if (removeErrorToastTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(removeErrorToastTimeoutRef.current);
    removeErrorToastTimeoutRef.current = null;
  }, []);

  const showRemoveErrorToast = useCallback(
    (message: string) => {
      clearRemoveErrorToastTimer();
      setRemoveErrorToastMessage(message);
      removeErrorToastTimeoutRef.current = window.setTimeout(() => {
        setRemoveErrorToastMessage(null);
        removeErrorToastTimeoutRef.current = null;
      }, REMOVE_ERROR_TOAST_DURATION_MS);
    },
    [clearRemoveErrorToastTimer]
  );

  useEffect(() => clearRemoveErrorToastTimer, [clearRemoveErrorToastTimer]);

  if (queue.length === 0 && !removeErrorToastMessage) {
    return null;
  }

  if (queue.length === 0) {
    return (
      <div className="file-queue file-queue-toast-only">
        <div className="file-queue-toast" role="status" aria-live="polite">
          {removeErrorToastMessage}
        </div>
      </div>
    );
  }

  const completedCount = queue.filter((item) => item.status === 'completed').length;
  const processingCount = queue.filter((item) => item.status === 'processing').length;
  const pendingCount = queue.filter((item) => item.status === 'pending').length;
  const errorCount = queue.filter((item) => item.status === 'error').length;
  const cancelledCount = queue.filter((item) => item.status === 'cancelled').length;
  const retryCount = errorCount + cancelledCount;
  const hasRetryItems = retryCount > 0;
  const hasCompletedItems = completedCount > 0 || queue.some((item) => item.status === 'cancelled');

  const handleItemClick = (id: string): void => {
    onSelectItem?.(id);
  };

  const handleRemoveClick = (e: React.MouseEvent, item: QueueItem): void => {
    e.stopPropagation();
    if (disabled || item.status === 'processing') return;

    if (item.status === 'error' && item.error) {
      const friendlyError = toUserFriendlyTranscriptionError(item.error, t);
      showRemoveErrorToast(t('queue.item.removedFailed', { error: friendlyError }));
    }

    onRemove(item.id);
  };

  return (
    <div className="file-queue">
      <div className="file-queue-header">
        <span className="file-queue-title">{t('queue.header.title', { count: queue.length })}</span>
        <div className="file-queue-header-actions">
          {hasRetryItems && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={14} />}
              onClick={onRetryFailed}
              disabled={disabled}
              title={t('queue.header.retryTitle')}
            >
              {t('queue.header.retryLabel')}
            </Button>
          )}
          {hasCompletedItems && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={onClearCompleted}
              disabled={disabled}
              title={t('queue.header.clearTitle')}
            >
              {t('queue.header.clearLabel')}
            </Button>
          )}
        </div>
      </div>

      <div className="file-queue-list">
        {queue.map((item) => (
          <div
            key={item.id}
            className={`file-queue-item ${item.status} ${selectedItemId === item.id ? 'selected' : ''}`}
            onClick={() => handleItemClick(item.id)}
            role="button"
            tabIndex={0}
            aria-label={t('queue.item.selectAria', { name: item.file.name })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleItemClick(item.id);
              }
            }}
          >
            <div className="file-queue-item-status">
              {getStatusIcon(item.status)}
              {/* Phase 2: diarization runs independently of transcription.
                  Surface its status on completed items as a small badge
                  next to the transcribe check so the user can see
                  "diarizzazione in corso" without leaving the sidebar. */}
              {item.status === 'completed' && item.diarization?.status === 'running' && (
                <Loader
                  size={12}
                  className="status-icon processing spin file-queue-item-diarize-badge"
                  aria-label={t('queue.item.diarizing')}
                />
              )}
              {item.status === 'completed' && item.diarization?.status === 'queued' && (
                <Clock
                  size={12}
                  className="status-icon pending file-queue-item-diarize-badge"
                  aria-label={t('queue.item.diarizeQueued')}
                />
              )}
            </div>
            <div className="file-queue-item-content">
              <span className="file-queue-item-name">{item.file.name}</span>
              {/* Diarization runs after transcription on a completed item,
                  in a separate queue. Surface its status in plain text so
                  the spinner isn't the only cue — the user explicitly
                  asked to see "Individuazione speaker in corso" / its
                  English equivalent right on the card. */}
              {item.status === 'completed' && item.diarization?.status === 'running' && (
                <span className="file-queue-item-phase diarizing">{t('queue.item.diarizing')}</span>
              )}
              {item.status === 'completed' && item.diarization?.status === 'queued' && (
                <span className="file-queue-item-phase">{t('queue.item.diarizeQueued')}</span>
              )}
              {item.status === 'processing' && (
                <>
                  <span
                    className={`file-queue-item-phase ${item.progress.phase ?? 'transcribing'}`}
                  >
                    {translateProgressPhase(item.progress, t, diarizingMessageIndex)}
                  </span>
                  {item.progress.phase === 'diarizing' ? (
                    <div className="file-queue-item-progress indeterminate">
                      <div className="file-queue-item-progress-bar" />
                    </div>
                  ) : (
                    <div className="file-queue-item-progress">
                      <div
                        className="file-queue-item-progress-bar"
                        style={{ width: `${item.progress.percent}%` }}
                      />
                    </div>
                  )}
                  {/* The ETA is shown only during diarization, which is the
                      one phase where sherpa-onnx runs synchronously and we
                      cannot emit a real progress bar — the audio-length/3
                      stamp is the user's only cue that the wait is bounded.
                      For preparing/converting/transcribing we already show
                      a percent-driven bar, so an extra ETA would just be
                      visual noise. */}
                  {item.progress.phase === 'diarizing' &&
                    typeof item.progress.audioDurationSec === 'number' &&
                    item.progress.audioDurationSec > 0 && (
                      <span className="file-queue-item-eta">
                        {t('queue.item.eta', {
                          duration: formatEstimatedTime(item.progress.audioDurationSec / 3),
                        })}
                      </span>
                    )}
                </>
              )}
              {item.status === 'error' && item.error && (
                <span
                  className="file-queue-item-error"
                  title={toUserFriendlyTranscriptionError(item.error, t)}
                >
                  {toUserFriendlyTranscriptionError(item.error, t)}
                </span>
              )}
            </div>
            <div className="file-queue-item-meta">
              {item.status === 'processing' && item.progress.phase !== 'diarizing' && (
                <span className="file-queue-item-percent">{item.progress.percent}%</span>
              )}
              {item.file.size && (
                <span className="file-queue-item-size">{formatFileSize(item.file.size)}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              iconOnly
              onClick={(e) => handleRemoveClick(e, item)}
              disabled={disabled || item.status === 'processing'}
              title={t('queue.item.removeTitle')}
              aria-label={t('queue.item.removeAria', { name: item.file.name })}
              className="file-queue-item-remove"
            />
          </div>
        ))}
      </div>

      {removeErrorToastMessage && (
        <div className="file-queue-toast" role="status" aria-live="polite">
          {removeErrorToastMessage}
        </div>
      )}

      <div className="file-queue-summary">
        {completedCount > 0 && (
          <span>{t('queue.summary.completed', { count: completedCount })}</span>
        )}
        {processingCount > 0 && (
          <span>{t('queue.summary.processing', { count: processingCount })}</span>
        )}
        {/* Hide the aggregate ETA while ANY item is in the diarization
            phase: sherpa-onnx runs synchronously and the percent-driven
            estimator goes blind, so the value it shows would be wildly
            unreliable. The per-item audio-length/3 stamp above stays
            visible for the diarizing item, which is the only ETA the
            user actually needs at that point. */}
        {processingCount > 0 && !isAnyDiarizing && (
          <span className="eta">
            {t('queue.summary.etaPrefix')}{' '}
            {typeof estimatedTimeRemainingSec === 'number'
              ? formatEstimatedTime(estimatedTimeRemainingSec)
              : t('queue.summary.etaCalculating')}
          </span>
        )}
        {pendingCount > 0 && <span>{t('queue.summary.pending', { count: pendingCount })}</span>}
        {errorCount > 0 && (
          <span className="error">{t('queue.summary.failed', { count: errorCount })}</span>
        )}
        {completedCount > 0 && !processingCount && (
          <span className="hint">{t('queue.empty.hint')}</span>
        )}
      </div>
    </div>
  );
}

export { FileQueue };
