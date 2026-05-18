import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader, Clock, XCircle, Slash, X, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { formatFileSize } from '../../../../utils';
import type { QueueItem, QueueItemStatus } from '../../../../types';
import { toUserFriendlyTranscriptionError } from '../../utils/errorMessages';
import { useTranslation } from '../../../../i18n';
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
  const removeErrorToastTimeoutRef = useRef<number | null>(null);

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
            <div className="file-queue-item-status">{getStatusIcon(item.status)}</div>
            <div className="file-queue-item-content">
              <span className="file-queue-item-name">{item.file.name}</span>
              {item.status === 'processing' && (
                <div className="file-queue-item-progress">
                  <div
                    className="file-queue-item-progress-bar"
                    style={{ width: `${item.progress.percent}%` }}
                  />
                </div>
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
              {item.status === 'processing' && (
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
        {processingCount > 0 && (
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
