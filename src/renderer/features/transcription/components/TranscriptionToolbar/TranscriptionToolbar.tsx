import React, { useState, useRef, useEffect } from 'react';
import { Search, Check, Copy, Save } from 'lucide-react';
import { Button } from '../../../../components/ui';
import './TranscriptionToolbar.css';
import type { OutputFormat } from '../../../../types';
import { OUTPUT_FORMATS } from '../../../../config';
import { useTranslation } from '../../../../i18n';

export interface TranscriptionToolbarProps {
  hasText: boolean;
  onCopy: () => void;
  onSave: (format: OutputFormat) => void;
  copySuccess: boolean;
  wordCount: number;
  charCount: number;
  onToggleSearch: () => void;
  isSearchActive: boolean;
  showMediaToggle?: boolean;
  isMediaPlayerEnabled?: boolean;
  onToggleMediaPlayer?: (enabled: boolean) => void;
}

function TranscriptionToolbar({
  hasText,
  onCopy,
  onSave,
  copySuccess,
  wordCount,
  charCount,
  onToggleSearch,
  isSearchActive,
  showMediaToggle = false,
  isMediaPlayerEnabled = true,
  onToggleMediaPlayer,
}: TranscriptionToolbarProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showSaveMenu, setShowSaveMenu] = useState<boolean>(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setShowSaveMenu(false);
      }
    };

    if (showSaveMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSaveMenu]);

  const handleSaveFormat = (format: OutputFormat): void => {
    setShowSaveMenu(false);
    onSave(format);
  };

  return (
    <div className="output-header">
      <h3>{t('toolbar.transcription')}</h3>
      <div className="output-meta">
        {hasText && (
          <span className="word-count">
            {t('toolbar.wordChar', { words: wordCount, chars: charCount })}
          </span>
        )}
      </div>
      {hasText && (
        <div className="output-actions">
          {showMediaToggle && (
            <label className="media-toggle" title={t('toolbar.mediaToggleTitle')}>
              <span className="media-toggle-label media-toggle-label-full">
                {t('toolbar.mediaPlayer')}
              </span>
              <span className="media-toggle-label media-toggle-label-short">
                {t('toolbar.mediaPlayer.short')}
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={isMediaPlayerEnabled}
                onChange={(event) => onToggleMediaPlayer?.(event.currentTarget.checked)}
                aria-label={t('toolbar.mediaToggleAria')}
              />
              <span className="media-toggle-track" aria-hidden="true">
                <span className="media-toggle-thumb" />
              </span>
            </label>
          )}
          <Button
            variant="icon"
            icon={<Search size={14} />}
            onClick={onToggleSearch}
            title={t('toolbar.searchTitle')}
            aria-label={t('toolbar.searchAria')}
            active={isSearchActive}
          >
            {t('toolbar.search')}
          </Button>
          <Button
            variant="icon"
            icon={copySuccess ? <Check size={14} /> : <Copy size={14} />}
            onClick={onCopy}
            title={t('toolbar.copyTitle')}
            aria-label={t('toolbar.copyAria')}
            className={copySuccess ? 'copied' : ''}
          >
            {copySuccess ? t('toolbar.copy.success') : t('toolbar.copy')}
          </Button>
          <div className="save-dropdown" ref={saveMenuRef}>
            <Button
              variant="icon"
              icon={<Save size={14} />}
              onClick={() => setShowSaveMenu(!showSaveMenu)}
              title={t('toolbar.saveTitle')}
              aria-label={t('toolbar.saveAria')}
              aria-expanded={showSaveMenu}
            >
              {t('toolbar.save')}
            </Button>
            {showSaveMenu && (
              <div className="save-menu">
                {OUTPUT_FORMATS.map((format) => (
                  <button
                    key={format.value}
                    className="save-menu-item"
                    onClick={() => handleSaveFormat(format.value)}
                  >
                    {format.label} <span className="format-ext">{format.ext}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { TranscriptionToolbar };
