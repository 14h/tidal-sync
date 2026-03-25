import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadTracks } from "./download.js";
function parsePlaylistId(input) {
    const urlMatch = input.match(/playlist\/([a-f0-9-]+)/i);
    if (urlMatch)
        return urlMatch[1];
    if (/^[a-f0-9-]+$/i.test(input))
        return input;
    throw new Error(`Could not parse playlist ID from: ${input}`);
}
async function loadSyncState(statePath) {
    try {
        const raw = await readFile(statePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function saveSyncState(statePath, state) {
    await writeFile(statePath, JSON.stringify(state, null, 2));
}
export async function loadConfig(configPath) {
    try {
        const raw = await readFile(configPath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function saveConfig(configPath, config) {
    await writeFile(configPath, JSON.stringify(config, null, 2));
}
export async function addPlaylist(configPath, playlistName, playlistUrl) {
    const config = await loadConfig(configPath);
    const isNew = !(playlistName in config);
    config[playlistName] = playlistUrl;
    await saveConfig(configPath, config);
    if (isNew) {
        console.log(chalk.green(`  Added "${playlistName}" to sync list`));
    }
}
export async function syncPlaylists(configPath, outputDir) {
    const config = await loadConfig(configPath);
    const entries = Object.entries(config);
    if (entries.length === 0) {
        console.log(chalk.yellow("No playlists to sync."));
        return;
    }
    await mkdir(outputDir, { recursive: true });
    const statePath = join(outputDir, ".sync-state.json");
    const state = await loadSyncState(statePath);
    // Phase 1: Fetch all playlists and compute diffs
    console.log(chalk.cyan.bold("\n  Checking playlists...\n"));
    const playlistInfos = [];
    for (const [name, urlOrId] of entries) {
        const playlistId = parsePlaylistId(urlOrId);
        const spinner = ora(`  ${name}`).start();
        try {
            const playlist = await getPlaylist(playlistId);
            const allTracks = await getPlaylistTracks(playlistId);
            const synced = new Set(state[playlistId] ?? []);
            const newTracks = allTracks.filter((t) => !synced.has(t.id));
            playlistInfos.push({
                name: playlist.title,
                playlistId,
                url: urlOrId,
                totalTracks: allTracks.length,
                newTracks,
                syncedCount: allTracks.length - newTracks.length,
            });
            if (newTracks.length > 0) {
                spinner.succeed(`  ${name} — ${chalk.green(`${newTracks.length} new`)} / ${allTracks.length} total`);
            }
            else {
                spinner.succeed(`  ${name} — ${chalk.gray("up to date")} (${allTracks.length} tracks)`);
            }
        }
        catch (err) {
            spinner.fail(`  ${name} — ${chalk.red(err.message)}`);
        }
    }
    // Phase 2: Summary
    const totalNew = playlistInfos.reduce((sum, p) => sum + p.newTracks.length, 0);
    const totalTracks = playlistInfos.reduce((sum, p) => sum + p.totalTracks, 0);
    const totalSynced = playlistInfos.reduce((sum, p) => sum + p.syncedCount, 0);
    const playlistsWithNew = playlistInfos.filter((p) => p.newTracks.length > 0);
    console.log();
    console.log(chalk.bold("  Summary: ") +
        chalk.white(`${playlistInfos.length} playlists, `) +
        chalk.white(`${totalTracks} total tracks, `) +
        chalk.green(`${totalNew} to download, `) +
        chalk.gray(`${totalSynced} already synced`));
    if (totalNew === 0) {
        console.log(chalk.green.bold("\n  Everything is up to date!\n"));
        return;
    }
    // Phase 3: Download new tracks
    console.log();
    let globalDownloaded = 0;
    let globalFailed = 0;
    for (const info of playlistsWithNew) {
        console.log(chalk.cyan.bold(`\n  ${info.name}`) +
            chalk.gray(` — ${info.newTracks.length} tracks to download`));
        const folder = join(outputDir, sanitize(info.name));
        const { downloaded, failed } = await downloadTracks(info.newTracks, folder, info.name, globalDownloaded, totalNew);
        globalDownloaded += downloaded;
        globalFailed += failed;
        // Update state after each playlist
        const allTrackIds = [
            ...(state[info.playlistId] ?? []),
            ...info.newTracks.filter((_, i) => i < downloaded).map((t) => t.id),
        ];
        // Deduplicate
        state[info.playlistId] = [...new Set(allTrackIds)];
        await saveSyncState(statePath, state);
    }
    // Phase 4: Final summary
    console.log();
    console.log(chalk.bold("  Done! ") + chalk.green(`${globalDownloaded} downloaded`));
    if (globalFailed > 0) {
        console.log(chalk.red(`  ${globalFailed} failed`));
    }
    console.log();
}
function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
//# sourceMappingURL=sync.js.map