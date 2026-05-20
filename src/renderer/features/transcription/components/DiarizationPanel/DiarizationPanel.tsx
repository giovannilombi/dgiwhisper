// TEMPORARY Phase 1 panel — exposes the new separate diarization flow
// without yet introducing the tabbed UX. Will be removed in Phase 2
// when "Individuazione speaker" becomes its own tab and gets the proper
// design treatment (predefiniti / personalizzati, version history,
// in-line info modal, etc.).

import React, { useState } from 'react';
import { Users, X, RefreshCw } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useAppTranscription } from '../../../../contexts';
import './DiarizationPanel.css';

const SPEAKER_OPTIONS = ['auto', '2', '3', '4', '5', '6'] as const;

function DiarizationPanel(): React.JSX.Element | null {
  const { audioId, diarizeStatus, diarization, runDiarization, cancelDiarization } =
    useAppTranscription();

  const [speakerChoice, setSpeakerChoice] = useState<(typeof SPEAKER_OPTIONS)[number]>('auto');
  const [thresholdStr, setThresholdStr] = useState('0.5');

  if (!audioId) return null;

  const handleRun = async () => {
    const params: { numClusters?: number; threshold?: number } = {};
    if (speakerChoice !== 'auto') {
      const n = Number.parseInt(speakerChoice, 10);
      if (Number.isFinite(n) && n > 0) params.numClusters = n;
    }
    const t = Number.parseFloat(thresholdStr);
    if (Number.isFinite(t) && t > 0) params.threshold = t;
    await runDiarization(params);
  };

  const disabled = diarizeStatus.running;

  return (
    <aside
      className="diarization-panel"
      role="region"
      aria-label="Individuazione speaker (anteprima Fase 1)"
    >
      <header className="diarization-panel-header">
        <Users size={16} aria-hidden="true" />
        <h3>Individuazione speaker</h3>
      </header>
      <p className="diarization-panel-disclaimer">
        Pannello provvisorio: in Fase 2 diventerà una tab dedicata con messaggi animati e controlli
        avanzati. Per ora qui imposti i parametri e lanci la diarizzazione sul transcript corrente.
      </p>
      <div className="diarization-panel-row">
        <label htmlFor="diar-speakers" className="diarization-panel-label">
          Numero speaker
        </label>
        <select
          id="diar-speakers"
          value={speakerChoice}
          onChange={(e) => setSpeakerChoice(e.target.value as (typeof SPEAKER_OPTIONS)[number])}
          disabled={disabled}
        >
          <option value="auto">Auto-rileva</option>
          {SPEAKER_OPTIONS.filter((o) => o !== 'auto').map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div className="diarization-panel-row">
        <label htmlFor="diar-threshold" className="diarization-panel-label">
          Threshold ({thresholdStr})
        </label>
        <input
          id="diar-threshold"
          type="range"
          min="0.1"
          max="1.0"
          step="0.05"
          value={thresholdStr}
          onChange={(e) => setThresholdStr(e.target.value)}
          disabled={disabled || speakerChoice !== 'auto'}
        />
      </div>
      <div className="diarization-panel-actions">
        <Button
          variant="primary"
          size="sm"
          icon={
            diarizeStatus.running ? <RefreshCw size={14} className="spin" /> : <Users size={14} />
          }
          onClick={handleRun}
          disabled={disabled}
        >
          {diarizeStatus.running
            ? 'Diarizzazione in corso…'
            : diarization
              ? 'Riapplica'
              : 'Diarizza'}
        </Button>
        {diarizeStatus.running && (
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={cancelDiarization}>
            Annulla
          </Button>
        )}
      </div>
      {diarizeStatus.error && (
        <p className="diarization-panel-error" role="alert">
          {diarizeStatus.error}
        </p>
      )}
      {diarization && !diarizeStatus.running && (
        <p className="diarization-panel-meta">
          {diarization.speakerCount} speaker · {diarizeStatus.strategy ?? 'sherpa'}
          {diarizeStatus.cached ? ' · cache hit' : ''}
        </p>
      )}
    </aside>
  );
}

export { DiarizationPanel };
