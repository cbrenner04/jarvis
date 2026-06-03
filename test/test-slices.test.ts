import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

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
    expect(pkgJson.scripts["test:v2"]).toBe("bun test ./v2/");
    expect(pkgJson.scripts["test:shared"]).toBe("bun test ./shared/");
    expect(pkgJson.scripts.test).toBe("bun test");
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
        .filter(
          (entry) => !basename(entry).startsWith("jarvis-test-fake-agents-"),
        )
        .join(":"),
    };

    execSync("bun run test:v2", { env, stdio: "pipe" });
    execSync("bun run test:shared", { env, stdio: "pipe" });
  });

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
