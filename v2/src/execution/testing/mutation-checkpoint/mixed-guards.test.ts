import { expect, test } from "bun:test";
import { gateA } from "./mixed-guard-a.ts";
import { gateB } from "./mixed-guard-b.ts";

test("mixed hollow and caught checkpoints", () => {
  // Mutation checkpoint: negating gate A `!value` guard must turn pin RED.
  expect(gateA(1)).toBe(true);
  // Mutation checkpoint: negating gate B `!value` guard must turn pin RED.
  expect(gateB(0)).toBe(false);
});
