#!/bin/bash
set -e

REPO="14h/tidal-sync"

cd "$(git rev-parse --show-toplevel)"

# Bump patch version
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r major minor patch <<< "$CURRENT"
VERSION="$major.$minor.$((patch + 1))"

echo "Releasing v$VERSION"

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Build
npm run build 2>&1

# Commit, tag, push — but WITHOUT the formula yet (need the tag to exist first for the tarball)
git add package.json
git commit --no-verify -m "Release v$VERSION"
git tag "v$VERSION"
git push && git push origin "v$VERSION"

echo "Waiting for GitHub to process the tag..."
sleep 5

# Get SHA256
SHA=$(curl -sL "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz" | shasum -a 256 | awk '{print $1}')
echo "SHA256: $SHA"

# Update formula
FORMULA="Formula/tidal-sync.rb"
sed -i '' "s|archive/refs/tags/v.*\.tar\.gz|archive/refs/tags/v$VERSION.tar.gz|" "$FORMULA"
sed -i '' "s/sha256 \".*\"/sha256 \"$SHA\"/" "$FORMULA"

git add "$FORMULA"
git commit --no-verify -m "Update formula to v$VERSION"
git push

echo
echo "Released v$VERSION"
