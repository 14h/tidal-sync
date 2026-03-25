#!/bin/bash
set -e

REPO="14h/tidal-sync"
TAP_DIR="${TAP_DIR:-../tidal-sync}"
FORMULA="$TAP_DIR/Formula/tidal-sync.rb"

# Get version from argument or bump patch
CURRENT=$(node -p "require('./package.json').version")

if [ -n "$1" ]; then
  VERSION="$1"
else
  IFS='.' read -r major minor patch <<< "$CURRENT"
  VERSION="$major.$minor.$((patch + 1))"
fi

echo "Releasing v$VERSION (current: $CURRENT)"
echo

# Update package.json version
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Build
npm run build

# Commit, tag, push
git add -A
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push && git push origin "v$VERSION"

echo
echo "Waiting for GitHub to process the tag..."
sleep 3

# Get SHA256
SHA=$(curl -sL "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz" | shasum -a 256 | awk '{print $1}')
echo "SHA256: $SHA"

# Update formula
if [ ! -f "$FORMULA" ]; then
  echo "Formula not found at $FORMULA"
  echo "Set TAP_DIR to your tidal-sync repo path"
  echo
  echo "Manual update:"
  echo "  url: https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz"
  echo "  sha256: $SHA"
  exit 0
fi

sed -i '' "s|archive/refs/tags/v.*\.tar\.gz|archive/refs/tags/v$VERSION.tar.gz|" "$FORMULA"
sed -i '' "s/sha256 \".*\"/sha256 \"$SHA\"/" "$FORMULA"

cd "$TAP_DIR"
git add -A
git commit -m "Update tidal-sync to v$VERSION"
git push

echo
echo "Done! Run: brew update && brew upgrade tidal-sync"
