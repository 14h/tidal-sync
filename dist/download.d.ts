import type { Playlist, Track } from "./types.js";
export declare function downloadPlaylist(playlist: Playlist, tracks: Track[], outputDir: string): Promise<void>;
