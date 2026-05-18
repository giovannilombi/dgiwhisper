import type { TranscribedSegment } from '../../../types';

interface SpeakerBlock {
  speaker: number;
  text: string;
}

function groupSegments(segments: TranscribedSegment[]): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];
  for (const segment of segments) {
    const speaker = segment.speaker ?? 0;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      blocks.push({ speaker, text: segment.text });
    }
  }
  return blocks;
}

function defaultLabel(speakerId: number): string {
  return `Speaker ${speakerId + 1}`;
}

function labelFor(speakerId: number, labels: Record<number, string>): string {
  return labels[speakerId] ?? defaultLabel(speakerId);
}

export function formatDiarizedAsTxt(
  segments: TranscribedSegment[],
  labels: Record<number, string> = {}
): string {
  return groupSegments(segments)
    .map((block) => `${labelFor(block.speaker, labels)}: ${block.text}`)
    .join('\n\n');
}

export function formatDiarizedAsMarkdown(
  segments: TranscribedSegment[],
  labels: Record<number, string> = {}
): string {
  return groupSegments(segments)
    .map((block) => `**${labelFor(block.speaker, labels)}:** ${block.text}`)
    .join('\n\n');
}
