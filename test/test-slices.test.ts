import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { v2Tests, walkV2TestFiles } from "../scripts/run-v2-tests.ts";

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

  it("test:* scripts use exact root paths with trailing slashes", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts["test:v1"]).toBe("bun test ./v1/");
    expect(pkgJson.scripts["test:shared"]).toBe("bun test ./shared/ ./test/");
    // Aggregate run is parallel for wall-clock; coverage stays sequential
    // because --parallel implies --isolate and coverage does not merge across
    // worker processes.
    expect(pkgJson.scripts.test).toBe("bun test --parallel");
    expect(pkgJson.scripts.coverage).toBe("bun test --coverage");
  });

  it("test:v2 and test:integration:v2 enumerate disjoint v2 test file sets", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts["test:v2"]).toBe("bun run scripts/run-v2-tests.ts agent");
    expect(pkgJson.scripts["test:integration:v2"]).toBe("bun run scripts/run-v2-tests.ts integration");

    const onDisk = walkV2TestFiles();
    const agent = v2Tests("agent");
    const integration = v2Tests("integration");

    expect([...agent, ...integration].sort()).toEqual(onDisk);
    expect(integration).toEqual([
      "v2/src/daemon/daemon.sandbox-unrunnable.test.ts",
      "v2/src/execution/external-worktree.sandbox-unrunnable.test.ts",
      "v2/src/ipc/ipc.sandbox-unrunnable.test.ts",
      "v2/src/persistence/log-stream.sandbox-unrunnable.test.ts",
      "v2/src/preload.sandbox-unrunnable.test.ts",
    ]);

    const runnerScript = await Bun.file("scripts/run-v2-tests.ts").text();
    expect(runnerScript).not.toContain("--parallel");
  });

  it("bunfig.toml preload points to relocated setup file", async () => {
    const bunfigText = await Bun.file("bunfig.toml").text();
    expect(bunfigText).toContain("./test/setup-fake-agents.ts");
    expect(existsSync("test/setup-fake-agents.ts")).toBeTrue();
    expect(existsSync("v1/test/setup-fake-agents.ts")).toBeFalse();
  });

  it("scoped slice runs load the agent-spawn preload", () => {
    // Strip any inherited fake-agent bin dir so the scoped run must wire the
    // preload itself. Run only the per-slice preload assertion files (not the
    // whole suites) so this stays a fast, deterministic check that the root
    // bunfig preload applies to a scoped `bun test` invocation.
    const env = {
      ...process.env,
      PATH: (process.env.PATH ?? "")
        .split(":")
        .filter((entry) => !basename(entry).startsWith("jarvis-test-fake-agents-"))
        .join(":"),
    };

    execSync("bun test ./v2/src/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
    execSync("bun test ./shared/preload.sandbox-unrunnable.test.ts", { env, stdio: "pipe" });
  }, 20_000);

  it("ready script uses aggregate test command", async () => {
    const readyScript = await Bun.file("scripts/ready.ts").text();
    // Check for the array elements that make up the test command
    expect(readyScript).toContain('"run"');
    expect(readyScript).toContain('"test"');
    // Verify it's the aggregate test, not a scoped one
    expect(readyScript).not.toContain("test:v1");
    expect(readyScript).not.toContain("test:v2");
    expect(readyScript).not.toContain("test:shared");
  });
});
