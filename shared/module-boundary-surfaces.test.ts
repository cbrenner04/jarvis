import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizePlanDraftSpecDir } from "./module-boundary-surfaces.ts";

const scratchRoot = resolve(".scratch");
const tempDirs: string[] = [];

function scratchDir(name: string): string {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(join(scratchRoot, `module-boundary-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function stageDraft(dir: string, subspecs: Readonly<Record<string, string>>): void {
  const links = Object.keys(subspecs)
    .map((file) => `- [ ] [${file.slice(3, -3)}](./${file})`)
    .join("\n");
  writeFileSync(join(dir, "index.md"), `# Authored plan\n\n${links}\n`);
  writeFileSync(join(dir, "intent.md"), "# Authored intent\n");
  for (const [file, body] of Object.entries(subspecs)) writeFileSync(join(dir, file), body);
}

function treeBytes(dir: string): Map<string, Buffer> {
  return new Map(
    readdirSync(dir)
      .sort()
      .map((file) => [file, readFileSync(join(dir, file))]),
  );
}

function section(body: string, heading: string): string {
  const start = body.indexOf(`${heading}\n`);
  if (start === -1) return "";
  const contentStart = start + heading.length + 1;
  const end = body.indexOf("\n## ", contentStart);
  return body.slice(contentStart, end === -1 ? undefined : end);
}

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("plan draft normalization", () => {
  test("keeps authored files, titles, and problems when criteria name jarvis surfaces", () => {
    const dir = scratchDir("jarvis-vocabulary");
    const subspecs = {
      "03-run-lifecycle.md":
        "# Run lifecycle\n\n## Problem\n\nKeep this exact lifecycle framing.\n\n## Acceptance criteria\n\n- [ ] `v2/src/daemon/host.ts` reloads runs.\n- [ ] The state-store persists runs.\n",
      "07-status-copy.md":
        "# Status copy\n\n## Problem\n\nKeep this exact copy framing.\n\n## Acceptance criteria\n\n- [ ] Status text stays concise.\n",
    };
    stageDraft(dir, subspecs);
    const before = treeBytes(dir);

    normalizePlanDraftSpecDir(dir);

    expect(treeBytes(dir)).toEqual(before);
    for (const [file, authored] of Object.entries(subspecs)) {
      const retained = readFileSync(join(dir, file), "utf8");
      expect(retained.split("\n", 1)[0]).toBe(authored.split("\n", 1)[0]);
      expect(section(retained, "## Problem")).toBe(section(authored, "## Problem"));
    }
  });

  test("does not classify product vocabulary", () => {
    const dir = scratchDir("product-vocabulary");
    stageDraft(dir, {
      "00-session-preferences.md":
        "# Session preferences\n\n## Problem\n\nPreserve the product draft.\n\n## Acceptance criteria\n\n- [ ] The preference persists across relaunch.\n- [ ] A feature flag controls rollout.\n",
    });
    const before = treeBytes(dir);

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
    expect(treeBytes(dir)).toEqual(before);
  });

  test("leaves a subspec with zero acceptance criteria authored and unnumbered", () => {
    const dir = scratchDir("empty-criteria");
    stageDraft(dir, {
      "04-empty.md": "# Empty criteria\n\n## Problem\n\nKeep this placeholder intact.\n\n## Acceptance criteria\n",
      "09-cross-cutting.md":
        "# Cross-cutting\n\n## Problem\n\nKeep this title and numbering.\n\n## Acceptance criteria\n\n- [ ] The daemon reads the state-store.\n- [ ] The CLI displays the result.\n",
    });
    const before = treeBytes(dir);

    normalizePlanDraftSpecDir(dir);

    expect(treeBytes(dir)).toEqual(before);
  });

  test("rejects unknown, duplicate, and missing index links", () => {
    const unknown = scratchDir("unknown-link");
    stageDraft(unknown, { "00-known.md": "# Known\n" });
    writeFileSync(join(unknown, "index.md"), "# Plan\n\n- [ ] [Unknown](./00-unknown.md)\n");
    expect(() => normalizePlanDraftSpecDir(unknown)).toThrow("Plan index links unknown subspec 00-unknown.md");

    const duplicate = scratchDir("duplicate-link");
    stageDraft(duplicate, { "00-known.md": "# Known\n" });
    writeFileSync(
      join(duplicate, "index.md"),
      "# Plan\n\n- [ ] [Known](./00-known.md)\n- [ ] [Known again](./00-known.md)\n",
    );
    expect(() => normalizePlanDraftSpecDir(duplicate)).toThrow("Plan index links 00-known.md more than once");

    const missing = scratchDir("missing-link");
    stageDraft(missing, { "00-known.md": "# Known\n", "01-unlinked.md": "# Unlinked\n" });
    writeFileSync(join(missing, "index.md"), "# Plan\n\n- [ ] [Known](./00-known.md)\n");
    expect(() => normalizePlanDraftSpecDir(missing)).toThrow("Plan index does not link 01-unlinked.md");
  });

  test("production modules import no retired surface-classification export", () => {
    const retired = [
      "MODULE_BOUNDARY_SURFACES",
      "ModuleBoundarySurface",
      "classifyModuleBoundaryText",
      "moduleBoundariesForAcceptanceCriteria",
      "spansMultipleModuleBoundaries",
      "orderModuleBoundariesForSplit",
      "referencedArtifactPaths",
      "splitResiduePattern",
    ];
    const offenders = [resolve("shared"), resolve("v2/src")]
      .flatMap(typescriptFiles)
      .filter((file) => file !== resolve("shared/module-boundary-surfaces.ts"))
      .flatMap((file) => {
        const body = readFileSync(file, "utf8");
        const imports = [
          ...body.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*module-boundary-surfaces\.ts["']/gsu),
        ];
        return imports.flatMap((match) =>
          retired
            .filter((name) => new RegExp(`\\b${name}\\b`, "u").test(match[1] ?? ""))
            .map((name) => `${file}: ${name}`),
        );
      });

    expect(offenders).toEqual([]);
  });
});
