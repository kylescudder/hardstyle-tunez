export class MusicError extends Error {}

export class PlaybackUnavailableError extends MusicError {
  constructor() {
    super("Playback is temporarily unavailable. Lavalink is not connected.");
  }
}

export class VoiceOwnershipError extends MusicError {
  constructor(public readonly channelId: string) {
    super(`I am already active in <#${channelId}>.`);
  }
}

export class QueueCapacityError extends MusicError {
  constructor(public readonly available: number) {
    super(
      available === 0
        ? "This server's 500-track queue is full."
        : `Only ${available} more track${available === 1 ? "" : "s"} fit in this server's queue.`,
    );
  }
}

export class NothingPlayingError extends MusicError {
  constructor() {
    super("Nothing is currently playing in this server.");
  }
}
