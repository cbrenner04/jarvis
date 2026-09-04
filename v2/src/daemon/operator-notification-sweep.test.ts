import { expect, test } from "bun:test";
import type { StateStore } from "../persistence/state-store.ts";
import {
  type NotificationSweepDeps,
  runNotificationSweepIntervalTick,
  shouldSkipOverlappingNotificationSweep,
} from "./operator-notification-sweep.ts";

test("shouldSkipOverlappingNotificationSweep: skips only while a sweep is in flight", () => {
  expect(shouldSkipOverlappingNotificationSweep(false)).toBe(false);
  expect(shouldSkipOverlappingNotificationSweep(true)).toBe(true);
});

test("notification sweep timer skips a tick while the prior sweep is still running", () => {
  const state = { sweepInProgress: false };
  const deps: NotificationSweepDeps = {
    store: { isClosed: () => false } as StateStore,
    readSinkCommand: () => undefined,
  };

  let sweepCount = 0;
  const blockingSweep = (sweepDeps: NotificationSweepDeps) => {
    sweepCount += 1;
    runNotificationSweepIntervalTick(state, sweepDeps, blockingSweep);
  };

  runNotificationSweepIntervalTick(state, deps, blockingSweep);
  expect(sweepCount).toBe(1);
});
