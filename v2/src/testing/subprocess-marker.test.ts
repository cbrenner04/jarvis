import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { waitForStdoutMarker } from "./subprocess-marker.ts";

const MARKER = "jarvis-lock-held";

function fakeChild(withStderr = true): {
  child: ChildProcess;
  stdout: PassThrough;
  stderr: PassThrough | undefined;
} {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = withStderr ? new PassThrough() : undefined;
  const child = Object.assign(emitter, { stdout, stderr }) as unknown as ChildProcess;
  return { child, stdout, stderr };
}

describe("waitForStdoutMarker", () => {
  test("waits past the former ten-second budget for a late marker", async () => {
    const { child, stdout } = fakeChild();
    const originalNow = Date.now;
    const started = originalNow();
    // Simulate a lock holder that reports after more than 10s of wall time without sleeping.
    Date.now = () => started + 15_000;
    try {
      const waited = waitForStdoutMarker(child, MARKER);
      stdout.write("booting");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      stdout.write(`...${MARKER}\n`);
      await expect(waited).resolves.toBeUndefined();
    } finally {
      Date.now = originalNow;
    }
  });

  test("reports a real child's exit code and stderr", async () => {
    const child = spawn(process.execPath, ["-e", 'process.stderr.write("startup failed\\n"); process.exit(23)'], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const waited = waitForStdoutMarker(child, MARKER);
    await expect(waited).rejects.toThrow(/code 23[\s\S]*startup failed/);
  });

  test("rejects on close with the exit cause and stderr tail", async () => {
    const { child, stdout, stderr } = fakeChild();
    const waited = waitForStdoutMarker(child, MARKER);
    stdout.write("no marker here\n");
    const stdoutEnded = new Promise<void>((resolve) => stdout.once("end", resolve));
    stdout.end();
    await stdoutEnded;
    stderr?.end("startup failed\n");
    child.emit("close", 1, "SIGTERM");
    await expect(waited).rejects.toThrow(
      `child closed (code 1, signal SIGTERM) without reporting ${MARKER}\nstderr tail:\nstartup failed`,
    );
  });

  test("rejects with the exit cause when stderr is absent", async () => {
    const { child, stdout } = fakeChild(false);
    const waited = waitForStdoutMarker(child, MARKER);
    const stdoutEnded = new Promise<void>((resolve) => stdout.once("end", resolve));
    stdout.end();
    await stdoutEnded;
    child.emit("close", 1, null);
    const error = await waited.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`child closed (code 1, signal null) without reporting ${MARKER}`);
  });

  test("retains only the stderr tail", async () => {
    const { child, stderr } = fakeChild();
    const waited = waitForStdoutMarker(child, MARKER);
    stderr?.write(`earliest-output-${"x".repeat(20_000)}-latest-output`);
    child.emit("close", 1, null);
    const error = await waited.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("earliest-output");
    expect((error as Error).message).toContain("latest-output");
  });
});
