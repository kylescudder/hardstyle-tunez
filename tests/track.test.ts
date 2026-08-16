import { describe, expect, it } from "vitest";
import { formatDuration } from "../src/music/track.js";

describe("formatDuration", () => {
  it("formats finite tracks and livestreams", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(185_000)).toBe("3:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(0, true)).toBe("LIVE");
  });
});
