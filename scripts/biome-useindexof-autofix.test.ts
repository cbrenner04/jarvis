import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

const FIXTURE_SOURCE = `export const items = ["a", "b"];
export const needle: string | undefined = items[0];
export const idx = items.findIndex((x) => x === needle);
`;

function tempBiomeConfig(): string {
  const config = JSON.parse(readFileSync(join(repoRoot, "biome.json"), "utf8")) as {
    vcs: { enabled: boolean };
  };
  config.vcs = { enabled: false };
  return JSON.stringify(config);
}

describe("biome useIndexOf autofix", () => {
  test("does not rewrite findIndex to indexOf when needle is possibly undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-biome-useindexof-"));
    try {
      writeFileSync(join(dir, "biome.json"), tempBiomeConfig());
      const fixturePath = join(dir, "example.ts");
      writeFileSync(fixturePath, FIXTURE_SOURCE);

      execFileSync(
        "bun",
        ["biome", "check", "--write", "--unsafe", fixturePath, `--config-path=${join(dir, "biome.json")}`],
        { cwd: repoRoot, stdio: "pipe" },
      );

      const output = readFileSync(fixturePath, "utf8");
      expect(output).toContain("findIndex");
      expect(output).not.toMatch(/\.indexOf\s*\(\s*needle\s*\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
