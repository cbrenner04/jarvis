import { expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { ConfinementRefusalError } from "../shared/invocation/confinement-policy.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { resolveWriteLoopBindings } from "./daemon.ts";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 999_999;
  start() {
    queueMicrotask(() => {
      this.stdout.end("");
      this.stderr.end("stop");
      setImmediate(() => {
        this.emit("exit", 1);
        this.emit("close", 1);
      });
    });
  }
  kill() {
    return true;
  }
}

function fakeSpawn() {
  const calls: { binary: string; argv: readonly string[] }[] = [];
  const spawn = (binary: string, argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
    calls.push({ binary, argv });
    const child = new FakeChild();
    child.start();
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const SNAPSHOT: AgentModelConfig = {
  claude: { implement: { rungs: [{ adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" }] } },
  codex: { implement: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] } },
};

function writeInput(agents: readonly string[], projectName = "demo"): WriteLoopInput {
  return {
    worktree: { projectRoot: "/tmp", projectName, branchName: "b", baseRef: "main" },
    specPath: "spec.md",
    stepRules: "rules",
    expectedArtifactPath: "out",
    bindings: [],
    bindingResolution: { role: "implement", agents, agentModelConfig: SNAPSHOT },
  };
}

function writeConfig(document: Record<string, unknown>): string {
  const configPath = join(trackedMkdtempSync(join(tmpdir(), "jarvis-confinement-")), "config.json");
  writeFileSync(configPath, JSON.stringify({ machineProfile: "p", agents: ["claude", "codex"], ...document }));
  return configPath;
}

function deps(configPath: string, spawn: ReturnType<typeof fakeSpawn>["spawn"]) {
  return {
    machineConfigPath: configPath,
    forceSnapshotAgentModelConfig: true,
    bindingSpawn: spawn,
    codexSessionsDir: trackedMkdtempSync(join(tmpdir(), "jarvis-confinement-sessions-")),
  };
}

test("a configured sandbox policy reaches the codex binding and refuses claude on the write/implement path", async () => {
  const fake = fakeSpawn();
  const configPath = writeConfig({ confinementPolicy: "sandbox", codexSandboxMode: "danger-full-access" });

  const resolved = resolveWriteLoopBindings(writeInput(["claude", "codex"]), deps(configPath, fake.spawn));
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  const [claude, codex] = resolved.input.bindings;

  expect(claude?.confinementMechanism).toBe("refused");
  await expect(claude?.invoke({ prompt: "implement it", cwd: "/repo" })).rejects.toBeInstanceOf(
    ConfinementRefusalError,
  );
  expect(fake.calls).toHaveLength(0);

  expect(codex?.confinementMechanism).toBe("codex-workspace-write");
  await codex?.invoke({ prompt: "implement it", cwd: "/repo" });
  expect(fake.calls[0]?.argv).toEqual([
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="on-request"',
    "--model",
    "gpt-5.4",
  ]);
});

test("the per-project confinementPolicy override shadows the machine default for that project only", async () => {
  const fake = fakeSpawn();
  const configPath = writeConfig({
    confinementPolicy: "sandbox",
    projects: { demo: { overrides: { confinementPolicy: "unrestricted" } } },
  });

  const demo = resolveWriteLoopBindings(writeInput(["claude"], "demo"), deps(configPath, fake.spawn));
  const other = resolveWriteLoopBindings(writeInput(["claude"], "other"), deps(configPath, fake.spawn));
  expect(demo.ok && other.ok).toBe(true);
  if (!demo.ok || !other.ok) return;

  expect(demo.input.bindings[0]?.confinementMechanism).toBe("none");
  expect(other.input.bindings[0]?.confinementMechanism).toBe("refused");
});

test("an invalid confinementPolicy fails binding resolution with the config path named", () => {
  const fake = fakeSpawn();
  const configPath = writeConfig({ confinementPolicy: "seatbelt" });

  const resolved = resolveWriteLoopBindings(writeInput(["codex"]), deps(configPath, fake.spawn));
  expect(resolved).toEqual({
    ok: false,
    message: expect.stringContaining("Unable to resolve bindings: Machine config 'confinementPolicy' must be one of"),
  });
});
