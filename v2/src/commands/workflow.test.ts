import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { originTrackingRefResolvesAsync } from "../../../shared/git.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { withExternalWorktree } from "../execution/external-worktree.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { AnyWorkflowStep, ReviewDebateWorkflowStep, ReviewWorkflowStep } from "../execution/workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import {
  type CliRepoFixture,
  COMPLETED_WAIT_JSON,
  COMPLETED_WAIT_RESULT,
  captureIo,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  withWorkflowUuids,
  workflowFrames,
  writeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { STALE_RESET_OVERRIDE_CLI_FLAG } from "./cleanup.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

const IMPLEMENT_ARGS = [
  "run",
  "workflow",
  "implement",
  "--branch",
  "implement-run",
  "--base",
  "HEAD",
  "--spec",
  "index.md",
] as const;

const IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty]\n";
const INTENT_USAGE =
  "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n";
const PLAN_USAGE =
  "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty]\n";

const REJECT_BASE_ARGS = {
  implement: IMPLEMENT_ARGS,
  intent: ["run", "workflow", "intent", "--seed-text", "Improve API"],
  "intent-reviewed": ["run", "workflow", "intent-reviewed", "--seed-text", "Improve API"],
  plan: ["run", "workflow", "plan", "--ready-intent", "spec/ready-intents/demo.md"],
  "plan-reviewed": ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md"],
  "plan-reviewed-light": ["run", "workflow", "plan-reviewed-light", "--ready-intent", "spec/ready-intents/demo.md"],
} as const;

function noDaemonDeps(extra: NonNullable<Parameters<typeof main>[2]> = {}): NonNullable<Parameters<typeof main>[2]> {
  return {
    connectIpcClient: async () => {
      throw new Error("should not contact daemon");
    },
    ...extra,
  };
}

describe("run workflow dispatch", () => {
  test("run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-888", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: `run-888\n${COMPLETED_WAIT_JSON}\n`, stderr: "" });
    expect(builtInput).toMatchObject({
      cwd: fx.repoSub,
      branchName: "implement-run",
      baseRef: "HEAD",
      specPath: "index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: fx.repoRoot } },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "run-888" } });
  });

  test("run workflow dispatches once to the connected daemon without stopping or restarting it", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let connections = 0;
    await withWorkflowUuids("start", "wait", async () => {
      const code = await main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => {
          connections += 1;
          return makeIpcClient(workflowFrames("start", "wait", "workflow-1", COMPLETED_WAIT_RESULT), { sent });
        },
        stopDaemon: async () => {
          throw new Error("should not stop");
        },
        startDaemon: async () => {
          throw new Error("should not start");
        },
      });
      expect(code).toBe(0);
    });
    expect(connections).toBe(1);
    expect(sent.map((frame) => (frame as { method?: string }).method)).toEqual(["start", "wait"]);
  });

  test("run workflow implement rejects --no-auto-bounce as unknown before daemon contact", async () => {
    const cap = captureIo();

    const code = await main([...IMPLEMENT_ARGS, "--no-auto-bounce"], cap.io, noDaemonDeps({ cwd: () => fx.repoSub }));

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: IMPLEMENT_USAGE });
  });

  test("run workflow implement blocks on completion and exits with proper exit code when workflow fails", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-failed", { runStatus: "failed" }), { sent }),
      }),
    );

    expect(code).toBe(3);
    expect(cap.read().stdout).toContain("run-failed");
    expect(cap.read().stdout).toContain('{"runStatus":"failed"}');
    expect(sent).toHaveLength(2);
  });

  test("run workflow implement passes through daemon guard errors without local workflow logic", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";

    const code = await withFixedUuid(requestId, () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: requestId,
              code: "run_in_progress",
              message: "A run is already in progress; at most one in-flight run globally",
            },
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run workflow implement exits nonzero on an invalid daemon response", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";

    const code = await withFixedUuid(requestId, () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => makeIpcClient([{ kind: "response", id: requestId, result: { runId: 123 } }]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });

  test("run workflow implement missing required flags prints usage and exits 1 without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "implement", "--branch", "implement-run"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: IMPLEMENT_USAGE });
  });

  test("run workflow with an unrecognized preset name prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "bogus"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });

  test("run workflow rejects inherited preset names without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "toString"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });

  test("bare run workflow prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow"], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n" });
  });
});

