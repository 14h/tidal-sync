import { mkdir, stat, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { File } from "node-taglib-sharp";
import chalk from "chalk";
import cliProgress from "cli-progress";
import { getStreamUrl, getTrackContributors, downloadCover, } from "./api.js";
import { decryptSecurityToken, decryptFile } from "./decrypt.js";
function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
function formatTrackNumber(n) {
    return String(n).padStart(2, "0");
}
function buildFilename(track, index, ext) {
    const num = formatTrackNumber(index + 1);
    const artist = sanitize(track.artist?.name ?? track.artists[0]?.name ?? "Unknown");
    const title = sanitize(track.title);
    return `${num} - ${artist} - ${title}${ext}`;
}
async function fileExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function downloadSegments(urls) {
    const chunks = [];
    const bar = new cliProgress.SingleBar({
        format: "  {bar} {percentage}% | {value}/{total} segments",
        hideCursor: true,
    }, cliProgress.Presets.shades_classic);
    bar.start(urls.length, 0);
    for (const url of urls) {
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Segment download failed: ${res.status}`);
        chunks.push(Buffer.from(await res.arrayBuffer()));
        bar.increment();
    }
    bar.stop();
    return Buffer.concat(chunks);
}
async function setMetadata(filePath, track, index, coverData) {
    try {
        const contributors = await getTrackContributors(track.id);
        const composers = contributors
            .filter((c) => c.role === "Composer")
            .map((c) => c.name);
        const file = File.createFromPath(filePath);
        const tag = file.tag;
        tag.title = track.title;
        tag.album = track.album.title;
        tag.performers = track.artists.map((a) => a.name);
        tag.albumArtists = track.album.artists?.map((a) => a.name) ?? [];
        tag.track = index + 1;
        tag.trackCount = 0;
        tag.disc = track.volumeNumber;
        tag.year = track.album.releaseDate
            ? parseInt(track.album.releaseDate.split("-")[0], 10)
            : 0;
        tag.copyright = track.copyright ?? "";
        if (composers.length > 0) {
            tag.composers = composers;
        }
        if (coverData) {
            const { ByteVector, Picture, PictureType } = await import("node-taglib-sharp");
            const bv = ByteVector.fromByteArray(coverData);
            const pic = Picture.fromData(bv);
            pic.type = PictureType.FrontCover;
            pic.mimeType = "image/jpeg";
            tag.pictures = [pic];
        }
        file.save();
        file.dispose();
    }
    catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not set metadata — ${err.message}`));
    }
}
export async function downloadPlaylist(playlist, tracks, outputDir) {
    const folder = join(outputDir, sanitize(playlist.title));
    await mkdir(folder, { recursive: true });
    console.log(chalk.cyan(`\nPlaylist: ${playlist.title}`));
    console.log(chalk.gray(`Tracks: ${tracks.length} | Folder: ${folder}\n`));
    // Download cover once for reuse
    const coverImageId = playlist.squareImage || playlist.image;
    const coverData = coverImageId ? await downloadCover(coverImageId) : null;
    if (coverData) {
        await fsWriteFile(join(folder, "cover.jpg"), coverData);
    }
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const artistName = track.artist?.name ?? track.artists[0]?.name ?? "Unknown";
        console.log(chalk.white(`[${i + 1}/${tracks.length}] `) +
            chalk.bold(track.title) +
            chalk.gray(` — ${artistName}`));
        try {
            const stream = await getStreamUrl(track.id);
            const filename = buildFilename(track, i, stream.fileExtension);
            const filePath = join(folder, filename);
            if (await fileExists(filePath)) {
                console.log(chalk.yellow("  Skipped (already exists)"));
                skipped++;
                continue;
            }
            // Download all segments and concatenate
            const data = await downloadSegments(stream.urls);
            // Write to file
            await fsWriteFile(filePath, data);
            // Decrypt if needed
            if (stream.encryptionKey) {
                const { key, nonce } = decryptSecurityToken(stream.encryptionKey);
                await decryptFile(filePath, key, nonce);
            }
            // Tag metadata (only for flac/m4a, not raw containers)
            const trackCover = track.album.cover
                ? await downloadCover(track.album.cover)
                : coverData;
            await setMetadata(filePath, track, i, trackCover);
            console.log(chalk.green("  Done"));
            downloaded++;
        }
        catch (err) {
            console.error(chalk.red(`  Error: ${err.message}`));
            failed++;
        }
    }
    console.log(chalk.cyan(`\nComplete: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`));
}
//# sourceMappingURL=download.js.map