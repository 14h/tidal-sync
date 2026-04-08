export interface TokenData {
  userId: number;
  countryCode: string;
  accessToken: string;
  refreshToken: string;
  expiresAfter: number; // Unix timestamp in ms
}

export interface DeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface Artist {
  id: number;
  name: string;
  type?: string;
  picture?: string;
}

export interface Album {
  id: number;
  title: string;
  releaseDate: string;
  numberOfTracks: number;
  numberOfVideos: number;
  numberOfVolumes: number;
  audioQuality: string;
  audioModes: string[];
  artists: Artist[];
  cover: string;
  copyright?: string;
}

export interface Track {
  id: number;
  title: string;
  duration: number;
  trackNumber: number;
  volumeNumber: number;
  version: string | null;
  isrc: string;
  explicit: boolean;
  audioQuality: string;
  copyright: string;
  artist: Artist;
  artists: Artist[];
  album: Album;
  streamReady: boolean;
  allowStreaming: boolean;
}

export interface Playlist {
  uuid: string;
  title: string;
  numberOfTracks: number;
  numberOfVideos: number;
  description: string;
  duration: number;
  image: string;
  squareImage: string;
}

export interface PlaylistItem {
  type: "track" | "video";
  item: Track;
}

export interface PlaylistItemsResponse {
  items: PlaylistItem[];
  totalNumberOfItems: number;
  offset: number;
  limit: number;
}

export interface StreamResponse {
  trackId: number;
  streamType: string;
  assetPresentation: string;
  audioMode: string;
  audioQuality: string;
  manifestMimeType: string;
  manifest: string; // base64 encoded
}

export interface ManifestData {
  mimeType: string;
  codecs: string;
  encryptionType?: string;
  keyId?: string;
  urls: string[];
}

export interface StreamUrl {
  trackId: number;
  codec: string;
  encryptionKey: string;
  urls: string[];
  fileExtension: string;
  audioQuality: string;
}

export interface Contributor {
  name: string;
  role: string;
}

export interface ContributorsResponse {
  items: Contributor[];
}

export interface UserPlaylistsResponse {
  items: Playlist[];
  totalNumberOfItems: number;
  offset: number;
  limit: number;
}
