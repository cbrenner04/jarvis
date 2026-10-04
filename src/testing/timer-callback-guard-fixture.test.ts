import { expect, test } from "bun:test";
import { shouldStopPolling } from "./timer-callback-guard-fixture.ts";

test("shouldStopPolling: draining poller stops only once no work is pending", () => {
  expect(shouldStopPolling(false, true, true)).toBe(false); // draining + pending → keep polling
  expect(shouldStopPolling(false, true, false)).toBe(true); // draining + idle → stop
  expect(shouldStopPolling(false, false, false)).toBe(false); // idle alone → keep polling
  expect(shouldStopPolling(true, false, true)).toBe(true); // explicit stop → stop
});
