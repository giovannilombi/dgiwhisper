import type { DiarizationSegment } from '../../shared/types';

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface SpeakerTaggedSegment extends WhisperSegment {
  speaker: number;
}

const VTT_TIMESTAMP_RE =
  /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function timestampToSeconds(h: string, m: string, s: string, ms: string): number {
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
}

/**
 * Parse a WebVTT transcript into an array of segments. Cue identifiers and
 * notes are ignored; only timed cues with text content are returned.
 */
export function parseVtt(vtt: string): WhisperSegment[] {
  const segments: WhisperSegment[] = [];
  const lines = vtt.replace(/\r/g, '').split('\n');

  let i = 0;
  while (i < lines.length) {
    const match = lines[i]?.match(VTT_TIMESTAMP_RE);
    if (!match) {
      i++;
      continue;
    }

    const start = timestampToSeconds(match[1]!, match[2]!, match[3]!, match[4]!);
    const end = timestampToSeconds(match[5]!, match[6]!, match[7]!, match[8]!);

    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]?.trim() !== '' && !lines[i]?.match(VTT_TIMESTAMP_RE)) {
      textLines.push(lines[i] ?? '');
      i++;
    }

    const text = textLines.join(' ').trim();
    if (text.length > 0) {
      segments.push({ start, end, text });
    }
  }

  return segments;
}

/**
 * For each transcript segment, pick the speaker whose diarization region
 * overlaps the segment the most. Segments with no overlap inherit the
 * previous segment's speaker, or fall back to 0.
 */
export function assignSpeakers(
  whisperSegments: WhisperSegment[],
  diarSegments: DiarizationSegment[]
): SpeakerTaggedSegment[] {
  let lastSpeaker = 0;
  return whisperSegments.map((ws) => {
    let bestOverlap = 0;
    let bestSpeaker: number | null = null;

    for (const ds of diarSegments) {
      const overlap = Math.max(0, Math.min(ws.end, ds.end) - Math.max(ws.start, ds.start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = ds.speaker;
      }
    }

    const speaker = bestSpeaker ?? lastSpeaker;
    lastSpeaker = speaker;
    return { ...ws, speaker };
  });
}

/**
 * Remap arbitrary cluster IDs to a contiguous range starting at 0, preserving
 * the order in which speakers first appear in the transcript. Returns the
 * remapped segments and the total number of distinct speakers.
 */
export function remapSpeakers<T extends { speaker: number }>(
  segments: T[]
): { segments: T[]; speakerCount: number } {
  const mapping = new Map<number, number>();
  const remapped = segments.map((s) => {
    if (!mapping.has(s.speaker)) {
      mapping.set(s.speaker, mapping.size);
    }
    return { ...s, speaker: mapping.get(s.speaker)! };
  });
  return { segments: remapped, speakerCount: mapping.size };
}
