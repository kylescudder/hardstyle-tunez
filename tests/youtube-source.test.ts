import { describe, expect, it, vi } from "vitest";
import { LoadType, type Node, type Track } from "shoukaku";
import {
  MAX_PLAYLIST_TRACKS,
  SourceInputError,
  resolveYouTube,
  toLavalinkIdentifier,
} from "../src/music/youtube-source.js";

const track = (identifier: string): Track => ({
  encoded: `encoded-${identifier}`,
  info: {
    identifier,
    isSeekable: true,
    author: "George Michael",
    length: 300_000,
    isStream: false,
    position: 0,
    title: `Track ${identifier}`,
    uri: `https://www.youtube.com/watch?v=${identifier}`,
    sourceName: "youtube",
  },
  pluginInfo: {},
});

describe("toLavalinkIdentifier", () => {
  it("turns free text into a YouTube Music search", () => {
    expect(toLavalinkIdentifier(" careless whisper ")).toBe(
      "ytmsearch:careless whisper",
    );
  });

  it.each([
    "https://youtube.com/watch?v=abc",
    "https://www.youtube.com/playlist?list=abc",
    "https://music.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
  ])("accepts trusted URL %s", (url) => {
    expect(toLavalinkIdentifier(url)).toBe(url);
  });

  it.each([
    "http://youtube.com/watch?v=abc",
    "https://youtube.com.evil.example/watch?v=abc",
    "https://127.0.0.1/audio",
    "ftp://youtube.com/file",
    "https://user:password@youtube.com/watch?v=abc",
  ])("rejects untrusted URL %s", (url) => {
    expect(() => toLavalinkIdentifier(url)).toThrow(SourceInputError);
  });
});

describe("resolveYouTube", () => {
  it("uses only the top search result", async () => {
    const resolve = vi.fn().mockResolvedValue({
      loadType: LoadType.SEARCH,
      data: [track("first"), track("second")],
    });
    const node = { rest: { resolve } } as unknown as Node;

    const result = await resolveYouTube(node, "careless whisper");

    expect(resolve).toHaveBeenCalledWith("ytmsearch:careless whisper");
    expect(result.tracks.map(({ info }) => info.identifier)).toEqual(["first"]);
  });

  it("caps playlist imports at 100 tracks", async () => {
    const tracks = Array.from({ length: 125 }, (_, index) =>
      track(String(index)),
    );
    const node = {
      rest: {
        resolve: vi.fn().mockResolvedValue({
          loadType: LoadType.PLAYLIST,
          data: {
            encoded: "",
            info: { name: "Playlist", selectedTrack: -1 },
            pluginInfo: {},
            tracks,
          },
        }),
      },
    } as unknown as Node;

    const result = await resolveYouTube(
      node,
      "https://youtube.com/playlist?list=abc",
    );

    expect(result.tracks).toHaveLength(MAX_PLAYLIST_TRACKS);
    expect(result.omitted).toBe(25);
  });

  it("reports an empty result", async () => {
    const node = {
      rest: {
        resolve: vi
          .fn()
          .mockResolvedValue({ loadType: LoadType.EMPTY, data: {} }),
      },
    } as unknown as Node;
    await expect(resolveYouTube(node, "not a song")).rejects.toThrow(
      "No playable",
    );
  });
});
