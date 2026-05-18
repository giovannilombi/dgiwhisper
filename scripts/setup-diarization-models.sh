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

EMBEDDING_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
EMBEDDING_MODEL_FILE="3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"

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
