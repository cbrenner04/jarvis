import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { getBaseBranch } from "../src/gh.ts";

function fakeChildProcess(
  stdout: string,
  exitCode: number,
): childProcess.ChildProcess {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([]);
  const child = new EventEmitter() as childProcess.ChildProcess;
  Object.assign(child, { stdout: stdoutStream, stderr: stderrStream });
  queueMicrotask(() => {
    child.emit("close", exitCode);
  });
  return child;
}

describe("getBaseBranch", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof childProcess, "spawn">>;

  beforeEach(() => {
    spawnSpy = spyOn(childProcess, "spawn");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  test("runs gh repo view with cwd set to the registered project root", async () => {
    const repo = "/tmp/example-target-repo";
    spawnSpy.mockImplementation(((
      command: string,
      args: readonly string[],
      options: object,
    ) => {
      expect(command).toBe("gh");
      expect([...args]).toEqual([
        "repo",
        "view",
        "--json",
        "defaultBranchRef",
        "-q",
        ".defaultBranchRef.name",
      ]);
      expect(options).toEqual(
        expect.objectContaining({
          cwd: repo,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      return fakeChildProcess("main\n", 0);
    }) as typeof childProcess.spawn);

    await expect(getBaseBranch(repo)).resolves.toBe("main");
  });
});
