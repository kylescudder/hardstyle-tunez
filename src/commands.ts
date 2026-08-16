import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play or queue a YouTube song, playlist, or livestream")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name or trusted YouTube URL")
        .setRequired(true)
        .setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current track"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the paused track"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the server's music queue"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the shared playback volume")
    .addIntegerOption((option) =>
      option
        .setName("percent")
        .setDescription("Shared volume from 0 to 100 percent")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder()
    .setName("now-playing")
    .setDescription("Show the current track"),
].map((command) => command.setDMPermission(false));

export const commandData = commandBuilders.map((command) => command.toJSON());
