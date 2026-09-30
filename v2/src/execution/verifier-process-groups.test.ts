import { expect, test } from "bun:test";
import { isForeignProcessGroup, ownProcessGroupIds, trackProcessGroup } from "./verifier-process-groups.ts";

test("isForeignProcessGroup accepts a distinct positive group", () => {
  expect(isForeignProcessGroup(5000, new Set([100, 200]))).toBe(true);
});

test("isForeignProcessGroup rejects own pid/group and invalid ids", () => {
  const own = new Set([100, 200]);
  expect(isForeignProcessGroup(100, own)).toBe(false);
  expect(isForeignProcessGroup(200, own)).toBe(false);
  expect(isForeignProcessGroup(0, own)).toBe(false);
  expect(isForeignProcessGroup(1, own)).toBe(false);
  expect(isForeignProcessGroup(-5, own)).toBe(false);
});

test("ownProcessGroupIds includes process.pid", () => {
  expect(ownProcessGroupIds().has(process.pid)).toBe(true);
});

test("trackProcessGroup refuses to record the current process's own group", () => {
  const recorded: number[] = [];
  const cleared: number[] = [];
  const recorder = { record: (p: number) => recorded.push(p), clear: (p: number) => cleared.push(p) };
  const own = trackProcessGroup(recorder);
  for (const pgid of ownProcessGroupIds()) own.processGroup.onGroupId(pgid);
  own.settle();
  const child = trackProcessGroup(recorder);
  child.processGroup.onGroupId(987654);
  child.settle();
  expect(recorded).toEqual([987654]);
  expect(cleared).toEqual([987654]);
});
