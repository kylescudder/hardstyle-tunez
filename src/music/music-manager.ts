import type { Client, Guild } from "discord.js";
import type { Shoukaku } from "shoukaku";
import { log, logError } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";
import { GuildPlayer } from "./guild-player.js";
import {
  NothingPlayingError,
  PlaybackUnavailableError,
  QueueCapacityError,
  VoiceOwnershipError,
} from "./errors.js";
import type { QueuedTrack } from "./track.js";
import { toQueuedTrack } from "./track.js";
import { resolveYouTube, type ResolvedTracks } from "./youtube-source.js";

export const MAX_QUEUE_TRACKS = 500;

export interface EnqueueResult {
  added: QueuedTrack[];
  omitted: number;
  pending: number;
}

export class MusicManager {
  readonly #client: Client;
  readonly #shoukaku: Shoukaku;
  readonly #settings: SettingsStore;
  readonly #players = new Map<string, GuildPlayer>();
  readonly #locks = new Map<string, Promise<void>>();

  constructor(client: Client, shoukaku: Shoukaku, settings: SettingsStore) {
    this.#client = client;
    this.#shoukaku = shoukaku;
    this.#settings = settings;
  }

  get(guildId: string): GuildPlayer | undefined {
    return this.#players.get(guildId);
  }

  async resolveAndEnqueue(
    guild: Guild,
    voiceChannelId: string,
    textChannelId: string,
    requesterId: string,
    input: string,
  ): Promise<EnqueueResult> {
    const node = this.#shoukaku.getIdealNode();
    if (!node) throw new PlaybackUnavailableError();
    const resolved = await resolveYouTube(node, input);

    return this.#withLock(guild.id, async () => {
      let session = this.#players.get(guild.id);
      if (session && session.voiceChannelId !== voiceChannelId) {
        throw new VoiceOwnershipError(session.voiceChannelId);
      }
      const available = MAX_QUEUE_TRACKS - (session?.size ?? 0);
      if (resolved.tracks.length > available)
        throw new QueueCapacityError(available);

      if (!session) {
        const player = await this.#shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannelId,
          shardId: guild.shardId,
          deaf: true,
        });
        session = new GuildPlayer({
          guildId: guild.id,
          voiceChannelId,
          textChannelId,
          player,
          client: this.#client,
          volume: this.#settings.getVolume(guild.id),
          onIdle: (guildId) => this.disconnect(guildId),
        });
        this.#players.set(guild.id, session);
      }

      const tracks = this.#convert(resolved, requesterId);
      await session.enqueue(tracks, textChannelId);
      return {
        added: tracks,
        omitted: resolved.omitted,
        pending: session.snapshot().pending.length,
      };
    });
  }

  require(guildId: string): GuildPlayer {
    const player = this.#players.get(guildId);
    if (!player) throw new NothingPlayingError();
    return player;
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    const session = this.require(guildId);
    await session.setVolume(volume);
    await this.#settings.setVolume(guildId, volume);
  }

  updateAudience(guildId: string, hasHumans: boolean): void {
    this.#players.get(guildId)?.updateAudience(hasHumans);
  }

  async disconnect(guildId: string): Promise<void> {
    const session = this.#players.get(guildId);
    if (!session) return;
    session.markDestroyed();
    this.#players.delete(guildId);
    try {
      await this.#shoukaku.leaveVoiceChannel(guildId);
      log("info", "voice_disconnected", { guildId });
    } catch (error) {
      logError("voice_disconnect_failed", error, { guildId });
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      [...this.#players.keys()].map((guildId) => this.disconnect(guildId)),
    );
  }

  #convert(resolved: ResolvedTracks, requesterId: string): QueuedTrack[] {
    return resolved.tracks.map((track) => toQueuedTrack(track, requesterId));
  }

  async #withLock<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.#locks.set(guildId, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(guildId) === chain) this.#locks.delete(guildId);
    }
  }
}
