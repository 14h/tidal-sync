# tidal-sync

CLI tool to sync the signed-in user's Tidal playlists locally at Master quality.

Each playlist gets its own subfolder inside the output directory.

## Install

```bash
brew tap 14h/tidal-sync
brew install tidal-sync
```

## Usage

```bash
# Sync playlists from the signed-in Tidal user
tidal-sync

# Custom output directory
tidal-sync -o ~/Music

# Logout
tidal-sync logout
```

On first run, you'll be prompted to log in via Tidal's device authorization flow.

## Output structure

```
./
  Playlist Name/
    01 - Artist - Track.m4a
    02 - Artist - Track.m4a
```

Re-running `tidal-sync` only downloads tracks that aren't already on disk.

## Release

```bash
npm run release
```

Bumps version, tags, pushes, and updates the Homebrew formula.

## License

Apache-2.0
