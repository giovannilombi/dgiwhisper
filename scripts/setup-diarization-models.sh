#!/bin/bash
# Download ONNX models used for speaker diarization (sherpa-onnx).
# Idempotent: skips files that are already present.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$PROJECT_DIR/bin/diarization-models"

SEGMENTATION_ARCHIVE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
SEGMENTATION_DIR_NAME="sherpa-onnx-pyannote-segmentation-3-0"
SEGMENTATION_MODEL_FILE="model.onnx"

# WeSpeaker ResNet293 with large-margin fine-tuning, trained on VoxCeleb 1+2.
# State of the art in our ecosystem for speaker embedding (~0.45% EER on
# VoxCeleb-O, vs ~0.66% for TitaNet Large). Multilingual coverage is good
# enough for Italian + English. ~256 MB on disk.
EMBEDDING_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet293_LM.onnx"
EMBEDDING_MODEL_FILE="wespeaker_en_voxceleb_resnet293_LM.onnx"

mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

echo "🎙️  Setting up diarization models in $MODELS_DIR"

# 1) Segmentation (pyannote 3.0)
if [ -f "$SEGMENTATION_DIR_NAME/$SEGMENTATION_MODEL_FILE" ]; then
    echo "✅ Segmentation model already present, skipping."
else
    echo "⬇️  Downloading pyannote segmentation model..."
    curl -SL --fail -o segmentation.tar.bz2 "$SEGMENTATION_ARCHIVE_URL"
    tar xf segmentation.tar.bz2
    rm segmentation.tar.bz2
    if [ ! -f "$SEGMENTATION_DIR_NAME/$SEGMENTATION_MODEL_FILE" ]; then
        echo "❌ Segmentation extraction failed: $SEGMENTATION_DIR_NAME/$SEGMENTATION_MODEL_FILE not found"
        exit 1
    fi
    echo "✅ Segmentation model ready."
fi

# 2) Speaker embedding (3D-Speaker eres2net)
if [ -f "$EMBEDDING_MODEL_FILE" ]; then
    echo "✅ Embedding model already present, skipping."
else
    echo "⬇️  Downloading 3D-Speaker embedding model..."
    curl -SL --fail -o "$EMBEDDING_MODEL_FILE" "$EMBEDDING_URL"
    echo "✅ Embedding model ready."
fi

echo ""
echo "📦 Models installed:"
ls -lh "$MODELS_DIR/$SEGMENTATION_DIR_NAME/$SEGMENTATION_MODEL_FILE" "$MODELS_DIR/$EMBEDDING_MODEL_FILE"

# 3) Cross-arch native binaries for sherpa-onnx so the macOS DMG can be built
#    as a universal binary. The packages are platform-tagged, so the host
#    arch will install its native pair automatically; we force-install the
#    sibling sherpa-onnx-darwin-x64 here.
SHERPA_X64_DIR="$PROJECT_DIR/node_modules/sherpa-onnx-darwin-x64"
if [ ! -f "$SHERPA_X64_DIR/sherpa-onnx.node" ]; then
    echo ""
    echo "⬇️  Force-installing sherpa-onnx-darwin-x64 for universal build..."
    (cd "$PROJECT_DIR" && npm install --no-save --force --no-audit --no-fund sherpa-onnx-darwin-x64@1.13.2 >/dev/null 2>&1)
    if [ ! -f "$SHERPA_X64_DIR/sherpa-onnx.node" ]; then
        echo "❌ Failed to install sherpa-onnx-darwin-x64"
        exit 1
    fi
    echo "✅ sherpa-onnx-darwin-x64 ready."
else
    echo "✅ sherpa-onnx-darwin-x64 already present, skipping."
fi

# 4) Cross-arch ffmpeg binary so the macOS DMG can ship ffmpeg for both
#    Apple Silicon and Intel without requiring the user to brew install it.
FFMPEG_X64_DIR="$PROJECT_DIR/node_modules/@ffmpeg-installer/darwin-x64"
if [ ! -f "$FFMPEG_X64_DIR/ffmpeg" ]; then
    echo ""
    echo "⬇️  Force-installing @ffmpeg-installer/darwin-x64 for universal build..."
    (cd "$PROJECT_DIR" && npm install --no-save --force --no-audit --no-fund @ffmpeg-installer/darwin-x64 >/dev/null 2>&1)
    if [ ! -f "$FFMPEG_X64_DIR/ffmpeg" ]; then
        echo "❌ Failed to install @ffmpeg-installer/darwin-x64"
        exit 1
    fi
    echo "✅ @ffmpeg-installer/darwin-x64 ready."
else
    echo "✅ @ffmpeg-installer/darwin-x64 already present, skipping."
fi
