import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { waitForStdoutMarker } from "./subprocess-marker.ts";

function fakeChild(): { child: ChildProcess; stdout: PassThrough; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const child = Object.assign(emitter, { stdout }) as unknown as ChildProcess;
  return { child, stdout, emitter };
}

describe("waitForStdoutMarker", () => {
  test("waits past the former ten-second budget for a late marker", async () => {
    const { child, stdout } = fakeChild();
    const originalNow = Date.now;
    const started = originalNow();
    // Simulate a lock holder that reports after more than 10s of wall time without sleeping.
    Date.now = () => started + 15_000;
    try {
      const waited = waitForStdoutMarker(child, "jarvis-lock-held");
      stdout.write("booting");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      stdout.write("...jarvis-lock-held\n");
      await expect(waited).resolves.toBeUndefined();
    } finally {
      Date.now = originalNow;
    }
  });

  test("rejects when the child exits without the marker", async () => {
    const { child, stdout, emitter } = fakeChild();
    const waited = waitForStdoutMarker(child, "jarvis-lock-held");
    stdout.write("no marker here\n");
    emitter.emit("exit", 1, null);
    await expect(waited).rejects.toThrow("exited (code 1, signal null) without reporting jarvis-lock-held");
    stdout.end();
  });

  test("rejects when stdout closes without the marker", async () => {
    const { child, stdout } = fakeChild();
    const waited = waitForStdoutMarker(child, "jarvis-lock-held");
    stdout.end();
    await expect(waited).rejects.toThrow("closed stdout without reporting jarvis-lock-held");
  });
});
