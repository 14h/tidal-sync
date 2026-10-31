export function playlistIdFromUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provide a valid Tidal playlist URL.");
  }

  const match = url.pathname.match(/^\/(?:browse\/)?playlist\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !(url.hostname === "tidal.com" || url.hostname.endsWith(".tidal.com")) ||
    !match
  ) {
    throw new Error("Provide a Tidal playlist URL, such as https://tidal.com/browse/playlist/<playlist-id>.");
  }

  return match[1];
}
