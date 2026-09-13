import { startDaemonRuntime } from "./daemon/daemon";

type EntrypointArgs = {
  socketPath?: string;
  privateSocketPath?: string;
  predecessorSocketPath?: string;
  testOwnerPid?: number;
};

const FLAG_KEYS: Record<string, keyof EntrypointArgs> = {
  "--socket": "socketPath",
  "--private-socket": "privateSocketPath",
  "--predecessor-socket": "predecessorSocketPath",
  "--test-owner-pid": "testOwnerPid",
};

// Pure: reads the daemon's addressing from argv. Addresses are never read from env, because env is
// inherited by every child the daemon spawns (agents, gates, tests) and would let them reach it.
// --private-socket: the spawning CLI resolves this because its executable digest may differ.
// --predecessor-socket: set only after a successful `changeover`; the outgoing generation's private
// endpoint, so this daemon can observe its drain (see `daemon-drain-observer.ts`).
export function parseEntrypointArgs(argv: readonly string[]): EntrypointArgs {
  const parsed: EntrypointArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const key = FLAG_KEYS[argv[i] ?? ""];
    const value = argv[i + 1];
    if (key === undefined || value === undefined || value === "") continue;
    if (key === "testOwnerPid") parsed.testOwnerPid = Number(value);
    else parsed[key] = value;
    i++;
  }
  return parsed;
}

// Pure: builds the `startDaemonRuntime` handoff options, omitting unset keys rather than passing undefined.
export function resolveHandoffOptions(args: EntrypointArgs): {
  privateSocketPath?: string;
  predecessorSocketPath?: string;
} {
  return {
    ...(args.privateSocketPath === undefined ? {} : { privateSocketPath: args.privateSocketPath }),
    ...(args.predecessorSocketPath === undefined ? {} : { predecessorSocketPath: args.predecessorSocketPath }),
  };
}

// Pure: true when `--test-owner-pid` names a real PID worth watching (test-only owner liveness hook —
// the entrypoint exits once that PID disappears).
export function shouldWatchOwnerPid(testOwnerPid: number): boolean {
  return Number.isInteger(testOwnerPid) && testOwnerPid > 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log("usage: daemon-entrypoint --socket <path> [--private-socket <path>] [--predecessor-socket <path>]");
    process.exit(0);
  }

  const args = parseEntrypointArgs(argv);
  if (!args.socketPath) {
    console.error("--socket <path> argument required");
    process.exit(1);
  }

  const testOwnerPid = args.testOwnerPid ?? Number.NaN;
  if (shouldWatchOwnerPid(testOwnerPid)) {
    setInterval(() => {
      try {
        process.kill(testOwnerPid, 0);
      } catch {
        process.exit(0);
      }
    }, 100).unref();
  }

  startDaemonRuntime(args.socketPath, undefined, undefined, resolveHandoffOptions(args)).catch((err) => {
    console.error("Fatal daemon error:", err);
    process.exit(1);
  });
}
