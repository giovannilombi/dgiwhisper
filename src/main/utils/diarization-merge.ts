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

export interface WhisperToken {
  /** Token text exactly as whisper emitted it, including a leading space when
   *  the token starts a new word and including punctuation/special markers. */
  text: string;
  /** Start offset in seconds within the input audio. */
  start: number;
  /** End offset in seconds within the input audio. */
  end: number;
}

/**
 * Extract usable word-level tokens from a whisper `--output-json-full` (`-ojf`)
 * JSON blob. Tokens that whisper emits to represent decoder state — anything
 * matching `[_FOO_]`, the bare `[BLANK]` marker, or zero-length stamps —
 * are filtered out so they do not contaminate the speaker assignment.
 *
 * `start`/`end` are converted from whisper's millisecond offsets to seconds
 * so they line up directly with the diarization segment timeline.
 */
export function parseWhisperJsonFull(jsonText: string): WhisperToken[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const root = parsed as { transcription?: unknown };
  const transcription = Array.isArray(root.transcription) ? root.transcription : [];

  const result: WhisperToken[] = [];
  for (const seg of transcription) {
    if (!seg || typeof seg !== 'object') continue;
    const tokens = (seg as { tokens?: unknown }).tokens;
    if (!Array.isArray(tokens)) continue;
    for (const tok of tokens) {
      if (!tok || typeof tok !== 'object') continue;
      const t = tok as {
        text?: unknown;
        offsets?: { from?: unknown; to?: unknown };
      };
      if (typeof t.text !== 'string') continue;
      const from = Number(t.offsets?.from);
      const to = Number(t.offsets?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      // Drop decoder-state / boundary tokens like [_BEG_], [_TT_525], [BLANK].
      // Real text tokens never look like that.
      if (/^\[_.+_\]$/.test(t.text) || t.text === '[BLANK]' || t.text.trim().length === 0) {
        continue;
      }
      if (to <= from) continue;
      result.push({ text: t.text, start: from / 1000, end: to / 1000 });
    }
  }
  return result;
}

/**
 * Assign a speaker to each whisper token by midpoint lookup against the
 * diarization timeline, then merge consecutive same-speaker tokens into
 * single segments. This is the precise alternative to splitting whisper
 * cues proportionally by time — every word lands in the right cluster
 * because we know its actual timestamp.
 *
 * Tokens whose midpoint falls in a diarization gap inherit the previous
 * token's speaker (or the closest neighbour at the start of the audio).
 */
/**
 * Default "short-run" cutoff used to suppress isolated speaker flips
 * inside otherwise homogeneous speaker turns. Any interior run of fewer
 * tokens than this — sandwiched between two runs of the SAME other
 * speaker — is rewritten to match its neighbours. This kills the
 * sentence-mid jitter produced by over-segmenting diarization without
 * touching real turn-takes (which are always neighboured by a different
 * speaker on the other side).
 *
 * 6 tokens ≈ 1.5–2 s of speech. Calibrated for WeSpeaker ResNet293's
 * cleaner cluster assignments — we don't need to compensate for as many
 * sherpa misclassifications as we did with TitaNet (which required 8).
 * The "flanked by SAME speaker on both sides" guard still protects
 * legitimate short interjections.
 */
const DEFAULT_MIN_RUN_TOKENS = 6;

interface SpeakerRun {
  speaker: number;
  start: number;
  end: number;
}

function runLength(run: SpeakerRun): number {
  return run.end - run.start;
}

/**
 * Collapse short interior speaker runs that are flanked by two longer runs
 * of the same other speaker. This is the central post-processing step
 * that takes a noisy 200+-segment diarization timeline and turns it into
 * something resembling actual speaker turns. The operation is iterative
 * because flattening one run can leave a new short run flanked the same
 * way (e.g. `A A B A C A A` → `A A B A A A A` → `A A A A A A A`).
 */
export function killShortSpeakerRuns(
  speakers: number[],
  minRun: number = DEFAULT_MIN_RUN_TOKENS
): number[] {
  if (speakers.length === 0 || minRun <= 1) return [...speakers];

  const runs: SpeakerRun[] = [];
  let i = 0;
  while (i < speakers.length) {
    let j = i;
    while (j < speakers.length && speakers[j] === speakers[i]) j++;
    runs.push({ speaker: speakers[i]!, start: i, end: j });
    i = j;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 1; r < runs.length - 1; r++) {
      const prev = runs[r - 1]!;
      const curr = runs[r]!;
      const next = runs[r + 1]!;
      if (runLength(curr) >= minRun) continue;
      if (prev.speaker !== next.speaker) continue;
      // Merge prev + curr + next into a single run of prev.speaker.
      prev.end = next.end;
      runs.splice(r, 2);
      changed = true;
      r--; // re-check the newly merged neighbour against its surroundings
    }
  }

  const out = new Array<number>(speakers.length);
  for (const run of runs) {
    for (let k = run.start; k < run.end; k++) out[k] = run.speaker;
  }
  return out;
}

/**
 * Drop diarization clusters whose total speaking time is a negligible
 * fraction of the recording. Tiny clusters are almost always artefacts
 * of the diarizer — momentary embedding outliers triggered by breathing,
 * coughs, room echo or a 100ms acoustic blip. Each segment that belonged
 * to a dropped cluster is reassigned to the speaker of the temporally
 * closest segment still alive after the cull.
 *
 * Conservative defaults: only clusters under 3% of the total duration are
 * killed, AND we never kill so many that fewer than `minSpeakers`
 * clusters remain — that guarantees we don't accidentally collapse a
 * genuine two-speaker conversation into one if the durations are
 * very unbalanced.
 */
