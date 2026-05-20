// Phase 2: the "Individuazione speaker" tab content. Replaces the
// temporary DiarizationPanel that lived under the transcript in Phase 1.
// Owns the launch UI (predefinita / personalizzata), the running-state
// presentation (rotating messages + indeterminate progress bar), and
// the pre-launch confirmation when other transcribes are still queued.

import React, { useEffect, useMemo, useState } from 'react';
import { Users, X, RefreshCw, Info, Sparkles, Sliders, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useAppTranscription } from '../../../../contexts';
import { SpeakerLabeledTranscript } from '../SpeakerLabeledTranscript';
import { useTranslation, type TranslationKey } from '../../../../i18n';
import { MAX_DIARIZATION_VERSIONS, getActiveDiarizationVersion } from '../../../../../shared/types';
import './DiarizationTab.css';

type ModeChoice = 'preset' | 'custom';
type SpeakerOption = 'auto' | '2' | '3' | '4' | '5' | '6';

const SPEAKER_OPTIONS: SpeakerOption[] = ['auto', '2', '3', '4', '5', '6'];

const RUNNING_MESSAGE_KEYS = [
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

interface ConfirmModalProps {
  pendingTranscribeCount: number;
  onWait: () => void;
  onSkipAndStart: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  pendingTranscribeCount,
  onWait,
  onSkipAndStart,
  onCancel,
}: ConfirmModalProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="diarization-tab-modal-backdrop" role="dialog" aria-modal="true">
      <div className="diarization-tab-modal">
        <h3>{t('diarization.tab.confirm.title')}</h3>
        <p>{t('diarization.tab.confirm.body')}</p>
        <p className="diarization-tab-modal-count">
          {pendingTranscribeCount} {pendingTranscribeCount === 1 ? 'trascrizione' : 'trascrizioni'}
        </p>
        <div className="diarization-tab-modal-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('diarization.tab.confirm.cancel')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onSkipAndStart}>
            {t('diarization.tab.confirm.skip')}
          </Button>
          <Button variant="primary" size="sm" onClick={onWait}>
            {t('diarization.tab.confirm.wait')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiarizationTab(): React.JSX.Element {
  const { t } = useTranslation();
  const {
    audioId,
    selectedItemDiarization,
    diarization,
    pendingTranscribeCount,
    isTranscribing,
    triggerSelectedItemDiarize,
    cancelSelectedItemDiarize,
    setSelectedItemActiveDiarizationVersion,
    deleteSelectedItemDiarizationVersion,
    handleCancel: cancelAllTranscribes,
    updateCurrentDiarization,
  } = useAppTranscription();

  const status = selectedItemDiarization?.status ?? 'idle';
  const isRunning = status === 'running';
  const isQueued = status === 'queued';
  const isBusy = isRunning || isQueued;
  const activeVersion = getActiveDiarizationVersion(selectedItemDiarization);
  const versions = selectedItemDiarization?.versions ?? [];
  const reachedCap = versions.length >= MAX_DIARIZATION_VERSIONS;

  const initialMode: ModeChoice =
    selectedItemDiarization?.params && Object.keys(selectedItemDiarization.params).length > 0
      ? 'custom'
      : 'preset';
  const [mode, setMode] = useState<ModeChoice>(initialMode);
  const [speakerChoice, setSpeakerChoice] = useState<SpeakerOption>(() => {
    const n = selectedItemDiarization?.params?.numClusters;
    if (typeof n === 'number' && n > 0) {
      const match = SPEAKER_OPTIONS.find((o) => o === String(n));
      return match ?? 'auto';
    }
    return 'auto';
  });
  const [thresholdStr, setThresholdStr] = useState<string>(() => {
    const v = selectedItemDiarization?.params?.threshold;
    return typeof v === 'number' ? v.toFixed(2) : '0.50';
  });
  // 4 additional advanced knobs exposed in Personalizzata. Each stored
  // as the string the slider holds; we parse on launch. Defaults mirror
  // the backend defaults so the slider position always reflects what
  // would be applied if the user pressed Avvia right now.
  const [minDurationOnStr, setMinDurationOnStr] = useState<string>(() => {
    const v = selectedItemDiarization?.params?.minDurationOn;
    return typeof v === 'number' ? v.toFixed(2) : '0.60';
  });
  const [minDurationOffStr, setMinDurationOffStr] = useState<string>(() => {
    const v = selectedItemDiarization?.params?.minDurationOff;
    return typeof v === 'number' ? v.toFixed(2) : '0.70';
  });
  const [minDurationRatioStr, setMinDurationRatioStr] = useState<string>(() => {
    const v = selectedItemDiarization?.params?.minDurationRatio;
    return typeof v === 'number' ? v.toFixed(2) : '0.05';
  });
  const [minRunStr, setMinRunStr] = useState<string>(() => {
    const v = selectedItemDiarization?.params?.minRun;
    return typeof v === 'number' ? String(v) : '6';
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCapModal, setShowCapModal] = useState(false);

  const resetParamsToDefaults = () => {
    setSpeakerChoice('auto');
    setThresholdStr('0.50');
    setMinDurationOnStr('0.60');
    setMinDurationOffStr('0.70');
    setMinDurationRatioStr('0.05');
    setMinRunStr('6');
  };

  // Rotating "we're working on it" message while the job is running. We
  // step through the existing 20 messages every 10 seconds — long enough
  // to read each one without flicker.
  const [msgIndex, setMsgIndex] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      setMsgIndex(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setMsgIndex((i) => (i + 1) % RUNNING_MESSAGE_KEYS.length);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const handleStart = () => {
    // Cap reached → force the user to delete a version first. We could
    // auto-evict the oldest, but the spec says "max 3, delete one to
    // continue" precisely so the user notices and curates.
    if (reachedCap) {
      setShowCapModal(true);
      return;
    }
    // If transcribes are still in-flight, intercept with the confirm
    // modal — the diarize would otherwise just sit in 'queued' until
    // the transcribes drain, and the user might not realise why.
    if (pendingTranscribeCount > 0) {
      setShowConfirm(true);
      return;
    }
    launch();
  };

  const launch = () => {
    const params: {
      numClusters?: number;
      threshold?: number;
      minDurationOn?: number;
      minDurationOff?: number;
      minDurationRatio?: number;
      minRun?: number;
    } = {};
    if (mode === 'custom') {
      if (speakerChoice !== 'auto') {
        const n = Number.parseInt(speakerChoice, 10);
        if (Number.isFinite(n) && n > 0) params.numClusters = n;
      }
      const th = Number.parseFloat(thresholdStr);
      if (Number.isFinite(th) && th > 0) params.threshold = th;
      const mdOn = Number.parseFloat(minDurationOnStr);
      if (Number.isFinite(mdOn) && mdOn > 0) params.minDurationOn = mdOn;
      const mdOff = Number.parseFloat(minDurationOffStr);
      if (Number.isFinite(mdOff) && mdOff > 0) params.minDurationOff = mdOff;
      const ratio = Number.parseFloat(minDurationRatioStr);
      if (Number.isFinite(ratio) && ratio >= 0) params.minDurationRatio = ratio;
      const mr = Number.parseInt(minRunStr, 10);
      if (Number.isFinite(mr) && mr >= 1) params.minRun = mr;
    }
    triggerSelectedItemDiarize(params);
  };

  const handleConfirmWait = () => {
    setShowConfirm(false);
    launch();
  };

  const handleConfirmSkipAndStart = async () => {
    setShowConfirm(false);
    // Skip all running/pending transcribes, then launch. Cancelled
    // transcribes can be resumed later via the existing "Retry Failed"
    // button in the queue header.
    if (isTranscribing) {
      await cancelAllTranscribes();
    }
    launch();
  };

  const runningMessageKey = RUNNING_MESSAGE_KEYS[msgIndex % RUNNING_MESSAGE_KEYS.length] ?? null;

  // Unavailable states. Both branches share the same root cause —
  // audioId is null — but the right CTA differs depending on whether we
  // already have a saved diarization to look at.
  if (!audioId && !activeVersion) {
    return (
      <div className="diarization-tab unavailable">
        <Info size={28} aria-hidden="true" className="diarization-tab-unavailable-icon" />
        <h3>{t('diarization.tab.history.title')}</h3>
        <p>{t('diarization.tab.history.body')}</p>
      </div>
    );
  }
  if (!audioId && activeVersion) {
    // History case: transcript is here, but audio was wiped between
    // sessions. Show the saved versions chips + the result we have so
    // the user can keep refining labels, with an explicit banner that
    // a NEW diarization run requires re-loading the source audio.
    return (
      <div className="diarization-tab">
        <div className="diarization-tab-stale-banner">
          <Info size={16} aria-hidden="true" />
          <span>{t('diarization.tab.history.staleEdit')}</span>
        </div>
        {versions.length > 0 && (
          <VersionsStrip
            versions={versions}
            activeId={activeVersion?.id}
            onSelect={setSelectedItemActiveDiarizationVersion}
            onDelete={deleteSelectedItemDiarizationVersion}
          />
        )}
        {diarization && (
          <SpeakerLabeledTranscript
            segments={diarization.segments}
            speakerCount={diarization.speakerCount}
            initialLabels={diarization.labels}
            onSegmentsChange={(segments) =>
              updateCurrentDiarization({ segments, labels: diarization.labels ?? {} })
            }
            onLabelsChange={(labels) =>
              updateCurrentDiarization({ segments: diarization.segments, labels })
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="diarization-tab">
      <DiarizationInfoBox />

      <section className="diarization-tab-controls" aria-label={t('diarization.tab.mode.label')}>
        <div
          className="diarization-tab-mode"
          role="radiogroup"
          aria-label={t('diarization.tab.mode.label')}
        >
          <ModeChip
            label={t('diarization.tab.mode.preset')}
            icon={<Sparkles size={14} aria-hidden="true" />}
            checked={mode === 'preset'}
            disabled={isBusy}
            onChange={() => setMode('preset')}
          />
          <ModeChip
            label={t('diarization.tab.mode.custom')}
            icon={<Sliders size={14} aria-hidden="true" />}
            checked={mode === 'custom'}
            disabled={isBusy}
            onChange={() => setMode('custom')}
          />
        </div>

        {mode === 'preset' ? (
          <p className="diarization-tab-preset-summary">{t('diarization.tab.preset.summary')}</p>
        ) : (
          <div className="diarization-tab-custom">
            <div className="diarization-tab-custom-header">
              <button
                type="button"
                className="diarization-tab-reset"
                onClick={resetParamsToDefaults}
                disabled={isBusy}
              >
                {t('diarization.tab.custom.reset')}
              </button>
            </div>

            <ParamField
              id="diar-tab-speakers"
              label={t('diarization.tab.custom.speakers.label')}
              hint={t('diarization.tab.custom.speakers.hint')}
            >
              <select
                id="diar-tab-speakers"
                value={speakerChoice}
                onChange={(e) => setSpeakerChoice(e.target.value as SpeakerOption)}
                disabled={isBusy}
              >
                <option value="auto">{t('diarization.speakerCount.auto')}</option>
                {SPEAKER_OPTIONS.filter((o) => o !== 'auto').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </ParamField>

            <ParamField
              id="diar-tab-threshold"
              label={t('diarization.tab.custom.threshold.label', { value: thresholdStr })}
              hint={t('diarization.tab.custom.threshold.hint')}
              dim={speakerChoice !== 'auto'}
            >
              <input
                id="diar-tab-threshold"
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={thresholdStr}
                onChange={(e) => setThresholdStr(e.target.value)}
                disabled={isBusy || speakerChoice !== 'auto'}
              />
            </ParamField>

            <ParamField
              id="diar-tab-min-on"
              label={t('diarization.tab.custom.minOn.label', { value: `${minDurationOnStr}s` })}
              hint={t('diarization.tab.custom.minOn.hint')}
              warning={t('diarization.tab.custom.segParam.warning')}
            >
              <input
                id="diar-tab-min-on"
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={minDurationOnStr}
                onChange={(e) => setMinDurationOnStr(e.target.value)}
                disabled={isBusy}
              />
            </ParamField>

            <ParamField
              id="diar-tab-min-off"
              label={t('diarization.tab.custom.minOff.label', { value: `${minDurationOffStr}s` })}
              hint={t('diarization.tab.custom.minOff.hint')}
              warning={t('diarization.tab.custom.segParam.warning')}
            >
              <input
                id="diar-tab-min-off"
                type="range"
                min="0.1"
                max="2.0"
                step="0.1"
                value={minDurationOffStr}
                onChange={(e) => setMinDurationOffStr(e.target.value)}
                disabled={isBusy}
              />
            </ParamField>

            <ParamField
              id="diar-tab-min-ratio"
              label={t('diarization.tab.custom.minRatio.label', {
                value: `${Math.round(Number.parseFloat(minDurationRatioStr) * 100)}%`,
              })}
              hint={t('diarization.tab.custom.minRatio.hint')}
              dim={speakerChoice !== 'auto'}
            >
              <input
                id="diar-tab-min-ratio"
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={minDurationRatioStr}
                onChange={(e) => setMinDurationRatioStr(e.target.value)}
                disabled={isBusy || speakerChoice !== 'auto'}
              />
            </ParamField>

            <ParamField
              id="diar-tab-min-run"
              label={t('diarization.tab.custom.minRun.label', { value: minRunStr })}
              hint={t('diarization.tab.custom.minRun.hint')}
            >
              <input
                id="diar-tab-min-run"
                type="range"
                min="1"
                max="20"
                step="1"
                value={minRunStr}
                onChange={(e) => setMinRunStr(e.target.value)}
                disabled={isBusy}
              />
            </ParamField>
          </div>
        )}

        <div className="diarization-tab-actions">
          {!isBusy && (
            <Button
              variant="primary"
              icon={<Users size={14} aria-hidden="true" />}
              onClick={handleStart}
              disabled={!audioId}
            >
              {activeVersion ? t('diarization.tab.restart') : t('diarization.tab.start')}
            </Button>
          )}
          {isBusy && (
            <Button
              variant="ghost"
              icon={<X size={14} aria-hidden="true" />}
              onClick={cancelSelectedItemDiarize}
            >
              {t('diarization.tab.cancel')}
            </Button>
          )}
        </div>
      </section>

      {isQueued && (
        <div className="diarization-tab-status queued">
          <RefreshCw size={14} className="spin" aria-hidden="true" />
          <span>{t('diarization.tab.queued')}</span>
        </div>
      )}
      {isRunning && (
        <div className="diarization-tab-status running" role="status" aria-live="polite">
          <RefreshCw size={14} className="spin" aria-hidden="true" />
          <span>{runningMessageKey ? t(runningMessageKey) : t('diarization.tab.running')}</span>
          <div className="diarization-tab-progress">
            <div className="diarization-tab-progress-bar" />
          </div>
        </div>
      )}
      {status === 'error' && selectedItemDiarization?.error && (
        <div className="diarization-tab-status error">
          <strong>{t('diarization.tab.error.heading')}: </strong>
          <span>{selectedItemDiarization.error}</span>
        </div>
      )}
      {status === 'completed' && activeVersion && (
        <div className="diarization-tab-completed-meta">
          {t('diarization.tab.completed.meta', {
            speakers: activeVersion.speakerCount,
            strategy: activeVersion.strategy ?? 'sherpa',
            cached: activeVersion.cached ? t('diarization.tab.completed.cached') : '',
          })}
        </div>
      )}

      {versions.length > 0 && (
        <VersionsStrip
          versions={versions}
          activeId={activeVersion?.id}
          onSelect={setSelectedItemActiveDiarizationVersion}
          onDelete={deleteSelectedItemDiarizationVersion}
        />
      )}

      {diarization && (
        <SpeakerLabeledTranscript
          segments={diarization.segments}
          speakerCount={diarization.speakerCount}
          initialLabels={diarization.labels}
          onSegmentsChange={(segments) =>
            updateCurrentDiarization({ segments, labels: diarization.labels ?? {} })
          }
          onLabelsChange={(labels) =>
            updateCurrentDiarization({ segments: diarization.segments, labels })
          }
        />
      )}

      {showConfirm && (
        <ConfirmModal
          pendingTranscribeCount={pendingTranscribeCount}
          onWait={handleConfirmWait}
          onSkipAndStart={handleConfirmSkipAndStart}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      {showCapModal && <CapModal onClose={() => setShowCapModal(false)} />}
    </div>
  );
}

interface VersionsStripProps {
  versions: ReadonlyArray<{
    id: string;
    createdAt: string;
    params: { numClusters?: number; threshold?: number };
    speakerCount: number;
  }>;
  activeId?: string;
  onSelect: (versionId: string) => void;
  onDelete: (versionId: string) => void;
}

function VersionsStrip({
  versions,
  activeId,
  onSelect,
  onDelete,
}: VersionsStripProps): React.JSX.Element {
  const { t } = useTranslation();
  const formatVersion = (v: VersionsStripProps['versions'][number]): string => {
    const date = new Date(v.createdAt);
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    const speakerLabel =
      typeof v.params.numClusters === 'number' && v.params.numClusters > 0
        ? `${v.params.numClusters}sp`
        : 'auto';
    return `${hh}:${mm} · ${speakerLabel} · ${v.speakerCount}sp`;
  };
  return (
    <div
      className="diarization-tab-versions"
      role="group"
      aria-label={t('diarization.tab.versions.label')}
    >
      <span className="diarization-tab-versions-label">{t('diarization.tab.versions.label')}</span>
      <div className="diarization-tab-versions-chips">
        {versions.map((v) => {
          const isActive = v.id === activeId;
          return (
            <span
              key={v.id}
              className={`diarization-tab-versions-chip${isActive ? ' active' : ''}`}
            >
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                title={new Date(v.createdAt).toLocaleString()}
                className="diarization-tab-versions-chip-label"
              >
                {formatVersion(v)}
              </button>
              <button
                type="button"
                className="diarization-tab-versions-chip-delete"
                onClick={() => onDelete(v.id)}
                aria-label={t('diarization.tab.versions.deleteAria')}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CapModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="diarization-tab-modal-backdrop" role="dialog" aria-modal="true">
      <div className="diarization-tab-modal">
        <h3>{t('diarization.tab.cap.title')}</h3>
        <p>{t('diarization.tab.cap.body', { max: MAX_DIARIZATION_VERSIONS })}</p>
        <div className="diarization-tab-modal-actions">
          <Button variant="primary" size="sm" onClick={onClose}>
            {t('diarization.tab.cap.ok')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ModeChipProps {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}

interface ParamFieldProps {
  id: string;
  label: string;
  hint: string;
  warning?: string;
  dim?: boolean;
  children: React.ReactNode;
}

function ParamField({
  id,
  label,
  hint,
  warning,
  dim,
  children,
}: ParamFieldProps): React.JSX.Element {
  return (
    <div className={`diarization-tab-param${dim ? ' dim' : ''}`}>
      <label htmlFor={id} className="diarization-tab-param-label">
        {label}
      </label>
      {children}
      <p className="diarization-tab-param-hint">{hint}</p>
      {warning && <p className="diarization-tab-param-warning">{warning}</p>}
    </div>
  );
}

function ModeChip({ label, icon, checked, disabled, onChange }: ModeChipProps): React.JSX.Element {
  return (
    <label
      className={`diarization-tab-mode-chip${checked ? ' active' : ''}${disabled ? ' disabled' : ''}`}
    >
      <input
        type="radio"
        name="diarization-mode"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {icon}
      <span>{label}</span>
    </label>
  );
}

function DiarizationInfoBox(): React.JSX.Element {
  const { t } = useTranslation();
  // Inline info, not a modal: in Phase 2 the panel IS the tab — there's
  // room to surface the caveats directly. Specifically the "local model,
  // not perfect accuracy" disclaimer that the user explicitly asked
  // for.
  const items = useMemo(
    () => [
      {
        title: t('diarization.info.expect.count.title'),
        body: t('diarization.info.expect.count.body'),
      },
      {
        title: t('diarization.info.expect.overlap.title'),
        body: t('diarization.info.expect.overlap.body'),
      },
      {
        title: t('diarization.info.expect.short.title'),
        body: t('diarization.info.expect.short.body'),
      },
      {
        title: t('diarization.info.expect.noise.title'),
        body: t('diarization.info.expect.noise.body'),
      },
      {
        title: t('diarization.info.local.title'),
        body: t('diarization.info.local.body'),
      },
    ],
    [t]
  );
  return (
    <details className="diarization-tab-info">
      <summary>
        <Info size={14} aria-hidden="true" />
        <span>{t('diarization.info.title')}</span>
      </summary>
      <p>{t('diarization.info.intro')}</p>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <strong>{it.title}</strong> {it.body}
          </li>
        ))}
      </ul>
    </details>
  );
}

export { DiarizationTab };
