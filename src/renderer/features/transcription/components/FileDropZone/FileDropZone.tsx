import React, { useCallback, type DragEvent, type KeyboardEvent } from 'react';
import { Files } from 'lucide-react';
import { isValidMediaFile, selectAndProcessFiles } from '../../../../utils';
import type { SelectedFile } from '../../../../types';
import { getPathForFile, getFileInfo } from '../../../../services/electronAPI';
import { useTranslation } from '../../../../i18n';
import './FileDropZone.css';

export interface FileDropZoneProps {
  onFilesSelect: (files: SelectedFile[]) => void;
  queueCount?: number;
  duplicateFilesSkipped?: number;
  disabled: boolean;
}

function FileDropZone({
  onFilesSelect,
  queueCount = 0,
  duplicateFilesSkipped = 0,
  disabled,
}: FileDropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const handleClick = async (): Promise<void> => {
    if (disabled) return;

    const files = await selectAndProcessFiles();
    if (files.length > 0) {
      onFilesSelect(files);
    }
  };

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault();
      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const validFiles: SelectedFile[] = [];

      for (const file of files) {
        if (isValidMediaFile(file.name)) {
          const filePath = getPathForFile(file);
          if (filePath) {
            const fileInfo = await getFileInfo(filePath);
            if (fileInfo) {
              validFiles.push(fileInfo);
            }
          }
        }
      }

      if (validFiles.length > 0) {
        onFilesSelect(validFiles);
      }
    },
    [disabled, onFilesSelect]
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={`dropzone ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={t('drop.aria')}
      onKeyDown={handleKeyDown}
    >
      <div className="dropzone-content">
        <Files size={40} className="dropzone-icon-svg" />
        <span className="dropzone-text">{t('drop.title')}</span>
        <span className="dropzone-subtext">{t('drop.subtitle')}</span>
        <span className="dropzone-formats">
          MP3, WAV, M4A, FLAC, OGG, OPUS, OGA, AMR, MP4, MOV, AVI, MKV, WEBM
        </span>
        {queueCount > 0 && (
          <span className="dropzone-queue-badge">
            {t(queueCount === 1 ? 'drop.queueBadge.one' : 'drop.queueBadge.many', {
              count: queueCount,
            })}
          </span>
        )}
        {duplicateFilesSkipped > 0 && (
          <span className="dropzone-duplicate-badge" role="status" aria-live="polite">
            {t(
              duplicateFilesSkipped === 1 ? 'drop.duplicateBadge.one' : 'drop.duplicateBadge.many',
              { count: duplicateFilesSkipped }
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export { FileDropZone };
