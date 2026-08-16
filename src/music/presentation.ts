import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  type APIEmbed,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { QueuedTrack } from "./track.js";
import { formatDuration } from "./track.js";

const BRAND_COLOR = 0xff_4f_9a;
export const QUEUE_PAGE_SIZE = 10;

const safeTitle = (title: string, maximum = 80): string => {
  const shortened =
    title.length <= maximum ? title : `${title.slice(0, maximum - 1)}…`;
  return escapeMarkdown(shortened);
};

export const nowPlayingEmbed = (
  track: QueuedTrack,
  pendingTracks: number,
): APIEmbed => {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("Now playing")
    .setDescription(
      `**${safeTitle(track.title, 180)}**\n${safeTitle(track.author, 120)}`,
    )
    .addFields(
      {
        name: "Duration",
        value: formatDuration(track.durationMs, track.isStream),
        inline: true,
      },
      { name: "Requested by", value: `<@${track.requesterId}>`, inline: true },
      { name: "Up next", value: String(pendingTracks), inline: true },
    );
  if (track.uri) embed.setURL(track.uri);
  if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);
  return embed.toJSON();
};

export const queuedEmbed = (
  added: QueuedTrack[],
  totalPending: number,
  omitted: number,
): APIEmbed => {
  const first = added[0];
  const embed = new EmbedBuilder().setColor(BRAND_COLOR);
  if (added.length === 1 && first) {
    embed
      .setTitle("Added to queue")
      .setDescription(
        `**${safeTitle(first.title, 180)}**\n${safeTitle(first.author, 120)}`,
      )
      .addFields(
        {
          name: "Duration",
          value: formatDuration(first.durationMs, first.isStream),
          inline: true,
        },
        { name: "Pending", value: String(totalPending), inline: true },
      );
    if (first.uri) embed.setURL(first.uri);
    if (first.artworkUrl) embed.setThumbnail(first.artworkUrl);
  } else {
    embed
      .setTitle("Playlist added")
      .setDescription(
        `${added.length} tracks were added atomically in playlist order.`,
      )
      .addFields({
        name: "Pending",
        value: String(totalPending),
        inline: true,
      });
  }
  if (omitted > 0) {
    embed.setFooter({
      text: `${omitted} tracks omitted by the 100-track playlist limit.`,
    });
  }
  return embed.toJSON();
};

export interface QueueView {
  embeds: APIEmbed[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

export const queueView = (
  current: QueuedTrack | null,
  pending: readonly QueuedTrack[],
  ownerId: string,
  requestedPage: number,
): QueueView => {
  const pageCount = Math.max(1, Math.ceil(pending.length / QUEUE_PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * QUEUE_PAGE_SIZE;
  const lines = pending
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((track, index) => {
      const position = start + index + 1;
      return `**${position}.** [${safeTitle(track.title)}](${track.uri ?? "https://youtube.com"}) · ${formatDuration(track.durationMs, track.isStream)} · <@${track.requesterId}>`;
    });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("Music queue")
    .setDescription(lines.length > 0 ? lines.join("\n") : "The queue is empty.")
    .setFooter({
      text: `Page ${page + 1}/${pageCount} · ${pending.length} pending`,
    });
  if (current) {
    embed.addFields({
      name: "Now playing",
      value: `[${safeTitle(current.title, 100)}](${current.uri ?? "https://youtube.com"}) · ${formatDuration(current.durationMs, current.isStream)}`,
    });
  }

  const controls =
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:${ownerId}:${page - 1}`)
        .setEmoji("◀️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`queue:${ownerId}:${page + 1}`)
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
    );
  return { embeds: [embed.toJSON()], components: [controls] };
};

export const failureEmbed = (track: QueuedTrack): APIEmbed =>
  new EmbedBuilder()
    .setColor(0xe7_4c_3c)
    .setTitle("Playback failed")
    .setDescription(
      `Could not play **${safeTitle(track.title, 180)}** after one retry. Continuing the queue.`,
    )
    .toJSON();
