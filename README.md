# tidal-sync

CLI tool to sync Tidal playlists locally in two qualities:

- **Master (FLAC)** — lossless hi-res, saved to `./flac/`
- **High (AAC)** — lossy, saved to `./m4a/`

Each playlist gets its own subfolder inside both directories.

## Install

```bash
brew tap 14h/tidal-sync
brew install tidal-sync
```

## Usage

```bash
# Sync all configured playlists
tidal-sync

# Add and sync a new playlist
tidal-sync https://tidal.com/browse/playlist/...

# Add a playlist without downloading
tidal-sync add https://tidal.com/browse/playlist/...

# Custom output directory (creates flac/ and m4a/ inside)
tidal-sync -o ~/Music

# Logout
tidal-sync logout
```

On first run, you'll be prompted to log in via Tidal's device authorization flow.

## Output structure

```
./flac/
  Playlist Name/
    01 - Artist - Track.flac
    02 - Artist - Track.flac
./m4a/
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
