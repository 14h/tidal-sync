import type {
  TokenData,
  UserProfile,
  UserSubscription,
  Playlist,
  Track,
  PlaylistItem,
  PlaylistItemsResponse,
  UserPlaylistsResponse,
  StreamResponse,
  StreamUrl,
  ManifestData,
  ContributorsResponse,
  Contributor,
} from "./types.js";

const API_BASE = "https://api.tidalhifi.com/v1";
export type AudioQuality = "HI_RES_LOSSLESS" | "HIGH";
const MAX_RETRIES = 3;
const RATE_LIMIT_WAIT = 20_000;

let token: TokenData;

export function setToken(t: TokenData): void {
  token = t;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token.accessToken}` };
}

function withCountry(params: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ countryCode: token.countryCode, ...params });
}

async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = `${API_BASE}/${path}?${withCountry(params)}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: authHeaders() });

    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 429) {
      console.warn(`Rate limited. Waiting ${RATE_LIMIT_WAIT / 1000}s...`);
      await sleep(RATE_LIMIT_WAIT);
      continue;
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    throw new Error(`API request failed: ${res.status} ${res.statusText} — ${path}`);
  }

  throw new Error(`Max retries exceeded for ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(): Promise<void> {
  return sleep(500 + Math.random() * 4500);
}

// --- User Info ---

export function getUserId(): number {
  return token.userId;
}

export async function getUserProfile(): Promise<UserProfile> {
  return apiGet<UserProfile>(`users/${token.userId}`);
}

export async function getUserSubscription(): Promise<UserSubscription> {
  return apiGet<UserSubscription>(`users/${token.userId}/subscription`);
}

export async function getUserPlaylists(): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const page = await apiGet<UserPlaylistsResponse>(
      `users/${token.userId}/playlists`,
      { limit: String(limit), offset: String(offset) }
    );

    playlists.push(...page.items);

    if (page.items.length < limit) break;
    offset += limit;
  }

  return playlists;
}

// --- Playlist ---

export async function getPlaylist(id: string): Promise<Playlist> {
  return apiGet<Playlist>(`playlists/${id}`);
}

export async function getPlaylistTracks(id: string): Promise<Track[]> {
  const tracks: Track[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const page = await apiGet<PlaylistItemsResponse>(`playlists/${id}/items`, {
      limit: String(limit),
      offset: String(offset),
    });

    for (const entry of page.items) {
      if (entry.type === "track") {
        tracks.push(entry.item);
      }
    }

    if (page.items.length < limit) break;
    offset += limit;
  }

  return tracks;
}

// --- Streams ---

export async function getStreamUrl(trackId: number, quality: AudioQuality = "HI_RES_LOSSLESS"): Promise<StreamUrl> {
  await randomDelay();

  const stream = await apiGet<StreamResponse>(
    `tracks/${trackId}/playbackinfopostpaywall`,
    {
      audioquality: quality,
      playbackmode: "STREAM",
      assetpresentation: "FULL",
    }
  );

  const manifestRaw = Buffer.from(stream.manifest, "base64").toString("utf-8");

  if (stream.manifestMimeType === "application/vnd.tidal.bts" ||
      stream.manifestMimeType === "application/vnd.tidal.bt") {
    const manifest: ManifestData = JSON.parse(manifestRaw);
    const codec = manifest.codecs;
    return {
      trackId: stream.trackId,
      codec,
      encryptionKey: manifest.keyId ?? "",
      urls: manifest.urls,
      fileExtension: getFileExtension(codec, stream.audioQuality),
      audioQuality: stream.audioQuality,
    };
  }

  if (stream.manifestMimeType === "application/dash+xml") {
    return parseMpd(manifestRaw, stream.trackId, stream.audioQuality);
  }

  throw new Error(`Unknown manifest type: ${stream.manifestMimeType}`);
}

function getFileExtension(codec: string, audioQuality: string): string {
  if (codec === "flac") {
    return ".flac";
  }
  if (codec.startsWith("mp4")) return ".m4a";
  if (codec.startsWith("ac4") || codec.startsWith("mha1")) return ".mp4";
  return ".m4a";
}

function parseMpd(xml: string, trackId: number, audioQuality: string): StreamUrl {
  const codecMatch = xml.match(/codecs="([^"]+)"/);
  const codec = codecMatch ? decodeXmlAttribute(codecMatch[1]) : "flac";

  const templateMatch = xml.match(/<SegmentTemplate\b([^>]*)>/);
  if (!templateMatch) throw new Error("No SegmentTemplate in MPD");

  const templateAttrs = parseXmlAttributes(templateMatch[1]);
  const urlTemplate = templateAttrs.media;
  if (!urlTemplate) throw new Error("No SegmentTemplate media attribute in MPD");

  const startNumber = templateAttrs.startNumber
    ? parseInt(templateAttrs.startNumber, 10)
    : 1;
  if (!Number.isFinite(startNumber)) {
    throw new Error("Invalid SegmentTemplate startNumber in MPD");
  }

  let segmentCount = 0;
  const sMatches = xml.matchAll(/<S\b([^>]*)\/?>/g);
  for (const match of sMatches) {
    const attrs = parseXmlAttributes(match[1]);
    const repeat = attrs.r ? parseInt(attrs.r, 10) : 0;
    if (!Number.isFinite(repeat) || repeat < 0) {
      throw new Error("Unsupported SegmentTimeline repeat count in MPD");
    }
    segmentCount += repeat + 1;
  }

  if (segmentCount === 0) {
    throw new Error("No media segments in MPD");
  }

  const urls: string[] = [];
  if (templateAttrs.initialization) {
    urls.push(templateAttrs.initialization);
  }

  for (let i = startNumber; i < startNumber + segmentCount; i++) {
    urls.push(urlTemplate.replace("$Number$", String(i)));
  }

  return {
    trackId,
    codec,
    encryptionKey: "",
    urls,
    fileExtension: getFileExtension(codec, audioQuality),
    audioQuality,
  };
}

function parseXmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const match of input.matchAll(/\s([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXmlAttribute(match[2]);
  }

  return attrs;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// --- Contributors ---

export async function getTrackContributors(trackId: number): Promise<Contributor[]> {
  try {
    const res = await apiGet<ContributorsResponse>(`tracks/${trackId}/contributors`);
    return res.items ?? [];
  } catch {
    return [];
  }
}

// --- Cover Art ---

export function getCoverUrl(imageId: string, size = 1280): string {
  const path = imageId.replace(/-/g, "/");
  return `https://resources.tidal.com/images/${path}/${size}x${size}.jpg`;
}

export async function downloadCover(imageId: string): Promise<Buffer | null> {
  try {
    const url = getCoverUrl(imageId);
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
