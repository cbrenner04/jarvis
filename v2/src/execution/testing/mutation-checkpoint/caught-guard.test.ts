import { expect, test } from "bun:test";
import { keepPositive } from "./caught-guard.ts";

test("keepPositive rejects zero", () => {
  // Mutation checkpoint: negating `!value` guard must turn pin RED.
  expect(keepPositive(0)).toBe(false);
});
