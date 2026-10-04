import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { sliceTests, walkSliceTestFiles } from "../scripts/run-slice-tests.ts";
import { aggregateTestFiles } from "../scripts/run-tests.ts";
import {
  isLoadSensitive,
  isSandboxUnrunnable,
  partitionTestFiles,
  planTestBatches,
  readTestIsolationClass,
} from "../scripts/test-slice.ts";

describe("Test slice boundaries", () => {
  it("unified v2 discovery includes v2, shared runtime, test harness, and scripts roots", () => {
    const files = walkSliceTestFiles();
    expect(files.some((file) => file.startsWith("src/") && !file.startsWith("src/shared/"))).toBeTrue();
    expect(files.some((file) => file.startsWith("src/shared/"))).toBeTrue();
    expect(files.some((file) => file.startsWith("test/"))).toBeTrue();
    expect(files.some((file) => file.startsWith("scripts/"))).toBeTrue();
  });

  it("test:* scripts route sandbox-unrunnable files to integration slices", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts.test).toBe("bun run scripts/run-tests.ts");
    expect(pkgJson.scripts["test:shared"]).toBeUndefined();
    expect(pkgJson.scripts["test:integration:shared"]).toBeUndefined();
    expect(pkgJson.scripts.coverage).toBe("bun test --coverage ./src/ ./test/");
  });

  it("frozen v1 tree is outside every test slice", () => {
    const { agent, integration } = aggregateTestFiles();
    expect([...agent, ...integration].some((file) => file.startsWith("v1/"))).toBeFalse();
    expect(existsSync("scripts/run-v1-tests.ts")).toBeFalse();
  });

  it("package.json scripts contain no :v2 slice labels", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    for (const name of Object.keys(pkgJson.scripts)) {
      expect(name.includes(":v2")).toBeFalse();
    }
  });

  it("test:agent and test:integration enumerate disjoint agent test file sets", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts["test:agent"]).toBe("bun run scripts/run-slice-tests.ts agent");
    expect(pkgJson.scripts["test:integration"]).toBe("bun run scripts/run-slice-tests.ts integration");

    const onDisk = walkSliceTestFiles();
    const agent = sliceTests("agent");
    const integration = sliceTests("integration");

    expect(agent.every((file) => !isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.every((file) => isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.length).toBeGreaterThan(0);
    expect([...agent, ...integration].sort()).toEqual(onDisk);

    const runnerScript = await Bun.file("scripts/run-slice-tests.ts").text();
    expect(runnerScript).toContain('spawn("bun", ["test", file]');
  });

  it("v2 integration slice derives from sandbox-unrunnable filename convention", () => {
    const testFiles = [
      "src/example/foo.test.ts",
      "src/example/foo.sandbox-unrunnable.test.ts",
      "src/other/bar.test.ts",
    ];

    const { agent, integration } = partitionTestFiles(testFiles);

    expect(agent).toEqual(["src/example/foo.test.ts", "src/other/bar.test.ts"]);
    expect(integration).toEqual(["src/example/foo.sandbox-unrunnable.test.ts"]);
  });

  it("known load-sensitive daemon files are classified load-sensitive", () => {
    expect(isLoadSensitive("src/daemon/daemon-workflow-start.test.ts")).toBeTrue();
    expect(isLoadSensitive("src/execution/runtime-smoke-verifier.test.ts")).toBeTrue();
    expect(isLoadSensitive("src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts")).toBeTrue();
  });

  it("audited heavy files are classified load-sensitive", () => {
    // @mutate scripts/test-slice.ts "src/daemon/daemon-resume.test.ts" -> "src/daemon/daemon-resume-pooled.test.ts"
    expect(isLoadSensitive("src/daemon/daemon-resume.test.ts")).toBeTrue();
    expect(isLoadSensitive("src/execution/write-loop.test.ts")).toBeFalse();
    // The former workflow-runner.test.ts monolith was split into pooled workflow-runner-*.test.ts
    // files (durable #2181 fix); no split file is load-sensitive without dated evidence.
    expect(isLoadSensitive("src/execution/workflow-runner-core.test.ts")).toBeFalse();

    // Audited candidates that stayed pooled: survived two concurrent-load rounds with no observed
    // failure, so they carry no dated evidence to join the lane (2026-08-18 audit).
    expect(isLoadSensitive("src/daemon/daemon-process-log.test.ts")).toBeFalse();
  });

  it("isLoadSensitive is distinct from isSandboxUnrunnable", () => {
    const suffixMatchedNotListed = "src/example/other.sandbox-unrunnable.test.ts";
    expect(isSandboxUnrunnable(suffixMatchedNotListed)).toBeTrue();
    expect(isLoadSensitive(suffixMatchedNotListed)).toBeTrue();

    const poolable = "src/example/other.test.ts";
    expect(isSandboxUnrunnable(poolable)).toBeFalse();
    expect(isLoadSensitive(poolable)).toBeFalse();
  });

  it("classifies the workflow poll-until-done declaration from its real source", () => {
    const file = "src/commands/workflow.test.ts";
    const source = readFileSync(file, "utf8");

    expect(source).toContain("waitForCompletion");
    expect(readTestIsolationClass(file, source)).toBe("poll-until-done");
    expect(isLoadSensitive(file)).toBeFalse();
    expect(isLoadSensitive("src/execution/diff-derived-mutation-verifier.test.ts")).toBeFalse();
  });

  it("plans declared classes and load-sensitive files in fixed batch order", () => {
    const sources = new Map([
      ["poll-a.test.ts", 'export const TEST_ISOLATION_CLASS = "poll-until-done";'],
      ["poll-b.test.ts", 'export const TEST_ISOLATION_CLASS = "poll-until-done";'],
      ["spawn.test.ts", 'export const TEST_ISOLATION_CLASS = "subprocess-spawning";'],
      ["isolated.sandbox-unrunnable.test.ts", 'export const TEST_ISOLATION_CLASS = "subprocess-spawning";'],
      ["plain.test.ts", ""],
    ]);
    const files = [
      "spawn.test.ts",
      "poll-a.test.ts",
      "isolated.sandbox-unrunnable.test.ts",
      "plain.test.ts",
      "poll-b.test.ts",
    ];
    const classOf = (file: string) => readTestIsolationClass(file, sources.get(file) ?? "");

    expect(planTestBatches(files, classOf)).toEqual([
      ["poll-a.test.ts", "plain.test.ts", "poll-b.test.ts"],
      ["spawn.test.ts"],
      ["isolated.sandbox-unrunnable.test.ts"],
    ]);
  });

  it("rejects conflicting and unrecognized isolation declarations", () => {
    const both = [
      'export const TEST_ISOLATION_CLASS = "poll-until-done";',
      'export const TEST_ISOLATION_CLASS = "subprocess-spawning";',
    ].join("\n");

    expect(() => readTestIsolationClass("both.test.ts", both)).toThrow("multiple TEST_ISOLATION_CLASS declarations");
    expect(() =>
      readTestIsolationClass("unknown.test.ts", 'export const TEST_ISOLATION_CLASS = "network-heavy";'),
    ).toThrow("unrecognized TEST_ISOLATION_CLASS");
  });

  it("v2 integration slice includes shared preload real-process test", () => {
    expect(sliceTests("integration")).toContain("src/shared/preload.sandbox-unrunnable.test.ts");
    expect(sliceTests("agent").some((file) => file.endsWith("git.test.ts"))).toBeTrue();
  });

  it("bunfig.toml preload points to relocated setup file", async () => {
    const bunfigText = await Bun.file("bunfig.toml").text();
    expect(bunfigText).toContain("./test/setup-fake-agents.ts");
    expect(existsSync("test/setup-fake-agents.ts")).toBeTrue();
  });

  it("scoped slice runs load the agent-spawn preload", () => {
    const env = {
      ...process.env,
      PATH: (process.env.PATH ?? "")
        .split(":")
        .filter((entry) => !basename(entry).startsWith("jarvis-test-fake-agents-"))
        .join(":"),
    };

    execSync("bun test ./src/testing/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
    execSync("bun test ./src/shared/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
  }, 20_000);

  it("ready script uses aggregate test command", async () => {
    const readyScript = await Bun.file("scripts/ready.ts").text();
    expect(readyScript).toContain('"run"');
    expect(readyScript).toContain('"test"');
    expect(readyScript).not.toContain("test:agent");
    expect(readyScript).not.toContain("test:shared");
  });

  it("aggregate roster matches unified v2 slice rosters", () => {
    expect(aggregateTestFiles()).toEqual({ agent: sliceTests("agent"), integration: sliceTests("integration") });
  });

  it("policy parity: aggregate and v2 files share per-file timeout and subprocess isolation", async () => {
    const runV2TestsScript = await Bun.file("scripts/run-slice-tests.ts").text();
    const runTestsScript = await Bun.file("scripts/run-tests.ts").text();

    expect(runV2TestsScript).toContain("SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000");
    expect(runV2TestsScript).toContain("PER_FILE_TIMEOUT_MS = SUPPORTED_HEALTHY_FILE_BUDGET_MS");
    expect(runV2TestsScript).toContain('spawn("bun", ["test", file]');
    expect(runV2TestsScript).toContain("timeout: PER_FILE_TIMEOUT_MS");
    expect(runV2TestsScript).toContain('child.kill("SIGKILL")');

    expect(runTestsScript).toMatch(/runSliceTestFiles\([^)]*\)/);
  });

  it("policy parity: agent-mode timeout diagnostics vs stop-admitting-on-failure behavior", async () => {
    const runV2TestsScript = await Bun.file("scripts/run-slice-tests.ts").text();

    expect(runV2TestsScript).toContain('if (mode !== "agent")');
    expect(runV2TestsScript).toContain("stopAdmitting = true");
    expect(runV2TestsScript).toContain("continue");
  });

  it("policy parity: the integration phase routes through the shared pooled seam, not a bare spawnSync loop", async () => {
    const runTestsScript = await Bun.file("scripts/run-tests.ts").text();

    expect(runTestsScript).not.toContain("spawnSync");
    expect((runTestsScript.match(/runSliceTestFiles\(/g) ?? []).length).toBe(2);
    expect(runTestsScript).toContain('runSliceTestFiles("integration", integration');
  });
});