describe("review-passes and review-behavior resolution", () => {
  test.each([
    ["implement", "--review-passes", "1x", IMPLEMENT_USAGE],
    ["implement", "--review-behavior", "heavy", IMPLEMENT_USAGE],
    ["intent", "--review-passes", "1x", INTENT_USAGE],
    ["intent-reviewed", "--review-passes", "invalid", INTENT_USAGE],
    ["plan", "--review-passes", "1x", PLAN_USAGE],
    ["plan-reviewed", "--review-passes", "-1", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "-1", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "1x", PLAN_USAGE],
    ["plan-reviewed-light", "--review-passes", "1.5", PLAN_USAGE],
    ["plan-reviewed-light", "--review-behavior", "heavy", PLAN_USAGE],
  ] as [
    keyof typeof REJECT_BASE_ARGS,
    string,
    string,
    string,
  ][])("run workflow %s rejects %s %s before daemon contact", async (preset, flag, value, usage) => {
    const cap = captureIo();

    const code = await main([...REJECT_BASE_ARGS[preset], flag, value], cap.io, noDaemonDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: usage });
  });

  test.each([
    [
      "reviewPasses",
      { reviewPasses: -1 },
      "projects.test-project.implement.reviewPasses must be a non-negative integer\n",
    ],
    [
      "reviewBehavior",
      { reviewBehavior: "heavy" },
      'projects.test-project.implement.reviewBehavior must be "debate" or "light"\n',
    ],
  ] as [
    string,
    Record<string, unknown>,
    string,
  ][])("run workflow implement rejects invalid project implement.%s before daemon contact", async (_key, implement, stderr) => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot, implement } } });

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe(stderr);
  });

  test.each([
    ["--review-passes with no project default", undefined, ["--review-passes", "2"], "reviewPasses", 2],
    [
      "project reviewPasses (left to the builder) when flag omitted",
      { reviewPasses: 3 },
      [],
      "reviewPasses",
      undefined,
    ],
    ["--review-passes over project reviewPasses", { reviewPasses: 3 }, ["--review-passes", "1"], "reviewPasses", 1],
    [
      "project reviewBehavior (left to the builder) when flag omitted",
      { reviewBehavior: "light" },
      [],
      "reviewBehavior",
      undefined,
    ],
    [
      "--review-behavior debate over project reviewBehavior",
      { reviewBehavior: "light" },
      ["--review-behavior", "debate"],
      "reviewBehavior",
      "debate",
    ],
  ] as [
    string,
    Record<string, unknown> | undefined,
    string[],
    string,
    unknown,
  ][])("run workflow implement resolves %s before daemon start", async (_label, implement, extraArgs, key, expected) => {
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;
    const machineConfigDeps =
      implement === undefined
        ? {}
        : { machineConfigPath: writeMachineConfig({ projects: { "test-project": { root: fx.repoRoot, implement } } }) };

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS, ...extraArgs], cap.io, {
        cwd: () => fx.repoSub,
        ...machineConfigDeps,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    if (expected === undefined) {
      expect(builtInput).not.toHaveProperty(key);
    } else {
      expect(builtInput).toMatchObject({ [key]: expected });
    }
  });
});

