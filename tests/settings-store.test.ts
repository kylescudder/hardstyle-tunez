import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/settings-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("SettingsStore", () => {
  it("defaults to 50 and persists a guild volume", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "hardstyle-tunez-test-"),
    );
    directories.push(directory);
    const store = new SettingsStore(directory);
    await store.load();

    expect(store.getVolume("guild-1")).toBe(50);
    await store.setVolume("guild-1", 73);

    const reloaded = new SettingsStore(directory);
    await reloaded.load();
    expect(reloaded.getVolume("guild-1")).toBe(73);
    expect(
      JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8")),
    ).toEqual({
      version: 1,
      guilds: { "guild-1": { volume: 73 } },
    });
  });

  it.each([-1, 101, 4.2])("rejects invalid volume %s", async (volume) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "hardstyle-tunez-test-"),
    );
    directories.push(directory);
    const store = new SettingsStore(directory);
    await store.load();
    await expect(store.setVolume("guild-1", volume)).rejects.toThrow(
      RangeError,
    );
  });
});
