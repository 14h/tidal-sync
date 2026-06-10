import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, mkdir, readdir, rename, stat, unlink, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { File } from "node-taglib-sharp";
import chalk from "chalk";
import {
  getStreamUrl,
  getTrackContributors,
  downloadCover,
} from "./api.js";
import type { AudioQuality } from "./api.js";
import { decryptSecurityToken, decryptFile } from "./decrypt.js";
import type { Track } from "./types.js";

const CONCURRENCY = 4;
const execFileAsync = promisify(execFile);

function sanitize(name: string | null | undefined, fallback = "Unknown"): string {
  return (name?.trim() || fallback).replace(/[<>:"/\\|?*]/g, "_").trim();
}

function artistName(track: Track): string {
  return tagText(track.artist?.name ?? track.artists?.[0]?.name, "Unknown");
}

function tagText(value: string | null | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

function tagTextList(values: Array<string | null | undefined>): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function buildFilename(track: Track, ext: string): string {
  return `${sanitize(artistName(track))} - ${sanitize(track.title, "Unknown Title")}${ext}`;
}

function trackMatchPattern(track: Track): string {
  return `${sanitize(artistName(track))} - ${sanitize(track.title, "Unknown Title")}`;
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
  const onDisk = new Set(
    existing.map((f) => {
      const dot = f.lastIndexOf(".");
      return (dot > 0 ? f.substring(0, dot) : f).normalize();
    })
  );
  return tracks.filter((track) => {
    return !onDisk.has(trackMatchPattern(track).normalize());
  });
}

async function downloadData(urls: string[]): Promise<Buffer> {
  const chunks: Buffer[] = [];

  if (urls.length === 1) {
    const res = await fetch(urls[0]);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    chunks.push(Buffer.from(await res.arrayBuffer()));
  } else {
    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Segment download failed: ${res.status}`);
      chunks.push(Buffer.from(await res.arrayBuffer()));
    }
  }

  return Buffer.concat(chunks);
}

async function isMp4Container(filePath: string): Promise<boolean> {
  const file = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead >= 8 && header.subarray(4, 8).toString("ascii") === "ftyp";
  } finally {
    await file.close();
  }
}

async function remuxFlacIfNeeded(filePath: string, codec: string): Promise<void> {
  if (codec !== "flac" || !(await isMp4Container(filePath))) {
    return;
  }

  const tempPath = `${filePath}.remux-${process.pid}-${Date.now()}.flac`;

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      filePath,
      "-map",
      "0:a:0",
      "-c:a",
      "copy",
      tempPath,
    ]);
    await rename(tempPath, filePath);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error(`FLAC remux failed: ${(err as Error).message}`);
  }
}

async function setMetadata(
  filePath: string,
  track: Track,
  index: number,
  coverData: Buffer | null,
  codec: string
): Promise<void> {
  if (codec.startsWith("mp4a")) {
    return;
  }

  try {
    const contributors = await getTrackContributors(track.id);
    const composers = contributors
      .filter((c) => c.role === "Composer")
      .map((c) => c.name)
      .filter((name) => name?.trim());

    const file = File.createFromPath(filePath);
    const tag = file.tag;

    tag.title = tagText(track.title, "Unknown Title");
    tag.album = tagText(track.album?.title);
    tag.performers = tagTextList(track.artists?.map((a) => a.name) ?? [track.artist?.name]);
    tag.albumArtists = tagTextList(track.album?.artists?.map((a) => a.name) ?? []);
    tag.track = index + 1;
    tag.trackCount = 0;
    tag.disc = track.volumeNumber || 0;
    tag.year = track.album?.releaseDate
      ? parseInt(track.album.releaseDate.split("-")[0], 10)
      : 0;
    tag.copyright = tagText(track.copyright);

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

export async function downloadTracks(
  tracks: Track[],
  folder: string,
  playlistName: string,
  globalOffset: number,
  globalTotal: number,
  quality: AudioQuality = "HI_RES_LOSSLESS"
): Promise<{ downloaded: number; failed: number }> {
  await mkdir(folder, { recursive: true });

  // Shuffle so parallel runs don't compete on the same tracks
  const shuffled = [...tracks].sort(() => Math.random() - 0.5);

  const firstCover = shuffled[0]?.album?.cover;
  const fallbackCover = firstCover ? await downloadCover(firstCover) : null;

  let downloaded = 0;
  let failed = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < shuffled.length) {
      const i = nextIndex++;
      const track = shuffled[i];
      const globalNum = globalOffset + i + 1;
      const artist = artistName(track);
      const label = `[${globalNum}/${globalTotal}] ${track.title} — ${artist}`;

      try {
        const stream = await getStreamUrl(track.id, quality);
        const filename = buildFilename(track, stream.fileExtension);
        const filePath = join(folder, filename);

        if (await fileExists(filePath)) {
          console.log(chalk.gray(`  ${label} — skipped`));
          downloaded++;
          continue;
        }

        const data = await downloadData(stream.urls);
        await fsWriteFile(filePath, data);

        if (stream.encryptionKey) {
          const { key, nonce } = decryptSecurityToken(stream.encryptionKey);
          await decryptFile(filePath, key, nonce);
        }

        await remuxFlacIfNeeded(filePath, stream.codec);

        const trackCover = track.album.cover
          ? await downloadCover(track.album.cover)
          : fallbackCover;
        await setMetadata(filePath, track, i, trackCover, stream.codec);

        console.log(chalk.green(`  ${label} — done`));
        downloaded++;
      } catch (err) {
        console.error(chalk.red(`  ${label} — failed: ${(err as Error).message}`));
        failed++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, shuffled.length) }, () => worker());
  await Promise.all(workers);

  return { downloaded, failed };
}