describe("review-role timeout resolution", () => {
  function fakeReviewStep(): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "implement-run",
      agents: { critic: ["claude"], actuator: ["claude"] },
      agentModelConfig: {},
      cwd: fx.repoRoot,
      verdictPath: "verdict.md",
      maxCycles: 1,
    };
  }

  function fakeReviewDebateStep(): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "review-debate",
      project: "demo",
      branch: "implement-run",
      agents: {
        adversary: ["claude"],
        advocate: ["claude"],
        adjudicator: ["claude"],
        actuator: ["claude"],
      },
      agentModelConfig: {},
      cwd: fx.repoRoot,
      verdictPath: "verdict.md",
      maxCycles: 1,
      prompts: { adversary: "a", advocate: "b", adjudicator: "c" },
    };
  }

  test("stamps the default reviewRoleTimeoutMs onto review steps when unconfigured", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-default", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review", roleTimeoutMs: 1_800_000 });
  });

  test("stamps a configured reviewRoleTimeoutMs onto review steps", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 900_000 });

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-configured", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review", roleTimeoutMs: 900_000 });
  });

  test("stamps the default reviewRoleTimeoutMs onto review-debate steps when unconfigured", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewDebateStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-debate-default", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review-debate", roleTimeoutMs: 1_800_000 });
  });

  test("stamps a configured reviewRoleTimeoutMs onto review-debate steps", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 900_000 });

    const code = await withWorkflowUuids("start", "wait", () =>
      main([...IMPLEMENT_ARGS], cap.io, {
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewDebateStep()] }),
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-review-debate-configured", COMPLETED_WAIT_RESULT), {
            sent,
          }),
      }),
    );

    expect(code).toBe(0);
    const sentSteps = (sent[0] as { params: { steps: AnyWorkflowStep[] } }).params.steps;
    expect(sentSteps[1]).toMatchObject({ behavior: "review-debate", roleTimeoutMs: 900_000 });
  });

  test("rejects a non-positive reviewRoleTimeoutMs before daemon contact", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ reviewRoleTimeoutMs: 0 });

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: [...fx.fakeImplementSteps.slice(0, 1), fakeReviewStep()] }),
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("Machine config 'reviewRoleTimeoutMs' must be a positive number\n");
  });
});

