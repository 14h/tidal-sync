# tidal-sync

Native macOS app and CLI for downloading Tidal playlists and individual songs as FLAC.

## Download the macOS app

**[Download for Apple Silicon (M1 and later)](https://github.com/14h/tidal-sync/releases/latest/download/Tidal-Sync-macos-arm64.zip)** · **[Download for Intel](https://github.com/14h/tidal-sync/releases/latest/download/Tidal-Sync-macos-x64.zip)**

Requires **macOS 15 or later**. Download the ZIP for your Mac, unzip it, and drag **Tidal Sync.app** into Applications. Node is included; no source build is needed.

Install FFmpeg for audio remuxing and conversion:

```bash
brew install ffmpeg
```

Open the app and sign in to Tidal. Select playlists or search the Tidal catalog, choose songs, and click Download. Playlist downloads use their own subfolders; individual songs go into `Tracks`.

The app is ad-hoc signed and not notarized. If macOS blocks the first launch, approve it in **System Settings → Privacy & Security → Open Anyway**.

[All releases and checksums](https://github.com/14h/tidal-sync/releases)

## Install the CLI

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

## Build the macOS app from source

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

Local builds target the Mac's current architecture and are ad-hoc signed. GitHub releases provide separate Apple Silicon and Intel builds. Closing an in-progress download with Stop keeps completed tracks; the next run skips them. An interrupted temporary file is never treated as a completed track.

Run `npm test` to verify the desktop bridge and download failure handling without contacting Tidal.

## Release

Update the version in `package.json` and `package-lock.json`, commit, then push a matching `v` tag. The `macOS release` workflow builds both architectures and publishes the app ZIPs and checksums to GitHub Releases. It runs builds only.

`npm run release` remains the legacy CLI/Homebrew release script; it bumps the patch version and updates the Homebrew formula.

## License

Apache-2.0
