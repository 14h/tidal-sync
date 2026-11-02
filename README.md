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

## Native macOS app

The SwiftUI app supports Tidal device login, a playlist sidebar with multiple selection, and a song table with individual checkboxes and Select All / Deselect All. The link field at the bottom of the sidebar adds playlists to your Tidal library. Download controls and progress stay at the bottom of the main area; the activity log can be toggled there. It shares authentication and the download engine with the CLI.

Enter a song or artist in Search Tidal and press Return (or click the search button) to search the Tidal catalog. Select the results you want and use Download; individual songs are saved in the `Tracks` subfolder. Use the clear button to return to your selected playlists.

Build on macOS 13 or later with Xcode command line tools, Python 3, Node.js 18+, and FFmpeg installed:

```bash
brew install node ffmpeg
npm ci
npm run build:macos
open "macos/build/Tidal Sync.app"
```

You can drag the built app into Applications. Node and its non-system libraries are bundled; FFmpeg must be available in `/opt/homebrew/bin`, `/usr/local/bin`, or your PATH. The app requests the highest available audio quality and converts to FLAC when needed. Command-click or Shift-click to select multiple library playlists.

The build targets the Mac's current architecture and is ad-hoc signed for local use. Distribution to other Macs requires appropriate Developer ID signing, notarization, and runtime license review. Closing an in-progress download with Stop keeps completed tracks; the next run skips them. An interrupted temporary file is never treated as a completed track.

Run `npm test` to verify the desktop bridge and download failure handling without contacting Tidal.

## Release

```bash
npm run release
```

Bumps version, tags, pushes, and updates the Homebrew formula.

## License

Apache-2.0
