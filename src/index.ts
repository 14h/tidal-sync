#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadToken, getDeviceCode, pollForToken, logout } from "./auth.js";
import { setToken, getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadPlaylist } from "./download.js";
import { syncPlaylists, addPlaylist } from "./sync.js";
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


const program = new Command();

program
  .name("tidal-sync")
  .description("Download Tidal playlists at Master quality")
  .version("1.0.0")
  .argument("<playlist-url>", "Tidal playlist URL or UUID")
  .option("-o, --output <dir>", "Output directory", "./download")
  .option("-c, --config <path>", "Path to playlists.json", "./playlists.json")
  .action(async (playlistUrl: string, opts: { output: string; config: string }) => {
    try {
      const playlistId = parsePlaylistId(playlistUrl);
      const token = await ensureAuth();
      setToken(token);

      const spinner = ora("Fetching playlist...").start();
      const playlist = await getPlaylist(playlistId);
      spinner.text = "Fetching tracks...";
      const tracks = await getPlaylistTracks(playlistId);
      spinner.succeed(`Found ${tracks.length} tracks in "${playlist.title}"`);

      await downloadPlaylist(playlist, tracks, opts.output);

      // Auto-add to playlists.json for future syncs
      await addPlaylist(opts.config, playlist.title, playlistUrl);
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Sync all playlists from a JSON config file")
  .option("-c, --config <path>", "Path to playlists.json", "./playlists.json")
  .option("-o, --output <dir>", "Output directory", "./download")
  .action(async (opts: { config: string; output: string }) => {
    try {
      const token = await ensureAuth();
      setToken(token);
      await syncPlaylists(opts.config, opts.output);
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
