#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
npm run build
mkdir -p macos/.build/clang-cache macos/.build/spm-cache
CLANG_MODULE_CACHE_PATH="$ROOT/macos/.build/clang-cache" swift build --package-path macos -c release --scratch-path macos/.build --cache-path "$ROOT/macos/.build/spm-cache" --disable-sandbox
APP="$ROOT/macos/build/Tidal Sync.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime" "$APP/Contents/Resources/backend"
cp macos/.build/release/TidalSync "$APP/Contents/MacOS/TidalSync"
python3 macos/scripts/bundle-runtime.py "$(command -v node)" "$APP/Contents/Resources/runtime"
# Package installed production dependencies without another network request.
rm -rf "$APP/Contents/Resources/backend/dist"
python3 macos/scripts/bundle-backend.py "$ROOT" "$APP/Contents/Resources/backend"
CLANG_MODULE_CACHE_PATH="$ROOT/macos/.build/clang-cache" swift macos/scripts/icon.swift "$ROOT/macos/.build/AppIcon.iconset"
python3 macos/scripts/bundle-icon.py "$ROOT/macos/.build/AppIcon.iconset" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TidalSync</string>
<key>CFBundleIdentifier</key><string>com.tidal-sync.desktop</string>
<key>CFBundleName</key><string>Tidal Sync</string>
<key>CFBundleDisplayName</key><string>Tidal Sync</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
VERSION="$(node -p "require('./package.json').version")"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion ${MACOS_MIN_VERSION:-13.0}" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"
printf '\nBuilt: %s\n' "$APP"