export function dropTinyDiarizationClusters(
  segments: DiarizationSegment[],
  minDurationRatio: number = 0.03,
  minSpeakers: number = 2
): DiarizationSegment[] {
  if (segments.length === 0) return [];

  const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (totalDuration <= 0) return segments;

  const perSpeaker = new Map<number, number>();
  for (const s of segments) {
    perSpeaker.set(s.speaker, (perSpeaker.get(s.speaker) ?? 0) + (s.end - s.start));
  }

  // Sort speakers by total duration descending, keep at least `minSpeakers`
  // of them no matter what.
  const sorted = [...perSpeaker.entries()].sort((a, b) => b[1] - a[1]);
  const keep = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const [speaker, dur] = sorted[i]!;
    if (i < minSpeakers) {
      keep.add(speaker);
      continue;
    }
    if (dur / totalDuration >= minDurationRatio) keep.add(speaker);
  }

  if (keep.size === perSpeaker.size) return segments;

  const survivors = segments.filter((s) => keep.has(s.speaker));
  if (survivors.length === 0) return segments;

  // For each DOOMED cluster, decide once which survivor it should merge
  // into and apply that decision to ALL of its segments. The naive
  // alternative — picking the nearest survivor per individual segment —
  // could split one doomed cluster's segments across multiple survivors
  // based on their position in the audio, which is the source of the
  // "speakers got inverted mid-recording" symptom: a single noisy
  // intermediate cluster ends up half-on speaker 0 and half-on speaker 1,
  // visibly flipping the labels at the audio midpoint.
  //
  // The decision is made by weighted voting: each doomed segment casts
  // a vote for the survivor that is temporally closest, weighted by
  // that survivor segment's own duration. Longer survivor segments are
  // more reliable evidence of who that doomed cluster really is.
  const doomedToSurvivor = new Map<number, number>();
  const fallbackSurvivor = sorted.find(([sp]) => keep.has(sp))?.[0] ?? survivors[0]!.speaker;

  for (const [doomedSpeaker] of perSpeaker) {
    if (keep.has(doomedSpeaker)) continue;
    const doomedSegs = segments.filter((s) => s.speaker === doomedSpeaker);
    const votes = new Map<number, number>();
    for (const dseg of doomedSegs) {
      let best: { speaker: number; dist: number; weight: number } | null = null;
      for (const surv of survivors) {
        const dist =
          dseg.end <= surv.start
            ? surv.start - dseg.end
            : surv.end <= dseg.start
              ? dseg.start - surv.end
              : 0;
        const weight = surv.end - surv.start;
        if (best === null || dist < best.dist || (dist === best.dist && weight > best.weight)) {
          best = { speaker: surv.speaker, dist, weight };
        }
      }
      if (best) votes.set(best.speaker, (votes.get(best.speaker) ?? 0) + best.weight);
    }
    let winner = fallbackSurvivor;
    let winnerScore = -1;
    for (const [sp, score] of votes) {
      if (score > winnerScore) {
        winnerScore = score;
        winner = sp;
      }
    }
    doomedToSurvivor.set(doomedSpeaker, winner);
  }

  return segments.map((seg) =>
    keep.has(seg.speaker)
      ? seg
      : { ...seg, speaker: doomedToSurvivor.get(seg.speaker) ?? seg.speaker }
  );
}

export function mergeTokensWithDiarization(
  tokens: WhisperToken[],
  diarSegments: DiarizationSegment[],
  minRun: number = DEFAULT_MIN_RUN_TOKENS
): SpeakerTaggedSegment[] {
  if (tokens.length === 0) return [];

  // Sort diarization segments by start so the linear scan stays cheap.
  const diar = [...diarSegments].sort((a, b) => a.start - b.start);

  const speakerAt = (timeSec: number): number | null => {
    let best: { speaker: number; dist: number } | null = null;
    for (const ds of diar) {
      if (timeSec >= ds.start && timeSec < ds.end) return ds.speaker;
      const dist =
        timeSec < ds.start ? ds.start - timeSec : timeSec >= ds.end ? timeSec - ds.end : 0;
      if (best === null || dist < best.dist) best = { speaker: ds.speaker, dist };
    }
    return best?.speaker ?? null;
  };

  // First pass: assign a raw speaker to each token. Punctuation/continuation
  // tokens (no leading space) inherit the previous token's speaker so a
  // mid-word boundary in the diarization timeline doesn't tear them off
  // their parent word.
  let lastSpeaker = 0;
  const rawSpeakers = new Array<number>(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const startsNewWord = tok.text.startsWith(' ');
    if (!startsNewWord && i > 0) {
      rawSpeakers[i] = rawSpeakers[i - 1]!;
      continue;
    }
    const mid = (tok.start + tok.end) / 2;
    const speaker = speakerAt(mid) ?? lastSpeaker;
    rawSpeakers[i] = speaker;
    lastSpeaker = speaker;
  }

  // Second pass: kill short interior speaker runs surrounded by same-
  // speaker neighbours. This is what stops sentences from being cut
  // visually mid-clause every time the diarizer noisily flips.
  const finalSpeakers = killShortSpeakerRuns(rawSpeakers, minRun);

  // Third pass: build the output segments by merging consecutive
  // same-speaker tokens.
  const result: SpeakerTaggedSegment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const speaker = finalSpeakers[i]!;
    const startsNewWord = tok.text.startsWith(' ');
    const last = result[result.length - 1];

    if (last && (!startsNewWord || last.speaker === speaker)) {
      last.text = `${last.text}${tok.text}`;
      last.end = tok.end;
      continue;
    }

    result.push({
      start: tok.start,
      end: tok.end,
      text: tok.text.replace(/^\s+/, ''),
      speaker,
    });
  }

  return result.map((seg) => ({ ...seg, text: seg.text.trim() }));
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
