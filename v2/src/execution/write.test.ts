import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWrite } from "./write.ts";

const { roots } = trackedTempRoots();

function runWrite(args: {
  jarvisRoot: string;
  bindings: readonly InvocationBinding[];
  artifactPath?: string;
  invocationTelemetry?: Parameters<typeof executeWrite>[0]["invocationTelemetry"];
  promptId?: string;
  promptPlaceholders?: Record<string, string>;
}) {
  // Track the parent directory of jarvisRoot for cleanup
  roots.push(join(args.jarvisRoot, ".."));
  return executeWrite({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    ...(args.invocationTelemetry !== undefined ? { invocationTelemetry: args.invocationTelemetry } : {}),
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.promptPlaceholders !== undefined ? { promptPlaceholders: args.promptPlaceholders } : {}),
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  });
}

function capturingBinding(onPrompt: (prompt: string) => void): InvocationBinding {
  return {
    id: "agent",
    invoke: async ({ prompt, cwd }) => {
      onPrompt(prompt);
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    },
  };
}

describe("write behavior", () => {
  test("happy path: done plus artifact contract pass returns complete", async () => {
    const { jarvisRoot } = createJarvisHome();
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
  });

  test("quota fallback success: second binding completes", async () => {
    const { jarvisRoot } = createJarvisHome();
    const calls: string[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "first",
        invoke: async () => {
          calls.push("first");
          return { kind: "quota", stderr: "quota" };
        },
      },
      {
        id: "second",
        invoke: async ({ cwd }) => {
          calls.push("second");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
    expect(calls).toEqual(["first", "second"]);
  });

  test("terminal contract miss returns non-success result", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }),
        },
      ],
    });

    expect(result.result.kind).toBe("contract_miss");
  });

  test("blocked token returns blocked without contract pass", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "blocked", stderr: "" }),
        },
      ],
    });

    expect(result.result.kind).toBe("blocked");
  });

  test("progress token returns non-success without retry", async () => {
    const { jarvisRoot } = createJarvisHome();
    let calls = 0;
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            calls += 1;
            return { kind: "ok", stdout: "progress", stderr: "" };
          },
        },
      ],
    });

    expect(result.result.kind).toBe("progress");
    expect(calls).toBe(1);
  });

  test("default prompt id renders write.execute with restraint principles", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";
    await runWrite({ jarvisRoot, bindings: [capturingBinding((prompt) => (capturedPrompt = prompt))] });

    expect(capturedPrompt).toContain("Read the spec at ");
    expect(capturedPrompt).toContain("spec.md.");
    expect(capturedPrompt).toContain("# Restraint principles");
    expect(capturedPrompt).toContain("Return exactly one terminal token.");
  });

  test("non-default prompt id renders the caller-supplied placeholder map", async () => {
    const { jarvisRoot } = createJarvisHome();
    let capturedPrompt = "";
    await runWrite({
      jarvisRoot,
      bindings: [capturingBinding((prompt) => (capturedPrompt = prompt))],
      promptId: "plan.prompt.draft",
      promptPlaceholders: {
        WORKDIR: "/tmp/work",
        NAME: "example-spec",
        INTENT: "Do the thing.",
        SPEC_GUIDANCE: "Follow the guidance.",
      },
    });

    expect(capturedPrompt).toContain("`/tmp/work`");
    expect(capturedPrompt).toContain("`example-spec`");
    expect(capturedPrompt).not.toContain("Read the spec at");
  });

  test("intentSeed branch: agent-instructed write path matches the seeded/validated spec directory", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-00Z-demo";
    const intentSeed = "---\nname: demo\n---\n\n## Prerequisites\n\nnone\n";
    let capturedPrompt = "";

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "plan-run", baseRef: "HEAD", jarvisRoot },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt, cwd }) => {
            capturedPrompt = prompt;
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "index.md"), "# Index\n", "utf8");
            writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).toBe("complete");
    const expectedSpecDir = join(result.worktreePath, specPath);
    expect(capturedPrompt).toContain(`Only write files under \`${expectedSpecDir}/\`.`);
    expect(capturedPrompt).not.toContain("spec/<NAME>/");

    const intentPath = join(result.worktreePath, specPath, "intent.md");
    expect(existsSync(intentPath)).toBe(true);
    expect(readFileSync(intentPath, "utf8")).toBe(intentSeed);
  });

  test("intentSeed branch: a genuine blocker in intent.md short-circuits completion", async () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const specPath = "v2/spec/2099-01-01T00-00-01Z-blocked";
    const intentSeed = "---\nname: blocked\n---\n\n## Prerequisites\n\nnone\n";

    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "plan-run-blocked", baseRef: "HEAD", jarvisRoot },
      specPath,
      stepRules: "unused",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            const specDir = join(cwd, specPath);
            mkdirSync(specDir, { recursive: true });
            writeFileSync(join(specDir, "intent.md"), `${intentSeed}\n## Blocker\n\nMissing prerequisite X.\n`, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });

    expect(result.result.kind).not.toBe("complete");
  });

  test("telemetry append failure is surfaced separately without changing the settled step result", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          metadata: { agent: "claude", model: "m1" },
          invoke: async ({ cwd }) => {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      invocationTelemetry: {
        sink: {
          append() {
            throw new Error("disk full");
          },
        },
        operatorSessionId: "session-1",
        runId: "run-1",
        attemptId: "attempt-1",
        project: "demo",
        workflow: "write",
        stepId: null,
        role: "implement",
        branch: "write-run",
        specRef: "HEAD",
        invocationIds: ["inv-1"],
      },
    });

    expect(result.result.kind).toBe("complete");
    expect(result.result.invocation.telemetryFailures).toEqual([
      { invocationId: "inv-1", bindingId: "agent", message: "disk full" },
    ]);
  });
});
