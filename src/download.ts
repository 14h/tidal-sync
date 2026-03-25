import { mkdir, readdir, stat, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { File } from "node-taglib-sharp";
import chalk from "chalk";
import cliProgress from "cli-progress";
import {
  getStreamUrl,
  getTrackContributors,
  downloadCover,
} from "./api.js";
import type { AudioQuality } from "./api.js";
import { decryptSecurityToken, decryptFile } from "./decrypt.js";
import type { Track } from "./types.js";

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function artistName(track: Track): string {
  return track.artist?.name ?? track.artists[0]?.name ?? "Unknown";
}

function buildFilename(track: Track, index: number, ext: string): string {
  const num = String(index + 1).padStart(2, "0");
  return `${num} - ${sanitize(artistName(track))} - ${sanitize(track.title)}${ext}`;
}

function trackMatchPattern(track: Track, index: number): string {
  const num = String(index + 1).padStart(2, "0");
  return `${num} - ${sanitize(artistName(track))} - ${sanitize(track.title)}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function findNewTracks(tracks: Track[], folder: string): Promise<Track[]> {
  let existing: string[];
  try {
    existing = await readdir(folder);
  } catch {
    return tracks;
  }
  return tracks.filter((track, i) => {
    const pattern = trackMatchPattern(track, i);
    return !existing.some((f) => f.startsWith(pattern));
  });
}

async function downloadSegments(urls: string[], label: string): Promise<Buffer> {
  const chunks: Buffer[] = [];

  if (urls.length === 1) {
    // Single URL — show byte progress
    const res = await fetch(urls[0]);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const reader = res.body!.getReader();
    let received = 0;

    const bar = new cliProgress.SingleBar(
      {
        format: `  ${chalk.gray("{bar}")} {percentage}% | {received} MB`,
        hideCursor: true,
        barsize: 25,
      },
      cliProgress.Presets.shades_classic
    );
    if (total > 0) bar.start(total, 0, { received: "0.0" });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      if (total > 0) bar.update(received, { received: (received / 1048576).toFixed(1) });
    }
    if (total > 0) bar.stop();
  } else {
    // Multi-segment
    const bar = new cliProgress.SingleBar(
      {
        format: `  ${chalk.gray("{bar}")} {percentage}% | {value}/{total} segments`,
        hideCursor: true,
        barsize: 25,
      },
      cliProgress.Presets.shades_classic
    );
    bar.start(urls.length, 0);

    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Segment download failed: ${res.status}`);
      chunks.push(Buffer.from(await res.arrayBuffer()));
      bar.increment();
    }
    bar.stop();
  }

  return Buffer.concat(chunks);
}

async function setMetadata(
  filePath: string,
  track: Track,
  index: number,
  coverData: Buffer | null
): Promise<void> {
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
  } catch (err) {
    console.warn(chalk.yellow(`    Warning: metadata failed — ${(err as Error).message}`));
  }
}

/**
 * Download a list of tracks into a folder.
 * Returns counts of downloaded and failed tracks.
 *
 * @param globalOffset - number of tracks already downloaded across all playlists (for global counter)
 * @param globalTotal - total tracks to download across all playlists
 */
export async function downloadTracks(
  tracks: Track[],
  folder: string,
  playlistName: string,
  globalOffset: number,
  globalTotal: number,
  quality: AudioQuality = "HI_RES_LOSSLESS"
): Promise<{ downloaded: number; failed: number }> {
  await mkdir(folder, { recursive: true });

  // Pre-fetch cover for the playlist folder
  const firstCover = tracks[0]?.album?.cover;
  const fallbackCover = firstCover ? await downloadCover(firstCover) : null;

  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const globalNum = globalOffset + i + 1;
    const artist = artistName(track);

    console.log(
      chalk.white.bold(`  [${globalNum}/${globalTotal}] `) +
      chalk.white(track.title) +
      chalk.gray(` — ${artist}`)
    );

    try {
      const stream = await getStreamUrl(track.id, quality);
      const filename = buildFilename(track, i, stream.fileExtension);
      const filePath = join(folder, filename);

      if (await fileExists(filePath)) {
        console.log(chalk.gray("    Already downloaded, skipping"));
        downloaded++;
        continue;
      }

      const data = await downloadSegments(stream.urls, track.title);
      await fsWriteFile(filePath, data);

      if (stream.encryptionKey) {
        const { key, nonce } = decryptSecurityToken(stream.encryptionKey);
        await decryptFile(filePath, key, nonce);
      }

      const trackCover = track.album.cover
        ? await downloadCover(track.album.cover)
        : fallbackCover;
      await setMetadata(filePath, track, i, trackCover);

      console.log(chalk.green("    Done"));
      downloaded++;
    } catch (err) {
      console.error(chalk.red(`    Failed: ${(err as Error).message}`));
      failed++;
    }
  }

  return { downloaded, failed };
}
