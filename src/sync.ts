import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { getUserPlaylists, getPlaylistTracks } from "./api.js";
import { downloadTracks, findNewTracks } from "./download.js";
import type { AudioQuality } from "./api.js";
import type { Track, Playlist } from "./types.js";

const QUALITY: AudioQuality = "HI_RES_LOSSLESS";

interface PlaylistSyncInfo {
  name: string;
  playlistId: string;
  totalTracks: number;
  newTracks: Track[];
  syncedCount: number;
}

interface SyncOptions {
  selectPlaylists?: boolean;
}

export async function syncAllPlaylists(baseDir: string, options: SyncOptions = {}): Promise<void> {
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

  // Phase 3: Compare with local files before asking what to sync
  await mkdir(baseDir, { recursive: true });

  const infos: PlaylistSyncInfo[] = [];

  for (const pl of playlists) {
    const folder = join(baseDir, sanitize(pl.name));
    const newTracks = await findNewTracks(pl.tracks, folder);

    infos.push({
      name: pl.name,
      playlistId: pl.playlistId,
      totalTracks: pl.tracks.length,
      newTracks,
      syncedCount: pl.tracks.length - newTracks.length,
    });
  }

  const selectedInfos = options.selectPlaylists === false
    ? infos
    : await selectPlaylists(infos);

  if (selectedInfos.length === 0) {
    console.log(chalk.yellow("\nNo playlists selected."));
    return;
  }

  // Phase 4: Download new tracks (FLAC Master)
  const totalNew = selectedInfos.reduce((sum, p) => sum + p.newTracks.length, 0);
  const totalTracks = selectedInfos.reduce((sum, p) => sum + p.totalTracks, 0);
  const totalSynced = selectedInfos.reduce((sum, p) => sum + p.syncedCount, 0);
  const withNew = selectedInfos.filter((p) => p.newTracks.length > 0);

  console.log(
    chalk.white(`  ${totalTracks} total, `) +
    chalk.green(`${totalNew} to download, `) +
    chalk.gray(`${totalSynced} synced`)
  );

  if (totalNew === 0) {
    console.log(chalk.gray("  Up to date"));
    return;
  }

  let globalDownloaded = 0;
  let globalFailed = 0;

  for (const info of withNew) {
    console.log(
      chalk.cyan.bold(`\n  ${info.name}`) +
      chalk.gray(` — ${info.newTracks.length} tracks`)
    );

    const folder = join(baseDir, sanitize(info.name));

    const { downloaded, failed } = await downloadTracks(
      info.newTracks,
      folder,
      info.name,
      globalDownloaded,
      totalNew,
      QUALITY
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

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

async function selectPlaylists(playlists: PlaylistSyncInfo[]): Promise<PlaylistSyncInfo[]> {
  if (!input.isTTY || !output.isTTY) {
    console.log(chalk.gray("  Non-interactive terminal detected; syncing all playlists."));
    return playlists;
  }

  const selected = await promptPlaylistChecklist(playlists);
  console.log(chalk.gray(`  Selected ${selected.length} of ${playlists.length} playlists`));
  return selected.map((index) => playlists[index]);
}

async function promptPlaylistChecklist(playlists: PlaylistSyncInfo[]): Promise<number[]> {
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  let cursor = 0;
  let top = 0;
  const selected = new Set(playlists.map((_, index) => index));

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      output.off("resize", render);
      input.setRawMode(false);
      output.write("\x1b[?25h\x1b[?1049l");
    };

    const finish = (indexes: number[]): void => {
      cleanup();
      resolve(indexes);
    };

    const cancel = (): void => {
      cleanup();
      reject(new Error("Playlist selection cancelled"));
    };

    const toggleCurrent = (): void => {
      if (selected.has(cursor)) {
        selected.delete(cursor);
      } else {
        selected.add(cursor);
      }
    };

    const toggleAll = (): void => {
      if (selected.size === playlists.length) {
        selected.clear();
      } else {
        playlists.forEach((_, index) => selected.add(index));
      }
    };

    const moveCursor = (delta: number): void => {
      cursor = Math.max(0, Math.min(playlists.length - 1, cursor + delta));
      render();
    };

    const onKeypress = (_value: string, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        cancel();
        return;
      }

      switch (key.name) {
        case "up":
          moveCursor(-1);
          break;
        case "down":
          moveCursor(1);
          break;
        case "pageup":
          moveCursor(-viewportHeight());
          break;
        case "pagedown":
          moveCursor(viewportHeight());
          break;
        case "space":
          toggleCurrent();
          render();
          break;
        case "a":
          toggleAll();
          render();
          break;
        case "return":
        case "enter":
          finish([...selected].sort((a, b) => a - b));
          break;
        case "q":
        case "escape":
          finish([]);
          break;
      }
    };

    const viewportHeight = (): number => {
      return Math.max(5, Math.min(playlists.length, (output.rows ?? 24) - 7));
    };

    const ensureCursorVisible = (): void => {
      const height = viewportHeight();
      if (cursor < top) {
        top = cursor;
      } else if (cursor >= top + height) {
        top = cursor - height + 1;
      }
      top = Math.max(0, Math.min(top, Math.max(0, playlists.length - height)));
    };

    function render(): void {
      ensureCursorVisible();
      const width = output.columns ?? 80;
      const height = viewportHeight();
      const last = Math.min(playlists.length, top + height);

      output.write("\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J");
      output.write(chalk.cyan.bold("Select playlists to sync") + "\n");
      output.write(chalk.gray(`${selected.size} selected. All playlists are selected initially.`) + "\n\n");

      for (let index = top; index < last; index++) {
        const playlist = playlists[index];
        const current = index === cursor;
        const marker = current ? ">" : " ";
        const checkbox = selected.has(index) ? "[x]" : "[ ]";
        const count = `${playlist.newTracks.length} of ${playlist.totalTracks} track${playlist.totalTracks === 1 ? "" : "s"}`;
        const prefix = `  ${marker} ${checkbox} `;
        const suffix = ` (${count})`;
        const title = truncate(playlist.name, Math.max(1, width - prefix.length - suffix.length));
        const line = `${prefix}${title}${chalk.gray(suffix)}`;

        output.write(current ? chalk.inverse(padPlain(line, width)) : line);
        output.write("\n");
      }

      if (top > 0 || last < playlists.length) {
        output.write(chalk.gray(`\n  Showing ${top + 1}-${last} of ${playlists.length}`));
      } else {
        output.write("\n");
      }

      output.write(chalk.gray("\n  Up/down scroll  Space toggle  A all/none  Enter sync  Q cancel"));
    }

    input.on("keypress", onKeypress);
    output.on("resize", render);
    render();
  });
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function padPlain(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - stripAnsi(value).length));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
