import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getPlaylist, getPlaylistTracks } from "./api.js";
import { downloadTracks, findNewTracks } from "./download.js";
const QUALITIES = [
    { quality: "HIGH", folder: "m4a", label: "High (AAC)" },
    { quality: "HI_RES_LOSSLESS", folder: "flac", label: "Master (FLAC)" },
];
function parsePlaylistId(input) {
    const urlMatch = input.match(/playlist\/([a-f0-9-]+)/i);
    if (urlMatch)
        return urlMatch[1];
    if (/^[a-f0-9-]+$/i.test(input))
        return input;
    throw new Error(`Could not parse playlist ID from: ${input}`);
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
export async function syncPlaylists(configPath, baseDir) {
    const config = await loadConfig(configPath);
    const entries = Object.entries(config);
    if (entries.length === 0) {
        console.log(chalk.yellow("No playlists to sync."));
        return;
    }
    // Phase 1: Fetch all playlists once
    console.log(chalk.cyan.bold("\n  Checking playlists...\n"));
    const playlists = [];
    for (const [name, urlOrId] of entries) {
        const playlistId = parsePlaylistId(urlOrId);
        const spinner = ora(`  ${name}`).start();
        try {
            const playlist = await getPlaylist(playlistId);
            const tracks = await getPlaylistTracks(playlistId);
            playlists.push({ name: playlist.title, playlistId, tracks });
            spinner.succeed(`  ${name} — ${tracks.length} tracks`);
        }
        catch (err) {
            spinner.fail(`  ${name} — ${chalk.red(err.message)}`);
        }
    }
    // Phase 2: Sync each quality
    for (const q of QUALITIES) {
        const outputDir = join(baseDir, q.folder);
        await mkdir(outputDir, { recursive: true });
        console.log(chalk.bold(`\n  ${q.label}`));
        const infos = [];
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
        console.log(chalk.white(`  ${totalTracks} total, `) +
            chalk.green(`${totalNew} to download, `) +
            chalk.gray(`${totalSynced} synced`));
        if (totalNew === 0) {
            console.log(chalk.gray("  Up to date"));
            continue;
        }
        let globalDownloaded = 0;
        let globalFailed = 0;
        for (const info of withNew) {
            console.log(chalk.cyan.bold(`\n  ${info.name}`) +
                chalk.gray(` — ${info.newTracks.length} tracks`));
            const folder = join(outputDir, sanitize(info.name));
            const { downloaded, failed } = await downloadTracks(info.newTracks, folder, info.name, globalDownloaded, totalNew, q.quality);
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
function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
//# sourceMappingURL=sync.js.map