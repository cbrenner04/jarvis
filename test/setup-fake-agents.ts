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

import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realExecSync = childProcess.execSync;
const realExecFileSync = childProcess.execFileSync;
const realSpawnSync = childProcess.spawnSync;

function setEnv(key: string, value: string): void {
  process.env[key] = value;
  Bun.env[key] = value;
}

const binDir = mkdtempSync(join(tmpdir(), "jarvis-test-fake-agents-"));
for (const name of ["claude", "codex", "cursor", "aider", "opencode"]) {
  const bin = join(binDir, name);
  writeFileSync(bin, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(bin, 0o755);
}
setEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

const gitConfig = [
  ["core.hooksPath", "/dev/null"],
  ["advice.defaultBranchName", "false"],
  ["init.defaultBranch", "main"],
];
const gitEnv = { ...process.env };
setEnv("GIT_CONFIG_COUNT", String(gitConfig.length));
for (const [i, [key, value]] of gitConfig.entries()) {
  setEnv(`GIT_CONFIG_KEY_${i}`, key);
  setEnv(`GIT_CONFIG_VALUE_${i}`, value);
  gitEnv[`GIT_CONFIG_KEY_${i}`] = key;
  gitEnv[`GIT_CONFIG_VALUE_${i}`] = value;
}
gitEnv.GIT_CONFIG_COUNT = String(gitConfig.length);

function withQuietGitDefaults<T extends { env?: NodeJS.ProcessEnv; stdio?: unknown }>(options: T | undefined): T {
  return {
    ...(options ?? ({} as T)),
    env: { ...gitEnv, ...options?.env },
    stdio: options?.stdio ?? "pipe",
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
    )) satisfies typeof childProcess.execSync,
  execFileSync: ((file: string, args?: readonly string[], options?: childProcess.ExecFileSyncOptions) =>
    realExecFileSync(
      file,
      args,
      file === "git" ? withQuietGitDefaults(options) : options,
    )) satisfies typeof childProcess.execFileSync,
  spawnSync: ((file: string, args?: readonly string[], options?: childProcess.SpawnSyncOptions) =>
    realSpawnSync(
      file,
      args,
      file === "git" ? withQuietGitDefaults(options) : options,
    )) satisfies typeof childProcess.spawnSync,
}));
