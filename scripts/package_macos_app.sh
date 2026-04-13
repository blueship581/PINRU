#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-PINRU}"
ARCHIVE_SUFFIX="${ARCHIVE_SUFFIX:-macos-arm64}"
OUTPUT_DIR="${OUTPUT_DIR:-dist}"
APP_BUNDLE="${APP_BUNDLE:-${OUTPUT_DIR}/${APP_NAME}.app}"
APP_ZIP="${APP_ZIP:-${OUTPUT_DIR}/${APP_NAME}-${ARCHIVE_SUFFIX}.zip}"
BINARY_PATH="${BINARY_PATH:-build/bin/pinru}"
INFO_PLIST="${INFO_PLIST:-build/darwin/Info.plist}"
ICON_PATH="${ICON_PATH:-build/darwin/icons.icns}"
ENTITLEMENTS_PATH="${ENTITLEMENTS_PATH:-build/darwin/entitlements.plist}"
SIGN_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-}"

require_file() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    echo "missing required file: $path" >&2
    exit 1
  fi
}

require_file "$BINARY_PATH"
require_file "$INFO_PLIST"
require_file "$ICON_PATH"

if [[ -n "$SIGN_IDENTITY" ]]; then
  require_file "$ENTITLEMENTS_PATH"
fi

rm -rf "$APP_BUNDLE"
mkdir -p "${APP_BUNDLE}/Contents/MacOS" "${APP_BUNDLE}/Contents/Resources"

cp "$BINARY_PATH" "${APP_BUNDLE}/Contents/MacOS/pinru"
cp "$INFO_PLIST" "${APP_BUNDLE}/Contents/Info.plist"
cp "$ICON_PATH" "${APP_BUNDLE}/Contents/Resources/icons.icns"

xattr -cr "$APP_BUNDLE"
plutil -lint "${APP_BUNDLE}/Contents/Info.plist"

if [[ -n "$SIGN_IDENTITY" ]]; then
  codesign \
    --force \
    --deep \
    --options runtime \
    --entitlements "$ENTITLEMENTS_PATH" \
    --sign "$SIGN_IDENTITY" \
    "$APP_BUNDLE"

  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

  if [[ -n "$NOTARY_PROFILE" ]]; then
    NOTARY_ZIP="${OUTPUT_DIR}/.${APP_NAME}-${ARCHIVE_SUFFIX}-notary.zip"
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
  echo "warning: APPLE_SIGNING_IDENTITY is empty; packaging an unsigned app bundle" >&2
fi

rm -f "$APP_ZIP"
ditto --norsrc -c -k --keepParent "$APP_BUNDLE" "$APP_ZIP"

echo "created: $APP_ZIP"
