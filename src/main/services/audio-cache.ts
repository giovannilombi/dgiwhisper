// Session-scoped audio cache. After transcription we hold on to the
// generated 16 kHz wav files (mono for downstream, optional stereo for
// the channel-based diarization fast-path) so the user can launch
// diarization later in the session — possibly more than once — without
// re-running the ffmpeg conversion or being forced to re-pick the file.
//
// The cache is intentionally session-only:
//   • on app quit we wipe everything
//   • there is no cross-restart persistence
//   • the renderer is told up-front that running diarization on a
//     transcript from a previous session means re-loading the audio
//
// The choice keeps storage usage bounded and avoids cross-session
// invariants we'd otherwise have to maintain.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import log from 'electron-log';

export interface AudioCacheEntry {
  /** Stable id, used as the public handle exposed to the renderer. */
  id: string;
  /** Display name of the source file the user originally picked. */
  originalFileName: string;
  /** Absolute path to the 16 kHz mono PCM-16 wav. */
  monoWavPath: string;
  /** Optional 16 kHz stereo PCM-16 wav. Present only when the source
   *  had ≥2 channels and we kept it around for channel-based diarization. */
  stereoWavPath?: string;
  /** Path to whisper's --output-json-full file for this audio. The
   *  diarize-service consumes it to align token-level timing with
   *  diarization clusters. */
  whisperJsonPath?: string;
  /** Path to whisper's --output-vtt file. Used as a fallback when the
   *  json-full output is missing or malformed. */
  whisperVttPath?: string;
  /** Audio duration in seconds (best effort, from ffmpeg or filesize). */
  durationSec?: number;
  /** Timestamp of last access, used for diagnostics. */
  lastAccess: number;
}

class AudioCache {
  private entries = new Map<string, AudioCacheEntry>();
  private cleanupHandlersInstalled = false;

  /**
   * Register a freshly-generated wav (or pair of wavs) under a new id.
   * The caller transfers ownership: from this point on, only the cache
   * is responsible for deleting these files.
   */
  register(input: {
    originalFileName: string;
    monoWavPath: string;
    stereoWavPath?: string;
    whisperJsonPath?: string;
    whisperVttPath?: string;
    durationSec?: number;
  }): AudioCacheEntry {
    this.installCleanupHandlers();
    const id = crypto.randomUUID();
    const entry: AudioCacheEntry = {
      id,
      originalFileName: input.originalFileName,
      monoWavPath: input.monoWavPath,
      stereoWavPath: input.stereoWavPath,
      whisperJsonPath: input.whisperJsonPath,
      whisperVttPath: input.whisperVttPath,
      durationSec: input.durationSec,
      lastAccess: Date.now(),
    };
    this.entries.set(id, entry);
    log.info('[audio-cache] registered', {
      id,
      originalFileName: input.originalFileName,
      hasStereo: Boolean(input.stereoWavPath),
      hasWhisperJson: Boolean(input.whisperJsonPath),
    });
    return entry;
  }

  get(id: string): AudioCacheEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.lastAccess = Date.now();
    return entry;
  }

  /**
   * Drop an entry from the cache and delete its on-disk wavs. Called
   * when the user removes the transcript from the queue or history, or
   * when the diarize-service is finished with the cached embeddings.
   */
  release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.unlinkSilently(entry.monoWavPath);
    if (entry.stereoWavPath) this.unlinkSilently(entry.stereoWavPath);
    if (entry.whisperJsonPath) this.unlinkSilently(entry.whisperJsonPath);
    if (entry.whisperVttPath) this.unlinkSilently(entry.whisperVttPath);
    log.info('[audio-cache] released', { id });
  }

  /** Wipe every entry and on-disk wav. Invoked on app quit. */
  releaseAll(): void {
    log.info('[audio-cache] releaseAll', { count: this.entries.size });
    for (const id of [...this.entries.keys()]) this.release(id);
  }

  list(): AudioCacheEntry[] {
    return [...this.entries.values()];
  }

  buildTempPath(prefix: string): string {
    return path.join(app.getPath('temp'), `${prefix}_${crypto.randomUUID()}.wav`);
  }

  private unlinkSilently(p: string): void {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      log.warn('[audio-cache] failed to delete wav', {
        path: p,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private installCleanupHandlers(): void {
    if (this.cleanupHandlersInstalled) return;
    this.cleanupHandlersInstalled = true;
    app.on('will-quit', () => this.releaseAll());
  }
}

export const audioCache = new AudioCache();
