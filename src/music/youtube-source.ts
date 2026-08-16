import { LoadType, type Node, type Track } from "shoukaku";

export const MAX_PLAYLIST_TRACKS = 100;
export const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export class SourceInputError extends Error {}
export class SourceUnavailableError extends Error {}

export interface ResolvedTracks {
  tracks: Track[];
  sourceLabel: string;
  omitted: number;
}

export const toLavalinkIdentifier = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new SourceInputError("Enter a song name or YouTube URL.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
      throw new SourceInputError("Only trusted YouTube URLs are supported.");
    }
    return `ytmsearch:${trimmed}`;
  }

  if (
    url.protocol !== "https:" ||
    !ALLOWED_YOUTUBE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new SourceInputError(
      "Only HTTPS URLs from youtube.com, music.youtube.com, or youtu.be are supported.",
    );
  }
  if (url.username || url.password) {
    throw new SourceInputError("YouTube URLs cannot contain credentials.");
  }
  return url.toString();
};

export const resolveYouTube = async (
  node: Node,
  input: string,
): Promise<ResolvedTracks> => {
  const identifier = toLavalinkIdentifier(input);
  let result;
  try {
    result = await node.rest.resolve(identifier);
  } catch (error) {
    throw new SourceUnavailableError(
      "The playback service could not resolve that request.",
      {
        cause: error,
      },
    );
  }

  if (!result || result.loadType === LoadType.EMPTY) {
    throw new SourceInputError("No playable YouTube result was found.");
  }
  if (result.loadType === LoadType.ERROR) {
    throw new SourceUnavailableError(
      result.data.message || "YouTube could not load that request.",
    );
  }
  if (result.loadType === LoadType.TRACK) {
    return {
      tracks: [result.data],
      sourceLabel: result.data.info.title,
      omitted: 0,
    };
  }
  if (result.loadType === LoadType.SEARCH) {
    const first = result.data[0];
    if (!first)
      throw new SourceInputError("No playable YouTube result was found.");
    return { tracks: [first], sourceLabel: first.info.title, omitted: 0 };
  }

  const tracks = result.data.tracks.slice(0, MAX_PLAYLIST_TRACKS);
  if (tracks.length === 0)
    throw new SourceInputError("That playlist contains no playable tracks.");
  return {
    tracks,
    sourceLabel: result.data.info.name,
    omitted: Math.max(0, result.data.tracks.length - tracks.length),
  };
};
