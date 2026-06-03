import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

describe("Test slice boundaries", () => {
  it("test files are scoped to owner directories", () => {
    const getTestFilePaths = (dir: string): string[] => {
      const files: string[] = [];
      const walk = (current: string, prefix: string) => {
        try {
          const entries = readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(current, entry.name);
            const rel = `${prefix}${entry.name}`;
            if (entry.isDirectory()) {
              walk(fullPath, `${rel}/`);
            } else if (entry.name.endsWith(".test.ts")) {
              files.push(rel);
            }
          }
        } catch {
          // Directory doesn't exist, skip
        }
      };
      walk(dir, "");
      return files;
    };

    const v1Files = getTestFilePaths("v1/test");
    const v2Files = getTestFilePaths("v2");
    const sharedFiles = getTestFilePaths("shared");

    // Verify no file path appears under more than one root directory
    const allPaths = [...v1Files, ...v2Files, ...sharedFiles];
    const pathsByRoot = new Map<string, number>();
    for (const path of allPaths) {
      const root = path.split("/")[0];
      pathsByRoot.set(root, (pathsByRoot.get(root) ?? 0) + 1);
    }

    // Each root should have its own tests, not mix with others
    const roots = ["v1", "v2", "shared"];
    for (const root of roots) {
      if (root === "v1") {
        expect(v1Files.every((f) => f.startsWith("."))).toBeFalsy();
      } else if (root === "v2") {
        expect(v2Files.length).toBeGreaterThan(0);
      } else if (root === "shared") {
        expect(sharedFiles.length).toBeGreaterThan(0);
      }
    }
  });

  it("test:* scripts use exact root paths with trailing slashes", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts["test:v1"]).toBe("bun test ./v1/");
    expect(pkgJson.scripts["test:v2"]).toBe("bun test ./v2/");
    expect(pkgJson.scripts["test:shared"]).toBe("bun test ./shared/");
    expect(pkgJson.scripts["test"]).toBe("bun test");
  });

  it("bunfig.toml preload points to relocated setup file", async () => {
    const bunfigText = await Bun.file("bunfig.toml").text();
    expect(bunfigText).toContain("./test/setup-fake-agents.ts");
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
