import React, { useEffect, useRef, useState } from 'react';
import { FileText, Users, File as FileIcon, Pencil, Check, X } from 'lucide-react';
import { OutputDisplay } from '../../../features/transcription';
import { DiarizationTab } from '../../../features/transcription/components/DiarizationTab';
import { TranscriptionHistory } from '../../../features/history';
import { Tabs, Button } from '../../ui';
import { useAppHistory, useAppTranscription } from '../../../contexts';
import { useTranslation } from '../../../i18n';
import { formatFileSize, formatTranscriptLabel } from '../../../utils';
import './RightPanel.css';

type RightPanelTabId = 'transcript' | 'diarization';

function RightPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const {
    history,
    showHistory,
    setShowHistory,
    clearHistory,
    selectHistoryItem,
    removeHistoryItem,
  } = useAppHistory();
  const {
    transcription,
    diarization,
    selectedFile,
    copySuccess,
    selectedQueueItemId,
    selectedItemDiarization,
    selectedItemDisplayName,
    audioId,
    currentDiarizeItemId,
    handleSave,
    handleCopy,
    renameSelectedItem,
  } = useAppTranscription();

  // Per-file tab state: switching to a different queue item resets to
  // the Trascrizione tab. The Individuazione speaker tab is only enabled
  // when the selected file has either a live audio entry (session) or
  // an existing diarization result on disk.
  const [activeTab, setActiveTab] = useState<RightPanelTabId>('transcript');
  useEffect(() => {
    setActiveTab('transcript');
  }, [selectedQueueItemId]);

  // If the user clicks the in-queue item that's currently being
  // diarized, switch to the diarize tab automatically — matches the
  // spec's "spinner on sidebar, click → goes to the tab".
  useEffect(() => {
    if (currentDiarizeItemId && selectedQueueItemId === currentDiarizeItemId) {
      setActiveTab('diarization');
    }
  }, [currentDiarizeItemId, selectedQueueItemId]);

  if (showHistory) {
    return (
      <div className="right-panel">
        <TranscriptionHistory
          history={history}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
          onSelect={selectHistoryItem}
          onDelete={removeHistoryItem}
        />
      </div>
    );
  }

  const diarizeTabEnabled = Boolean(audioId || diarization);
  const diarizeTabBusy =
    selectedItemDiarization?.status === 'running' || selectedItemDiarization?.status === 'queued';
  const showTabs = Boolean(transcription) && diarizeTabEnabled;
  // The header bar shows the source file of whatever is on the right
  // side — it's the only durable cue connecting the queue card on the
  // left to the transcript / diarization view on the right. We render
  // it whenever there's any transcript content to show.
  const showFileHeader = Boolean(transcription) && Boolean(selectedFile);

  return (
    <div className="right-panel">
      {showFileHeader && selectedFile && (
        <FileHeader
          fileName={selectedFile.name}
          path={selectedFile.path}
          size={selectedFile.size}
          displayName={selectedItemDisplayName}
          canRename={Boolean(selectedQueueItemId)}
          onRename={renameSelectedItem}
        />
      )}

      {showTabs && (
        <Tabs<RightPanelTabId>
          ariaLabel={t('rightPanel.tabsAriaLabel')}
          activeId={activeTab}
          onChange={setActiveTab}
          tabs={[
            {
              id: 'transcript',
              label: t('rightPanel.tab.transcript'),
              icon: <FileText size={14} aria-hidden="true" />,
            },
            {
              id: 'diarization',
              label: t('diarization.tab.title'),
              icon: <Users size={14} aria-hidden="true" />,
              busy: diarizeTabBusy,
            },
          ]}
        />
      )}

      {activeTab === 'diarization' && showTabs ? (
        <DiarizationTab />
      ) : (
        <OutputDisplay
          text={transcription}
          selectedFile={selectedFile}
          onSave={handleSave}
          onCopy={handleCopy}
          copySuccess={copySuccess}
          /* The diarized view used to render here as well, but Phase 2
             moved it under the dedicated Individuazione speaker tab. */
          diarizationSegments={null}
          speakerCount={undefined}
          diarizationLabels={undefined}
          onDiarizationStateChange={() => {}}
        />
      )}
    </div>
  );
}

interface FileHeaderProps {
  fileName: string;
  path: string;
  size?: number;
  displayName: string | null;
  canRename: boolean;
  onRename: (displayName: string) => void;
}

function FileHeader({
  fileName,
  path,
  size,
  displayName,
  canRename,
  onRename,
}: FileHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(displayName ?? '');
  }, [displayName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    onRename(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(displayName ?? '');
    setEditing(false);
  };

  const label = formatTranscriptLabel({ displayName, fileName });

  return (
    <div className="right-panel-file-header" title={path}>
      <FileIcon size={14} aria-hidden="true" className="right-panel-file-header-icon" />
      {editing ? (
        <>
          <input
            ref={inputRef}
            type="text"
            className="right-panel-file-header-input"
            value={draft}
            placeholder={fileName}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            aria-label={t('rightPanel.rename.inputAria')}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Check size={14} />}
            onClick={commit}
            title={t('rightPanel.rename.save')}
            aria-label={t('rightPanel.rename.save')}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<X size={14} />}
            onClick={cancel}
            title={t('rightPanel.rename.cancel')}
            aria-label={t('rightPanel.rename.cancel')}
          />
        </>
      ) : (
        <>
          <span className="right-panel-file-header-name">{label}</span>
          {typeof size === 'number' && size > 0 && (
            <span className="right-panel-file-header-size">{formatFileSize(size)}</span>
          )}
          {canRename && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Pencil size={12} />}
              onClick={() => setEditing(true)}
              title={t('rightPanel.rename.edit')}
              aria-label={t('rightPanel.rename.edit')}
              className="right-panel-file-header-rename"
            />
          )}
        </>
      )}
    </div>
  );
}

export { RightPanel };
