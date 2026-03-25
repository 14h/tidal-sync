import type { Track } from "./types.js";
export declare function findNewTracks(tracks: Track[], folder: string): Promise<Track[]>;
/**
 * Download a list of tracks into a folder.
 * Returns counts of downloaded and failed tracks.
 *
 * @param globalOffset - number of tracks already downloaded across all playlists (for global counter)
 * @param globalTotal - total tracks to download across all playlists
 */
export declare function downloadTracks(tracks: Track[], folder: string, playlistName: string, globalOffset: number, globalTotal: number): Promise<{
    downloaded: number;
    failed: number;
}>;
