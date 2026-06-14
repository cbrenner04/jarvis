import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogRepository } from "../log-repository.ts";
import { discoverJarvisExecutable, ensureDaemonRunning } from "./autostart.ts";
import { daemonSocketPath } from "./paths.ts";
import { createDaemonHost } from "./server.ts";

describe("daemon autostart", () => {
  test("discoverJarvisExecutable returns bun run cli.ts when invoked from tests", () => {
    const launch = discoverJarvisExecutable();
    expect(launch.command).toBe("bun");
    expect(launch.serveArgv[0]).toBe("run");
    expect(launch.serveArgv.at(-2)).toBe("daemon");
    expect(launch.serveArgv.at(-1)).toBe("serve");
  });

  test("ensureDaemonRunning reports already_running for a live socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-autostart-"));
    const socketPath = daemonSocketPath(root);
    const host = createDaemonHost({
      socketPath,
      logRepository: openLogRepository(join(root, "state", "logs.sqlite")),
    });
    await host.start();

    const result = await ensureDaemonRunning({ jarvisRoot: root, socketPath });
    expect(result).toEqual({
      ok: false,
      reason: "already_running",
      detail: "daemon already answers status",
    });

    await host.stop();
    host.logRepository.close();
  });

  test("ensureDaemonRunning spawns detached serve and waits for readiness", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-autostart-"));
    const socketPath = daemonSocketPath(root);
    let spawned = false;
    const host = createDaemonHost({
      socketPath,
      logRepository: openLogRepository(join(root, "state", "logs.sqlite")),
    });

    const result = await ensureDaemonRunning({
      jarvisRoot: root,
      socketPath,
      spawnDaemon: () => {
        spawned = true;
        void host.start();
        return { pid: 1, unref: () => {} } as never;
      },
      sleep: async () => {},
    });

    expect(spawned).toBe(true);
    expect(result.ok).toBe(true);
    await host.stop();
    host.logRepository.close();
  });
});
