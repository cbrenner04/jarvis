import { expect, test } from "bun:test";
import { keepPositive } from "./hollow-guard.ts";

test("keepPositive accepts one", () => {
  // Mutation checkpoint: negating `!value` guard must turn pin RED.
  expect(keepPositive(1)).toBe(true);
});
