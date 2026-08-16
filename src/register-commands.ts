import { REST, Routes } from "discord.js";
import { commandData } from "./commands.js";
import { loadConfig } from "./config.js";
import { logError, log } from "./logger.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordGuildId,
      )
    : Routes.applicationCommands(config.discordClientId);
  await rest.put(route, { body: commandData });
  log("info", "commands_registered", {
    scope: config.discordGuildId ? "guild" : "global",
    guildId: config.discordGuildId,
    count: commandData.length,
  });
};

main().catch((error: unknown) => {
  logError("command_registration_failed", error);
  process.exitCode = 1;
});
