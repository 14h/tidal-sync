import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadTracks, findNewTracks } from "./download.js";
import type { Track } from "./types.js";

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

export async function syncPlaylists(configPath: string, outputDir: string): Promise<void> {
  const config = await loadConfig(configPath);
  const entries = Object.entries(config);

  if (entries.length === 0) {
    console.log(chalk.yellow("No playlists to sync."));
    return;
  }

  await mkdir(outputDir, { recursive: true });

  // Phase 1: Fetch all playlists and compare against files on disk
  console.log(chalk.cyan.bold("\n  Checking playlists...\n"));

  const playlistInfos: PlaylistSyncInfo[] = [];

  for (const [name, urlOrId] of entries) {
    const playlistId = parsePlaylistId(urlOrId);
    const spinner = ora(`  ${name}`).start();

    try {
      const playlist = await getPlaylist(playlistId);
      const allTracks = await getPlaylistTracks(playlistId);

      const folder = join(outputDir, sanitize(playlist.title));
      const newTracks = await findNewTracks(allTracks, folder);

      playlistInfos.push({
        name: playlist.title,
        playlistId,
        url: urlOrId,
        totalTracks: allTracks.length,
        newTracks,
        syncedCount: allTracks.length - newTracks.length,
      });

      if (newTracks.length > 0) {
        spinner.succeed(
          `  ${name} — ${chalk.green(`${newTracks.length} new`)} / ${allTracks.length} total`
        );
      } else {
        spinner.succeed(
          `  ${name} — ${chalk.gray("up to date")} (${allTracks.length} tracks)`
        );
      }
    } catch (err) {
      spinner.fail(`  ${name} — ${chalk.red((err as Error).message)}`);
    }
  }

  // Phase 2: Summary
  const totalNew = playlistInfos.reduce((sum, p) => sum + p.newTracks.length, 0);
  const totalTracks = playlistInfos.reduce((sum, p) => sum + p.totalTracks, 0);
  const totalSynced = playlistInfos.reduce((sum, p) => sum + p.syncedCount, 0);
  const playlistsWithNew = playlistInfos.filter((p) => p.newTracks.length > 0);

  console.log();
  console.log(
    chalk.bold("  Summary: ") +
    chalk.white(`${playlistInfos.length} playlists, `) +
    chalk.white(`${totalTracks} total tracks, `) +
    chalk.green(`${totalNew} to download, `) +
    chalk.gray(`${totalSynced} already synced`)
  );

  if (totalNew === 0) {
    console.log(chalk.green.bold("\n  Everything is up to date!\n"));
    return;
  }

  // Phase 3: Download new tracks
  console.log();

  let globalDownloaded = 0;
  let globalFailed = 0;

  for (const info of playlistsWithNew) {
    console.log(
      chalk.cyan.bold(`\n  ${info.name}`) +
      chalk.gray(` — ${info.newTracks.length} tracks to download`)
    );

    const folder = join(outputDir, sanitize(info.name));

    const { downloaded, failed } = await downloadTracks(
      info.newTracks,
      folder,
      info.name,
      globalDownloaded,
      totalNew
    );

    globalDownloaded += downloaded;
    globalFailed += failed;
  }

  // Phase 4: Final summary
  console.log();
  console.log(chalk.bold("  Done! ") + chalk.green(`${globalDownloaded} downloaded`));
  if (globalFailed > 0) {
    console.log(chalk.red(`  ${globalFailed} failed`));
  }
  console.log();
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