describe("implement spec and artifact validation", () => {
  test("run workflow implement derives branch from spec parent dirname when branch is omitted", async () => {
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "implement", "--base", "main", "--spec", "v2/spec/my-spec/index.md"], cap.io, {
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "run-derived-branch", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-derived-branch");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
    expect(builtInput).toMatchObject({
      cwd: fx.repoRoot,
      baseRef: "main",
      specPath: "v2/spec/my-spec/index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: fx.repoRoot } },
    });
  });

  test("run workflow implement requires --artifact for non-index specs and surfaces error without daemon contact", async () => {
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md"],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoRoot,
        readProjectRegistry: () => ({ "test-project": { root: fx.repoRoot } }),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Non-index spec requires --artifact");
  });

  test("run workflow implement rejects a missing spec before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const cap = captureIo();
    const built = false;

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "missing.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(cap.read().stderr).toContain(`Spec path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects a cwd-visible spec unavailable from the base ref before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-base-ref-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "local-spec/\n", "utf8");
    writeFileSync(join(root, "README.md"), "seed\n", "utf8");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    mkdirSync(join(root, "local-spec"));
    writeFileSync(join(root, "local-spec", "index.md"), "- [ ] Work\n", "utf8");
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "HEAD", "--spec", "local-spec/index.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("Spec path unavailable in base ref HEAD: local-spec/index.md\n");
  });

  test("run workflow implement rejects a missing non-index artifact before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "spec.md"), "# Spec\n", "utf8");
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "missing.md"],
      cap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(`Artifact path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects escaping spec and artifact symlinks before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const outside = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-outside-"));
    writeFileSync(join(outside, "outside.md"), "# Outside\n", "utf8");
    symlinkSync(join(outside, "outside.md"), join(root, "escaped.md"));
    writeFileSync(join(root, "spec.md"), "# Spec\n", "utf8");
    const specCap = captureIo();

    const specCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "escaped.md"],
      specCap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );
    expect(specCode).toBe(1);
    expect(specCap.read().stderr).toContain("Spec path outside registered project roots");

    symlinkSync(join(outside, "outside.md"), join(root, "escaped-artifact.md"));
    const artifactCap = captureIo();
    const artifactCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "escaped-artifact.md"],
      artifactCap.io,
      noDaemonDeps({ cwd: () => root, readProjectRegistry: () => ({ project: { root } }) }),
    );
    expect(artifactCode).toBe(1);
    expect(artifactCap.read().stderr).toContain("Artifact path outside registered project root");
  });

  test("run workflow implement accepts contained symlinks and passes relative paths to the builder", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "spec.md"), "# Spec\n", "utf8");
    writeFileSync(join(root, "specs", "artifact.md"), "# Artifact\n", "utf8");
    symlinkSync(join(root, "specs", "spec.md"), join(root, "spec-link.md"));
    symlinkSync(join(root, "specs", "artifact.md"), join(root, "artifact-link.md"));
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "spec-link.md", "--artifact", "artifact-link.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({
      specPath: "spec-link.md",
      artifactPath: "artifact-link.md",
    });
  });

  test("run workflow implement ignores an unresolved registry root unrelated to the spec", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), "# Index\n", "utf8");
    const cap = captureIo();

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "implement", "--base", "main", "--spec", "index.md"], cap.io, {
        cwd: () => root,
        readProjectRegistry: () => ({ stale: { root: join(root, "missing") }, project: { root } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: fx.fakeImplementSteps }) },
        connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow implement ignores --artifact for index specs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), "# Index\n", "utf8");
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "index.md", "--artifact", "missing.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () => makeIpcClient(workflowFrames("start", "wait", "run-1", COMPLETED_WAIT_RESULT)),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ specPath: "index.md", artifactPath: "missing.md" });
  });

  test("run workflow implement surfaces a builder error without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({ cwd: () => fx.unregistered, readProjectRegistry: () => ({}) }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Spec path outside registered project roots");
  });

  test("run workflow implement reports an already-complete spec without daemon contact", async () => {
    const cap = captureIo();
    const teardownCalls: string[] = [];
    const code = await main(
      [...IMPLEMENT_ARGS],
      cap.io,
      noDaemonDeps({
        cwd: () => fx.repoSub,
        subprocessRunner: {
          runAsync: async (cmd, args, cwd) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? fx.repoRoot);
          },
        },
        workflowPresetBuilders: {
          implement: () => ({
            ok: false,
            error: "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria",
          }),
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe(
      "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria\n",
    );
    expect(teardownCalls).toEqual([]);
  });
});

describe("implement preflight stale workspace reset", () => {
  let resetTmp: string;
  let resetProjectRoot: string;
  let resetJarvisRoot: string;
  const resetBranch = "implement-run";

  function resetImplementSteps(branch = resetBranch): AnyWorkflowStep[] {
    return [
      {
        behavior: "write",
        stepId: "implement",
        role: "implement",
        promptId: "patch.prompt.body",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        agents: ["claude"],
        agentModelConfig: {},
        worktree: {
          projectRoot: realpathSync(resetProjectRoot),
          projectName: "demo",
          branchName: branch,
          baseRef: "HEAD",
        },
        specPath: "index.md",
        expectedArtifactPath: "index.md",
      },
    ];
  }

  function resetImplementDeps(overrides: NonNullable<Parameters<typeof main>[2]> = {}) {
    return {
      cwd: () => resetProjectRoot,
      jarvisRoot: resetJarvisRoot,
      readProjectRegistry: () => ({ demo: { root: resetProjectRoot } }),
      workflowPresetBuilders: {
        implement: () => ({ ok: true as const, steps: resetImplementSteps() }),
      },
      ...overrides,
    } as NonNullable<Parameters<typeof main>[2]>;
  }

  async function materializeStaleWorktree(branch = resetBranch): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], resetProjectRoot);
    const worktreePath = join(resetJarvisRoot, "worktrees", "demo", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], resetProjectRoot);
    return worktreePath;
  }

  function staleResetSubprocessRunner(
    intercept?: (cmd: string, args: string[]) => string | undefined | Promise<string | undefined>,
    closedPrs?: number[],
  ): AsyncSubprocessRunner {
    return {
      runAsync: async (cmd, args, cwd) => {
        const intercepted = intercept ? await intercept(cmd, args) : undefined;
        if (intercepted !== undefined) return intercepted;
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 55, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          if (closedPrs) closedPrs.push(Number(args[2]));
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
      },
    };
  }

  beforeEach(async () => {
    resetTmp = mkdtempSync(join(tmpdir(), "jarvis-cli-reset-"));
    resetProjectRoot = join(resetTmp, "project");
    resetJarvisRoot = join(resetTmp, "jarvis-home");
    mkdirSync(resetProjectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], resetProjectRoot);
    writeFileSync(join(resetProjectRoot, "index.md"), "# Index\n", "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], resetProjectRoot);
  });

  afterEach(() => {
    rmSync(resetTmp, { recursive: true, force: true });
  });

  test("run workflow implement resets a stale worktree before daemon start", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner = staleResetSubprocessRunner(undefined, closedPrs);

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-reset", COMPLETED_WAIT_RESULT), { sent }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([55]);
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
    expect(sent).toHaveLength(2);
  });

  test("run workflow implement prints destroyed-artifact summary when retirement succeeds and dispatch fails", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();

    const subprocessRunner = staleResetSubprocessRunner();

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-reset-fail", { runStatus: "failed" })),
        }),
      ),
    );

    expect(code).toBe(3);
    const { stderr } = cap.read();
    expect(stderr).toContain("Retirement destroyed artifacts:");
    expect(stderr).toContain(`  worktree: ${worktreePath}`);
    expect(stderr).toContain(`  local branch: ${resetBranch}`);
    expect(stderr).toContain(`  remote branch: ${resetBranch}`);
    expect(stderr).toContain("  PR: #55");
  });

  test("run workflow implement prints partial destroyed-artifact summary when retirement aborts mid-sequence", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();

    const subprocessRunner = staleResetSubprocessRunner((cmd, args) => {
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
        throw new Error("branch delete failed");
      }
      return undefined;
    });

    const code = await main(
      ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
      cap.io,
      resetImplementDeps({
        subprocessRunner,
        connectIpcClient: async () => makeIpcClient([]),
      }),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toContain("Retirement destroyed artifacts:");
    expect(stderr).toContain(`  worktree: ${worktreePath}`);
    expect(stderr).not.toContain("  local branch:");
    expect(stderr).not.toContain("  remote branch:");
    expect(stderr).not.toContain("  PR: #");
  });

  test("run workflow plan resets a stale worktree before daemon start", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 56, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          closedPrs.push(Number(args[2]));
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
      },
    };

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "plan", "--ready-intent", "index.md"],
        cap.io,
        resetImplementDeps({
          workflowPresetBuilders: {
            plan: () => ({ ok: true as const, steps: resetImplementSteps() }),
          },
          subprocessRunner,
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-reset-plan", COMPLETED_WAIT_RESULT), { sent }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([56]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
  });

  test("run workflow implement refuses reset when the workspace is live-held", async () => {
    await materializeStaleWorktree();
    const lockPath = join(resetJarvisRoot, "worktree-locks", "demo", resetBranch, ".jarvis.lock");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
      cap.io,
      resetImplementDeps({
        subprocessRunner: {
          runAsync: async (cmd, args) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
              return JSON.stringify([{ number: 77, isDraft: true }]);
            }
            return realAsyncSubprocessRunner.runAsync(cmd, args, resetProjectRoot);
          },
        },
        connectIpcClient: async () => makeIpcClient([]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(`Cannot re-run incomplete spec: process ${process.pid} holds worktree lock`);
  });

  test("run workflow implement refuses reset when the managed worktree is dirty", async () => {
    const worktreePath = await materializeStaleWorktree();
    const dirtyFile = "agent-leftover.txt";
    writeFileSync(join(worktreePath, dirtyFile), "uncommitted\n", "utf8");
    const cap = captureIo();
    const teardownCalls: string[] = [];

    const code = await main(
      ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
      cap.io,
      resetImplementDeps({
        subprocessRunner: {
          runAsync: async (cmd, args, cwd) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
              return JSON.stringify([{ number: 88, isDraft: true }]);
            }
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
          },
        },
        connectIpcClient: async () => makeIpcClient([]),
      }),
    );

    expect(code).toBe(1);
    const { stderr } = cap.read();
    expect(stderr).toContain("Cannot re-run incomplete spec:");
    expect(stderr).toContain(dirtyFile);
    expect(stderr).toContain("commit");
    expect(stderr).toContain("discard");
    expect(stderr).toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
    expect(stderr).toContain("jarvis cleanup --abandon");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
  });

  test("run workflow implement resets stale dirty worktree when override switch is set", async () => {
    const worktreePath = await materializeStaleWorktree();
    writeFileSync(join(worktreePath, "agent-leftover.txt"), "uncommitted\n", "utf8");
    const cap = captureIo();
    const sent: unknown[] = [];

    const closedPrs: number[] = [];
    const subprocessRunner = staleResetSubprocessRunner(undefined, closedPrs);

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        [
          "run",
          "workflow",
          "implement",
          "--branch",
          resetBranch,
          "--base",
          "HEAD",
          "--spec",
          "index.md",
          STALE_RESET_OVERRIDE_CLI_FLAG,
        ],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-reset-dirty", COMPLETED_WAIT_RESULT), { sent }),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(closedPrs).toEqual([55]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).not.toContain(worktreePath);
    expect(sent).toHaveLength(2);
  });

  test("run workflow implement performs no reset teardown on a fresh run", async () => {
    const cap = captureIo();
    const teardownCalls: string[] = [];

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner: {
            runAsync: async (cmd, args, cwd) => {
              if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
              if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
              return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-fresh", COMPLETED_WAIT_RESULT)),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(teardownCalls).toEqual([]);
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
  });

  test("run workflow implement prints no destroyed-artifact summary when dispatch is unreachable", async () => {
    const worktreePath = await materializeStaleWorktree();
    const cap = captureIo();
    let connectAttempted = false;
    const teardownCalls: string[] = [];

    const code = await main(
      ["run", "workflow", "implement", "--branch", resetBranch, "--base", "HEAD", "--spec", "index.md"],
      cap.io,
      resetImplementDeps({
        subprocessRunner: {
          runAsync: async (cmd, args, cwd) => {
            if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
            if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
            if (cmd === "git" && args[0] === "push" && args[2] === "--delete") teardownCalls.push("remote-delete");
            return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? resetProjectRoot);
          },
        },
        connectIpcClient: async () => {
          connectAttempted = true;
          throw new Error("Failed to connect to daemon on socket mock");
        },
        startDaemon: async () => {
          throw new Error("Failed to start daemon");
        },
      }),
    );

    expect(code).toBe(1);
    expect(connectAttempted).toBe(true);
    expect(cap.read().stderr).toContain("Failed to start daemon");
    expect(cap.read().stderr).not.toContain("Retirement destroyed artifacts:");
    expect(teardownCalls).toEqual([]);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], resetProjectRoot);
    expect(list).toContain(worktreePath);
    const branchList = await realAsyncSubprocessRunner.runAsync("git", ["branch"], resetProjectRoot);
    expect(branchList).toContain(resetBranch);
  });

  test("redispatch-materializes-from-base-after-preflight-reset-stale-remote-tracking-ref", async () => {
    const cap = captureIo();
    const originRoot = join(resetTmp, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["init", "--bare", originRoot], resetTmp);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], resetProjectRoot);
    mkdirSync(join(resetProjectRoot, "node_modules"), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", "HEAD"], resetProjectRoot);

    const baseHead = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], resetProjectRoot)).trim();
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "-b", resetBranch], resetProjectRoot);
    writeFileSync(join(resetProjectRoot, "stale-advance.md"), "stale\n", "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "stale advance"], resetProjectRoot);
    const staleTip = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], resetProjectRoot)).trim();
    expect(staleTip).not.toBe(baseHead);
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", resetBranch], resetProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${resetBranch}`], originRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", baseHead], resetProjectRoot);

    const worktreePath = join(resetJarvisRoot, "worktrees", "demo", resetBranch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, resetBranch], resetProjectRoot);
    expect(await originTrackingRefResolvesAsync(resetProjectRoot, resetBranch, realAsyncSubprocessRunner)).toBe(true);

    const subprocessRunner = staleResetSubprocessRunner();
    const baseStep = resetImplementSteps()[0];
    if (baseStep === undefined || baseStep.behavior !== "write") {
      throw new Error("expected implement write step");
    }
    const stepsWithBase: AnyWorkflowStep[] = [
      {
        ...baseStep,
        worktree: { ...baseStep.worktree, baseRef: baseHead },
      },
    ];

    const code = await withWorkflowUuids("start", "wait", () =>
      main(
        ["run", "workflow", "implement", "--branch", resetBranch, "--base", baseHead, "--spec", "index.md"],
        cap.io,
        resetImplementDeps({
          subprocessRunner,
          workflowPresetBuilders: {
            implement: () => ({ ok: true as const, steps: stepsWithBase }),
          },
          connectIpcClient: async () =>
            makeIpcClient(workflowFrames("start", "wait", "run-redispatch-stale-origin", COMPLETED_WAIT_RESULT)),
        }),
      ),
    );

    expect(code).toBe(0);
    expect(await originTrackingRefResolvesAsync(resetProjectRoot, resetBranch, realAsyncSubprocessRunner)).toBe(false);

    await withExternalWorktree(
      {
        projectRoot: resetProjectRoot,
        projectName: "demo",
        branchName: resetBranch,
        baseRef: baseHead,
        jarvisRoot: resetJarvisRoot,
      },
      async (worktree) => {
        const branchTip = (
          await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", resetBranch], resetProjectRoot)
        ).trim();
        expect(branchTip).toBe(baseHead);
        const worktreeHead = (
          await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], worktree.path)
        ).trim();
        expect(worktreeHead).toBe(baseHead);
      },
      subprocessRunner,
    );
  });
});

