import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { defaultTelemetrySinkPath } from "./execution/work-boundary-telemetry.ts";
import {
  DAEMON_PID_PATH,
  DAEMON_SOCKET_DISPLAY,
  DAEMON_SOCKET_PATH,
  daemonPathsForDigest,
  jarvisHome,
  MACHINE_CONFIG_PATH,
} from "./paths.ts";

const REAL_HOME = join(homedir(), ".jarvis");

describe("paths", () => {
  test("DAEMON_SOCKET_PATH is <jarvis-home>/daemon.sock", () => {
    expect(DAEMON_SOCKET_PATH).toBe(join(jarvisHome(), "daemon.sock"));
  });

  test("DAEMON_PID_PATH is <jarvis-home>/daemon.pid", () => {
    expect(DAEMON_PID_PATH).toBe(join(jarvisHome(), "daemon.pid"));
  });

  test("MACHINE_CONFIG_PATH is <jarvis-home>/config.json", () => {
    expect(MACHINE_CONFIG_PATH).toBe(join(jarvisHome(), "config.json"));
  });

  test("DAEMON_SOCKET_DISPLAY is ~/.jarvis/daemon.sock", () => {
    expect(DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });

  test("daemon paths use the complete executable digest without touching legacy paths", () => {
    expect(daemonPathsForDigest("a-full-digest")).toEqual({
      socketPath: join(jarvisHome(), "daemon-a-full-digest.sock"),
      pidPath: join(jarvisHome(), "daemon-a-full-digest.pid"),
      logPath: join(jarvisHome(), "daemon-a-full-digest.log"),
    });
  });

  test("jarvisHome falls back to ~/.jarvis when JARVIS_HOME is unset", () => {
    const isolated = process.env.JARVIS_HOME;
    delete process.env.JARVIS_HOME;
    try {
      expect(jarvisHome()).toBe(REAL_HOME);
    } finally {
      process.env.JARVIS_HOME = isolated;
    }
  });
});

describe("jarvis home isolation", () => {
  test("the suite resolves an isolated home, never the operator's real ~/.jarvis", () => {
    const isolated = process.env.JARVIS_HOME;
    expect(isolated).toBeDefined();
    expect(jarvisHome()).toBe(isolated as string);
    expect(jarvisHome()).not.toBe(REAL_HOME);
  });

  test("the telemetry sink resolves under the isolated home", () => {
    const sink = defaultTelemetrySinkPath();
    expect(sink).toBe(join(process.env.JARVIS_HOME as string, "telemetry.jsonl"));
    expect(sink.startsWith(REAL_HOME)).toBe(false);
  });

  test("no v2 source resolves a jarvis-home path via homedir() directly", () => {
    // Fail here rather than silently in the operator's home directory.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== "paths.ts") {
          if (readFileSync(path, "utf8").includes("homedir()")) {
            offenders.push(relative(import.meta.dir, path));
          }
        }
      }
    };
    walk(import.meta.dir);

    expect(offenders).toEqual([]);
  });
});
