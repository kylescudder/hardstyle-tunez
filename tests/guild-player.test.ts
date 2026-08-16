import { EventEmitter } from "node:events";
import type { Client } from "discord.js";
import type { Player } from "shoukaku";
import { describe, expect, it, vi } from "vitest";
import { GuildPlayer } from "../src/music/guild-player.js";
import type { QueuedTrack } from "../src/music/track.js";

class FakePlayer extends EventEmitter {
  readonly played: unknown[] = [];
  readonly paused: boolean[] = [];
  readonly volumes: number[] = [];

  async playTrack(options: unknown): Promise<void> {
    this.played.push(options);
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused.push(paused);
  }

  async setGlobalVolume(volume: number): Promise<void> {
    this.volumes.push(volume);
  }

  async stopTrack(): Promise<void> {}
}

const queuedTrack = (index: number): QueuedTrack => ({
  encoded: `encoded-${index}`,
  identifier: String(index),
  title: `Track ${index}`,
  author: "Artist",
  durationMs: 60_000,
  isStream: false,
  requesterId: "requester",
  retries: 0,
});

const makeGuildPlayer = () => {
  const player = new FakePlayer();
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue({ isSendable: () => false }) },
  } as unknown as Client;
  const onIdle = vi.fn().mockResolvedValue(undefined);
  const session = new GuildPlayer({
    guildId: "guild",
    voiceChannelId: "voice",
    textChannelId: "text",
    player: player as unknown as Player,
    client,
    volume: 50,
    onIdle,
  });
  return { session, player };
};

describe("GuildPlayer", () => {
  it("plays a FIFO queue and advances after a finished track", async () => {
    const { session, player } = makeGuildPlayer();
    await session.enqueue([queuedTrack(1), queuedTrack(2)], "text");
    expect(session.snapshot().current?.identifier).toBe("1");
    expect(
      session.snapshot().pending.map(({ identifier }) => identifier),
    ).toEqual(["2"]);

    player.emit("end", { reason: "finished" });
    await vi.waitFor(() =>
      expect(session.snapshot().current?.identifier).toBe("2"),
    );
    expect(player.played).toHaveLength(2);
    session.markDestroyed();
  });

  it("controls pause, resume, and 0-100 shared volume", async () => {
    const { session, player } = makeGuildPlayer();
    await session.enqueue([queuedTrack(1)], "text");
    await session.pause();
    await session.resume();
    await session.setVolume(0);
    await session.setVolume(100);

    expect(player.paused).toEqual([true, false]);
    expect(player.volumes).toEqual([0, 100]);
    expect(session.snapshot().volume).toBe(100);
    session.markDestroyed();
  });

  it("clears pending tracks when stopped", async () => {
    const { session, player } = makeGuildPlayer();
    await session.enqueue([queuedTrack(1), queuedTrack(2)], "text");
    await session.stop();
    player.emit("end", { reason: "stopped" });
    await vi.waitFor(() => expect(session.snapshot().current).toBeNull());
    expect(session.snapshot().pending).toEqual([]);
    session.markDestroyed();
  });
});
