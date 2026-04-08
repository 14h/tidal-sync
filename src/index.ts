#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createInterface } from "node:readline/promises";
import { loadToken, getDeviceCode, pollForToken, logout } from "./auth.js";
import { setToken } from "./api.js";
import { syncAllPlaylists } from "./sync.js";
import type { TokenData } from "./types.js";

async function askQuality(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log();
  console.log(chalk.bold("  Download quality:"));
  console.log("  1) m4a");
  console.log("  2) flac");
  console.log("  3) both");
  console.log();
  const answer = await rl.question(chalk.bold("  Choice (1/2/3): "));
  rl.close();
  const choice = answer.trim();
  if (choice === "1" || choice === "m4a") return "m4a";
  if (choice === "2" || choice === "flac") return "flac";
  return "both";
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
  .description("Sync all your Tidal playlists at Master quality")
  .version("1.0.0")
  .option("-o, --output <dir>", "Base output directory (creates flac/ and m4a/ inside)", ".")
  .option("-q, --quality <type>", "Quality to download: flac, m4a, or both")
  .action(async (opts: { output: string; quality: string }) => {
    try {
      const token = await ensureAuth();
      setToken(token);

      const quality = opts.quality ?? await askQuality();

      await syncAllPlaylists(opts.output, quality);
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
