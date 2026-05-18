import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Users, Scissors, Merge, Pencil, Check, X, ChevronDown } from 'lucide-react';
import { Button } from '../../../../components/ui';
import type { TranscribedSegment } from '../../../../types';
import './SpeakerLabeledTranscript.css';

export interface SpeakerLabeledTranscriptProps {
  segments: TranscribedSegment[];
  speakerCount: number;
  onLabelsChange?: (labels: Record<number, string>) => void;
  onSegmentsChange?: (segments: TranscribedSegment[]) => void;
}

interface SpeakerBlock {
  speaker: number;
  text: string;
  startSec: number;
  endSec: number;
  segmentIndices: number[];
}

function groupBlocks(segments: TranscribedSegment[]): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];
  segments.forEach((segment, index) => {
    const speaker = segment.speaker ?? 0;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${segment.text}`.trim();
      last.endSec = segment.end;
      last.segmentIndices.push(index);
    } else {
      blocks.push({
        speaker,
        text: segment.text,
        startSec: segment.start,
        endSec: segment.end,
        segmentIndices: [index],
      });
    }
  });
  return blocks;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function defaultLabelFor(speakerId: number): string {
  return `Speaker ${speakerId + 1}`;
}

function SpeakerLabeledTranscript({
  segments,
  speakerCount,
  onLabelsChange,
  onSegmentsChange,
}: SpeakerLabeledTranscriptProps): React.JSX.Element {
  const [workingSegments, setWorkingSegments] = useState<TranscribedSegment[]>(segments);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [openMergeFor, setOpenMergeFor] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Reset internal state whenever the input segments change (new transcription)
  useEffect(() => {
    setWorkingSegments(segments);
    setLabels({});
    setEditingSpeaker(null);
    setOpenMergeFor(null);
  }, [segments]);

  useEffect(() => {
    if (editingSpeaker !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSpeaker]);

  useEffect(() => {
    onLabelsChange?.(labels);
  }, [labels, onLabelsChange]);

  useEffect(() => {
    onSegmentsChange?.(workingSegments);
  }, [workingSegments, onSegmentsChange]);

  const blocks = useMemo(() => groupBlocks(workingSegments), [workingSegments]);

  const speakerIds = useMemo(() => {
    const ids = new Set<number>();
    workingSegments.forEach((s) => ids.add(s.speaker ?? 0));
    return Array.from(ids).sort((a, b) => a - b);
  }, [workingSegments]);

  const labelFor = useCallback(
    (speakerId: number): string => labels[speakerId] ?? defaultLabelFor(speakerId),
    [labels]
  );

  const startRename = (speakerId: number) => {
    setEditingSpeaker(speakerId);
    setEditingValue(labelFor(speakerId));
    setOpenMergeFor(null);
  };

  const commitRename = () => {
    if (editingSpeaker === null) return;
    const trimmed = editingValue.trim();
    setLabels((prev) => {
      const next = { ...prev };
      if (trimmed.length === 0 || trimmed === defaultLabelFor(editingSpeaker)) {
        delete next[editingSpeaker];
      } else {
        next[editingSpeaker] = trimmed;
      }
      return next;
    });
    setEditingSpeaker(null);
  };

  const cancelRename = () => {
    setEditingSpeaker(null);
  };

  const mergeInto = (fromSpeaker: number, intoSpeaker: number) => {
    if (fromSpeaker === intoSpeaker) {
      setOpenMergeFor(null);
      return;
    }
    setWorkingSegments((prev) =>
      prev.map((s) => (s.speaker === fromSpeaker ? { ...s, speaker: intoSpeaker } : s))
    );
    setLabels((prev) => {
      const next = { ...prev };
      delete next[fromSpeaker];
      return next;
    });
    setOpenMergeFor(null);
  };

  const splitBlock = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (!block) return;
    const newSpeakerId = Math.max(...workingSegments.map((s) => s.speaker ?? 0)) + 1;
    setWorkingSegments((prev) => {
      const next = [...prev];
      block.segmentIndices.forEach((idx) => {
        const seg = next[idx];
        if (seg) {
          next[idx] = { ...seg, speaker: newSpeakerId };
        }
      });
      return next;
    });
  };

  return (
    <div className="speaker-transcript" role="region" aria-label="Diarized transcript">
      <div className="speaker-transcript-banner">
        <Users size={14} aria-hidden="true" />
        <span>
          {speakerIds.length} speaker{speakerIds.length === 1 ? '' : 's'} detected
          {speakerCount !== speakerIds.length ? ` (originally ${speakerCount})` : ''}.
        </span>
      </div>

      <div className="speaker-transcript-blocks">
        {blocks.map((block, blockIndex) => {
          const isEditing = editingSpeaker === block.speaker;
          const isMergeOpen = openMergeFor === blockIndex;
          const otherSpeakers = speakerIds.filter((id) => id !== block.speaker);

          return (
            <article key={`block-${blockIndex}`} className="speaker-block">
              <header className="speaker-block-header">
                <div className="speaker-block-identity">
                  {isEditing ? (
                    <span className="speaker-label-edit">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        aria-label="Speaker name"
                        className="speaker-label-input"
                      />
                      <Button
                        variant="icon"
                        iconOnly
                        icon={<Check size={14} />}
                        onClick={commitRename}
                        title="Save"
                        aria-label="Save speaker name"
                      />
                      <Button
                        variant="icon"
                        iconOnly
                        icon={<X size={14} />}
                        onClick={cancelRename}
                        title="Cancel"
                        aria-label="Cancel rename"
                      />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="speaker-label-button"
                      onClick={() => startRename(block.speaker)}
                      title="Rename speaker"
                    >
                      <span className="speaker-label-name">{labelFor(block.speaker)}</span>
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                  )}
                  <span className="speaker-block-time">
                    {formatTime(block.startSec)} – {formatTime(block.endSec)}
                  </span>
                </div>
                <div className="speaker-block-actions">
                  {otherSpeakers.length > 0 && (
                    <div className="speaker-merge-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Merge size={14} />}
                        onClick={() => setOpenMergeFor(isMergeOpen ? null : blockIndex)}
                        aria-haspopup="menu"
                        aria-expanded={isMergeOpen}
                        title="Merge this speaker into another"
                      >
                        Merge
                        <ChevronDown size={12} aria-hidden="true" />
                      </Button>
                      {isMergeOpen && (
                        <div className="speaker-merge-menu" role="menu">
                          <p className="speaker-merge-hint">
                            Merge <strong>{labelFor(block.speaker)}</strong> into…
                          </p>
                          {otherSpeakers.map((targetId) => (
                            <button
                              key={`merge-${blockIndex}-${targetId}`}
                              type="button"
                              role="menuitem"
                              className="speaker-merge-option"
                              onClick={() => mergeInto(block.speaker, targetId)}
                            >
                              {labelFor(targetId)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Scissors size={14} />}
                    onClick={() => splitBlock(blockIndex)}
                    title="Mark this block as a different speaker"
                  >
                    Split
                  </Button>
                </div>
              </header>
              <p className="speaker-block-text">{block.text}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export { SpeakerLabeledTranscript };
