import { describe, expect, test } from "bun:test";
import { simulatedBindings } from "../testing/bindings.ts";
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

const createTestBindings = (_agentIds: readonly string[]) => simulatedBindings(["done"]);

describe("buildWriteLoopInput", () => {
  test("matches jarvis run start argv mapping for required fields with omitted optional flags", () => {
    const fromCli = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, createTestBindings);
    const fromFields = buildWriteLoopInput(FIXTURE_FIELDS, createTestBindings);

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

    const built = buildWriteLoopInputFromCliValues(values, createTestBindings);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.maxIterations).toBe(4);
    expect(built.input.bindings).toHaveLength(1);
  });

  test("resolves agents from fallbackAgents, defaulting to DEFAULT_WRITE_AGENTS when omitted", () => {
    let capturedAgents: readonly string[] | undefined;
    const capture = (agentIds: readonly string[]) => {
      capturedAgents = agentIds;
      return simulatedBindings(["done"]);
    };

    const defaulted = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, capture);
    expect(defaulted.ok).toBe(true);
    expect(capturedAgents).toEqual(["claude"]);

    const overridden = buildWriteLoopInputFromCliValues(FIXTURE_CLI_VALUES, capture, ["codex", "cursor"]);
    expect(overridden.ok).toBe(true);
    expect(capturedAgents).toEqual(["codex", "cursor"]);
  });

  test("parseWriteArgs rejects unknown flags", () => {
    expect(() => parseWriteArgs(["--unknown"])).toThrow();
  });
});
