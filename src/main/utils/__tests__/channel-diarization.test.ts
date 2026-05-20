import { describe, it, expect } from 'vitest';
import { analyzeChannels, diarizeFromChannels } from '../channel-diarization';

const SAMPLE_RATE = 16_000;

// Helper: build a Float32Array with the given amplitude (1.0 = full scale)
// for `durationSec` worth of samples.
function tone(durationSec: number, amplitude: number): Float32Array {
  const out = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    // Sinusoidal so it has actual energy; frequency doesn't matter for
    // these tests, only RMS energy does.
    out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
  }
  return out;
}

function silence(durationSec: number): Float32Array {
  return new Float32Array(Math.round(durationSec * SAMPLE_RATE));
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('analyzeChannels', () => {
  it('flags a clean per-channel recording as per-channel', () => {
    // Left = speaker A talking for 5s then silent for 5s.
    // Right = silent for 5s then speaker B for 5s.
    // Zero overlap, perfectly per-channel.
    const left = concat(tone(5, 0.5), silence(5));
    const right = concat(silence(5), tone(5, 0.5));
    const a = analyzeChannels(left, right);
    expect(a.isPerChannel).toBe(true);
    expect(a.correlation).toBeLessThan(0.4);
    expect(a.dominanceFrameRatio).toBeGreaterThan(0.5);
  });

  it('does NOT flag a mixed stereo (both channels carrying same voice) as per-channel', () => {
    // Same signal duplicated on both channels — typical Zoom mixdown.
    const mono = concat(tone(2, 0.5), silence(0.3), tone(2, 0.4), silence(0.3), tone(2, 0.5));
    const a = analyzeChannels(mono, mono);
    expect(a.isPerChannel).toBe(false);
    expect(a.correlation).toBeGreaterThan(0.9);
  });

  it('does NOT flag a symmetric room recording as per-channel', () => {
    // Both channels hear both speakers equally — high correlation,
    // very low dominance ratio.
    const left = concat(tone(3, 0.4), tone(3, 0.4));
    const right = concat(tone(3, 0.4), tone(3, 0.4));
    const a = analyzeChannels(left, right);
    expect(a.isPerChannel).toBe(false);
  });

  it('handles an all-silent input without crashing', () => {
    const a = analyzeChannels(silence(2), silence(2));
    expect(a.isPerChannel).toBe(false);
    expect(a.dominanceFrameRatio).toBe(0);
  });
});

describe('diarizeFromChannels', () => {
  it('emits a segment per speaker run with the correct channel-to-speaker mapping', () => {
    // 5s of left only, then 5s of right only.
    const left = concat(tone(5, 0.5), silence(5));
    const right = concat(silence(5), tone(5, 0.5));
    const segs = diarizeFromChannels(left, right, SAMPLE_RATE);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.speaker).toBe(0);
    expect(segs[0]!.start).toBeCloseTo(0, 1);
    expect(segs[0]!.end).toBeCloseTo(5, 1);
    expect(segs[1]!.speaker).toBe(1);
    expect(segs[1]!.start).toBeCloseTo(5, 1);
    expect(segs[1]!.end).toBeCloseTo(10, 1);
  });

  it('alternates speakers across multiple turn-takes', () => {
    // L→R→L pattern, 2s each.
    const left = concat(tone(2, 0.5), silence(2), tone(2, 0.5));
    const right = concat(silence(2), tone(2, 0.5), silence(2));
    const segs = diarizeFromChannels(left, right, SAMPLE_RATE);
    expect(segs.map((s) => s.speaker)).toEqual([0, 1, 0]);
  });

  it('absorbs sub-100ms speaker flickers into the surrounding turn', () => {
    // 5s of left, with a single 40ms blip where right briefly beats it.
    // The hangover smoother should drop the blip.
    const left = new Float32Array(5 * SAMPLE_RATE);
    for (let i = 0; i < left.length; i++) {
      left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
    const right = new Float32Array(5 * SAMPLE_RATE);
    const blipStart = 2.5 * SAMPLE_RATE;
    const blipEnd = blipStart + 0.04 * SAMPLE_RATE;
    for (let i = blipStart; i < blipEnd; i++) {
      // Briefly louder than left to grab the dominance check.
      right[i] = 0.9 * Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE);
    }
    const segs = diarizeFromChannels(left, right, SAMPLE_RATE);
    // The smoother should keep this as a single speaker-0 run.
    expect(segs.every((s) => s.speaker === 0)).toBe(true);
  });

  it('returns no segments for completely silent stereo', () => {
    const segs = diarizeFromChannels(silence(3), silence(3), SAMPLE_RATE);
    expect(segs).toEqual([]);
  });
});
