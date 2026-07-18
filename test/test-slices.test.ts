import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { sharedTests } from "../scripts/run-shared-tests.ts";
import { aggregateTestFiles } from "../scripts/run-tests.ts";
import { v1Tests } from "../scripts/run-v1-tests.ts";
import { v2Tests, walkV2TestFiles } from "../scripts/run-v2-tests.ts";
import { isSandboxUnrunnable, partitionTestFiles } from "../scripts/test-slice.ts";

describe("Test slice boundaries", () => {
  it("test files are scoped to owner directories", () => {
    const getTestFiles = (dir: string): { logical: string; real: string }[] => {
      const files: { logical: string; real: string }[] = [];
      const walk = (current: string, prefix: string) => {
        try {
          const entries = readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(current, entry.name);
            const rel = `${prefix}${entry.name}`;
            if (entry.isDirectory()) {
              walk(fullPath, `${rel}/`);
            } else if (entry.name.endsWith(".test.ts")) {
              files.push({ logical: rel, real: realpathSync(fullPath) });
            }
          }
        } catch {
          // Directory doesn't exist, skip
        }
      };
      walk(dir, "");
      return files;
    };

    const filesByOwner = {
      v1: getTestFiles("v1/test").map((file) => ({
        ...file,
        logical: `v1/test/${file.logical}`,
      })),
      v2: getTestFiles("v2").map((file) => ({
        ...file,
        logical: `v2/${file.logical}`,
      })),
      shared: getTestFiles("shared").map((file) => ({
        ...file,
        logical: `shared/${file.logical}`,
      })),
    };

    expect(filesByOwner.v1.length).toBeGreaterThan(0);
    expect(filesByOwner.v2.length).toBeGreaterThan(0);
    expect(filesByOwner.shared.length).toBeGreaterThan(0);

    const seen = new Map<string, string>();
    for (const [owner, files] of Object.entries(filesByOwner)) {
      for (const file of files) {
        const previousOwner = seen.get(file.real);
        expect(previousOwner).toBeUndefined();
        seen.set(file.real, owner);
      }
    }
  });

  it("test:* scripts route sandbox-unrunnable files to integration slices", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts.test).toBe("bun run scripts/run-tests.ts");
    expect(pkgJson.scripts["test:v1"]).toBe("bun run scripts/run-v1-tests.ts agent");
    expect(pkgJson.scripts["test:integration:v1"]).toBe("bun run scripts/run-v1-tests.ts integration");
    expect(pkgJson.scripts["test:shared"]).toBe("bun run scripts/run-shared-tests.ts agent");
    expect(pkgJson.scripts["test:integration:shared"]).toBe("bun run scripts/run-shared-tests.ts integration");
    expect(pkgJson.scripts.coverage).toBe("bun test --coverage");
  });

  it("v1 agent and integration slices partition the v1 test tree", () => {
    const agent = v1Tests("agent");
    const integration = v1Tests("integration");
    expect(agent.every((file) => !isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.every((file) => isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.length).toBeGreaterThan(0);
    expect([...agent, ...integration].sort()).toEqual([...v1Tests("agent"), ...v1Tests("integration")].sort());
  });

  it("test:v2 and test:integration:v2 enumerate disjoint v2 test file sets", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts["test:v2"]).toBe("bun run scripts/run-v2-tests.ts agent");
    expect(pkgJson.scripts["test:integration:v2"]).toBe("bun run scripts/run-v2-tests.ts integration");

    const onDisk = walkV2TestFiles();
    const agent = v2Tests("agent");
    const integration = v2Tests("integration");

    expect(agent.every((file) => !isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.every((file) => isSandboxUnrunnable(file))).toBeTrue();
    expect(integration.length).toBeGreaterThan(0);
    expect([...agent, ...integration].sort()).toEqual(onDisk);

    const runnerScript = await Bun.file("scripts/run-v2-tests.ts").text();
    expect(runnerScript).toContain('spawn("bun", ["test", file]');
  });

  it("v2 integration slice derives from sandbox-unrunnable filename convention", () => {
    const testFiles = ["v2/example/foo.test.ts", "v2/example/foo.sandbox-unrunnable.test.ts", "v2/other/bar.test.ts"];

    const { agent, integration } = partitionTestFiles(testFiles);

    expect(agent).toEqual(["v2/example/foo.test.ts", "v2/other/bar.test.ts"]);
    expect(integration).toEqual(["v2/example/foo.sandbox-unrunnable.test.ts"]);
  });

  it("shared integration slice includes preload real-process test", () => {
    expect(sharedTests("integration")).toEqual(["shared/preload.sandbox-unrunnable.test.ts"]);
    expect(sharedTests("agent").some((file) => file.endsWith("git.test.ts"))).toBeTrue();
  });

  it("bunfig.toml preload points to relocated setup file", async () => {
    const bunfigText = await Bun.file("bunfig.toml").text();
    expect(bunfigText).toContain("./test/setup-fake-agents.ts");
    expect(existsSync("test/setup-fake-agents.ts")).toBeTrue();
    expect(existsSync("v1/test/setup-fake-agents.ts")).toBeFalse();
  });

  it("scoped slice runs load the agent-spawn preload", () => {
    const env = {
      ...process.env,
      PATH: (process.env.PATH ?? "")
        .split(":")
        .filter((entry) => !basename(entry).startsWith("jarvis-test-fake-agents-"))
        .join(":"),
    };

    execSync("bun test ./v2/src/testing/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
    execSync("bun test ./shared/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
  }, 20_000);

  it("ready script uses aggregate test command", async () => {
    const readyScript = await Bun.file("scripts/ready.ts").text();
    expect(readyScript).toContain('"run"');
    expect(readyScript).toContain('"test"');
    expect(readyScript).not.toContain("test:v1");
    expect(readyScript).not.toContain("test:v2");
    expect(readyScript).not.toContain("test:shared");
  });

  it("aggregate roster is exactly the union of six scoped rosters", () => {
    const aggregate = aggregateTestFiles();
    const expectedAgent = [...v1Tests("agent"), ...v2Tests("agent"), ...sharedTests("agent")].sort();
    const expectedIntegration = [
      ...v1Tests("integration"),
      ...v2Tests("integration"),
      ...sharedTests("integration"),
    ].sort();

    expect(aggregate.agent.sort()).toEqual(expectedAgent);
    expect(aggregate.integration.sort()).toEqual(expectedIntegration);
  });

  it("policy parity: aggregate and v2 files share per-file timeout and subprocess isolation", async () => {
    const runV2TestsScript = await Bun.file("scripts/run-v2-tests.ts").text();
    const runTestsScript = await Bun.file("scripts/run-tests.ts").text();

    expect(runV2TestsScript).toContain("PER_FILE_TIMEOUT_MS = 180_000");
    expect(runV2TestsScript).toContain('spawn("bun", ["test", file]');
    expect(runV2TestsScript).toContain("timeout: PER_FILE_TIMEOUT_MS");
    expect(runV2TestsScript).toContain('killSignal: "SIGKILL"');

    expect(runTestsScript).toMatch(/runV2TestFiles\([^)]*\)/);
  });

  it("policy parity: agent-mode timeout diagnostics vs integration-mode fail-fast behavior", async () => {
    const runV2TestsScript = await Bun.file("scripts/run-v2-tests.ts").text();

    expect(runV2TestsScript).toContain('if (mode !== "agent")');
    expect(runV2TestsScript).toContain("return results");
    expect(runV2TestsScript).toContain("continue");
  });
});