describe("intent and plan presets", () => {
  test("run workflow intent builds seed text before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let received: unknown;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent", "--seed-text", "Improve API"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          intent: (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "intent-1", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-1" } });
    expect(cap.read().stdout).toContain("intent-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent rejects invalid seed arguments before daemon contact", async () => {
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "intent", "--seed", "one", "--seed-text", "two"],
      cap.io,
      noDaemonDeps(),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: INTENT_USAGE });
  });

  test("run workflow intent-reviewed builds seed text with default review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let received: unknown;

    const code = await withWorkflowUuids("start", "wait", () =>
      main(["run", "workflow", "intent-reviewed", "--seed-text", "Improve API"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          "intent-reviewed": (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(workflowFrames("start", "wait", "intent-reviewed-1", COMPLETED_WAIT_RESULT), { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-1" } });
    expect(cap.read().stdout).toContain("intent-reviewed-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent-reviewed accepts review-passes before daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000009";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(["run", "workflow", "intent-reviewed", "--seed-text", "Improve API", "--review-passes", "2"], cap.io, {
        cwd: () => fx.repoRoot,
        workflowPresetBuilders: {
          "intent-reviewed": (input) => {
            received = input;
            return { ok: true, steps: fx.fakeImplementSteps };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            [
              { kind: "response", id: requestId, result: { runId: "intent-reviewed-2" } },
              { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
            ],
            { sent },
          ),
      }),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: fx.repoRoot, seedText: "Improve API", reviewPasses: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: fx.fakeImplementSteps } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `intent-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use intent --review-passes 1 --review-behavior light\n",
    });
  });

  test("run workflow plan-reviewed routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000010";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(
        ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md", "--review-passes", "2"],
        cap.io,
        {
          cwd: () => fx.repoRoot,
          workflowPresetBuilders: {
            "plan-reviewed": (input) => {
              received = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({
      cwd: fx.repoRoot,
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior debate\n",
    });
  });

  test("run workflow plan-reviewed-light routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000011";
    let received: unknown;

    const code = await withFixedUuid(requestId, () =>
      main(
        [
          "run",
          "workflow",
          "plan-reviewed-light",
          "--ready-intent",
          "spec/ready-intents/demo.md",
          "--review-passes",
          "2",
        ],
        cap.io,
        {
          cwd: () => fx.repoRoot,
          workflowPresetBuilders: {
            "plan-reviewed-light": (input) => {
              received = input;
              return { ok: true, steps: fx.fakeImplementSteps };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-light-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(received).toMatchObject({
      cwd: fx.repoRoot,
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-light-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-light-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior light\n",
    });
  });
});
