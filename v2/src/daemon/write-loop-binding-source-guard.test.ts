import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  resetWriteLoopBindingSourceDepsForTests,
  resolveWriteLoopBindings,
  setWriteLoopBindingSourceDepsForTests,
} from "./daemon.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS = ["v2/src/daemon/daemon.ts", "v2/src/cli.ts"] as const;

function listProductionTsSourcesUnderV2Src(): string[] {
  const srcRoot = join(REPO_ROOT, "v2/src");
  const out: string[] = [];
  const walk = (absDir: string, relFromSrc: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relFromSrc ? `${relFromSrc}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(`v2/src/${rel}`);
      }
    }
  };
  walk(srcRoot, "");
  return out.sort();
}

const BINDING_SOURCE_MARKERS = [
  "resolveWriteLoopAgentModelConfig",
  "loadAgentModelConfigForWriteLoopAgents",
  "forceSnapshotAgentModelConfig",
] as const;

const minimalWriteInput = (context: NonNullable<WriteLoopInput["bindingResolution"]>): WriteLoopInput => ({
  worktree: { projectRoot: "/tmp", projectName: "p", branchName: "b", baseRef: "main" },
  specPath: "spec.md",
  stepRules: "rules",
  expectedArtifactPath: "out",
  bindings: [],
  bindingResolution: context,
});

test("only allowlisted modules call resolveWriteLoopBindings", () => {
  const callers = new Set<string>();
  for (const relPath of listProductionTsSourcesUnderV2Src()) {
    const source = readFileSync(join(REPO_ROOT, relPath), "utf-8");
    if (source.includes("resolveWriteLoopBindings(")) {
      callers.add(relPath);
    }
  }
  expect([...callers].sort()).toEqual([...ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS].sort());
});

test("daemon binding resolution re-loads from the machine profile unless the snapshot replay test hook is set", () => {
  const daemonSource = readFileSync(join(REPO_ROOT, "v2/src/daemon/daemon.ts"), "utf-8");
  for (const marker of BINDING_SOURCE_MARKERS) {
    expect(daemonSource.includes(marker)).toBe(true);
  }

  const stale: AgentModelConfig = {
    claude: { implement: { rungs: [{ adapterModel: "stale-model", priceKey: "stale" }] } },
  };
  const context: NonNullable<WriteLoopInput["bindingResolution"]> = {
    role: "implement",
    agents: ["claude"],
    agentModelConfig: stale,
  };
  const badProfileDeps = {
    machinesDir: mkdtempSync(join(tmpdir(), "jarvis-guard-machines-")),
    machineConfigPath: join(mkdtempSync(join(tmpdir(), "jarvis-guard-home-")), "config.json"),
  };
  writeFileSync(badProfileDeps.machineConfigPath, JSON.stringify({ machineProfile: "absent-profile", agents: ["claude"] }));

  setWriteLoopBindingSourceDepsForTests({ ...badProfileDeps, forceSnapshotAgentModelConfig: true });
  try {
    const resolved = resolveWriteLoopBindings(minimalWriteInput(context));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.input.bindings[0]?.id).toContain("stale-model");
    }
  } finally {
    resetWriteLoopBindingSourceDepsForTests();
  }

  setWriteLoopBindingSourceDepsForTests({ ...badProfileDeps, forceSnapshotAgentModelConfig: false });
  try {
    expect(resolveWriteLoopBindings(minimalWriteInput(context)).ok).toBe(false);
  } finally {
    resetWriteLoopBindingSourceDepsForTests();
  }
});
