// End-to-end slash-command journey: the real interaction handlers, MusicManager,
// GuildPlayer and on-disk SettingsStore run together. Only the two network
// boundaries are replaced: the Discord gateway (an EventEmitter that emits
// interactions) and the Lavalink node/voice player.
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Events, type Client } from "discord.js";
import { LoadType, type Shoukaku, type Track } from "shoukaku";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerInteractionHandlers } from "../src/interactions.js";
import { MusicManager } from "../src/music/music-manager.js";
import { SettingsStore } from "../src/settings-store.js";

const GUILD = "guild-1";
const VOICE = "voice-1";
const OTHER_VOICE = "voice-2";
const TEXT = "text-1";

const track = (id: string, title: string): Track => ({
  encoded: `encoded-${id}`,
  info: {
    identifier: id,
    isSeekable: true,
    author: "Headhunterz",
    length: 240_000,
    isStream: false,
    position: 0,
    title,
    uri: `https://www.youtube.com/watch?v=${id}`,
    sourceName: "youtube",
  },
  pluginInfo: {},
});

class FakeVoicePlayer extends EventEmitter {
  readonly played: string[] = [];
  readonly paused: boolean[] = [];
  readonly volumes: number[] = [];
  async playTrack({ track }: { track: { encoded: string } }) {
    this.played.push(track.encoded);
    queueMicrotask(() => this.emit("start", {}));
  }
  async setPaused(paused: boolean) {
    this.paused.push(paused);
  }
  async setGlobalVolume(volume: number) {
    this.volumes.push(volume);
  }
  async stopTrack() {
    queueMicrotask(() => this.emit("end", { reason: "stopped" }));
  }
}

interface Reply {
  kind: string;
  payload: unknown;
}

const text = (reply: Reply | undefined): string => {
  const payload = reply?.payload as
    | string
    | {
        content?: string;
        embeds?: Array<{ title?: string; description?: string }>;
      }
    | undefined;
  if (typeof payload === "string") return payload;
  return [
    payload?.content ?? "",
    ...(payload?.embeds ?? []).map(
      (e) => `${e.title ?? ""} ${e.description ?? ""}`,
    ),
  ].join(" ");
};

