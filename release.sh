#!/bin/bash
set -e

REPO="14h/tidal-sync"
TAP_DIR="${TAP_DIR:-$(dirname "$(git rev-parse --show-toplevel)")/tidal-sync-tap}"
FORMULA="$TAP_DIR/Formula/tidal-sync.rb"

cd "$(git rev-parse --show-toplevel)"

# Bump patch version
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r major minor patch <<< "$CURRENT"
VERSION="$major.$minor.$((patch + 1))"

echo "Auto-releasing v$VERSION"

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Build
npm run build 2>&1

# Commit version bump (this won't re-trigger because message starts with "Release v")
git add package.json
git commit --no-verify -m "Release v$VERSION"

# Tag
git tag "v$VERSION"

# Push everything
git push && git push origin "v$VERSION"

echo "Waiting for GitHub..."
sleep 3

# Get SHA256
SHA=$(curl -sL "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz" | shasum -a 256 | awk '{print $1}')
echo "SHA256: $SHA"

# Update formula
if [ ! -f "$FORMULA" ]; then
  echo "Tap formula not found at $FORMULA"
  echo "Set TAP_DIR or clone the tap repo."
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
echo "Released v$VERSION"
