import { describe, it, expect } from 'vitest';
import {
  parseVtt,
  assignSpeakers,
  splitSegmentsBySpeakers,
  parseWhisperJsonFull,
  mergeTokensWithDiarization,
  killShortSpeakerRuns,
  dropTinyDiarizationClusters,
  remapSpeakers,
} from '../diarization-merge';

describe('parseVtt', () => {
  it('parses a simple two-cue VTT', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.500
Hello world.

00:00:02.500 --> 00:00:05.000
How are you?
`;
    const segments = parseVtt(vtt);
    expect(segments).toEqual([
      { start: 0, end: 2.5, text: 'Hello world.' },
      { start: 2.5, end: 5, text: 'How are you?' },
    ]);
  });

  it('joins multi-line cue text with a space', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
First line
second line
`;
    expect(parseVtt(vtt)).toEqual([{ start: 0, end: 3, text: 'First line second line' }]);
  });

  it('skips cues with empty text', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000

00:00:02.000 --> 00:00:04.000
Hello.
`;
    expect(parseVtt(vtt)).toEqual([{ start: 2, end: 4, text: 'Hello.' }]);
  });

  it('accepts comma decimal separator (SRT-style fallback)', () => {
    const vtt = `WEBVTT

00:00:01,500 --> 00:00:03,250
Localised punctuation.
`;
    expect(parseVtt(vtt)).toEqual([{ start: 1.5, end: 3.25, text: 'Localised punctuation.' }]);
  });

  it('returns empty array for VTT with no cues', () => {
    expect(parseVtt('WEBVTT\n\n')).toEqual([]);
  });
});

describe('assignSpeakers', () => {
  it('assigns the speaker with maximum overlap for each segment', () => {
    const whisper = [
      { start: 0, end: 3, text: 'A' },
      { start: 3, end: 6, text: 'B' },
      { start: 6, end: 9, text: 'C' },
    ];
    const diar = [
      { start: 0, end: 3.5, speaker: 0 },
      { start: 3.5, end: 7, speaker: 1 },
      { start: 7, end: 10, speaker: 2 },
    ];
    expect(assignSpeakers(whisper, diar)).toEqual([
      { start: 0, end: 3, text: 'A', speaker: 0 },
      { start: 3, end: 6, text: 'B', speaker: 1 },
      { start: 6, end: 9, text: 'C', speaker: 2 },
    ]);
  });

  it('falls back to the previous speaker when a segment has no overlap', () => {
    const whisper = [
      { start: 0, end: 2, text: 'A' },
      { start: 10, end: 12, text: 'B (silent gap)' },
    ];
    const diar = [{ start: 0, end: 2, speaker: 0 }];
    expect(assignSpeakers(whisper, diar)).toEqual([
      { start: 0, end: 2, text: 'A', speaker: 0 },
      { start: 10, end: 12, text: 'B (silent gap)', speaker: 0 },
    ]);
  });

  it('defaults to speaker 0 when nothing has ever overlapped', () => {
    const whisper = [{ start: 0, end: 2, text: 'A' }];
    const diar = [{ start: 5, end: 7, speaker: 42 }];
    expect(assignSpeakers(whisper, diar)).toEqual([{ start: 0, end: 2, text: 'A', speaker: 0 }]);
  });

  it('picks the larger overlap when a segment spans two speakers', () => {
    const whisper = [{ start: 0, end: 10, text: 'split' }];
    const diar = [
      { start: 0, end: 3, speaker: 0 },
      { start: 3, end: 10, speaker: 1 },
    ];
    expect(assignSpeakers(whisper, diar)[0]?.speaker).toBe(1);
  });
});

describe('splitSegmentsBySpeakers', () => {
  it('keeps a single-speaker segment intact', () => {
    const whisper = [{ start: 0, end: 4, text: 'hello there friend' }];
    const diar = [{ start: 0, end: 4, speaker: 1 }];
    expect(splitSegmentsBySpeakers(whisper, diar)).toEqual([
      { start: 0, end: 4, text: 'hello there friend', speaker: 1 },
    ]);
  });

  it('splits a two-speaker exchange proportionally by time', () => {
    // 10s cue, four words evenly spaced. Speaker A talks for the first 5s,
    // speaker B for the last 5s — so two words should land on each side.
    const whisper = [{ start: 0, end: 10, text: 'one two three four' }];
    const diar = [
      { start: 0, end: 5, speaker: 0 },
      { start: 5, end: 10, speaker: 1 },
    ];
    expect(splitSegmentsBySpeakers(whisper, diar)).toEqual([
      { start: 0, end: 5, text: 'one two', speaker: 0 },
      { start: 5, end: 10, text: 'three four', speaker: 1 },
    ]);
  });

  it('assigns at least one word to every speaker even with skewed time ratios', () => {
    // Speaker B only gets 1s of a 10s cue with 5 words — but it still owns
    // at least one word, leaving 4 for speaker A.
    const whisper = [{ start: 0, end: 10, text: 'one two three four five' }];
    const diar = [
      { start: 0, end: 9, speaker: 0 },
      { start: 9, end: 10, speaker: 1 },
    ];
    const out = splitSegmentsBySpeakers(whisper, diar);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ start: 0, end: 9, text: 'one two three four', speaker: 0 });
    expect(out[1]).toEqual({ start: 9, end: 10, text: 'five', speaker: 1 });
  });

  it('uses the longest span when the cue is too short to split (≤1 word)', () => {
    const whisper = [{ start: 0, end: 2, text: 'hi' }];
    const diar = [
      { start: 0, end: 0.4, speaker: 0 },
      { start: 0.4, end: 2, speaker: 1 },
    ];
    expect(splitSegmentsBySpeakers(whisper, diar)).toEqual([
      { start: 0, end: 2, text: 'hi', speaker: 1 },
    ]);
  });

  it('falls back to the previous speaker when there is no diarization overlap', () => {
    const whisper = [
      { start: 0, end: 2, text: 'first' },
      { start: 10, end: 12, text: 'isolated' },
    ];
    const diar = [{ start: 0, end: 2, speaker: 3 }];
    expect(splitSegmentsBySpeakers(whisper, diar)).toEqual([
      { start: 0, end: 2, text: 'first', speaker: 3 },
      { start: 10, end: 12, text: 'isolated', speaker: 3 },
    ]);
  });

  it('merges very close same-speaker spans inside a cue', () => {
    // Two segmentation gaps of <0.5s inside one speaker's turn should not
    // produce three output segments — they collapse back into one.
    const whisper = [{ start: 0, end: 6, text: 'a b c d e f' }];
    const diar = [
      { start: 0, end: 2, speaker: 0 },
      { start: 2.2, end: 4, speaker: 0 },
      { start: 4.3, end: 6, speaker: 0 },
    ];
    expect(splitSegmentsBySpeakers(whisper, diar)).toEqual([
      { start: 0, end: 6, text: 'a b c d e f', speaker: 0 },
    ]);
  });
});

describe('parseWhisperJsonFull', () => {
  it('extracts text tokens with second-precision timestamps', () => {
    const json = JSON.stringify({
      transcription: [
        {
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
            { text: ' Hello', offsets: { from: 200, to: 600 } },
            { text: ' world', offsets: { from: 600, to: 1100 } },
            { text: '.', offsets: { from: 1100, to: 1200 } },
            { text: '[_TT_120]', offsets: { from: 1200, to: 1200 } },
          ],
        },
      ],
    });
    expect(parseWhisperJsonFull(json)).toEqual([
      { text: ' Hello', start: 0.2, end: 0.6 },
      { text: ' world', start: 0.6, end: 1.1 },
      { text: '.', start: 1.1, end: 1.2 },
    ]);
  });

  it('returns [] for malformed JSON without throwing', () => {
    expect(parseWhisperJsonFull('{not json')).toEqual([]);
    expect(parseWhisperJsonFull('null')).toEqual([]);
    expect(parseWhisperJsonFull('{}')).toEqual([]);
  });

  it('drops zero-length and missing-offset tokens', () => {
    const json = JSON.stringify({
      transcription: [
        {
          tokens: [
            { text: ' good', offsets: { from: 100, to: 300 } },
            { text: ' broken', offsets: { from: 'x', to: 400 } },
            { text: ' empty', offsets: { from: 400, to: 400 } },
            { text: ' fine', offsets: { from: 400, to: 600 } },
          ],
        },
      ],
    });
    expect(parseWhisperJsonFull(json).map((t) => t.text)).toEqual([' good', ' fine']);
  });
});

describe('mergeTokensWithDiarization', () => {
  it('assigns each token to the speaker covering its midpoint', () => {
    const tokens = [
      { text: ' a', start: 0, end: 1 },
      { text: ' b', start: 1, end: 2 },
      { text: ' c', start: 2, end: 3 },
      { text: ' d', start: 3, end: 4 },
    ];
    const diar = [
      { start: 0, end: 2, speaker: 0 },
      { start: 2, end: 4, speaker: 1 },
    ];
    const out = mergeTokensWithDiarization(tokens, diar);
    expect(out).toEqual([
      { start: 0, end: 2, text: 'a b', speaker: 0 },
      { start: 2, end: 4, text: 'c d', speaker: 1 },
    ]);
  });

  it('keeps punctuation attached to the previous word even across a speaker change', () => {
    // The comma's midpoint is on speaker 1's side, but punctuation
    // continuation tokens must follow their parent word so we do not split
    // "world," visually onto two speakers.
    const tokens = [
      { text: ' Hello', start: 0, end: 0.5 },
      { text: ' world', start: 0.5, end: 1.0 },
      { text: ',', start: 1.0, end: 1.1 },
      { text: ' how', start: 1.2, end: 1.5 },
      { text: ' are', start: 1.5, end: 1.7 },
      { text: ' you', start: 1.7, end: 2.0 },
    ];
    const diar = [
      { start: 0, end: 1.05, speaker: 0 },
      { start: 1.05, end: 2, speaker: 1 },
    ];
    const out = mergeTokensWithDiarization(tokens, diar);
    expect(out).toEqual([
      { start: 0, end: 1.1, text: 'Hello world,', speaker: 0 },
      { start: 1.2, end: 2.0, text: 'how are you', speaker: 1 },
    ]);
  });

  it('inherits the previous speaker when a token falls into a diarization gap', () => {
    // Token c sits at t=2.5 which is outside both diarization segments;
    // the previous speaker (1) carries over.
    const tokens = [
      { text: ' a', start: 0, end: 0.5 },
      { text: ' b', start: 1.5, end: 2.0 },
      { text: ' c', start: 2.4, end: 2.6 },
      { text: ' d', start: 4.0, end: 4.5 },
    ];
    const diar = [
      { start: 0, end: 1, speaker: 0 },
      { start: 1, end: 2, speaker: 1 },
      { start: 3, end: 5, speaker: 1 },
    ];
    const out = mergeTokensWithDiarization(tokens, diar);
    // a → 0, b/c/d → 1 (c via inheritance because the nearest segment is
    // the previous speaker; d is inside speaker 1's later segment).
    expect(out.map((s) => s.speaker)).toEqual([0, 1]);
    expect(out[1]!.text).toBe('b c d');
  });

  it('returns an empty result when there are no tokens', () => {
    expect(mergeTokensWithDiarization([], [{ start: 0, end: 1, speaker: 0 }])).toEqual([]);
  });
});

describe('killShortSpeakerRuns', () => {
  it('flattens a single-token flip surrounded by the same speaker', () => {
    expect(killShortSpeakerRuns([0, 0, 0, 1, 0, 0, 0])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('keeps real turn-takes intact (genuine alternation)', () => {
    // Long alternating runs, no spurious flips.
    expect(killShortSpeakerRuns([0, 0, 0, 0, 1, 1, 1, 1])).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('keeps short edge runs (first/last) — they have no flanking pair', () => {
    expect(killShortSpeakerRuns([0, 1, 1, 1, 1])).toEqual([0, 1, 1, 1, 1]);
    expect(killShortSpeakerRuns([1, 1, 1, 1, 0])).toEqual([1, 1, 1, 1, 0]);
  });

  it('iteratively collapses A B A C A patterns into a single run', () => {
    // After killing run B (len 1), the runs around C merge — then C
    // (len 1) is itself flanked by the same speaker and gets killed.
    expect(killShortSpeakerRuns([0, 0, 0, 1, 0, 0, 2, 0, 0, 0])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('keeps runs that are flanked by DIFFERENT speakers (real turn-take)', () => {
    // Short run of speaker 1 sits between speaker 0 and speaker 2 — that's
    // a legitimate three-way exchange, not a flip, so leave it.
    expect(killShortSpeakerRuns([0, 0, 0, 1, 2, 2, 2])).toEqual([0, 0, 0, 1, 2, 2, 2]);
  });

  it('respects the minRun parameter', () => {
    // With minRun=2, a run of len 1 dies but a run of len 2 survives.
    expect(killShortSpeakerRuns([0, 0, 1, 0, 0], 2)).toEqual([0, 0, 0, 0, 0]);
    expect(killShortSpeakerRuns([0, 0, 1, 1, 0, 0], 2)).toEqual([0, 0, 1, 1, 0, 0]);
  });
});

describe('mergeTokensWithDiarization smoothing', () => {
  it('cleans up a single-word speaker flip in the middle of a sentence', () => {
    // Six consecutive tokens; midpoints all map to speaker 0 except
    // the middle token whose midpoint sits inside a noisy 200ms blip
    // from the diarizer attributing it to speaker 1. Smoothing should
    // restore it to 0 so the sentence stays in one block.
    const tokens = [
      { text: ' one', start: 0, end: 0.4 },
      { text: ' two', start: 0.4, end: 0.8 },
      { text: ' three', start: 0.8, end: 1.2 },
      { text: ' four', start: 1.2, end: 1.6 },
      { text: ' five', start: 1.6, end: 2.0 },
      { text: ' six', start: 2.0, end: 2.4 },
    ];
    const diar = [
      { start: 0, end: 1.3, speaker: 0 },
      { start: 1.3, end: 1.5, speaker: 1 }, // 200ms noise blip on token "four"
      { start: 1.5, end: 2.4, speaker: 0 },
    ];
    const out = mergeTokensWithDiarization(tokens, diar);
    expect(out).toHaveLength(1);
    expect(out[0]!.speaker).toBe(0);
    expect(out[0]!.text).toBe('one two three four five six');
  });
});

describe('dropTinyDiarizationClusters', () => {
  it('drops a cluster occupying less than the ratio of total time', () => {
    const segments = [
      { start: 0, end: 30, speaker: 0 },
      { start: 30, end: 60, speaker: 1 },
      { start: 60, end: 60.5, speaker: 2 }, // 0.5/60.5 ≈ 0.8% — micro
    ];
    const out = dropTinyDiarizationClusters(segments, 0.03);
    // Speaker 2 should be reassigned to the closest survivor (speaker 1
    // whose segment ends right at 60).
    expect(out.map((s) => s.speaker)).toEqual([0, 1, 1]);
  });

  it('always keeps at least minSpeakers, even if all are tiny', () => {
    const segments = [
      { start: 0, end: 1, speaker: 0 },
      { start: 1, end: 2, speaker: 1 },
      { start: 2, end: 3, speaker: 2 },
    ];
    // All three are 33% each, none under 3%, so nothing drops — but
    // even with a 50% ratio the top 2 must survive.
    const out = dropTinyDiarizationClusters(segments, 0.5, 2);
    const survivors = new Set(out.map((s) => s.speaker));
    expect(survivors.size).toBeGreaterThanOrEqual(2);
  });

  it('returns input unchanged when nothing is below the threshold', () => {
    const segments = [
      { start: 0, end: 30, speaker: 0 },
      { start: 30, end: 60, speaker: 1 },
    ];
    expect(dropTinyDiarizationClusters(segments, 0.03)).toEqual(segments);
  });

  it('handles an empty input', () => {
    expect(dropTinyDiarizationClusters([])).toEqual([]);
  });

  it('reassigns a tiny cluster to the longer adjacent survivor on a distance tie', () => {
    // Speaker 5 has 0.4s, total 60.4s → 0.66%. The tiny segment at 20-20.4
    // touches BOTH survivors (distance 0 to either). The tie is broken by
    // weighting on survivor duration, so speaker 1 (40s) wins over
    // speaker 0 (20s). This is what keeps doomed-cluster decisions
    // anchored to the most prominent neighbour instead of flipping.
    const segments = [
      { start: 0, end: 20, speaker: 0 },
      { start: 20, end: 20.4, speaker: 5 },
      { start: 20.4, end: 60.4, speaker: 1 },
    ];
    const out = dropTinyDiarizationClusters(segments, 0.03);
    expect(out[1]!.speaker).toBe(1);
  });

  it('reassigns ALL segments of a doomed cluster to the same survivor (no splitting)', () => {
    // The doomed cluster (speaker 9) has two segments — one early in the
    // audio (near speaker 0) and one late (near speaker 1). The legacy
    // per-segment "nearest survivor" rule would have flipped them onto
    // different speakers, visibly inverting labels mid-recording. The
    // weighted-vote rule must instead pick ONE survivor for all of them.
    const segments = [
      { start: 0, end: 60, speaker: 0 }, // long
      { start: 60, end: 60.3, speaker: 9 }, // doomed, adjacent to sp0
      { start: 60.3, end: 60.6, speaker: 9 }, // doomed, still next to sp0
      { start: 60.6, end: 120, speaker: 1 }, // long
      { start: 120, end: 120.3, speaker: 9 }, // doomed, adjacent to sp1
    ];
    const out = dropTinyDiarizationClusters(segments, 0.03);
    const doomedNow = out.filter((_, i) => [1, 2, 4].includes(i)).map((s) => s.speaker);
    // All three doomed segments must agree on a single survivor.
    expect(new Set(doomedNow).size).toBe(1);
  });
});

describe('remapSpeakers', () => {
  it('remaps non-contiguous cluster IDs to 0..N-1 in order of first appearance', () => {
    const input = [
      { speaker: 4, t: 'a' },
      { speaker: 7, t: 'b' },
      { speaker: 4, t: 'c' },
      { speaker: 2, t: 'd' },
      { speaker: 7, t: 'e' },
    ];
    const { segments, speakerCount } = remapSpeakers(input);
    expect(segments.map((s) => s.speaker)).toEqual([0, 1, 0, 2, 1]);
    expect(speakerCount).toBe(3);
  });

  it('handles already-contiguous IDs without changes', () => {
    const input = [{ speaker: 0 }, { speaker: 1 }, { speaker: 0 }];
    const { segments, speakerCount } = remapSpeakers(input);
    expect(segments.map((s) => s.speaker)).toEqual([0, 1, 0]);
    expect(speakerCount).toBe(2);
  });

  it('returns 0 speakers for an empty input', () => {
    const { segments, speakerCount } = remapSpeakers([]);
    expect(segments).toEqual([]);
    expect(speakerCount).toBe(0);
  });
});
