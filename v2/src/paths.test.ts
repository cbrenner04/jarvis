import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { locateDiscoveredFile } from "../../shared/structural-test-locator.ts";
import { defaultTelemetrySinkPath } from "./execution/work-boundary-telemetry.ts";
import {
  DAEMON_PID_PATH,
  DAEMON_SOCKET_DISPLAY,
  DAEMON_SOCKET_PATH,
  jarvisHome,
  MACHINE_CONFIG_PATH,
  ORCHESTRATION_STORE_PATH,
  orchestrationStorePath,
} from "./paths.ts";

const REAL_HOME = join(homedir(), ".jarvis");
const REPO_ROOT = join(import.meta.dir, "..", "..");
const CANONICAL_HOMEDIR_PATH = "v2/src/paths.ts";
const HOMEDIR_CALL_PATTERN = /homedir\s*\(/;

type ModuleSet = Readonly<Record<string, string>>;

function productionSourceMap(): ModuleSet {
  const sources: Record<string, string> = {};
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources[relativePath] = readFileSync(join(REPO_ROOT, relativePath), "utf8");
      }
    }
  };
  walk(join(REPO_ROOT, "v2/src"), "v2/src");
  return sources;
}

/** Pre-fix absence-only scan: skips paths.ts by filename without asserting canonical homedir presence. */
function absenceOnlyHomedirGuard(modules: ModuleSet): string[] {
  const offenders: string[] = [];
  for (const [path, source] of Object.entries(modules)) {
    if (path === CANONICAL_HOMEDIR_PATH) continue;
    if (HOMEDIR_CALL_PATTERN.test(source)) {
      offenders.push(path);
    }
  }
  return offenders;
}

function pairedHomedirGuard(modules: ModuleSet): string[] {
  const canonicalSource = locateDiscoveredFile(modules, CANONICAL_HOMEDIR_PATH);
  if (!HOMEDIR_CALL_PATTERN.test(canonicalSource)) {
    return [CANONICAL_HOMEDIR_PATH];
  }
  const offenders: string[] = [];
  for (const path of Object.keys(modules)) {
    if (path === CANONICAL_HOMEDIR_PATH) continue;
    const source = locateDiscoveredFile(modules, path);
    if (HOMEDIR_CALL_PATTERN.test(source)) {
      offenders.push(path);
    }
  }
  return offenders;
}

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

  test("ORCHESTRATION_STORE_PATH is <jarvis-home>/state/v2.sqlite", () => {
    expect(ORCHESTRATION_STORE_PATH).toBe(join(jarvisHome(), "state", "v2.sqlite"));
  });

  test("orchestrationStorePath(customHome) preserves state/v2.sqlite suffix", () => {
    const customHome = join(jarvisHome(), "custom-home");
    expect(orchestrationStorePath(customHome)).toBe(join(customHome, "state", "v2.sqlite"));
  });

  test("DAEMON_SOCKET_DISPLAY is ~/.jarvis/daemon.sock", () => {
    expect(DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
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
    const modules = productionSourceMap();
    expect(pairedHomedirGuard(modules)).toEqual([]);

    const withoutCanonicalHomedir: ModuleSet = {
      ...modules,
      [CANONICAL_HOMEDIR_PATH]:
        'import { join } from "node:path";\nexport function jarvisHome() { return process.env.JARVIS_HOME ?? join("/tmp", ".jarvis"); }\n',
    };
    expect(absenceOnlyHomedirGuard(withoutCanonicalHomedir)).toEqual([]);
    expect(pairedHomedirGuard(withoutCanonicalHomedir)).toEqual([CANONICAL_HOMEDIR_PATH]);
  });
});
