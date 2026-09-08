import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { locateSymbolSlice } from "../../../shared/structural-test-locator.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { resolveWriteLoopBindings } from "./daemon.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const RESOLVE_WRITE_LOOP_BINDINGS_EXPORT = /export\s+function\s+resolveWriteLoopBindings\b/;
const RESOLVE_WRITE_LOOP_BINDINGS_CALL = /resolveWriteLoopBindings\s*\(/;
const RESOLVE_WRITE_LOOP_BINDINGS_IMPORT =
  /import\s+(?:type\s+)?\{[^}]*\bresolveWriteLoopBindings\b[^}]*\}\s+from\s+["']([^"']+)["']/g;
type ProductionSources = Readonly<Record<string, string>>;

const BINDING_SOURCE_MARKERS = [
  "resolveWriteLoopAgentModelConfig",
  "loadAgentModelConfigForWriteLoopAgents",
  "forceSnapshotAgentModelConfig",
] as const;

// Pre-fix hardcoded allowlist; red-gates when the binding seam moves to a sibling module.
const ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS = [
  "v2/src/daemon/daemon.ts",
  "v2/src/daemon/daemon-run-lifecycle-handlers.ts",
] as const;

function listProductionSourcesUnderV2Src(): ProductionSources {
  const srcRoot = join(REPO_ROOT, "v2/src");
  const sources: Record<string, string> = {};
  const walk = (absDir: string, relFromSrc: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relFromSrc ? `${relFromSrc}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources[`v2/src/${rel}`] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(srcRoot, "");
  return sources;
}

function resolveTsImport(fromRepoPath: string, importSpecifier: string): string {
  const resolved = normalize(join(dirname(join(REPO_ROOT, fromRepoPath)), importSpecifier));
  const rel = resolved.startsWith(REPO_ROOT) ? resolved.slice(REPO_ROOT.length + 1) : resolved;
  return rel.endsWith(".ts") ? rel : `${rel}.ts`;
}

function resolverOwnerPaths(sources: ProductionSources): string[] {
  return Object.entries(sources)
    .filter(([, source]) => RESOLVE_WRITE_LOOP_BINDINGS_EXPORT.test(source))
    .map(([path]) => path)
    .sort();
}

function importsFromResolverExportSurface(path: string, source: string, exportSurface: ReadonlySet<string>): boolean {
  for (const match of source.matchAll(RESOLVE_WRITE_LOOP_BINDINGS_IMPORT)) {
    const importSpecifier = match[1];
    if (importSpecifier === undefined) continue;
    if (exportSurface.has(resolveTsImport(path, importSpecifier))) return true;
  }
  return false;
}

export function discoverResolveWriteLoopBindingsCallers(sources: ProductionSources): string[] {
  return Object.entries(sources)
    .filter(([, source]) => RESOLVE_WRITE_LOOP_BINDINGS_CALL.test(source))
    .map(([path]) => path)
    .sort();
}

export function resolveWriteLoopBindingsCallSurface(sources: ProductionSources): string[] {
  const exportSurface = new Set(resolverOwnerPaths(sources));
  return discoverResolveWriteLoopBindingsCallers(sources).filter(
    (path) => exportSurface.has(path) || importsFromResolverExportSurface(path, sources[path] ?? "", exportSurface),
  );
}

/** Pre-fix allowlist equality; red-gates when the resolver seam moves to a sibling module. */
export function allowlistPinnedCallerGuard(sources: ProductionSources): boolean {
  const callers = discoverResolveWriteLoopBindingsCallers(sources);
  return JSON.stringify(callers) === JSON.stringify([...ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS].sort());
}

export function locateBindingResolutionSourceSlice(sources: ProductionSources): string {
  const ownerSources = resolverOwnerPaths(sources).map((path) => sources[path] ?? "");
  return locateSymbolSlice({
    candidates: ownerSources,
    start: "function resolveWriteLoopAgentModelConfig",
    end: "export function resolveWriteLoopBindings",
    searchKey: "resolveWriteLoopAgentModelConfig",
  });
}

/** Pre-fix daemon.ts-only marker pins; vacuous pass when markers linger in daemon.ts after extraction. */
export function daemonOnlyBindingSourceMarkerGuard(sources: ProductionSources): boolean {
  const daemonSource = sources["v2/src/daemon/daemon.ts"] ?? "";
  return BINDING_SOURCE_MARKERS.every((marker) => daemonSource.includes(marker));
}

const minimalWriteInput = (context: NonNullable<WriteLoopInput["bindingResolution"]>): WriteLoopInput => ({
  worktree: { projectRoot: "/tmp", projectName: "p", branchName: "b", baseRef: "main" },
  specPath: "spec.md",
  stepRules: "rules",
  expectedArtifactPath: "out",
  bindings: [],
  bindingResolution: context,
});

test("only allowlisted modules call resolveWriteLoopBindings", () => {
  const sources = listProductionSourcesUnderV2Src();
  expect(discoverResolveWriteLoopBindingsCallers(sources)).toEqual(resolveWriteLoopBindingsCallSurface(sources));
  expect(allowlistPinnedCallerGuard(sources)).toBe(true);

  const withSiblingCaller = {
    ...sources,
    "v2/src/daemon/daemon-write-loop-binding.ts": [
      'import { resolveWriteLoopBindings } from "./daemon.ts";',
      "export function promoteQueuedBinding(input: unknown, deps: unknown) {",
      "  return resolveWriteLoopBindings(input, deps);",
      "}",
    ].join("\n"),
  };
  expect(allowlistPinnedCallerGuard(withSiblingCaller)).toBe(false);
  expect(discoverResolveWriteLoopBindingsCallers(withSiblingCaller)).toEqual(
    resolveWriteLoopBindingsCallSurface(withSiblingCaller),
  );
});

test("daemon binding resolution re-loads from the machine profile unless the snapshot replay test hook is set", () => {
  const sources = listProductionSourcesUnderV2Src();
  const bindingSourceSlice = locateBindingResolutionSourceSlice(sources);
  for (const marker of BINDING_SOURCE_MARKERS) {
    expect(bindingSourceSlice.includes(marker)).toBe(true);
  }
  expect(daemonOnlyBindingSourceMarkerGuard(sources)).toBe(true);

  const vacuousDaemonOnlyMarkers = {
    ...sources,
    "v2/src/daemon/daemon-write-loop-binding.ts": [
      "function loadAgentModelConfigForWriteLoopAgents(agents: string[], deps: unknown) { return {}; }",
      "function resolveWriteLoopAgentModelConfig(context: unknown, deps: { forceSnapshotAgentModelConfig?: boolean }) {",
      "  if (deps.forceSnapshotAgentModelConfig) return context;",
      "  return loadAgentModelConfigForWriteLoopAgents([], deps);",
      "}",
      "export function resolveWriteLoopBindings(input: unknown, deps: unknown) {",
      "  resolveWriteLoopAgentModelConfig(input, deps);",
      "  return { ok: true, input };",
      "}",
    ].join("\n"),
    "v2/src/daemon/daemon.ts": [
      "// resolveWriteLoopAgentModelConfig",
      "// loadAgentModelConfigForWriteLoopAgents",
      "export type WriteLoopBindingSourceDeps = { forceSnapshotAgentModelConfig?: boolean };",
      'export { resolveWriteLoopBindings } from "./daemon-write-loop-binding.ts";',
    ].join("\n"),
  };
  expect(daemonOnlyBindingSourceMarkerGuard(vacuousDaemonOnlyMarkers)).toBe(true);
  expect(
    locateBindingResolutionSourceSlice(vacuousDaemonOnlyMarkers).includes("loadAgentModelConfigForWriteLoopAgents"),
  ).toBe(true);

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
  writeFileSync(
    badProfileDeps.machineConfigPath,
    JSON.stringify({ machineProfile: "absent-profile", agents: ["claude"] }),
  );

  const resolved = resolveWriteLoopBindings(minimalWriteInput(context), {
    ...badProfileDeps,
    forceSnapshotAgentModelConfig: true,
  });
  expect(resolved.ok).toBe(true);
  if (resolved.ok) {
    expect(resolved.input.bindings[0]?.id).toContain("stale-model");
  }

  expect(
    resolveWriteLoopBindings(minimalWriteInput(context), { ...badProfileDeps, forceSnapshotAgentModelConfig: false })
      .ok,
  ).toBe(false);
});