describe("slash-command journey", () => {
  let directory: string;
  let gateway: EventEmitter;
  let voice: FakeVoicePlayer;
  let music: MusicManager;
  let announcements: unknown[];
  let memberChannel: string | null;
  const resolved = new Map<string, Track>([
    ["ytmsearch:the power of the dream", track("a1", "The Power Of The Dream")],
    ["ytmsearch:dragonborn", track("b2", "Dragonborn")],
  ]);

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "hardstyle-tunez-e2e-"));
    const settings = new SettingsStore(directory);
    await settings.load();
    announcements = [];
    memberChannel = VOICE;
    voice = new FakeVoicePlayer();
    gateway = new EventEmitter();
    const client = Object.assign(gateway, {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (message: unknown) => announcements.push(message),
        }),
      },
    }) as unknown as Client;
    const shoukaku = {
      getIdealNode: () => ({
        rest: {
          resolve: async (identifier: string) => {
            const hit = resolved.get(identifier);
            return hit
              ? { loadType: LoadType.SEARCH, data: [hit] }
              : { loadType: LoadType.EMPTY, data: {} };
          },
        },
      }),
      joinVoiceChannel: vi.fn(async () => voice),
      leaveVoiceChannel: vi.fn(async () => undefined),
    } as unknown as Shoukaku;
    music = new MusicManager(client, shoukaku, settings);
    registerInteractionHandlers(client, music);
  });

  afterEach(async () => {
    await music.disconnectAll();
    await rm(directory, { recursive: true, force: true });
  });

  const slash = async (
    commandName: string,
    options: Record<string, string | number> = {},
  ): Promise<Reply[]> => {
    const replies: Reply[] = [];
    const record = (kind: string) => async (payload: unknown) => {
      replies.push({ kind, payload });
      if (kind === "reply") interaction.replied = true;
      if (kind === "deferReply") interaction.deferred = true;
    };
    const interaction = {
      commandName,
      guildId: GUILD,
      channelId: TEXT,
      user: { id: "listener-1" },
      deferred: false,
      replied: false,
      guild: {
        id: GUILD,
        shardId: 0,
        members: {
          fetch: async () => ({ voice: { channelId: memberChannel } }),
        },
      },
      options: {
        getString: (name: string) => options[name] as string,
        getInteger: (name: string) => options[name] as number,
      },
      isChatInputCommand: () => true,
      isButton: () => false,
      reply: record("reply"),
      deferReply: record("deferReply"),
      editReply: record("editReply"),
      followUp: record("followUp"),
      deleteReply: record("deleteReply"),
    };
    gateway.emit(Events.InteractionCreate, interaction);
    await vi.waitFor(() =>
      expect(
        replies.some((r) =>
          ["reply", "followUp", "editReply"].includes(r.kind),
        ),
      ).toBe(true),
    );
    // Let the remaining awaited calls (e.g. deleteReply) settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return replies;
  };

  it("queues, controls and stops playback for a listener in the voice channel", async () => {
    const first = await slash("play", { query: "the power of the dream" });
    expect(first.map((r) => r.kind)).toEqual([
      "deferReply",
      "followUp",
      "deleteReply",
    ]);
    expect(text(first[1])).toContain("The Power Of The Dream");
    expect(voice.played).toEqual(["encoded-a1"]);
    await vi.waitFor(() => expect(announcements).toHaveLength(1));

    await slash("play", { query: "dragonborn" });
    expect(voice.played).toEqual(["encoded-a1"]);

    const queue = await slash("queue");
    expect(text(queue[0])).toContain("Dragonborn");

    expect(text((await slash("pause"))[0])).toBe("Playback paused.");
    expect(text((await slash("resume"))[0])).toBe("Playback resumed.");
    expect(voice.paused).toEqual([true, false]);

    expect(text((await slash("volume", { percent: 35 }))[0])).toContain("35%");
    expect(voice.volumes).toEqual([35]);
    const saved = JSON.parse(
      await readFile(path.join(directory, "settings.json"), "utf8"),
    );
    expect(saved.guilds[GUILD].volume).toBe(35);

    expect(text((await slash("skip"))[0])).toBe("Skipped the current track.");
    await vi.waitFor(() =>
      expect(voice.played).toEqual(["encoded-a1", "encoded-b2"]),
    );
    expect(text((await slash("now-playing"))[0])).toContain("Dragonborn");

    expect(text((await slash("stop"))[0])).toBe(
      "Playback stopped and the queue was cleared.",
    );
    await vi.waitFor(async () =>
      expect(text((await slash("now-playing"))[0])).toBe(
        "Nothing is currently playing in this server.",
      ),
    );
  });

  it("refuses control from another voice channel and explains unusable requests", async () => {
    memberChannel = null;
    const notInVoice = await slash("play", { query: "dragonborn" });
    expect(text(notInVoice.at(-1))).toBe(
      "Join a voice channel before using this command.",
    );

    memberChannel = VOICE;
    await slash("play", { query: "dragonborn" });

    memberChannel = OTHER_VOICE;
    const elsewhere = await slash("pause");
    expect(text(elsewhere[0])).toBe(`Join <#${VOICE}> to control playback.`);
    expect(voice.paused).toEqual([]);

    memberChannel = VOICE;
    const unknown = await slash("play", { query: "no such song" });
    expect(text(unknown.at(-1))).toBe("No playable YouTube result was found.");

    const insecure = await slash("play", {
      query: "http://youtube.com/watch?v=x",
    });
    expect(text(insecure.at(-1))).toContain("Only HTTPS URLs");
    expect(voice.played).toEqual(["encoded-b2"]);
  });
});
