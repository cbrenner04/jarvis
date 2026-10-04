/**
 * Structural guard: no production client file (CLI bootstrap, commands, runtime-smoke verifier,
 * TUI) computes an executable digest or enumerates digest-keyed sockets to locate a daemon.
 * That pattern was the client-side socket discovery removed by
 * remove-client-daemon-socket-discovery; every client now dispatches to the stable socket only.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

type ProductionSources = Readonly<Record<string, string>>;

const EXECUTABLE_DIGEST_CALL_PATTERN =
  /\b(getExecutableDigest|getInvokingExecutableDigest|getExecutableTreeDigest)\s*\(/;
/** The digest-keyed socket filename regex fragment used to enumerate `daemon-<digest>.sock` files. */
const DIGEST_KEYED_SOCKET_ENUMERATION_PATTERN = /\[0-9a-f\]\{16\}/;
const DISCOVER_LIVE_DAEMON_SOCKETS_REFERENCE_PATTERN = /discoverLiveDaemonSockets/;

/** `daemon start`'s private successor-socket handoff — never a client routing target (see 00). */
const EXECUTABLE_DIGEST_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "src/cli.ts",
  "src/cli/deps.ts",
  "src/cli/dispatch-revision.ts",
]);

/** Reap dead digest-keyed socket artifacts by deleting files; they never route a command by digest. */
const DIGEST_KEYED_SOCKET_ENUMERATION_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "src/commands/daemon.ts",
  "src/commands/cleanup.ts",
]);

/**
 * Violations for each scanned file: an executable-digest computation or digest-keyed-socket
 * enumeration outside the named exemptions, or any reference to the deleted discovery module.
 */
export function clientDaemonSocketDiscoveryViolations(sources: ProductionSources): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    if (DISCOVER_LIVE_DAEMON_SOCKETS_REFERENCE_PATTERN.test(source)) {
      violations.push(`${path}: references discoverLiveDaemonSockets`);
    }
    if (!EXECUTABLE_DIGEST_ALLOWED_PATHS.has(path) && EXECUTABLE_DIGEST_CALL_PATTERN.test(source)) {
      violations.push(`${path}: computes an executable digest`);
    }
    if (
      !DIGEST_KEYED_SOCKET_ENUMERATION_ALLOWED_PATHS.has(path) &&
      DIGEST_KEYED_SOCKET_ENUMERATION_PATTERN.test(source)
    ) {
      violations.push(`${path}: enumerates digest-keyed sockets`);
    }
  }
  return violations.sort();
}

/** src/cli.ts, src/cli/**, src/commands/**, src/execution/runtime-smoke-verifier.ts, src/tui/** — excluding *.test.ts/*.test.tsx. */
function listGuardedProductionSources(): ProductionSources {
  const sources: Record<string, string> = {};

  const addFile = (repoPath: string): void => {
    if (repoPath.endsWith(".test.ts") || repoPath.endsWith(".test.tsx")) return;
    sources[repoPath] = readFileSync(join(REPO_ROOT, repoPath), "utf-8");
  };

  const walkDir = (absDir: string, repoPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const repoPath = `${repoPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walkDir(join(absDir, entry.name), repoPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        addFile(repoPath);
      }
    }
  };

  addFile("src/cli.ts");
  walkDir(join(REPO_ROOT, "src/cli"), "src/cli");
  walkDir(join(REPO_ROOT, "src/commands"), "src/commands");
  addFile("src/execution/runtime-smoke-verifier.ts");
  walkDir(join(REPO_ROOT, "src/tui"), "src/tui");

  return sources;
}

test("the guarded production client surface has no discovery, digest-computation, or socket-enumeration violations", () => {
  expect(clientDaemonSocketDiscoveryViolations(listGuardedProductionSources())).toEqual([]);
});

test("fails against the pre-fix discovery in tui-entry.tsx", () => {
  const preFixTuiEntry = [
    'import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";',
    "async function updateConnections() {",
    "  const sockets = await discoverLiveDaemonSockets();",
    "}",
  ].join("\n");

  expect(clientDaemonSocketDiscoveryViolations({ "src/tui/tui-entry.tsx": preFixTuiEntry })).toEqual([
    "src/tui/tui-entry.tsx: references discoverLiveDaemonSockets",
  ]);
});

test("fails against the pre-fix discovery in tui-log-follow-entry.tsx", () => {
  const preFixTuiLogFollowEntry = [
    'import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";',
    "async function resolveOwningSocket(runId, sockets, connectFn) {",
    "  const allSockets = new Set(await discoverLiveDaemonSockets());",
    "}",
  ].join("\n");

  expect(
    clientDaemonSocketDiscoveryViolations({ "src/tui/tui-log-follow-entry.tsx": preFixTuiLogFollowEntry }),
  ).toEqual(["src/tui/tui-log-follow-entry.tsx: references discoverLiveDaemonSockets"]);
});

test("flags an executable-digest computation call in a non-exempt file, not in an exempt one", () => {
  const fixtures: ProductionSources = {
    "src/cli.ts": "const digest = await getExecutableDigest();\n",
    "src/commands/pipeline.ts": "const digest = await getExecutableDigest();\n",
  };

  expect(clientDaemonSocketDiscoveryViolations(fixtures)).toEqual([
    "src/commands/pipeline.ts: computes an executable digest",
  ]);
});

test("flags digest-keyed socket enumeration in a non-exempt file, not in an exempt one", () => {
  const fixtures: ProductionSources = {
    "src/commands/daemon.ts": "const DAEMON_DIGEST_ARTIFACT_FILE = /^daemon-([0-9a-f]{16})\\.sock$/;\n",
    "src/tui/tui-entry.tsx": "const socketPattern = /^daemon-([0-9a-f]{16})\\.sock$/;\n",
  };

  expect(clientDaemonSocketDiscoveryViolations(fixtures)).toEqual([
    "src/tui/tui-entry.tsx: enumerates digest-keyed sockets",
  ]);
});

test("a digest-key display parse (mixed-case hex class) is not an enumeration violation", () => {
  // tui-entry.tsx's keyedSocketDigest parses a digest label from the already-known invoking
  // socket path for display; it is not readdir-based discovery and must not trip the guard.
  const fixtures: ProductionSources = {
    "src/tui/tui-entry.tsx": "const match = /^daemon-([0-9a-fA-F]{16})\\.sock$/.exec(basename(socketPath));\n",
  };

  expect(clientDaemonSocketDiscoveryViolations(fixtures)).toEqual([]);
});
