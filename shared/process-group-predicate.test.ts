import { expect, test } from "bun:test";
import { isForeignProcessGroup, ownProcessGroupIds } from "./process-group-predicate.ts";

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
  expect(isForeignProcessGroup(2.5, own)).toBe(false);
});

test("ownProcessGroupIds includes process.pid", () => {
  expect(ownProcessGroupIds().has(process.pid)).toBe(true);
});
