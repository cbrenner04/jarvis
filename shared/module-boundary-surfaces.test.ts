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
  test("accepts a bullet naming one path alongside dotted identifiers and numeric literals", () => {
    const dir = scratchDir("dotted-identifiers");
    stageDraft(dir, {
      "00-fields.md":
        "# Fields\n\n## Problem\n\nFraming.\n\n## Acceptance criteria\n\n- [ ] `v2/src/state/store.ts` exposes `run.finishedAtMs` at `0.0038492` per token via `test.skipIf`.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("still rejects a bullet naming two root-level artifact files", () => {
    const dir = scratchDir("root-level-pair");
    stageDraft(dir, {
      "00-roots.md":
        "# Roots\n\n## Problem\n\nFraming.\n\n## Acceptance criteria\n\n- [ ] `package.json` and `README.md` both change.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(/package\.json, README\.md/u);
  });

  test("rejects a subspec with no acceptance-criteria heading", () => {
    const dir = scratchDir("missing-criteria");
    stageDraft(dir, {
      "00-no-criteria.md": "# No criteria\n\n## Problem\n\nFraming.\n\n## Tasks\n\n- Do the thing.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(/missing ## Acceptance criteria/u);
  });

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

  test("rejects an acceptance criterion naming two artifact paths with actionable context", () => {
    const dir = scratchDir("two-artifact-criterion");
    stageDraft(dir, {
      "00-runtime.md":
        "# Runtime\n\n## Acceptance criteria\n\n- [ ] `shared/state.ts` persists daemon state covered by `shared/state.test.ts`.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(
      "Plan subspec 00-runtime.md has a ## Acceptance criteria bullet naming multiple artifact paths (shared/state.ts, shared/state.test.ts): `shared/state.ts` persists daemon state covered by `shared/state.test.ts`.",
    );
  });

  test("accepts one artifact regardless of product vocabulary and accepts prose without an artifact", () => {
    const dir = scratchDir("artifact-count");
    stageDraft(dir, {
      "00-preferences.md":
        "# Preferences\n\n## Decisions\n\n- Keep rollout reversible.\n\n## Acceptance criteria\n\n- [ ] `src/preferences.ts` proves the persisted flag behavior.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("rejects two artifact paths without module-boundary vocabulary", () => {
    const dir = scratchDir("two-artifact-unsplit");
    stageDraft(dir, {
      "00-cart.md":
        "# Cart\n\n## Acceptance criteria\n\n- [ ] `src/cart.ts` returns the total covered by `test/cart.test.ts`.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("src/cart.ts, test/cart.test.ts");
  });

  test("rejects two root-level artifact paths", () => {
    const dir = scratchDir("two-root-artifacts");
    stageDraft(dir, {
      "00-packaging.md":
        "# Packaging\n\n## Acceptance criteria\n\n- [ ] `package.json` and `README.md` describe the release.\n",
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("package.json, README.md");
  });

  test.each(["## Decisions", "## Documentation updates"])("rejects two artifact paths under %s", (heading) => {
    const dir = scratchDir("two-artifact-supporting-bullet");
    stageDraft(dir, {
      "00-cart.md": `# Cart\n\n${heading}\n\n- \`src/cart.ts\` and \`test/cart.test.ts\` change together.\n\n## Acceptance criteria\n\n- [ ] Cart totals are correct.\n`,
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(
      `Plan subspec 00-cart.md has a ${heading} bullet naming multiple artifact paths (src/cart.ts, test/cart.test.ts)`,
    );
  });

  test.each([
    "## Acceptance criteria",
    "## Decisions",
    "## Documentation updates",
  ])("validates every %s occurrence", (heading) => {
    const dir = scratchDir("duplicate-governed-section");
    const bullet =
      heading === "## Acceptance criteria"
        ? "- [ ] `src/cart.ts` and `test/cart.test.ts` change together."
        : "- `src/cart.ts` and `test/cart.test.ts` change together.";
    stageDraft(dir, {
      "00-cart.md":
        heading === "## Acceptance criteria"
          ? `# Cart\n\n${heading}\n\n- [ ] A single artifact is enough.\n\n${heading}\n\n${bullet}\n`
          : `# Cart\n\n## Acceptance criteria\n\n- [ ] Something is proven.\n\n${heading}\n\n- A single artifact is enough.\n\n${heading}\n\n${bullet}\n`,
    });

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(
      `Plan subspec 00-cart.md has a ${heading} bullet naming multiple artifact paths (src/cart.ts, test/cart.test.ts)`,
    );
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

    // An annotated link is a linked subspec: two plan lanes were blocked `contract_miss` on drafts
    // whose index linked every subspec with a trailing `— why` clause.
    const annotated = scratchDir("annotated-link");
    stageDraft(annotated, { "00-known.md": "# Known\n", "01-second.md": "# Second\n" });
    writeFileSync(
      join(annotated, "index.md"),
      "# Plan\n\n- [ ] [Known](./00-known.md) — exclusive verifier test-run mode\n" +
        "- [ ] [Second](./01-second.md) (after 00)\n",
    );
    // Later contracts still apply to this minimal draft; only the index-link verdict is asserted.
    expect(() => normalizePlanDraftSpecDir(annotated)).not.toThrow(/Plan index does not link/);
  });

  test("production modules import no retired surface-classification export", () => {
    const retired = [
      "MODULE_BOUNDARY_SURFACES",
      "ModuleBoundarySurface",
      "classifyModuleBoundaryText",
      "moduleBoundariesForAcceptanceCriteria",
      "spansMultipleModuleBoundaries",
      "orderModuleBoundariesForSplit",
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
