import { Client, Events, GatewayIntentBits } from "discord.js";
import { Connectors, Shoukaku } from "shoukaku";
import { loadConfig } from "./config.js";
import { startHealthServer, type HealthState } from "./health-server.js";
import { registerInteractionHandlers } from "./interactions.js";
import { log, logError } from "./logger.js";
import { MusicManager } from "./music/music-manager.js";
import { SettingsStore } from "./settings-store.js";

const config = loadConfig();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const health: HealthState = {
  discordReady: false,
  lavalinkReady: false,
  startedAt: new Date().toISOString(),
};
const healthServer = startHealthServer(config.healthPort, health);
const settings = new SettingsStore(config.dataDirectory);
await settings.load();

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  [
    {
      name: "main",
      url: `${config.lavalinkHost}:${config.lavalinkPort}`,
      auth: config.lavalinkPassword,
      secure: config.lavalinkSecure,
    },
  ],
  {
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 30,
    resume: true,
    resumeTimeout: 60,
  },
);
const music = new MusicManager(client, shoukaku, settings);
registerInteractionHandlers(client, music);

shoukaku.on("ready", (name) => {
  health.lavalinkReady = true;
  log("info", "lavalink_ready", { node: name });
});
shoukaku.on("disconnect", (name, count) => {
  health.lavalinkReady = false;
  log("warn", "lavalink_disconnected", { node: name, count });
});
shoukaku.on("close", (name, code) => {
  health.lavalinkReady = false;
  log("warn", "lavalink_closed", { node: name, code });
});
shoukaku.on("error", (name, error) => {
  health.lavalinkReady = false;
  logError("lavalink_error", error, { node: name });
});

client.once(Events.ClientReady, (readyClient) => {
  health.discordReady = true;
  log("info", "discord_ready", {
    botId: readyClient.user.id,
    guildCount: readyClient.guilds.cache.size,
  });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild.id;
  const session = music.get(guildId);
  if (!session) return;

  if (
    newState.id === client.user?.id &&
    oldState.channelId &&
    !newState.channelId
  ) {
    void music.disconnect(guildId);
    return;
  }

  if (
    oldState.channelId !== session.voiceChannelId &&
    newState.channelId !== session.voiceChannelId
  )
    return;
  const voiceChannel = newState.guild.channels.cache.get(
    session.voiceChannelId,
  );
  const hasHumans =
    voiceChannel?.isVoiceBased() === true &&
    voiceChannel.members.some((member) => !member.user.bot);
  music.updateAudience(guildId, hasHumans);
});

client.on(Events.Error, (error) => logError("discord_error", error));

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_started", { signal });
  health.discordReady = false;
  await music.disconnectAll();
  client.destroy();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (error) =>
  logError("unhandled_rejection", error),
);
process.on("uncaughtException", (error) => {
  logError("uncaught_exception", error);
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

try {
  await client.login(config.discordToken);
} catch (error) {
  logError("discord_login_failed", error);
  await shutdown("login_failed");
  process.exitCode = 1;
}
