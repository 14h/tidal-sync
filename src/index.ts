#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadToken, getDeviceCode, pollForToken, logout } from "./auth.js";
import { setToken, getUserProfile, getUserSubscription } from "./api.js";
import { syncAllPlaylists } from "./sync.js";
import type { TokenData } from "./types.js";

async function ensureAuth(): Promise<TokenData> {
  const spinner = ora("Checking authentication...").start();
  const existing = await loadToken();

  if (existing) {
    spinner.succeed("Authenticated");
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
  authSpinner.succeed("Authenticated");

  return token;
}

async function showUserInfo(): Promise<void> {
  const spinner = ora("Loading profile...").start();
  try {
    const [profile, sub] = await Promise.all([getUserProfile(), getUserSubscription()]);
    spinner.stop();

    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username;

    console.log();
    console.log(chalk.bold("  Account"));
    console.log(`  ${chalk.white(name)} ${chalk.gray(`(${profile.username})`)}`);
    console.log(`  ${chalk.gray(profile.email)}`);
    console.log(`  ${chalk.gray(profile.countryCode)} — ${chalk.cyan(sub.subscription.type)} ${chalk.gray(`(${sub.highestSoundQuality})`)}`);
    console.log();
  } catch {
    spinner.stop();
  }
}

const program = new Command();

program
  .name("tidal-sync")
  .description("Sync all your Tidal playlists at Master quality (FLAC)")
  .version("1.0.0")
  .option("-o, --output <dir>", "Base output directory", ".")
  .action(async (opts: { output: string }) => {
    try {
      const token = await ensureAuth();
      setToken(token);

      await showUserInfo();
      await syncAllPlaylists(opts.output);
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
