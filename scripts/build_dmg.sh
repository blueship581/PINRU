#!/usr/bin/env bash
# Build PINRU-<version>-macos-<arch>.dmg for arm64 and/or amd64.
# Usage: ./scripts/build_dmg.sh [arm64|amd64|universal]
#   ARCH env var overrides the first argument (default: arm64)
#   SKIP_BUILD=1  skip frontend + Go compilation (use existing binary)
#   VERSION env var overrides the version read from Info.plist
#   APPLE_SIGNING_IDENTITY  optional code-signing identity
#   APPLE_NOTARY_PROFILE    optional notarytool profile (requires signing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

# ── Config ─────────────────────────────────────────────────────────────────
APP_NAME="${APP_NAME:-PINRU}"
ARCH="${ARCH:-${1:-arm64}}"
VERSION="${VERSION:-}"
OUTPUT_DIR="${OUTPUT_DIR:-dist}"
INFO_PLIST="${INFO_PLIST:-build/darwin/Info.plist}"
ICON_PATH="${ICON_PATH:-build/darwin/icons.icns}"
ENTITLEMENTS_PATH="${ENTITLEMENTS_PATH:-build/darwin/entitlements.plist}"
SIGN_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-}"
SKIP_BUILD="${SKIP_BUILD:-0}"

# Resolve version from Info.plist when not set explicitly
if [[ -z "$VERSION" ]]; then
  VERSION=$(plutil -extract CFBundleShortVersionString raw "$INFO_PLIST" 2>/dev/null || true)
  if [[ -z "$VERSION" ]]; then
    echo "error: cannot read CFBundleShortVersionString from $INFO_PLIST" >&2
    exit 1
  fi
fi

require_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "error: required tool '$1' not found" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -e "$1" ]]; then
    echo "error: missing required file: $1" >&2
    exit 1
  fi
}

require_tool plutil
require_tool codesign
require_tool hdiutil

# ── Resolve binary path ────────────────────────────────────────────────────
case "$ARCH" in
  arm64)   GOARCH_VAL=arm64  ;;
  amd64)   GOARCH_VAL=amd64  ;;
  universal)
    # Build both slices and lipo them; fall through after creating universal binary
    GOARCH_VAL=universal
    ;;
  *)
    echo "error: unsupported ARCH '$ARCH'; use arm64, amd64, or universal" >&2
    exit 1
    ;;
esac

BINARY_PATH="${BINARY_PATH:-}"
if [[ -z "$BINARY_PATH" ]]; then
  if [[ "$ARCH" == "arm64" || "$ARCH" == "universal" ]]; then
    BINARY_ARM64="build/bin/pinru-arm64"
  fi
  if [[ "$ARCH" == "amd64" || "$ARCH" == "universal" ]]; then
    BINARY_AMD64="build/bin/pinru-amd64"
  fi
  if [[ "$ARCH" == "arm64" ]]; then
    BINARY_PATH="$BINARY_ARM64"
  elif [[ "$ARCH" == "amd64" ]]; then
    BINARY_PATH="$BINARY_AMD64"
  else
    BINARY_PATH="build/bin/pinru-universal"
  fi
fi

# ── Build ──────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "==> Building frontend..."
  (cd frontend && npm run build)

  if [[ "$ARCH" == "universal" ]]; then
    echo "==> Compiling Go binary for arm64..."
    GOOS=darwin GOARCH=arm64 go build -o "$BINARY_ARM64" .

    echo "==> Compiling Go binary for amd64..."
    GOOS=darwin GOARCH=amd64 go build -o "$BINARY_AMD64" .

    echo "==> Creating universal binary with lipo..."
    require_tool lipo
    lipo -create -output "$BINARY_PATH" "$BINARY_ARM64" "$BINARY_AMD64"
  else
    echo "==> Compiling Go binary for $ARCH..."
    GOOS=darwin GOARCH="$GOARCH_VAL" go build -o "$BINARY_PATH" .
  fi
fi

require_file "$BINARY_PATH"
require_file "$INFO_PLIST"
require_file "$ICON_PATH"
if [[ -n "$SIGN_IDENTITY" ]]; then
  require_file "$ENTITLEMENTS_PATH"
fi

# ── Assemble .app bundle ───────────────────────────────────────────────────
APP_BUNDLE="${OUTPUT_DIR}/${APP_NAME}.app"
DMG_NAME="${APP_NAME}-${VERSION}-macos-${ARCH}.dmg"
DMG_PATH="${OUTPUT_DIR}/${DMG_NAME}"
STAGING_DIR="${OUTPUT_DIR}/.dmg-staging-${ARCH}"

echo "==> Assembling ${APP_BUNDLE}..."
rm -rf "$APP_BUNDLE"
mkdir -p "${APP_BUNDLE}/Contents/MacOS" "${APP_BUNDLE}/Contents/Resources"

cp "$BINARY_PATH"  "${APP_BUNDLE}/Contents/MacOS/pinru"
cp "$INFO_PLIST"   "${APP_BUNDLE}/Contents/Info.plist"
cp "$ICON_PATH"    "${APP_BUNDLE}/Contents/Resources/icons.icns"

xattr -cr "$APP_BUNDLE"
plutil -lint "${APP_BUNDLE}/Contents/Info.plist"

# ── Code signing ───────────────────────────────────────────────────────────
if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "==> Signing with identity: $SIGN_IDENTITY"
  codesign \
    --force \
    --deep \
    --options runtime \
    --entitlements "$ENTITLEMENTS_PATH" \
    --sign "$SIGN_IDENTITY" \
    "$APP_BUNDLE"
  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

  if [[ -n "$NOTARY_PROFILE" ]]; then
    echo "==> Submitting for notarization..."
    NOTARY_ZIP="${OUTPUT_DIR}/.${APP_NAME}-${ARCH}-notary.zip"
    rm -f "$NOTARY_ZIP"
    ditto --norsrc -c -k --keepParent "$APP_BUNDLE" "$NOTARY_ZIP"
    xcrun notarytool submit "$NOTARY_ZIP" \
      --keychain-profile "$NOTARY_PROFILE" \
      --wait
    xcrun stapler staple "$APP_BUNDLE"
    rm -f "$NOTARY_ZIP"
    spctl --assess --type execute --verbose=4 "$APP_BUNDLE"
  else
    echo "warning: APPLE_NOTARY_PROFILE is empty; app is signed but not notarized" >&2
  fi
else
  echo "==> Ad-hoc signing (not distributable)..."
  codesign --force --deep --sign - "$APP_BUNDLE"
fi

# ── Create DMG ─────────────────────────────────────────────────────────────
echo "==> Creating ${DMG_PATH}..."
rm -rf "$STAGING_DIR" "$DMG_PATH"
mkdir -p "$STAGING_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/"
ln -s /Applications "${STAGING_DIR}/Applications"

# Create a read-write DMG, then convert to compressed read-only
TMP_DMG="${OUTPUT_DIR}/.tmp-${ARCH}.dmg"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDRW \
  "$TMP_DMG"

hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
rm -f "$TMP_DMG"
rm -rf "$STAGING_DIR"

# Sign the DMG itself when an identity is provided
if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "==> Signing DMG..."
  codesign --force --sign "$SIGN_IDENTITY" "$DMG_PATH"
fi

echo ""
echo "Done: ${DMG_PATH}"
