#!/bin/bash
set -e

REPO="14h/tidal-sync"
FORMULA="Formula/tidal-sync.rb"

cd "$(git rev-parse --show-toplevel)"

# Ensure clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

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

# Commit & tag
git add package.json
git commit --no-verify -m "Release v$VERSION"
git tag "v$VERSION"
git push && git push origin "v$VERSION"

# Wait for GitHub to make the tarball available
echo "Waiting for tarball..."
for i in 1 2 3 4 5; do
  STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz")
  [ "$STATUS" = "200" ] && break
  sleep 2
done

# Get SHA256
SHA=$(curl -sL "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz" | shasum -a 256 | awk '{print $1}')
echo "SHA256: $SHA"

# Update formula
sed -i '' "s|archive/refs/tags/v.*\.tar\.gz|archive/refs/tags/v$VERSION.tar.gz|" "$FORMULA"
sed -i '' "s/sha256 \".*\"/sha256 \"$SHA\"/" "$FORMULA"

git add "$FORMULA"
git commit --no-verify -m "Update formula to v$VERSION"
git push

echo
echo "Done — released v$VERSION"
