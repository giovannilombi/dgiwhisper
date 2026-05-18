import { describe, it, expect } from 'vitest';
import {
  parseVtt,
  assignSpeakers,
  splitSegmentsBySpeakers,
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
