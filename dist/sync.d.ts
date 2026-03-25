interface PlaylistsConfig {
    [name: string]: string;
}
export declare function loadConfig(configPath: string): Promise<PlaylistsConfig>;
export declare function addPlaylist(configPath: string, playlistName: string, playlistUrl: string): Promise<void>;
export declare function syncPlaylists(configPath: string, outputDir: string): Promise<void>;
export {};
