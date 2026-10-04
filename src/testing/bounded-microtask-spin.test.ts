import { expect, test } from "bun:test";
import { spinUntilMicrotask } from "./bounded-microtask-spin.ts";

test("spinUntilMicrotask throws a named error when the condition never becomes true", async () => {
  await expect(spinUntilMicrotask(() => false, "waitCalled", 3)).rejects.toThrow(
    'spinUntilMicrotask: condition "waitCalled" not met after 3 iterations',
  );
});
