// Line-delimited JSON bridge for the native macOS app. Tokens never cross this bridge.
import { loadToken, getDeviceCode, pollForToken, logout } from "./auth.js";
import { setToken, getLibraryPlaylists, getPlaylist, getPlaylistTracks, addPlaylistToLibrary, searchTracks, getTrack } from "./api.js";
import { syncAllPlaylists } from "./sync.js";
import { playlistIdFromUrl } from "./playlist.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { downloadTracks, findNewTracks } from "./download.js";

const folderName = (name: string): string => name.replace(/[<>:"/\\|?*]/g, "_").trim() || "Playlist";
const playlistInfo = (p: { uuid: string; title: string; numberOfTracks: number }) =>
  ({ id: p.uuid, title: p.title, count: p.numberOfTracks });
const validateId = (id: string): void => { playlistIdFromUrl(`https://tidal.com/playlist/${id}`); };

const emit = (type: string, data: Record<string, unknown> = {}): void => {
  process.stdout.write(JSON.stringify({ type, ...data }) + "\n");
};
for (const method of ["log", "warn", "error"] as const) {
  console[method] = (...args: unknown[]) => emit("log", { message: args.map(String).join(" ").replace(/\x1b\[[0-9;]*m/g, "") });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "logout") {
    await logout();
    emit("signedOut");
    return;
  }
  // Validate before triggering login or network requests.
  const playlistId = ["url", "add"].includes(command) ? playlistIdFromUrl(args[0] ?? "") : undefined;
  if (["url", "sync", "download"].includes(command)) {
    try {
      await promisify(execFile)("ffmpeg", ["-version"]);
    } catch {
      throw new Error("FFmpeg is required. Install it with brew install ffmpeg, then try again.");
    }
  }
  let token = await loadToken();
  if (!token && command === "status") {
    emit("signedOut");
    return;
  }
  if (!token) {
    const device = await getDeviceCode();
    const raw = (device.verificationUriComplete ||
      `${device.verificationUri.replace(/\/$/, "")}/${encodeURIComponent(device.userCode)}`).trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
    emit("authorization", { url: url.href, code: device.userCode });
    token = await pollForToken(device.deviceCode, device.interval, device.expiresIn);
  }
  setToken(token);
  emit("authenticated");
  if (["status", "login", "list"].includes(command)) {
    const playlists = await getLibraryPlaylists();
    emit("playlists", { playlists: playlists.map(playlistInfo) });
  } else if (command === "add") {
    const playlist = await getPlaylist(playlistId!);
    await addPlaylistToLibrary(playlistId!);
    emit("playlistAdded", { playlist: playlistInfo(playlist) });
  } else if (command === "tracks") {
    if (!args[0]) throw new Error("Choose a download folder.");
    const songs = [];
    for (const id of args.slice(1)) {
      validateId(id);
      const playlist = await getPlaylist(id);
      const tracks = [...new Map((await getPlaylistTracks(id)).map(t => [t.id, t])).values()];
      const pending = new Set((await findNewTracks(tracks, join(args[0], folderName(playlist.title)))).map(t => t.id));
      for (const t of tracks) songs.push({
        id: `${id}:${t.id}`, trackId: t.id, title: t.title,
        artist: t.artists?.map(a => a.name).join(", ") || t.artist?.name || "",
        album: t.album?.title || "", duration: t.duration,
        playlistId: id, playlistTitle: playlist.title, downloaded: !pending.has(t.id),
      });
    }
    emit("songs", { songs });
  } else if (command === "search") {
    const query = args[0]?.trim();
    if (!query || !args[1]) throw new Error("Enter a song or artist and choose a download folder.");
    const tracks = [...new Map((await searchTracks(query)).map(t => [t.id, t])).values()];
    const pending = new Set((await findNewTracks(tracks, join(args[1], "Tracks"))).map(t => t.id));
    emit("songs", { query, songs: tracks.map(t => ({
      id: `tidal:${t.id}`, trackId: t.id, title: t.title,
      artist: t.artists?.map(a => a.name).join(", ") || t.artist?.name || "",
      album: t.album?.title || "", duration: t.duration,
      playlistId: "", playlistTitle: "", downloaded: !pending.has(t.id),
    })) });
  } else if (command === "download") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input) as {
      folder: string; playlists: { id: string; trackIds: number[] }[]; trackIds?: number[];
    };
    if (!request.folder || (!request.playlists?.length && !request.trackIds?.length)) throw new Error("Select songs to download.");
    const plans = [];
    for (const entry of request.playlists ?? []) {
      validateId(entry.id);
      const playlist = await getPlaylist(entry.id);
      const wanted = new Set(entry.trackIds);
      const tracks = [...new Map((await getPlaylistTracks(entry.id)).filter(t => wanted.has(t.id)).map(t => [t.id, t])).values()];
      const folder = join(request.folder, folderName(playlist.title));
      plans.push({ playlist, folder, tracks: await findNewTracks(tracks, folder) });
    }
    if (request.trackIds?.length) {
      const tracks = [];
      for (const id of new Set(request.trackIds)) tracks.push(await getTrack(id));
      const folder = join(request.folder, "Tracks");
      plans.push({ playlist: { title: "Tracks" }, folder, tracks: await findNewTracks(tracks, folder) });
    }
    const total = plans.reduce((n, p) => n + p.tracks.length, 0);
    let completed = 0, downloaded = 0, failed = 0;
    emit("progress", { completed, total });
    for (const plan of plans) {
      emit("log", { message: plan.playlist.title });
      const result = await downloadTracks(plan.tracks, plan.folder, plan.playlist.title, completed, total,
        "HI_RES_LOSSLESS", count => emit("progress", { completed: completed + count, total }));
      completed += result.downloaded + result.failed;
      downloaded += result.downloaded;
      failed += result.failed;
    }
    emit("summary", { downloaded, failed });
  } else if (command === "url") {
    if (!args[1]) throw new Error("Choose a download folder.");
    await syncAllPlaylists(args[1], { playlistId, selectPlaylists: false,
      onProgress: (completed, total) => emit("progress", { completed, total }) });
  } else if (command === "sync") {
    if (!args[0] || args.length < 2) throw new Error("Choose a folder and at least one playlist.");
    for (const id of args.slice(1)) {
      playlistIdFromUrl(`https://tidal.com/playlist/${id}`);
      await syncAllPlaylists(args[0], { playlistId: id, selectPlaylists: false,
        onProgress: (completed, total) => emit("progress", { completed, total }) });
    }
  } else {
    throw new Error("Unknown desktop command.");
  }
}

main().then(() => emit("complete")).catch(err => {
  emit("failure", { message: (err as Error).message });
  process.exitCode = 1;
});
