import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  TranscriptionOptions,
  SaveFileOptions,
  ModelDownloadProgress,
  TranscriptionProgress,
  UpdateStatus,
} from '../shared/types';

/**
 * Shape of the parameters accepted by the new diarization service. Kept
 * inline so we don't drag the whole DiarizeParams interface into the
 * shared types (the renderer doesn't need any other field).
 */
interface DiarizeParams {
  numClusters?: number;
  threshold?: number;
  minDurationRatio?: number;
  minDurationOn?: number;
  minDurationOff?: number;
  minRun?: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openMultipleFiles: () => ipcRenderer.invoke('dialog:openMultipleFiles'),
  saveFile: (options: SaveFileOptions) => ipcRenderer.invoke('dialog:saveFile', options),

  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:getInfo', filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getMediaSource: (filePath: string) => ipcRenderer.invoke('file:getMediaSource', filePath),

  listModels: () => ipcRenderer.invoke('models:list'),
  getGpuStatus: () => ipcRenderer.invoke('models:gpuStatus'),
  checkFFmpeg: () => ipcRenderer.invoke('system:checkFFmpeg'),
  downloadModel: (modelName: string) => ipcRenderer.invoke('models:download', modelName),
  deleteModel: (modelName: string) => ipcRenderer.invoke('models:delete', modelName),
  onModelDownloadProgress: (callback: (data: ModelDownloadProgress) => void) => {
    ipcRenderer.on('models:downloadProgress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('models:downloadProgress');
  },

  startTranscription: (options: TranscriptionOptions) =>
    ipcRenderer.invoke('transcribe:start', options),
  cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),
  onTranscriptionProgress: (callback: (data: TranscriptionProgress) => void) => {
    ipcRenderer.on('transcribe:progress', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('transcribe:progress');
  },

  isDiarizationAvailable: () => ipcRenderer.invoke('diarization:isAvailable'),
  diarizeRun: (audioId: string, params?: DiarizeParams) =>
    ipcRenderer.invoke('diarize:run', audioId, params),
  diarizeCancel: () => ipcRenderer.invoke('diarize:cancel'),
  diarizeReleaseAudio: (audioId: string) => ipcRenderer.invoke('diarize:releaseAudio', audioId),

  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getMemoryUsage: () => ipcRenderer.invoke('app:getMemoryUsage'),
  trackEvent: (eventName: string, properties?: Record<string, string | number | boolean>) =>
    ipcRenderer.invoke('analytics:track', eventName, properties),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  onMenuOpenFile: (callback: () => void) => {
    ipcRenderer.on('menu:openFile', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:openFile');
  },
  onMenuSaveFile: (callback: () => void) => {
    ipcRenderer.on('menu:saveFile', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:saveFile');
  },
  onMenuCopyTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:copyTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:copyTranscription');
  },
  onMenuStartTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:startTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:startTranscription');
  },
  onMenuCancelTranscription: (callback: () => void) => {
    ipcRenderer.on('menu:cancelTranscription', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:cancelTranscription');
  },
  onMenuToggleHistory: (callback: () => void) => {
    ipcRenderer.on('menu:toggleHistory', () => callback());
    return () => ipcRenderer.removeAllListeners('menu:toggleHistory');
  },

  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (data: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update:status');
  },
});
