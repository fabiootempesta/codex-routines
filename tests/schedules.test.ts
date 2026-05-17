import { describe, expect, it } from "vitest";
import { getNextRunAt } from "../src/server/schedules";

describe("getNextRunAt", () => {
  it("returns null for manual schedules", () => {
    const nextRun = getNextRunAt({ type: "manual" }, new Date("2026-05-08T17:00:00-03:00"));

    expect(nextRun).toBeNull();
  });

  it("schedules an interval from the supplied date", () => {
    const nextRun = getNextRunAt(
      { type: "interval", everyMinutes: 45 },
      new Date("2026-05-08T17:00:00-03:00")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-08T20:45:00.000Z");
  });

  it("schedules daily time today when it is still ahead", () => {
    const nextRun = getNextRunAt(
      { type: "daily", time: "18:30" },
      new Date("2026-05-08T17:00:00-03:00")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-08T21:30:00.000Z");
  });

  it("schedules daily time tomorrow when today's time has passed", () => {
    const nextRun = getNextRunAt(
      { type: "daily", time: "16:00" },
      new Date("2026-05-08T17:00:00-03:00")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-09T19:00:00.000Z");
  });

  it("schedules weekly time on the next matching weekday", () => {
    const nextRun = getNextRunAt(
      { type: "weekly", dayOfWeek: 1, time: "09:15" },
      new Date("2026-05-08T17:00:00-03:00")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-11T12:15:00.000Z");
  });

  it("does not schedule a one-time date in the past", () => {
    const nextRun = getNextRunAt(
      { type: "once", runAt: "2026-05-08T16:00" },
      new Date("2026-05-08T17:00:00-03:00")
    );

    expect(nextRun).toBeNull();
  });

  it("schedules continuous runs with a short gap to avoid tight-loops", () => {
    const nextRun = getNextRunAt(
      { type: "continuous" },
      new Date("2026-05-16T19:00:00.000Z")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-16T19:00:03.000Z");
  });

  it("does not schedule continuous runs after the configured stop time", () => {
    const nextRun = getNextRunAt(
      { type: "continuous", stopAt: "2026-05-16T19:00:02.000Z" },
      new Date("2026-05-16T19:00:00.000Z")
    );

    expect(nextRun).toBeNull();
  });

  it("keeps scheduling continuous runs while the next run is before the stop time", () => {
    const nextRun = getNextRunAt(
      { type: "continuous", stopAt: "2026-05-16T19:01:00.000Z" },
      new Date("2026-05-16T19:00:00.000Z")
    );

    expect(nextRun?.toISOString()).toBe("2026-05-16T19:00:03.000Z");
  });
});
