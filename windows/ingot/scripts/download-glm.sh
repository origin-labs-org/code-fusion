#!/usr/bin/env bash
#

set -euo pipefail
INTRANET_MACHINE_HOST="${INTRANET_MACHINE_HOST:-10.0.0.100}"

PLATFORM="${1:-${CF_TARGET_OS:-$(uname -s | tr '[:upper:]' '[:lower:]')}}"
RAW_ARCH="${2:-${CF_TARGET_ARCH:-$(uname -m)}}"

case "$PLATFORM" in
  mac|macos|darwin|osx) PLATFORM="darwin" ;;
  win|windows|win32) PLATFORM="win32" ;;
  linux) PLATFORM="linux" ;;
esac

case "$RAW_ARCH" in
  x86_64|x64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) ARCH="$RAW_ARCH" ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GLM_RUNTIME_VERSION="$(node -e "const fs=require('fs');const source=fs.readFileSync('$REPO_ROOT/packages/shared/src/cf-agent-runtime.ts','utf8');const match=source.match(/version:\\s*['\"]([^'\"]+)['\"]/);if(!match){throw new Error('Unable to parse CodeFusion Agent runtime version');}process.stdout.write(match[1]);")"
LOCAL_PLATFORM="${CF_TARGET_OS:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
LOCAL_ARCH="${CF_TARGET_ARCH:-$(uname -m)}"

case "$LOCAL_PLATFORM" in
  mac|macos|darwin|osx) LOCAL_PLATFORM="darwin" ;;
  win|windows|win32) LOCAL_PLATFORM="win32" ;;
  linux) LOCAL_PLATFORM="linux" ;;
esac

case "$LOCAL_ARCH" in
  x86_64|x64|amd64) LOCAL_ARCH="x64" ;;
  aarch64|arm64) LOCAL_ARCH="arm64" ;;
esac

PLATFORM_KEY="$PLATFORM-$ARCH"
LOCAL_KEY="$LOCAL_PLATFORM-$LOCAL_ARCH"

if [ "$PLATFORM_KEY" = "$LOCAL_KEY" ]; then
  OUTPUT_DIR="$REPO_ROOT/packages/desktop/bundled-agents/$PLATFORM_KEY/glm"
else
  OUTPUT_DIR="$REPO_ROOT/packages/desktop/mock-cdn/releases/$(node -p "require('$REPO_ROOT/package.json').version")/glm/$PLATFORM_KEY"
fi

BINARY_NAME="cf-agent"
if [ "$PLATFORM" = "win32" ]; then
  BINARY_NAME="cf-agent.exe"
fi

DOWNLOAD_BASE_URL="${GLM_BINARY_DOWNLOAD_BASE_URL:-http://${INTRANET_MACHINE_HOST}:12345/cf/deps/cf-cli-${GLM_RUNTIME_VERSION}}"
DOWNLOAD_NAME="cf-${PLATFORM}-${ARCH}"
if [ "$PLATFORM" = "win32" ]; then
  DOWNLOAD_NAME="cf-windows-${ARCH}.exe"
fi
DOWNLOAD_URL="${DOWNLOAD_BASE_URL}/${DOWNLOAD_NAME}"

echo "==> glm binary download"
echo "    platform: ${PLATFORM_KEY}"
echo "    target:   ${OUTPUT_DIR}/${BINARY_NAME}"

if [ -f "$OUTPUT_DIR/$BINARY_NAME" ]; then
  echo "    [skip] 已存在，Skip"
  exit 0
fi

mkdir -p "$OUTPUT_DIR"
TMPFILE="$(mktemp "${OUTPUT_DIR}/.glm-dl-XXXXXXXXXX.part")"
trap 'rm -f "$TMPFILE"' EXIT

echo "    [download] ${DOWNLOAD_URL}"
curl -fSL --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"

mv "$TMPFILE" "$OUTPUT_DIR/$BINARY_NAME"

if [ "$PLATFORM" != "win32" ]; then
  chmod +x "$OUTPUT_DIR/$BINARY_NAME" 2>/dev/null || true
fi

echo "==> Done! glm (${PLATFORM_KEY}) -> ${OUTPUT_DIR}/${BINARY_NAME}"
