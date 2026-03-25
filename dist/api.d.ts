import type { TokenData, Playlist, Track, StreamUrl, Contributor } from "./types.js";
export declare function setToken(t: TokenData): void;
export declare function getPlaylist(id: string): Promise<Playlist>;
export declare function getPlaylistTracks(id: string): Promise<Track[]>;
export declare function getStreamUrl(trackId: number): Promise<StreamUrl>;
export declare function getTrackContributors(trackId: number): Promise<Contributor[]>;
export declare function getCoverUrl(imageId: string, size?: number): string;
export declare function downloadCover(imageId: string): Promise<Buffer | null>;
