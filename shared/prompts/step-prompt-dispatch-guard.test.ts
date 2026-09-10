import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ASSEMBLER = "shared/prompts/assemble.ts";
const RENDERER = "shared/prompts/render.ts";

/** Every way of building a step prompt other than the assembler's own entry point. */
const PARALLEL_RENDER_CALLS = ["assemblePromptForStep(", "renderStepPrompt(", "renderArtifactTemplate("] as const;

function productionSources(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "testing") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".test-support.ts"))
        continue;
      out.push([relative(REPO_ROOT, path).replace(/\\/g, "/"), readFileSync(path, "utf8")]);
    }
  };
  walk(root);
  return out;
}

test("only the shared assembler builds step prompts", () => {
  const sources = [...productionSources(join(REPO_ROOT, "shared")), ...productionSources(join(REPO_ROOT, "v2/src"))];
  expect(sources.some(([path]) => path === ASSEMBLER)).toBe(true);
  const offenders: string[] = [];
  for (const [path, source] of sources) {
    if (path === ASSEMBLER || path === RENDERER) continue;
    for (const call of PARALLEL_RENDER_CALLS) {
      if (source.includes(call)) offenders.push(`${path}: ${call}`);
    }
  }
  expect(offenders).toEqual([]);
  // Presence: the single entry point exists and is what call sites reach.
  const assembler = sources.find(([path]) => path === ASSEMBLER)?.[1] ?? "";
  expect(assembler).toContain("export function renderPromptForStep(");
  expect(sources.filter(([, source]) => source.includes("renderPromptForStep(")).length).toBeGreaterThan(5);
});
