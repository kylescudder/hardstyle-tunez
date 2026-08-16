import {
  Events,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Interaction,
} from "discord.js";
import { log, logError } from "./logger.js";
import { MusicError, NothingPlayingError } from "./music/errors.js";
import type { MusicManager } from "./music/music-manager.js";
import {
  nowPlayingEmbed,
  queuedEmbed,
  queueView,
} from "./music/presentation.js";
import {
  SourceInputError,
  SourceUnavailableError,
} from "./music/youtube-source.js";

class UserInputError extends Error {}

const userMessage = (error: unknown): string => {
  if (
    error instanceof UserInputError ||
    error instanceof MusicError ||
    error instanceof SourceInputError ||
    error instanceof SourceUnavailableError
  ) {
    return error.message;
  }
  if (error instanceof Error && error.message === "nothing is playing") {
    return "Nothing is currently playing in this server.";
  }
  return "Something went wrong while handling that command.";
};

const replyError = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  error: unknown,
): Promise<void> => {
  const payload = {
    content: userMessage(error),
    flags: MessageFlags.Ephemeral,
  } as const;
  if (interaction.deferred)
    await interaction.editReply({ content: payload.content });
  else if (interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
};

const guildMember = async (
  interaction: ChatInputCommandInteraction,
): Promise<GuildMember> => {
  if (!interaction.guild)
    throw new UserInputError("Music commands can only be used in a server.");
  return interaction.guild.members.fetch(interaction.user.id);
};

const memberVoiceChannel = async (
  interaction: ChatInputCommandInteraction,
): Promise<string> => {
  const member = await guildMember(interaction);
  if (!member.voice.channelId) {
    throw new UserInputError("Join a voice channel before using this command.");
  }
  return member.voice.channelId;
};

const requireSameVoice = async (
  interaction: ChatInputCommandInteraction,
  music: MusicManager,
) => {
  if (!interaction.guildId)
    throw new UserInputError("Music commands can only be used in a server.");
  const session = music.require(interaction.guildId);
  const memberChannelId = await memberVoiceChannel(interaction);
  if (memberChannelId !== session.voiceChannelId) {
    throw new UserInputError(
      `Join <#${session.voiceChannelId}> to control playback.`,
    );
  }
  return session;
};

const handlePlay = async (
  interaction: ChatInputCommandInteraction,
  music: MusicManager,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guild)
    throw new UserInputError("Music commands can only be used in a server.");
  const voiceChannelId = await memberVoiceChannel(interaction);
  const query = interaction.options.getString("query", true);
  const result = await music.resolveAndEnqueue(
    interaction.guild,
    voiceChannelId,
    interaction.channelId,
    interaction.user.id,
    query,
  );
  await interaction.followUp({
    embeds: [queuedEmbed(result.added, result.pending, result.omitted)],
  });
  await interaction.deleteReply();
};

const handleCommand = async (
  interaction: ChatInputCommandInteraction,
  music: MusicManager,
): Promise<void> => {
  const startedAt = performance.now();
  log("info", "command_received", {
    command: interaction.commandName,
    guildId: interaction.guildId,
  });
  try {
    switch (interaction.commandName) {
      case "play":
        await handlePlay(interaction, music);
        break;
      case "pause": {
        const session = await requireSameVoice(interaction, music);
        await session.pause();
        await interaction.reply("Playback paused.");
        break;
      }
      case "resume": {
        const session = await requireSameVoice(interaction, music);
        await session.resume();
        await interaction.reply("Playback resumed.");
        break;
      }
      case "skip": {
        const session = await requireSameVoice(interaction, music);
        await session.skip();
        await interaction.reply("Skipped the current track.");
        break;
      }
      case "stop": {
        const session = await requireSameVoice(interaction, music);
        await session.stop();
        await interaction.reply("Playback stopped and the queue was cleared.");
        break;
      }
      case "volume": {
        const session = await requireSameVoice(interaction, music);
        const volume = interaction.options.getInteger("percent", true);
        await music.setVolume(interaction.guildId!, volume);
        await interaction.reply(
          `Shared volume set to **${volume}%**. Each listener can also adjust my user volume locally.`,
        );
        void session;
        break;
      }
      case "queue": {
        if (!interaction.guildId)
          throw new UserInputError(
            "Music commands can only be used in a server.",
          );
        const snapshot = music.require(interaction.guildId).snapshot();
        await interaction.reply(
          queueView(snapshot.current, snapshot.pending, interaction.user.id, 0),
        );
        break;
      }
      case "now-playing": {
        if (!interaction.guildId)
          throw new UserInputError(
            "Music commands can only be used in a server.",
          );
        const snapshot = music.require(interaction.guildId).snapshot();
        if (!snapshot.current) throw new NothingPlayingError();
        await interaction.reply({
          embeds: [nowPlayingEmbed(snapshot.current, snapshot.pending.length)],
        });
        break;
      }
      default:
        throw new UserInputError("Unknown command.");
    }
    log("info", "command_completed", {
      command: interaction.commandName,
      guildId: interaction.guildId,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    logError("command_failed", error, {
      command: interaction.commandName,
      guildId: interaction.guildId,
      durationMs: Math.round(performance.now() - startedAt),
    });
    await replyError(interaction, error);
  }
};

const handleQueueButton = async (
  interaction: ButtonInteraction,
  music: MusicManager,
): Promise<void> => {
  const parts = interaction.customId.split(":");
  if (parts[0] !== "queue" || parts.length !== 3) return;
  const ownerId = parts[1];
  const page = Number.parseInt(parts[2] ?? "0", 10);
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content:
        "Only the person who opened this queue can use its page buttons.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!interaction.guildId)
    throw new UserInputError("This queue is no longer available.");
  const snapshot = music.require(interaction.guildId).snapshot();
  await interaction.update(
    queueView(snapshot.current, snapshot.pending, ownerId, page),
  );
};

export const registerInteractionHandlers = (
  client: Client,
  music: MusicManager,
): void => {
  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleCommand(interaction, music);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("queue:")) {
      void handleQueueButton(interaction, music).catch(
        async (error: unknown) => {
          logError("queue_button_failed", error, {
            guildId: interaction.guildId,
          });
          await replyError(interaction, error);
        },
      );
    }
  });
};
