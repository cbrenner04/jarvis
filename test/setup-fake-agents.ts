// Test preload: guarantees the suite never spawns a real agent CLI.
//
// Several end-to-end code paths spawn an agent by its bare binary name
// (`claude`/`codex`/`cursor`/...) via the real factory. Under tests that would
// invoke the actual CLI, making live API calls and triggering network
// permission prompts. We prepend a temp dir of no-op fakes (exit 0) onto PATH so
// those bare-name spawns resolve to the fakes instead.
//
// Tests that inject an explicit absolute `binary:` path bypass PATH and are
// unaffected; tests asserting "binary not found" use a bare name we do not stub
// (e.g. "fake"), so they still get ENOENT.

import { mock, setDefaultTimeout } from "bun:test";
import * as childProcess from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Enforce the per-test timeout. bun 1.3.x ignores `[test] timeout` in
// bunfig.toml (only `--timeout` is honored), so without this the suite falls
// back to bun's 5000ms default and git-backed tests that run just over 5s
// (e.g. the patch review phase) time out intermittently, looking like hangs.
setDefaultTimeout(30000);

const realExecSync = childProcess.execSync;
const realExecFileSync = childProcess.execFileSync;
const realSpawnSync = childProcess.spawnSync;

function setEnv(key: string, value: string): void {
  process.env[key] = value;
  Bun.env[key] = value;
}

const binDir = mkdtempSync(join(tmpdir(), "jarvis-test-fake-agents-"));

// Isolate the jarvis home: without this the suite writes fixture rows into the operator's real
// ~/.jarvis. Must precede any import that reads it.
process.env.JARVIS_HOME = mkdtempSync(join(tmpdir(), "jarvis-test-home-"));
for (const name of ["claude", "codex", "cursor", "opencode"]) {
  const bin = join(binDir, name);
  writeFileSync(bin, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(bin, 0o755);
}
setEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

// Block v1 command-path tests from POSTing to the operator's long-lived log-server
// on 127.0.0.1:4310. Production keeps the real client; under test we no-op.
const LIVE_LOG_SERVER_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost):4310\//;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (LIVE_LOG_SERVER_URL_RE.test(url)) {
      return new Response("ok\n", { status: 202 });
    }
    return realFetch(input, init);
  },
  realFetch,
);

const gitConfig: [string, string][] = [
  ["core.hooksPath", "/dev/null"],
  ["advice.defaultBranchName", "false"],
  ["init.defaultBranch", "main"],
];
// Quieting overlay merged onto the *live* process.env at call time (below), so
// tests that mutate process.env after preload still have those changes reach git
// subprocesses. Also seed process.env itself for git calls made without options.
const gitConfigEnv: Record<string, string> = { GIT_CONFIG_COUNT: String(gitConfig.length) };
setEnv("GIT_CONFIG_COUNT", String(gitConfig.length));
for (const [i, [key, value]] of gitConfig.entries()) {
  setEnv(`GIT_CONFIG_KEY_${i}`, key);
  setEnv(`GIT_CONFIG_VALUE_${i}`, value);
  gitConfigEnv[`GIT_CONFIG_KEY_${i}`] = key;
  gitConfigEnv[`GIT_CONFIG_VALUE_${i}`] = value;
}

function withQuietGitDefaults<T extends { env?: NodeJS.ProcessEnv | undefined; stdio?: unknown }>(
  options: T | undefined,
): T {
  return {
    ...(options ?? ({} as T)),
    env: { ...process.env, ...gitConfigEnv, ...options?.env },
    stdio: options?.stdio ?? "pipe",
  };
}

function withInheritedEnv<T extends { env?: NodeJS.ProcessEnv | undefined }>(options: T | undefined): T {
  if (options?.env !== undefined) {
    return options;
  }
  return {
    ...(options ?? ({} as T)),
    env: process.env,
  };
}

function isGitShellCommand(command: string): boolean {
  return /(^|[;&|]\s*)git(\s|$)/.test(command);
}

mock.module("node:child_process", () => ({
  ...childProcess,
  execSync: ((command: string, options?: childProcess.ExecSyncOptions) =>
    realExecSync(
      command,
      isGitShellCommand(command) ? withQuietGitDefaults(options) : options,
    )) as typeof childProcess.execSync,
  execFileSync: ((file: string, args?: readonly string[], options?: childProcess.ExecFileSyncOptions) =>
    realExecFileSync(
      file,
      args,
      file === "git" ? withQuietGitDefaults(options) : file === "gh" ? withInheritedEnv(options) : options,
    )) as typeof childProcess.execFileSync,
  spawnSync: ((file: string, args?: readonly string[], options?: childProcess.SpawnSyncOptions) =>
    realSpawnSync(
      file,
      args,
      file === "git" ? withQuietGitDefaults(options) : options,
    )) as typeof childProcess.spawnSync,
}));
