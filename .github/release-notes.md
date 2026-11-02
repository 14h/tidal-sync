Native SwiftUI macOS app with:

- Playlist library, multiple playlist selection, and adding playlist links to your Tidal library.
- Song selection with individual checkboxes and Select All / Deselect All.
- Tidal catalog search and direct song downloads.
- Download folder selection, track progress, and an activity log.

## Download

- **Apple Silicon (M1 and later):** `Tidal-Sync-macos-arm64.zip`
- **Intel:** `Tidal-Sync-macos-x64.zip`

Requires **macOS 15 or later**. Unzip and drag **Tidal Sync.app** into Applications.
Node is bundled. Install FFmpeg for audio remuxing and conversion:

```bash
brew install ffmpeg
```

Sign in with your Tidal account on first use. The app is ad-hoc signed and is not notarized; macOS may require approval in **System Settings → Privacy & Security → Open Anyway** after your first launch attempt.

SHA-256 checksum files are included alongside each download.
