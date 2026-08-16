import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { log, logError } from "./logger.js";

const DEFAULT_VOLUME = 50;

interface SettingsFile {
  version: 1;
  guilds: Record<string, { volume: number }>;
}

const emptySettings = (): SettingsFile => ({ version: 1, guilds: {} });

export class SettingsStore {
  readonly #filePath: string;
  #settings = emptySettings();
  #writeChain: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#filePath = path.join(dataDirectory, "settings.json");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.#filePath, "utf8"),
      );
      if (!this.#isValid(parsed))
        throw new Error("settings file has an invalid shape");
      this.#settings = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.#persist();
        return;
      }
      logError("settings_load_failed", error);
      throw error;
    }
  }

  getVolume(guildId: string): number {
    return this.#settings.guilds[guildId]?.volume ?? DEFAULT_VOLUME;
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw new RangeError("volume must be an integer between 0 and 100");
    }
    this.#settings.guilds[guildId] = { volume };
    this.#writeChain = this.#writeChain
      .catch(() => undefined)
      .then(() => this.#persist());
    await this.#writeChain;
  }

  async #persist(): Promise<void> {
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(this.#settings, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    await rename(temporaryPath, this.#filePath);
    log("debug", "settings_saved");
  }

  #isValid(value: unknown): value is SettingsFile {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<SettingsFile>;
    if (
      candidate.version !== 1 ||
      !candidate.guilds ||
      typeof candidate.guilds !== "object"
    ) {
      return false;
    }
    return Object.values(candidate.guilds).every(
      (entry) =>
        !!entry &&
        typeof entry === "object" &&
        Number.isInteger(entry.volume) &&
        entry.volume >= 0 &&
        entry.volume <= 100,
    );
  }
}
