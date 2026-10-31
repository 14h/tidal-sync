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

# Sync every playlist without prompting
tidal-sync --all

# Custom output directory
tidal-sync -o ~/Music

# Download one playlist directly, including a public playlist outside your account
tidal-sync --playlist "https://tidal.com/browse/playlist/00000000-0000-0000-0000-000000000000" -o ~/Music

# Logout
tidal-sync logout
```

On first run, you'll be prompted to log in via Tidal's device authorization flow.
`--playlist` accepts Tidal playlist URLs (including `listen.tidal.com/playlist/...`) and skips the playlist checklist. The playlist must be accessible to your signed-in account; it does not need to be saved in your library. `--playlist` cannot be combined with `--all`.
Before syncing, you'll be prompted with a checklist of playlists showing how many tracks still need to be synced, such as `(5 of 42 tracks)`. All playlists are selected initially; use the arrow keys to scroll, Space to deselect or reselect, and Enter to start syncing.

## Output structure

```
./
  Playlist Name/
    Artist - Track.flac
    Artist - Track.flac
```

Re-running `tidal-sync` only downloads tracks that aren't already on disk.

## Release

```bash
npm run release
```

Bumps version, tags, pushes, and updates the Homebrew formula.

## License

Apache-2.0
