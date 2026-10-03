import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import {
  type OwnershipKey,
  type PromoteQueuedRunDeps,
  promoteQueuedRunImpl,
  WorktreeOwnershipRegistry,
  type WriteLoopBindingSourceDeps,
} from "./daemon.ts";

let profileHome: string;
let machinesDir: string;
let previousJarvisHome: string | undefined;
let writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps;
const MACHINE_PROFILE = "queue-promotion-profile";

function rung(adapterModel: string) {
  return { rungs: [{ adapterModel, priceKey: adapterModel }] };
}

function queuePromotionProfileModels(codexImplement: string[]): AgentModelConfig {
  const bundle = {
    plan: rung("plan"),
    implement: { rungs: codexImplement.map((adapterModel) => ({ adapterModel, priceKey: adapterModel })) },
    shrink: rung("shrink"),
    adversary: rung("adv"),
    critic: rung("crit"),
    advocate: rung("advoc"),
    adjudicator: rung("adj"),
    actuator: rung("act"),
    routing: rung("act"),
  };
  return {
    codex: bundle,
    cursor: { ...bundle, implement: rung("cursor-fast") },
  };
}

function installQueuePromotionProfile(codexImplement: string[]): void {
  mkdirSync(machinesDir, { recursive: true });
  writeFileSync(
    join(machinesDir, `${MACHINE_PROFILE}.json`),
    JSON.stringify({ models: queuePromotionProfileModels(codexImplement) }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: MACHINE_PROFILE, agents: ["codex", "cursor"] }),
  );
  writeLoopBindingSourceDeps = {
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  };
}

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: {
    implement: {
      rungs: [
        { adapterModel: "codex-fast", priceKey: "codex-fast" },
        { adapterModel: "codex-deep", priceKey: "codex-deep" },
      ],
    },
  },
  cursor: {
    implement: {
      rungs: [{ adapterModel: "cursor-fast", priceKey: "cursor-fast" }],
    },
  },
};

beforeEach(() => {
  profileHome = trackedMkdtempSync(join(tmpdir(), `jarvis-queue-promotion-profile-${process.pid}-`));
  machinesDir = join(profileHome, "machines");
  previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  installQueuePromotionProfile(["codex-fast", "codex-deep"]);
  createFakeWriteLoopExecutor();
});

afterEach(() => {
  if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = previousJarvisHome;
  rmSync(profileHome, { recursive: true, force: true });
});

function createUnitStore(): { store: StateStore; dbPath: string } {
  const dbPath = join(tmpdir(), `jarvis-state-queue-promotion-unit-${process.pid}-${Date.now()}-${Math.random()}.db`);
  return { store: openStateStore(dbPath), dbPath };
}

function createFakeSpawnWriteLoop(registry: WorktreeOwnershipRegistry) {
  const calls: Array<{ key: OwnershipKey; runId: string; worktreePath: string; bindingIds: string[] }> = [];
  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    calls.push({ key, runId, worktreePath, bindingIds: input.bindings.map((binding) => binding.id) });
    registry.claim(key, { runId, worktreePath });
  };
  return { spawnWriteLoop, calls };
}

function queueRun(store: StateStore, branch: string): string {
  return store.createRun({
    project: branch,
    specRef: "main",
    worktreePath: `/tmp/${branch}/worktree`,
    branch,
    specPath: "/tmp/test-project/spec.md",
    status: "queued",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: "workflow-1",
      steps: [
        {
          stepId: "step-1",
          role: "implement",
          stepRules: "test rules",
          expectedArtifactPath: "/tmp/test-project/artifact",
          agents: ["codex", "cursor"],
          agentModelConfig: AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
}

function createPromotionHarness(
  overrides: Partial<Pick<PromoteQueuedRunDeps, "checkMemoryHeadroom" | "settleDelayMs">> = {},
) {
  const { store, dbPath } = createUnitStore();
  const registry = new WorktreeOwnershipRegistry();
  const { spawnWriteLoop, calls } = createFakeSpawnWriteLoop(registry);
  const deps: PromoteQueuedRunDeps = {
    store,
    registry,
    checkMemoryHeadroom: () => true,
    settleDelayMs: () => 0,
    settleState: { suppressedUntil: 0 },
    spawnWriteLoop,
    writeLoopBindingSourceDeps,
    ...overrides,
  };
  return {
    store,
    calls,
    promote: (bypassSettleDelay?: boolean) => promoteQueuedRunImpl(deps, bypassSettleDelay),
    cleanup: (): void => {
      store.close();
      rmSync(dbPath, { force: true });
    },
  };
}

test("promoteQueuedRunImpl leaves queued runs queued", () => {
  const { store, calls, promote, cleanup } = createPromotionHarness();
  try {
    const runIdA = queueRun(store, "project-a");
    const runIdB = queueRun(store, "project-b");

    promote();

    expect(store.loadRun(runIdA)?.status).toBe("queued");
    expect(store.loadRun(runIdB)?.status).toBe("queued");
    expect(calls).toEqual([]);
  } finally {
    cleanup();
  }
});

test("promotion against a closed store is a no-op instead of an unhandled throw", () => {
  const { store } = createUnitStore();
  const registry = new WorktreeOwnershipRegistry();
  const { spawnWriteLoop, calls } = createFakeSpawnWriteLoop(registry);
  store.close();

  expect(() =>
    promoteQueuedRunImpl({
      store,
      registry,
      checkMemoryHeadroom: () => true,
      settleDelayMs: () => 0,
      settleState: { suppressedUntil: 0 },
      spawnWriteLoop,
    }),
  ).not.toThrow();
  expect(calls).toEqual([]);
});
