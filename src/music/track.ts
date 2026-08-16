import type { Track } from "shoukaku";

export interface QueuedTrack {
  encoded: string;
  identifier: string;
  title: string;
  author: string;
  uri?: string;
  artworkUrl?: string;
  durationMs: number;
  isStream: boolean;
  requesterId: string;
  retries: number;
}

export const toQueuedTrack = (
  track: Track,
  requesterId: string,
): QueuedTrack => ({
  encoded: track.encoded,
  identifier: track.info.identifier,
  title: track.info.title,
  author: track.info.author,
  ...(track.info.uri ? { uri: track.info.uri } : {}),
  ...(track.info.artworkUrl ? { artworkUrl: track.info.artworkUrl } : {}),
  durationMs: track.info.length,
  isStream: track.info.isStream,
  requesterId,
  retries: 0,
});

export const formatDuration = (
  milliseconds: number,
  isStream = false,
): string => {
  if (isStream) return "LIVE";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
};
