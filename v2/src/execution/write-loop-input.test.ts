import { describe, expect, test } from "bun:test";
import { buildWriteLoopInput, buildWriteLoopInputFromCliValues, parseWriteArgs } from "./write-loop-input.ts";

const FIXTURE_CLI_VALUES = {
  "project-root": "/tmp/repo",
  project: "demo",
  branch: "write-run",
  base: "HEAD",
  spec: "spec.md",
  artifact: "proof.txt",
};

const FIXTURE_FIELDS = {
  projectRoot: FIXTURE_CLI_VALUES["project-root"],
  projectName: FIXTURE_CLI_VALUES.project,
  branchName: FIXTURE_CLI_VALUES.branch,
  baseRef: FIXTURE_CLI_VALUES.base,
  specPath: FIXTURE_CLI_VALUES.spec,
  artifactPath: FIXTURE_CLI_VALUES.artifact,
};

const RUNG = { rungs: [{ adapterModel: "m1", priceKey: "p1" }] };
const FIXTURE_AGENT_MODEL_CONFIG = { claude: { implement: RUNG } };

describe("buildWriteLoopInput", () => {
  test("matches jarvis run start argv mapping for required fields with omitted optional flags", () => {
    const fromCli = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, FIXTURE_AGENT_MODEL_CONFIG);
    const fromFields = buildWriteLoopInput(FIXTURE_FIELDS, FIXTURE_AGENT_MODEL_CONFIG);

    expect(fromCli.ok).toBe(true);
    expect(fromFields.ok).toBe(true);
    if (!fromCli.ok || !fromFields.ok) return;
    expect(fromCli.input).toMatchObject({
      worktree: fromFields.input.worktree,
      specPath: fromFields.input.specPath,
      stepRules: fromFields.input.stepRules,
      expectedArtifactPath: fromFields.input.expectedArtifactPath,
    });
    expect("maxIterations" in fromCli.input).toBe(false);
  });

  test("includes optional maxIterations when provided", () => {
    const values = {
      ...FIXTURE_CLI_VALUES,
      "max-iterations": "4",
    };

    const built = buildWriteLoopInputFromCliValues(values, FIXTURE_AGENT_MODEL_CONFIG);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.maxIterations).toBe(4);
    expect(built.input.bindingResolution?.agentModelConfig).toEqual(FIXTURE_AGENT_MODEL_CONFIG);
  });

  test("resolves agents from fallbackAgents into bindingResolution, defaulting to DEFAULT_WRITE_AGENTS", () => {
    const defaulted = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, FIXTURE_AGENT_MODEL_CONFIG);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.input.bindingResolution).toEqual({
      role: "implement",
      agents: ["claude"],
      agentModelConfig: FIXTURE_AGENT_MODEL_CONFIG,
    });

    const overridden = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, FIXTURE_AGENT_MODEL_CONFIG, [
      "codex",
      "cursor",
    ]);
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.input.bindingResolution?.agents).toEqual(["codex", "cursor"]);
    expect(overridden.input.bindings).toHaveLength(0);
  });

  test("parseWriteArgs rejects unknown flags", () => {
    expect(() => parseWriteArgs(["--unknown"])).toThrow();
  });
});
