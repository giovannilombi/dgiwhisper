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

interface SpeakerSpan {
  start: number;
  end: number;
  speaker: number;
}

/**
 * Within a single whisper segment's time range, collect the diarization
 * speakers that cover it. Adjacent same-speaker spans are merged so that
 * a single agglomerate speaker run produces a single output segment.
 * Gaps where no diarization speaker is active are filled by the surrounding
 * speaker (or, for a leading gap with no prior speaker, by the next one).
 */
function speakerSpansWithin(
  ws: WhisperSegment,
  diarSegments: DiarizationSegment[],
  fallbackSpeaker: number
): SpeakerSpan[] {
  const wsLen = Math.max(0, ws.end - ws.start);
  if (wsLen <= 0) return [];

  const overlaps: SpeakerSpan[] = [];
  for (const ds of diarSegments) {
    const start = Math.max(ws.start, ds.start);
    const end = Math.min(ws.end, ds.end);
    if (end > start) overlaps.push({ start, end, speaker: ds.speaker });
  }
  overlaps.sort((a, b) => a.start - b.start);

  // Merge consecutive same-speaker overlaps and fold any small gaps between
  // them into the preceding span — they're typically tiny pauses inside one
  // speaker's turn that the segmentation model didn't bridge.
  const merged: SpeakerSpan[] = [];
  for (const span of overlaps) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === span.speaker && span.start - last.end < 0.5) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  if (merged.length === 0) {
    return [{ start: ws.start, end: ws.end, speaker: fallbackSpeaker }];
  }

  // Stretch the first and last spans to cover the whole whisper segment
  // so we don't drop edge words that fell into a diarization gap.
  const first = merged[0]!;
  const last = merged[merged.length - 1]!;
  first.start = ws.start;
  last.end = ws.end;

  // Fill any inter-span gaps by assigning them to whichever neighbour is
  // closer. Doing this iteratively avoids creating zero-length placeholder
  // spans for the unassigned regions.
  for (let i = 0; i < merged.length - 1; i++) {
    const cur = merged[i]!;
    const next = merged[i + 1]!;
    if (cur.end < next.start) {
      const mid = (cur.end + next.start) / 2;
      cur.end = mid;
      next.start = mid;
    }
  }

  return merged;
}

/**
 * Split each whisper segment at speaker boundaries from the diarization
 * timeline, allocating words proportionally to the time each speaker
 * occupies within the segment. Returns a flat list where every output
 * segment is single-speaker.
 *
 * This is the key step that prevents "mixed speaker" clusters: without
 * splitting, a long whisper cue spanning a turn-taking exchange gets
 * assigned to whichever speaker dominated by overlap, dragging the other
 * speaker's words into the wrong cluster.
 */
export function splitSegmentsBySpeakers(
  whisperSegments: WhisperSegment[],
  diarSegments: DiarizationSegment[]
): SpeakerTaggedSegment[] {
  const result: SpeakerTaggedSegment[] = [];
  let lastSpeaker = 0;

  for (const ws of whisperSegments) {
    const spans = speakerSpansWithin(ws, diarSegments, lastSpeaker);
    if (spans.length === 0) {
      result.push({ ...ws, speaker: lastSpeaker });
      continue;
    }

    if (spans.length === 1) {
      const sp = spans[0]!;
      lastSpeaker = sp.speaker;
      result.push({ ...ws, speaker: sp.speaker });
      continue;
    }

    // Multiple speakers inside this whisper cue — split the text by word
    // count proportional to the time each speaker covers. We keep the
    // word-time mapping linear within the cue: whisper's segments are
    // already short (capped by --max-len), so a uniform-rate assumption
    // is a reasonable approximation in absence of word-level timings.
    const words = ws.text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 1) {
      // Too short to split — give the whole thing to the longest span.
      let best = spans[0]!;
      for (const sp of spans) {
        if (sp.end - sp.start > best.end - best.start) best = sp;
      }
      lastSpeaker = best.speaker;
      result.push({ ...ws, speaker: best.speaker });
      continue;
    }

    const totalSpanLen = spans.reduce((sum, sp) => sum + (sp.end - sp.start), 0) || 1;
    let wordIdx = 0;
    for (let i = 0; i < spans.length; i++) {
      const sp = spans[i]!;
      const remainingSpans = spans.length - 1 - i;
      const remainingWords = words.length - wordIdx;
      let count: number;
      if (i === spans.length - 1) {
        count = remainingWords;
      } else {
        const frac = (sp.end - sp.start) / totalSpanLen;
        const target = Math.round(frac * words.length);
        // Each subsequent span needs at least one word, and we cannot
        // take more than what is left for this span.
        count = Math.max(1, Math.min(remainingWords - remainingSpans, target));
      }
      if (count <= 0) continue;
      const text = words.slice(wordIdx, wordIdx + count).join(' ');
      wordIdx += count;
      lastSpeaker = sp.speaker;
      result.push({ start: sp.start, end: sp.end, text, speaker: sp.speaker });
    }
  }

  return result;
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
