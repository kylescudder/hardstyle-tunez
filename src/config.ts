const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const integerEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
};

export interface Config {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  lavalinkHost: string;
  lavalinkPort: number;
  lavalinkPassword: string;
  lavalinkSecure: boolean;
  dataDirectory: string;
  healthPort: number;
}

export const loadConfig = (): Config => {
  const discordGuildId = process.env.DISCORD_GUILD_ID?.trim();
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordClientId: requireEnv("DISCORD_CLIENT_ID"),
    ...(discordGuildId ? { discordGuildId } : {}),
    lavalinkHost: process.env.LAVALINK_HOST?.trim() || "127.0.0.1",
    lavalinkPort: integerEnv("LAVALINK_PORT", 2333),
    lavalinkPassword: requireEnv("LAVALINK_PASSWORD"),
    lavalinkSecure: process.env.LAVALINK_SECURE === "true",
    dataDirectory: process.env.DATA_DIRECTORY?.trim() || "./data",
    healthPort: integerEnv("HEALTH_PORT", 3000),
  };
};
