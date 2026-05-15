# 🎙️ DGI-Whisper

Local only, privacy-first AI transcription.

> Based on [WhisperDesk](https://github.com/PVAS-Development/whisperdesk) · powered by [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

![DGI-Whisper Screenshot](src/docs/screenshot.png)

## ✨ Features

- **Drag & Drop** - Drag single or multiple files to create a batch queue
- **Batch Processing** - Process unlimited files sequentially with automatic queue management
- **Queue Persistence + Resume** - Restore unfinished queue items after restarting the app
- **Duplicate File Protection** - Automatically skips duplicates by file path/fingerprint in batch mode
- **Retry Failed Items** - One-click retry for failed or cancelled queue items
- **Live Batch ETA** - See estimated remaining time while batch processing is running
- **Completion Notifications** - Native notification when a batch finishes
- **Multiple Formats** - Supports MP3, WAV, M4A, FLAC, OGG, OPUS, OGA, AMR, WMA, AAC, AIFF, MP4, MOV, AVI, MKV, WebM, WMV, FLV, M4V
- **Embedded Media Preview** - Play the selected audio or video beside your transcript
- **Transcript Navigation** - Click timestamped transcript segments to seek directly to that moment in the media
- **Secure Local Streaming** - Media previews use a private `whisperdesk-media://` protocol with approved local files only
- **Cleaner Subtitles** - Improved VTT/SRT segmentation with better word-boundary splitting for readable captions
- **Multiple Models** - Choose from tiny, base, small, medium, large-v3, or large-v3-turbo Whisper models (including English-only variants)
- **Output Formats** - Export as VTT subtitles, SRT subtitles, plain text, Word (`.docx`), PDF, or Markdown
- **Finder Reveal After Save** - Prompt to reveal the saved transcript directly in Finder
- **Language Support** - Auto-detect or select from 12+ languages
- **Apple Silicon Optimized** - Native Metal GPU acceleration on M1/M2/M3/M4 Macs
- **Dark Mode** - Beautiful dark theme that respects your system preference
- **Auto Updates** - Automatic update notifications when new versions are available
- **Keyboard Shortcuts** - Full keyboard navigation support
- **Transcription History + Search** - Keep track of recent transcriptions and search by file name, content, model, or language
- **Native Performance** - Uses whisper.cpp for fast, efficient transcription
- **TypeScript** - Fully typed codebase for better maintainability
- **Feature-Driven Architecture** - Modular codebase organized by feature domains

## 📋 Requirements

- **macOS** 10.15 (Catalina) or later
- **FFmpeg** (Required for audio processing)
- ~500MB disk space (for whisper.cpp and models)

> **Note:** DGI-Whisper requires FFmpeg to process audio files. The app will check for it on startup and guide you if it's missing.

## 🚀 Setup

1. Download the latest `DGIWhisper-x.x.x.dmg` from [Releases](https://github.com/giovannilombi/dgiwhisper/releases)
2. Open the DMG file
3. Drag DGI-Whisper to your Applications folder
4. **Important:** Ensure you have FFmpeg installed (`brew install ffmpeg`)
5. Launch DGI-Whisper from Applications

## 🎮 Usage

1. **Open Files** - Drag and drop audio/video files (single or batch) into the app, or click to browse
2. **Configure Settings** - Choose your preferred model, language, and output format
3. **Transcribe** - Click "Transcribe" to process the entire queue sequentially
4. **Review with Media** - For timestamped output, play the selected media and click transcript segments to jump to the matching audio/video moment
5. **Save/Copy** - Save the transcription from the save dialog (choose from `.txt`, `.docx`, `.pdf`, `.md`, `.srt`, or `.vtt` formats) or copy to clipboard

### Keyboard Shortcuts

| Shortcut     | Action               |
| ------------ | -------------------- |
| `Cmd+O`      | Open file            |
| `Cmd+S`      | Save transcription   |
| `Cmd+C`      | Copy transcription   |
| `Cmd+Return` | Start transcription  |
| `Cmd+H`      | Toggle history       |
| `Escape`     | Cancel transcription |

## 🧠 Whisper Models

| Model            | Size   | Speed | Quality | Best For               |
| ---------------- | ------ | ----- | ------- | ---------------------- |
| `tiny`           | 75 MB  | ~10x  | ★☆☆☆☆   | Quick drafts, testing  |
| `base`           | 142 MB | ~7x   | ★★☆☆☆   | Fast transcription     |
| `small`          | 466 MB | ~4x   | ★★★☆☆   | Balanced speed/quality |
| `medium`         | 1.5 GB | ~2x   | ★★★★☆   | High quality           |
| `large-v3`       | 3.1 GB | ~1x   | ★★★★★   | Best quality           |
| `large-v3-turbo` | 1.6 GB | ~2x   | ★★★★★   | Fast + quality         |

English-only variants (`.en`) are available for tiny, base, small, and medium models.

Models are downloaded automatically on first use and cached in:

- **Development**: `PROJECT_ROOT/models/`
- **Production**: `~/Library/Application Support/DGI-Whisper/models/`

## 🔧 Development

### Architecture

This project follows a modern Electron architecture with strict separation of concerns:

- **`src/main/`**: Electron Main process (TypeScript). Handles OS integration, window management, and native services.
- **`src/preload/`**: Preload scripts (TypeScript). Exposes a secure, typed API to the renderer via `contextBridge`.
- **`src/renderer/`**: React application (TypeScript). The UI layer, built with Vite.
- **`src/shared/`**: Shared types and constants used by both Main and Renderer processes.

**Security Features:**

- **Context Isolation**: Enabled. Renderer cannot access Node.js primitives directly.
- **Sandbox**: Enabled. Renderer runs in a sandboxed environment.
- **IPC**: All communication happens via typed IPC channels defined in `src/main/ipc/`.
- **Media Preview Authorization**: Local previews are limited to user-approved media paths and served through time-bound `whisperdesk-media://` URLs.

## 🐛 Troubleshooting

### "whisper.cpp not found" error

Run the setup script to build whisper.cpp:

```bash
npm run setup:whisper
```

### "FFmpeg not found" error

Install FFmpeg via Homebrew:

```bash
brew install ffmpeg
```

### Slow transcription

- Use a smaller model (tiny or base) for faster results
- Ensure you're using GPU acceleration (shown in app settings)
- Close other resource-intensive applications

### App won't open (macOS Gatekeeper)

DGI-Whisper is currently distributed **unsigned**, so the first time you open it macOS Gatekeeper will block it. To allow it:

1. Right-click the app in Applications and select "Open"
2. Click "Open" in the dialog that appears

If that doesn't work (e.g. "app is damaged" message), remove the quarantine attribute and reopen:

```bash
xattr -cr /Applications/DGI-Whisper.app
```

## 🔒 Privacy & Security

- **Local Processing**: All audio/video processing happens **locally** on your device. Your files never leave your computer.
- **No Cloud Uploads**: We do not upload your media files or transcriptions to any server.
- **Private Media Preview**: Transcript playback uses local, approved media files only. Preview URLs are temporary and are not raw filesystem paths.
- **Anonymous Analytics**: We collect minimal, anonymous usage data (e.g., app launches, feature usage) to improve the app. No personal data or file content is collected.
- **Code Signing**: Currently unsigned. macOS Gatekeeper will require a one-time manual approval to launch the app — see [Troubleshooting](#app-wont-open-macos-gatekeeper).

## ☕ Support the Project

DGI-Whisper is a fork of [WhisperDesk](https://github.com/PVAS-Development/whisperdesk). If you find it useful, please consider supporting the **original project** that made this fork possible:

- [**Donate via PayPal**](https://www.paypal.com/donate/?hosted_button_id=HTJXGMEGMWWD6)
- [**Buy me a coffee**](https://www.buymeacoffee.com/pedrovsiqueira)

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [WhisperDesk](https://github.com/PVAS-Development/whisperdesk) - The original project this fork is based on
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) - High-performance C++ port of OpenAI Whisper
- [OpenAI Whisper](https://github.com/openai/whisper) - The amazing speech recognition model
- [Electron](https://www.electronjs.org/) - Cross-platform desktop apps
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vite](https://vitejs.dev/) - Build tool
- [Vitest](https://vitest.dev/) - Fast unit testing framework

---

Made with ❤️ for the transcription community
