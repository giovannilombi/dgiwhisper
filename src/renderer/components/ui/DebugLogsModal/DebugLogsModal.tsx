import React, { useEffect, useCallback } from 'react';
import { X, Terminal, Copy, Clipboard, Trash2 } from 'lucide-react';
import { Button } from '../Button';
import type { LogEntry } from '../../../services/logger';
import { useTranslation } from '../../../i18n';
import './DebugLogsModal.css';

interface DebugLogsModalProps {
  isOpen: boolean;
  logs: LogEntry[];
  onClose: () => void;
  onCopyLogs: () => Promise<boolean>;
  onCopyLogsWithSystemInfo: () => Promise<boolean>;
  onClearLogs: () => void;
}

function formatLogEntry(entry: LogEntry): string {
  const timestamp = entry.timestamp.toISOString().substring(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const data = entry.data !== undefined ? ` | ${JSON.stringify(entry.data)}` : '';
  return `[${timestamp}] [${level}] ${entry.message}${data}`;
}

function DebugLogsModal({
  isOpen,
  logs,
  onClose,
  onCopyLogs,
  onCopyLogsWithSystemInfo,
  onClearLogs,
}: DebugLogsModalProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [copyState, setCopyState] = React.useState<'idle' | 'logs' | 'info'>('idle');

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
    return undefined;
  }, [isOpen, handleKeyDown]);

  const handleCopyLogs = async () => {
    const success = await onCopyLogs();
    if (success) {
      setCopyState('logs');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleCopyWithInfo = async () => {
    const success = await onCopyLogsWithSystemInfo();
    if (success) {
      setCopyState('info');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="debug-logs-overlay" onClick={handleOverlayClick}>
      <div
        className="debug-logs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="debug-logs-title"
      >
        <div className="debug-logs-header">
          <h2 id="debug-logs-title">
            <Terminal size={18} aria-hidden="true" />
            {t('debugLogs.title')}
            <span className="log-count">
              {t(logs.length === 1 ? 'debugLogs.entries.one' : 'debugLogs.entries.many', {
                count: logs.length,
              })}
            </span>
          </h2>
          <Button
            variant="ghost"
            icon={<X size={20} />}
            iconOnly
            onClick={onClose}
            aria-label={t('debugLogs.close')}
            className="debug-logs-close"
          />
        </div>

        <div className="debug-logs-content">
          {logs.length === 0 ? (
            <div className="debug-logs-empty">
              <Terminal size={48} aria-hidden="true" />
              <p>{t('debugLogs.empty.title')}</p>
              <p>{t('debugLogs.empty.body')}</p>
            </div>
          ) : (
            logs.map((entry, index) => (
              <div
                key={`${entry.timestamp.getTime()}-${index}`}
                className={`log-entry level-${entry.level}`}
              >
                {formatLogEntry(entry)}
              </div>
            ))
          )}
        </div>

        <div className="debug-logs-footer">
          <Button
            variant="primary"
            icon={<Copy size={16} />}
            onClick={handleCopyLogs}
            disabled={logs.length === 0}
            className={`btn-copy-logs ${copyState === 'logs' ? 'copied' : ''}`}
          >
            {copyState === 'logs' ? t('debugLogs.copied') : t('debugLogs.copy')}
          </Button>
          <Button
            variant="secondary"
            icon={<Clipboard size={16} />}
            onClick={handleCopyWithInfo}
            disabled={logs.length === 0}
            className={`btn-copy-with-info ${copyState === 'info' ? 'copied' : ''}`}
          >
            {copyState === 'info' ? t('debugLogs.copied') : t('debugLogs.copyWithSystem')}
          </Button>
          <Button
            variant="secondary"
            icon={<Trash2 size={16} />}
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="btn-clear-logs danger"
          >
            {t('debugLogs.clear')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DebugLogsModal };
export type { DebugLogsModalProps };
