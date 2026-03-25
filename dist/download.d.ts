import type { AudioQuality } from "./api.js";
import type { Track } from "./types.js";
export declare function findNewTracks(tracks: Track[], folder: string): Promise<Track[]>;
export declare function downloadTracks(tracks: Track[], folder: string, playlistName: string, globalOffset: number, globalTotal: number, quality?: AudioQuality): Promise<{
    downloaded: number;
    failed: number;
}>;
