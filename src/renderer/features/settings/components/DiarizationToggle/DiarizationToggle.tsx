import React, { useCallback, useEffect, useState } from 'react';
import { Info, Users, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useTranslation } from '../../../../i18n';
import './DiarizationToggle.css';

export interface DiarizationToggleProps {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
  speakerCount?: number;
  onSpeakerCountChange?: (count: number | undefined) => void;
}

function DiarizationInfoModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  // The intro sentence is built from a template that contains the
  // emphasized phrase verbatim — we split on it so we can render an <em>.
  const intro = t('diarization.info.intro');
  const emphasized = t('diarization.info.intro.emphasized');
  const introParts = intro.split(emphasized);

  return (
    <div className="diarization-info-overlay" onClick={onClose}>
      <div
        className="diarization-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diarization-info-title"
        onClick={stopPropagation}
      >
        <div className="diarization-info-header">
          <h2 id="diarization-info-title">
            <Users size={18} aria-hidden="true" />
            {t('diarization.info.title')}
          </h2>
          <Button
            variant="ghost"
            icon={<X size={20} />}
            iconOnly
            onClick={onClose}
            aria-label={t('diarization.info.close')}
            className="diarization-info-close"
          />
        </div>

        <div className="diarization-info-content">
          <p>
            {introParts[0]}
            <em>{emphasized}</em>
            {introParts.slice(1).join(emphasized)}
          </p>

          <h3>{t('diarization.info.expect.heading')}</h3>
          <ul>
            <li>
              <strong>{t('diarization.info.expect.count.title')}</strong>{' '}
              {t('diarization.info.expect.count.body')}
            </li>
            <li>
              <strong>{t('diarization.info.expect.overlap.title')}</strong>{' '}
              {t('diarization.info.expect.overlap.body')}
            </li>
            <li>
              <strong>{t('diarization.info.expect.short.title')}</strong>{' '}
              {t('diarization.info.expect.short.body')}
            </li>
            <li>
              <strong>{t('diarization.info.expect.noise.title')}</strong>{' '}
              {t('diarization.info.expect.noise.body')}
            </li>
          </ul>

          <h3>{t('diarization.info.control.heading')}</h3>
          <p>{t('diarization.info.control.body')}</p>
        </div>
      </div>
    </div>
  );
}

function DiarizationToggle({
  enabled,
  disabled = false,
  onChange,
  speakerCount,
  onSpeakerCountChange,
}: DiarizationToggleProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showInfo, setShowInfo] = useState(false);

  const handleSpeakerCountChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'auto') {
      onSpeakerCountChange?.(undefined);
    } else {
      onSpeakerCountChange?.(Number.parseInt(value, 10));
    }
  };

  const speakerSelectValue = typeof speakerCount === 'number' ? String(speakerCount) : 'auto';

  return (
    <>
      <div className={`diarization-toggle-row${disabled ? ' disabled' : ''}`}>
        <label className="diarization-toggle-label">
          <span className="diarization-toggle-icon">
            <Users size={16} aria-hidden="true" />
          </span>
          <span className="diarization-toggle-text">{t('diarization.toggle')}</span>
          <span className="diarization-toggle-switch">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              aria-label={t('diarization.toggle.enableAria')}
            />
            <span className="diarization-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <Button
          variant="icon"
          iconOnly
          icon={<Info size={16} />}
          onClick={() => setShowInfo(true)}
          title={t('diarization.info.button')}
          aria-label={t('diarization.info.button')}
          className="diarization-info-button"
        />
      </div>
      {enabled && (
        <div className={`diarization-speakers-row${disabled ? ' disabled' : ''}`}>
          <label htmlFor="diarization-speaker-count" className="diarization-speakers-label">
            {t('diarization.speakerCount.label')}
          </label>
          <select
            id="diarization-speaker-count"
            className="diarization-speakers-select"
            value={speakerSelectValue}
            disabled={disabled}
            onChange={handleSpeakerCountChange}
            aria-label={t('diarization.speakerCount.label')}
          >
            <option value="auto">{t('diarization.speakerCount.auto')}</option>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
      {showInfo && <DiarizationInfoModal onClose={() => setShowInfo(false)} />}
    </>
  );
}

export { DiarizationToggle };
