import { describe, it, expect } from 'vitest';
import { formatDiarizedAsTxt, formatDiarizedAsMarkdown } from '../diarizedExport';

const segments = [
  { start: 0, end: 2, text: 'Hello.', speaker: 0 },
  { start: 2, end: 4, text: 'How are you?', speaker: 0 },
  { start: 4, end: 6, text: 'Fine, thanks.', speaker: 1 },
  { start: 6, end: 8, text: 'Good to hear.', speaker: 0 },
];

describe('formatDiarizedAsTxt', () => {
  it('groups consecutive segments by speaker and uses default labels', () => {
    expect(formatDiarizedAsTxt(segments)).toBe(
      'Speaker 1: Hello. How are you?\n\nSpeaker 2: Fine, thanks.\n\nSpeaker 1: Good to hear.'
    );
  });

  it('honours user-provided labels', () => {
    expect(formatDiarizedAsTxt(segments, { 0: 'Alice', 1: 'Bob' })).toBe(
      'Alice: Hello. How are you?\n\nBob: Fine, thanks.\n\nAlice: Good to hear.'
    );
  });
});

describe('formatDiarizedAsMarkdown', () => {
  it('renders speakers as bold prefixes', () => {
    expect(formatDiarizedAsMarkdown(segments)).toBe(
      '**Speaker 1:** Hello. How are you?\n\n**Speaker 2:** Fine, thanks.\n\n**Speaker 1:** Good to hear.'
    );
  });

  it('honours user-provided labels in markdown', () => {
    expect(formatDiarizedAsMarkdown(segments, { 0: 'Alice', 1: 'Bob' })).toBe(
      '**Alice:** Hello. How are you?\n\n**Bob:** Fine, thanks.\n\n**Alice:** Good to hear.'
    );
  });
});
