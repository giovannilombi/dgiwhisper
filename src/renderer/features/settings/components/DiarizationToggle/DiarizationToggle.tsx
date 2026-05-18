import React, { useCallback, useEffect, useState } from 'react';
import { Info, Users, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import './DiarizationToggle.css';

export interface DiarizationToggleProps {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}

function DiarizationInfoModal({ onClose }: { onClose: () => void }): React.JSX.Element {
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
            About speaker diarization
          </h2>
          <Button
            variant="ghost"
            icon={<X size={20} />}
            iconOnly
            onClick={onClose}
            aria-label="Close"
            className="diarization-info-close"
          />
        </div>

        <div className="diarization-info-content">
          <p>
            Speaker diarization tries to figure out <em>who spoke when</em> by clustering voice
            characteristics across the audio. It runs locally, after the transcription, and attaches
            a speaker label to each segment.
          </p>

          <h3>What to expect</h3>
          <ul>
            <li>
              <strong>The number of speakers is a guess.</strong> Without ground-truth labels, the
              algorithm decides clusters from voice similarity, and may merge two similar voices or
              split one speaker into two.
            </li>
            <li>
              <strong>Overlapping speech is hard.</strong> When two people talk at the same time,
              one speaker may dominate the segment and the other is hidden.
            </li>
            <li>
              <strong>Short turns can be misassigned.</strong> A one-word interjection may inherit
              the surrounding speaker.
            </li>
            <li>
              <strong>Background noise hurts accuracy.</strong> Music, reverb, or low
              signal-to-noise degrade clustering quality.
            </li>
          </ul>

          <h3>You stay in control</h3>
          <p>
            After diarization runs you can rename each speaker, merge two clusters that are the same
            person, or mark a block as a different speaker. The transcript text is never altered —
            only the speaker labels change.
          </p>
        </div>
      </div>
    </div>
  );
}

function DiarizationToggle({
  enabled,
  disabled = false,
  onChange,
}: DiarizationToggleProps): React.JSX.Element {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <div className={`diarization-toggle-row${disabled ? ' disabled' : ''}`}>
        <label className="diarization-toggle-label">
          <span className="diarization-toggle-icon">
            <Users size={16} aria-hidden="true" />
          </span>
          <span className="diarization-toggle-text">Speaker diarization</span>
          <span className="diarization-toggle-switch">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              aria-label="Enable speaker diarization"
            />
            <span className="diarization-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <Button
          variant="icon"
          iconOnly
          icon={<Info size={16} />}
          onClick={() => setShowInfo(true)}
          title="About speaker diarization"
          aria-label="About speaker diarization"
          className="diarization-info-button"
        />
      </div>
      {showInfo && <DiarizationInfoModal onClose={() => setShowInfo(false)} />}
    </>
  );
}

export { DiarizationToggle };
