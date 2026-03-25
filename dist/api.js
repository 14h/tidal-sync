const API_BASE = "https://api.tidalhifi.com/v1";
const MAX_RETRIES = 3;
const RATE_LIMIT_WAIT = 20_000;
let token;
export function setToken(t) {
    token = t;
}
function authHeaders() {
    return { Authorization: `Bearer ${token.accessToken}` };
}
function withCountry(params = {}) {
    return new URLSearchParams({ countryCode: token.countryCode, ...params });
}
async function apiGet(path, params) {
    const url = `${API_BASE}/${path}?${withCountry(params)}`;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers: authHeaders() });
        if (res.ok)
            return res.json();
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
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function randomDelay() {
    return sleep(500 + Math.random() * 4500);
}
// --- Playlist ---
export async function getPlaylist(id) {
    return apiGet(`playlists/${id}`);
}
export async function getPlaylistTracks(id) {
    const tracks = [];
    let offset = 0;
    const limit = 50;
    while (true) {
        const page = await apiGet(`playlists/${id}/items`, {
            limit: String(limit),
            offset: String(offset),
        });
        for (const entry of page.items) {
            if (entry.type === "track") {
                tracks.push(entry.item);
            }
        }
        if (page.items.length < limit)
            break;
        offset += limit;
    }
    return tracks;
}
// --- Streams ---
export async function getStreamUrl(trackId, quality = "HI_RES_LOSSLESS") {
    await randomDelay();
    const stream = await apiGet(`tracks/${trackId}/playbackinfopostpaywall`, {
        audioquality: quality,
        playbackmode: "STREAM",
        assetpresentation: "FULL",
    });
    const manifestRaw = Buffer.from(stream.manifest, "base64").toString("utf-8");
    if (stream.manifestMimeType === "application/vnd.tidal.bts" ||
        stream.manifestMimeType === "application/vnd.tidal.bt") {
        const manifest = JSON.parse(manifestRaw);
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
function getFileExtension(codec, audioQuality) {
    if (codec === "flac") {
        return audioQuality === "HI_RES_LOSSLESS" ? ".m4a" : ".flac";
    }
    if (codec.startsWith("mp4"))
        return ".m4a";
    if (codec.startsWith("ac4") || codec.startsWith("mha1"))
        return ".mp4";
    return ".m4a";
}
function parseMpd(xml, trackId, audioQuality) {
    const NS = "urn:mpeg:dash:schema:mpd:2011";
    // Extract codec
    const codecMatch = xml.match(/codecs="([^"]+)"/);
    const codec = codecMatch?.[1] ?? "flac";
    // Extract SegmentTemplate media URL pattern
    const mediaMatch = xml.match(/media="([^"]+)"/);
    if (!mediaMatch)
        throw new Error("No SegmentTemplate media attribute in MPD");
    const urlTemplate = mediaMatch[1];
    // Count segments from SegmentTimeline <S> elements
    const sMatches = [...xml.matchAll(/<S\s[^>]*?d="(\d+)"[^>]*?(?:r="(\d+)")?[^>]*?\/>/g)];
    let total = 0;
    for (const m of sMatches) {
        total += 1;
        if (m[2])
            total += parseInt(m[2], 10);
    }
    // Generate URLs: segment 0 is init, then 1..total
    const urls = [];
    for (let i = 0; i <= total; i++) {
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
// --- Contributors ---
export async function getTrackContributors(trackId) {
    try {
        const res = await apiGet(`tracks/${trackId}/contributors`);
        return res.items ?? [];
    }
    catch {
        return [];
    }
}
// --- Cover Art ---
export function getCoverUrl(imageId, size = 1280) {
    const path = imageId.replace(/-/g, "/");
    return `https://resources.tidal.com/images/${path}/${size}x${size}.jpg`;
}
export async function downloadCover(imageId) {
    try {
        const url = getCoverUrl(imageId);
        const res = await fetch(url);
        if (!res.ok)
            return null;
        return Buffer.from(await res.arrayBuffer());
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=api.js.map