import { describe, expect, it } from "vitest";
import { queueView } from "../src/music/presentation.js";
import type { QueuedTrack } from "../src/music/track.js";

const queuedTrack = (index: number): QueuedTrack => ({
  encoded: `encoded-${index}`,
  identifier: String(index),
  title: `Track ${index}`,
  author: "Artist",
  uri: `https://youtube.com/watch?v=${index}`,
  durationMs: 60_000,
  isStream: false,
  requesterId: "requester",
  retries: 0,
});

describe("queueView", () => {
  it("paginates ten tracks and binds controls to their owner", () => {
    const tracks = Array.from({ length: 21 }, (_, index) => queuedTrack(index));
    const view = queueView(null, tracks, "owner-1", 1);
    const embed = view.embeds[0]!;
    const row = view.components[0]!.toJSON();

    expect(embed.description).toContain("**11.**");
    expect(embed.description).toContain("**20.**");
    expect(embed.description).not.toContain("**21.**");
    expect(embed.footer?.text).toContain("Page 2/3");
    expect(
      row.components.map(
        (component) => "custom_id" in component && component.custom_id,
      ),
    ).toEqual(["queue:owner-1:0", "queue:owner-1:2"]);
  });
});
