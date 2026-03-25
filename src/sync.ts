import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadTracks, findNewTracks } from "./download.js";
import type { AudioQuality } from "./api.js";
import type { Track } from "./types.js";

const QUALITIES: { quality: AudioQuality; folder: string; label: string }[] = [
  { quality: "HIGH", folder: "m4a", label: "High (AAC)" },
  { quality: "HI_RES_LOSSLESS", folder: "flac", label: "Master (FLAC)" },
];

interface PlaylistsConfig {
  [name: string]: string;
}

interface PlaylistSyncInfo {
  name: string;
  playlistId: string;
  url: string;
  totalTracks: number;
  newTracks: Track[];
  syncedCount: number;
}

function parsePlaylistId(input: string): string {
  const urlMatch = input.match(/playlist\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-f0-9-]+$/i.test(input)) return input;
  throw new Error(`Could not parse playlist ID from: ${input}`);
}


export async function loadConfig(configPath: string): Promise<PlaylistsConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(configPath: string, config: PlaylistsConfig): Promise<void> {
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function addPlaylist(
  configPath: string,
  playlistName: string,
  playlistUrl: string
): Promise<void> {
  const config = await loadConfig(configPath);
  const isNew = !(playlistName in config);
  config[playlistName] = playlistUrl;
  await saveConfig(configPath, config);
  if (isNew) {
    console.log(chalk.green(`  Added "${playlistName}" to sync list`));
  }
}

export async function syncPlaylists(configPath: string, baseDir: string, qualityFilter: string = "both"): Promise<void> {
  const config = await loadConfig(configPath);
  const entries = Object.entries(config);

  if (entries.length === 0) {
    console.log(chalk.yellow("No playlists to sync."));
    return;
  }

  const selectedQualities = QUALITIES.filter((q) => {
    if (qualityFilter === "both") return true;
    return q.folder === qualityFilter;
  });

  if (selectedQualities.length === 0) {
    console.log(chalk.red(`Unknown quality "${qualityFilter}". Use: flac, m4a, or both`));
    return;
  }

  // Phase 1: Fetch all playlists once
  console.log(chalk.cyan.bold("\n  Checking playlists...\n"));

  const playlists: { name: string; playlistId: string; tracks: Track[] }[] = [];

  for (const [name, urlOrId] of entries) {
    const playlistId = parsePlaylistId(urlOrId);
    const spinner = ora(`  ${name}`).start();

    try {
      const playlist = await getPlaylist(playlistId);
      const tracks = await getPlaylistTracks(playlistId);
      playlists.push({ name: playlist.title, playlistId, tracks });
      spinner.succeed(`  ${name} — ${tracks.length} tracks`);
    } catch (err) {
      spinner.fail(`  ${name} — ${chalk.red((err as Error).message)}`);
    }
  }

  // Phase 2: Sync each quality
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
        url: "",
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
