import type { APIEmbed, Client } from "discord.js";
import type { Player } from "shoukaku";
import { log, logError } from "../logger.js";
import { failureEmbed, nowPlayingEmbed } from "./presentation.js";
import type { QueuedTrack } from "./track.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1_000;

type IdleReason = "empty_queue" | "no_humans";

export interface QueueSnapshot {
  current: QueuedTrack | null;
  pending: readonly QueuedTrack[];
  volume: number;
  paused: boolean;
  voiceChannelId: string;
}

interface GuildPlayerOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  player: Player;
  client: Client;
  volume: number;
  onIdle: (guildId: string) => Promise<void>;
}

export class GuildPlayer {
  readonly guildId: string;
  readonly voiceChannelId: string;
  #textChannelId: string;
  readonly #player: Player;
  readonly #client: Client;
  readonly #onIdle: (guildId: string) => Promise<void>;
  #queue: QueuedTrack[] = [];
  #current: QueuedTrack | null = null;
  #volume: number;
  #paused = false;
  #idleTimer: NodeJS.Timeout | null = null;
  #idleReason: IdleReason | null = null;
  #manualTransition: "skip" | "stop" | null = null;
  #destroyed = false;

  constructor(options: GuildPlayerOptions) {
    this.guildId = options.guildId;
    this.voiceChannelId = options.voiceChannelId;
    this.#textChannelId = options.textChannelId;
    this.#player = options.player;
    this.#client = options.client;
    this.#volume = options.volume;
    this.#onIdle = options.onIdle;
    this.#bindEvents();
  }

  get size(): number {
    return this.#queue.length + (this.#current ? 1 : 0);
  }

  snapshot(): QueueSnapshot {
    return {
      current: this.#current,
      pending: [...this.#queue],
      volume: this.#volume,
      paused: this.#paused,
      voiceChannelId: this.voiceChannelId,
    };
  }

  async enqueue(tracks: QueuedTrack[], textChannelId: string): Promise<void> {
    if (this.#destroyed) throw new Error("player has been destroyed");
    this.#textChannelId = textChannelId;
    this.#queue.push(...tracks);
    this.#cancelIdle("empty_queue");
    if (!this.#current) await this.#playNext();
  }

  async pause(): Promise<void> {
    if (!this.#current) throw new Error("nothing is playing");
    await this.#player.setPaused(true);
    this.#paused = true;
  }

  async resume(): Promise<void> {
    if (!this.#current) throw new Error("nothing is playing");
    await this.#player.setPaused(false);
    this.#paused = false;
  }

  async skip(): Promise<void> {
    if (!this.#current) throw new Error("nothing is playing");
    this.#manualTransition = "skip";
    try {
      await this.#player.stopTrack();
    } catch (error) {
      this.#manualTransition = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#queue = [];
    this.#paused = false;
    if (this.#current) {
      this.#manualTransition = "stop";
      try {
        await this.#player.stopTrack();
      } catch (error) {
        this.#manualTransition = null;
        throw error;
      }
    } else {
      this.#scheduleIdle("empty_queue");
    }
  }

  async setVolume(volume: number): Promise<void> {
    await this.#player.setGlobalVolume(volume);
    this.#volume = volume;
  }

  updateAudience(hasHumanListeners: boolean): void {
    if (hasHumanListeners) {
      this.#cancelIdle("no_humans");
      if (!this.#current && this.#queue.length === 0)
        this.#scheduleIdle("empty_queue");
    } else {
      this.#scheduleIdle("no_humans");
    }
  }

  markDestroyed(): void {
    this.#destroyed = true;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #bindEvents(): void {
    this.#player.on("start", () => {
      const current = this.#current;
      if (!current) return;
      this.#paused = false;
      log("info", "track_started", {
        guildId: this.guildId,
        isStream: current.isStream,
      });
      void this.#sendEmbed(nowPlayingEmbed(current, this.#queue.length));
    });

    this.#player.on("end", (event) => {
      void this.#handleEnd(event.reason);
    });

    this.#player.on("exception", (event) => {
      log("warn", "track_exception", {
        guildId: this.guildId,
        severity: event.exception.severity,
      });
    });

    this.#player.on("stuck", (event) => {
      log("warn", "track_stuck", {
        guildId: this.guildId,
        thresholdMs: event.thresholdMs,
      });
    });

    this.#player.on("closed", (event) => {
      log("warn", "voice_websocket_closed", {
        guildId: this.guildId,
        code: event.code,
      });
    });
  }

  async #handleEnd(reason: string): Promise<void> {
    if (this.#destroyed) return;
    const transition = this.#manualTransition;
    this.#manualTransition = null;

    if (transition === "stop") {
      this.#current = null;
      this.#scheduleIdle("empty_queue");
      return;
    }
    if (transition === "skip") {
      this.#current = null;
      await this.#playNext();
      return;
    }
    if (reason === "replaced") return;

    if (reason === "loadFailed" || reason === "cleanup") {
      await this.#retryOrFail();
      return;
    }

    this.#current = null;
    await this.#playNext();
  }

  async #retryOrFail(): Promise<void> {
    const failed = this.#current;
    if (!failed) return;
    if (failed.retries < 1) {
      failed.retries += 1;
      log("warn", "track_retry", { guildId: this.guildId });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      try {
        await this.#playCurrent();
        return;
      } catch (error) {
        logError("track_retry_failed", error, { guildId: this.guildId });
      }
    }
    await this.#sendEmbed(failureEmbed(failed));
    this.#current = null;
    await this.#playNext();
  }

  async #playNext(): Promise<void> {
    const next = this.#queue.shift();
    if (!next) {
      this.#current = null;
      this.#scheduleIdle("empty_queue");
      return;
    }
    this.#current = next;
    try {
      await this.#playCurrent();
    } catch (error) {
      logError("track_start_failed", error, { guildId: this.guildId });
      await this.#retryOrFail();
    }
  }

  async #playCurrent(): Promise<void> {
    if (!this.#current) return;
    await this.#player.playTrack({
      track: { encoded: this.#current.encoded },
      volume: this.#volume,
    });
  }

  #scheduleIdle(reason: IdleReason): void {
    if (this.#destroyed || this.#idleTimer) return;
    this.#idleReason = reason;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      log("info", "player_idle_disconnect", {
        guildId: this.guildId,
        reason: this.#idleReason,
      });
      void this.#onIdle(this.guildId);
    }, IDLE_TIMEOUT_MS);
    this.#idleTimer.unref();
  }

  #cancelIdle(reason: IdleReason): void {
    if (this.#idleReason !== reason || !this.#idleTimer) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#idleReason = null;
  }

  async #sendEmbed(embed: APIEmbed): Promise<void> {
    try {
      const channel = await this.#client.channels.fetch(this.#textChannelId);
      if (channel?.isSendable()) await channel.send({ embeds: [embed] });
    } catch (error) {
      logError("channel_message_failed", error, { guildId: this.guildId });
    }
  }
}
