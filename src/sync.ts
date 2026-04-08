import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getUserPlaylists, getPlaylistTracks } from "./api.js";
import { downloadTracks, findNewTracks } from "./download.js";
import type { AudioQuality } from "./api.js";
import type { Track, Playlist } from "./types.js";

const QUALITIES: { quality: AudioQuality; folder: string; label: string }[] = [
  { quality: "HIGH", folder: "m4a", label: "High (AAC)" },
  { quality: "HI_RES_LOSSLESS", folder: "flac", label: "Master (FLAC)" },
];

interface PlaylistSyncInfo {
  name: string;
  playlistId: string;
  totalTracks: number;
  newTracks: Track[];
  syncedCount: number;
}

export async function syncAllPlaylists(baseDir: string, qualityFilter: string = "both"): Promise<void> {
  const selectedQualities = QUALITIES.filter((q) => {
    if (qualityFilter === "both") return true;
    return q.folder === qualityFilter;
  });

  if (selectedQualities.length === 0) {
    console.log(chalk.red(`Unknown quality "${qualityFilter}". Use: flac, m4a, or both`));
    return;
  }

  // Phase 1: Fetch all user playlists
  const fetchSpinner = ora("Fetching your playlists...").start();
  let userPlaylists: Playlist[];
  try {
    userPlaylists = await getUserPlaylists();
    fetchSpinner.succeed(`Found ${userPlaylists.length} playlists`);
  } catch (err) {
    fetchSpinner.fail(`Failed to fetch playlists: ${(err as Error).message}`);
    return;
  }

  if (userPlaylists.length === 0) {
    console.log(chalk.yellow("\nNo playlists found in your library."));
    return;
  }

  // Phase 2: Fetch tracks for each playlist
  console.log(chalk.cyan.bold("\n  Loading tracks...\n"));

  const playlists: { name: string; playlistId: string; tracks: Track[] }[] = [];

  for (const pl of userPlaylists) {
    const spinner = ora(`  ${pl.title}`).start();
    try {
      const tracks = await getPlaylistTracks(pl.uuid);
      playlists.push({ name: pl.title, playlistId: pl.uuid, tracks });
      spinner.succeed(`  ${pl.title} — ${tracks.length} tracks`);
    } catch (err) {
      spinner.fail(`  ${pl.title} — ${chalk.red((err as Error).message)}`);
    }
  }

  // Phase 3: Sync each quality
  for (const q of selectedQualities) {
    const outputDir = join(baseDir, q.folder);
    await mkdir(outputDir, { recursive: true });

    console.log(chalk.bold(`\n  ${q.label}`));

    const infos: PlaylistSyncInfo[] = [];

    for (const pl of playlists) {
      const folder = join(outputDir, sanitize(pl.name));
      const newTracks = await findNewTracks(pl.tracks, folder);

      infos.push({
        name: pl.name,
        playlistId: pl.playlistId,
        totalTracks: pl.tracks.length,
        newTracks,
        syncedCount: pl.tracks.length - newTracks.length,
      });
    }

    const totalNew = infos.reduce((sum, p) => sum + p.newTracks.length, 0);
    const totalTracks = infos.reduce((sum, p) => sum + p.totalTracks, 0);
    const totalSynced = infos.reduce((sum, p) => sum + p.syncedCount, 0);
    const withNew = infos.filter((p) => p.newTracks.length > 0);

    console.log(
      chalk.white(`  ${totalTracks} total, `) +
      chalk.green(`${totalNew} to download, `) +
      chalk.gray(`${totalSynced} synced`)
    );

    if (totalNew === 0) {
      console.log(chalk.gray("  Up to date"));
      continue;
    }

    let globalDownloaded = 0;
    let globalFailed = 0;

    for (const info of withNew) {
      console.log(
        chalk.cyan.bold(`\n  ${info.name}`) +
        chalk.gray(` — ${info.newTracks.length} tracks`)
      );

      const folder = join(outputDir, sanitize(info.name));

      const { downloaded, failed } = await downloadTracks(
        info.newTracks,
        folder,
        info.name,
        globalDownloaded,
        totalNew,
        q.quality
      );

      globalDownloaded += downloaded;
      globalFailed += failed;
    }

    console.log();
    console.log(chalk.bold("  Done! ") + chalk.green(`${globalDownloaded} downloaded`));
    if (globalFailed > 0) {
      console.log(chalk.red(`  ${globalFailed} failed`));
    }
  }

  console.log();
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
