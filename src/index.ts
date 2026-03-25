#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createInterface } from "node:readline/promises";
import { loadToken, getDeviceCode, pollForToken, logout } from "./auth.js";
import { setToken, getPlaylist, getPlaylistTracks } from "./api.js";
import { syncPlaylists, addPlaylist, loadConfig } from "./sync.js";
import type { TokenData } from "./types.js";

function parsePlaylistId(input: string): string {
  const urlMatch = input.match(/playlist\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-f0-9-]+$/i.test(input)) return input;
  throw new Error(`Could not parse playlist ID from: ${input}`);
}

async function ensureAuth(): Promise<TokenData> {
  const spinner = ora("Checking authentication...").start();
  const existing = await loadToken();

  if (existing) {
    spinner.succeed(`Logged in (user ${existing.userId})`);
    return existing;
  }

  spinner.info("Not logged in. Starting device authorization...");

  const device = await getDeviceCode();
  const link = `https://${device.verificationUri}/${device.userCode}`;

  console.log();
  console.log(chalk.bold("  Open this URL and enter the code:"));
  console.log(chalk.cyan(`  ${link}`));
  console.log(chalk.gray(`  Code: ${device.userCode}`));
  console.log();

  const authSpinner = ora("Waiting for authorization...").start();
  const token = await pollForToken(device.deviceCode, device.interval, device.expiresIn);
  authSpinner.succeed(`Logged in as user ${token.userId} (${token.countryCode})`);

  return token;
}

async function promptForPlaylist(configPath: string, outputDir: string, quality: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      console.log();
      const input = await rl.question(chalk.bold("Paste a Tidal playlist URL (or 'q' to quit): "));
      const trimmed = input.trim();

      if (trimmed === "q" || trimmed === "quit" || trimmed === "") break;

      try {
        const playlistId = parsePlaylistId(trimmed);
        const spinner = ora("Fetching playlist...").start();
        const playlist = await getPlaylist(playlistId);
        const tracks = await getPlaylistTracks(playlistId);
        spinner.succeed(`Found "${playlist.title}" — ${tracks.length} tracks`);

        await addPlaylist(configPath, playlist.title, trimmed);
        console.log(chalk.green(`  Playlist will be synced on next run.`));

        const answer = await rl.question(chalk.bold("  Download now? (Y/n): "));
        if (answer.trim().toLowerCase() !== "n") {
          await syncPlaylists(configPath, outputDir, quality);
        }
      } catch (err) {
        console.error(chalk.red(`  Error: ${(err as Error).message}`));
      }
    }
  } finally {
    rl.close();
  }
}

const program = new Command();

program
  .name("tidal-sync")
  .description("Sync Tidal playlists at Master quality")
  .version("1.0.0")
  .option("-o, --output <dir>", "Base output directory (creates flac/ and m4a/ inside)", ".")
  .option("-c, --config <path>", "Path to playlists.json", "./playlists.json")
  .option("-q, --quality <type>", "Quality to download: flac, m4a, or both", "both")
  .argument("[playlist-url]", "Tidal playlist URL to add and sync")
  .action(async (playlistUrl: string | undefined, opts: { output: string; config: string; quality: string }) => {
    try {
      const token = await ensureAuth();
      setToken(token);

      // If a URL was passed, add it first
      if (playlistUrl) {
        const playlistId = parsePlaylistId(playlistUrl);
        const spinner = ora("Fetching playlist...").start();
        const playlist = await getPlaylist(playlistId);
        spinner.succeed(`Added "${playlist.title}"`);
        await addPlaylist(opts.config, playlist.title, playlistUrl);
      }

      const config = await loadConfig(opts.config);
      const playlistCount = Object.keys(config).length;

      if (playlistCount === 0) {
        console.log(chalk.yellow("\nNo playlists configured yet.\n"));
        await promptForPlaylist(opts.config, opts.output, opts.quality);
        return;
      }

      await syncPlaylists(opts.config, opts.output, opts.quality);
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command("add <playlist-url>")
  .description("Add a playlist without downloading")
  .option("-c, --config <path>", "Path to playlists.json", "./playlists.json")
  .action(async (playlistUrl: string, opts: { config: string }) => {
    try {
      const token = await ensureAuth();
      setToken(token);
      const playlistId = parsePlaylistId(playlistUrl);
      const spinner = ora("Fetching playlist...").start();
      const playlist = await getPlaylist(playlistId);
      spinner.succeed(`"${playlist.title}" — ${playlist.numberOfTracks} tracks`);
      await addPlaylist(opts.config, playlist.title, playlistUrl);
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Clear stored authentication token")
  .action(async () => {
    await logout();
    console.log(chalk.green("Logged out successfully."));
  });

program.parse();
