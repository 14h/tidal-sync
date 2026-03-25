import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadPlaylist } from "./download.js";
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
async function loadConfig(configPath) {
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
    config[playlistName] = playlistUrl;
    await saveConfig(configPath, config);
    console.log(chalk.green(`  Added "${playlistName}" to ${configPath}`));
}
export async function syncPlaylists(configPath, outputDir) {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const entries = Object.entries(config);
    if (entries.length === 0) {
        console.log(chalk.yellow("No playlists configured."));
        return;
    }
    console.log(chalk.cyan(`Syncing ${entries.length} playlist(s)...\n`));
    const statePath = join(outputDir, ".sync-state.json");
    const state = await loadSyncState(statePath);
    let totalNew = 0;
    let totalSkipped = 0;
    for (const [name, urlOrId] of entries) {
        const playlistId = parsePlaylistId(urlOrId);
        const spinner = ora(`Fetching "${name}"...`).start();
        try {
            const playlist = await getPlaylist(playlistId);
            const allTracks = await getPlaylistTracks(playlistId);
            spinner.succeed(`${name}: ${allTracks.length} total tracks`);
            const synced = new Set(state[playlistId] ?? []);
            const newTracks = allTracks.filter((t) => !synced.has(t.id));
            if (newTracks.length === 0) {
                console.log(chalk.gray(`  No new tracks, skipping.\n`));
                totalSkipped += allTracks.length;
                continue;
            }
            console.log(chalk.white(`  ${newTracks.length} new track(s) to download\n`));
            totalNew += newTracks.length;
            totalSkipped += allTracks.length - newTracks.length;
            await downloadPlaylist(playlist, newTracks, outputDir);
            // Update state with all current track IDs (new + previously synced)
            state[playlistId] = allTracks.map((t) => t.id);
            await saveSyncState(statePath, state);
        }
        catch (err) {
            spinner.fail(`${name}: ${err.message}`);
        }
    }
    console.log(chalk.cyan(`\nSync complete: ${totalNew} new, ${totalSkipped} already synced`));
}
//# sourceMappingURL=sync.js.map