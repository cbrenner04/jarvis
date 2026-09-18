import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import markdownlint from "markdownlint";
import noHardWrapRule from "../scripts/markdownlint-no-hard-wrap-rule.ts";
import { normalizePlanDraftSpecDir } from "./module-boundary-surfaces.ts";
import { trackedMkdtempSync } from "./tracked-temp-dir.test-support.ts";

function noHardWrapViolations(content: string): number[] {
  const result = markdownlint.sync({
    strings: { content },
    customRules: [noHardWrapRule],
    config: { default: false, "no-hard-wrap": true, MD041: false, MD047: false },
  });
  return (result.content ?? []).filter((error) => error.ruleNames.includes("no-hard-wrap")).map((e) => e.lineNumber);
}

const scratchRoot = resolve(".scratch");
const tempDirs: string[] = [];

function scratchDir(name: string): string {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = trackedMkdtempSync(join(scratchRoot, `module-boundary-${name}-`));
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
  // Each case below was accepted before the exemptions were made to fail closed: the shared-outcome
  // marker short-circuited the mixed-claim refusal, and the preservation vocabulary matched bare
  // "green" / "stops" in ordinary prose about new work.
  // Both bullets below are verbatim shapes the gate rejected on live plan lanes (2026-09-10): each
  // names one real artifact and mentions the spec tree's own scaffolding as the subject of the work.
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

  describe("## Decisions bulletization (staging rewrite)", () => {
    test("bulletizes bare consecutive Decisions lines in rewrite-allowed mode, satisfying no-hard-wrap", () => {
      const dir = scratchDir("bulletize-bare-lines");
      stageDraft(dir, {
        "00-case.md":
          "# Case\n\n## Decisions\n\nFirst bare decision line.\nSecond bare decision line.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n",
      });

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      const rewritten = readFileSync(join(dir, "00-case.md"), "utf8");
      expect(rewritten).toContain("- First bare decision line.\n- Second bare decision line.\n");
      expect(noHardWrapViolations(rewritten)).toEqual([]);
    });

    test("leaves a bare line following an authored bullet untouched as a continuation", () => {
      const dir = scratchDir("bulletize-continuation");
      const body =
        "# Continuation\n\n## Decisions\n\n- Decision one.\ncontinuation of decision one.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n";
      stageDraft(dir, { "00-case.md": body });

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      expect(readFileSync(join(dir, "00-case.md"), "utf8")).toBe(body);
    });

    test("finds the real ## Decisions past a fenced one and leaves the fenced block untouched", () => {
      const dir = scratchDir("bulletize-fenced-heading");
      const body =
        "# Fenced heading\n\n## Context\n\n```markdown\n## Decisions\n\nfenced example line.\n```\n\n## Decisions\n\nreal bare decision.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n";
      stageDraft(dir, { "00-case.md": body });

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      const rewritten = readFileSync(join(dir, "00-case.md"), "utf8");
      // The fenced example keeps its exact bytes; only the real section is repaired.
      expect(rewritten).toContain("```markdown\n## Decisions\n\nfenced example line.\n```");
      expect(rewritten).toContain("- real bare decision.");
    });

    test("leaves structural lines in ## Decisions untouched — subheadings, tables, ordered and star bullets, quotes, comments, indented code", () => {
      const dir = scratchDir("bulletize-structure");
      const body =
        "# Structure\n\n## Decisions\n\n### Sub\n| a | b |\n1. First.\n* Starred.\n+ Plussed.\n> Quoted note.\n<!-- note -->\n    indented code\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n";
      stageDraft(dir, { "00-case.md": body });

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      // Every one of these is structure, not a bare prose decision; prefixing `- ` destroys it.
      expect(readFileSync(join(dir, "00-case.md"), "utf8")).toBe(body);
    });

    test("is idempotent: a second rewrite-allowed pass produces identical bytes", () => {
      const dir = scratchDir("bulletize-idempotent");
      stageDraft(dir, {
        "00-case.md":
          "# Idempotent\n\n## Decisions\n\nFirst bare decision line.\nSecond bare decision line.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n",
      });

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");
      const afterFirst = readFileSync(join(dir, "00-case.md"), "utf8");
      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      expect(readFileSync(join(dir, "00-case.md"), "utf8")).toBe(afterFirst);
    });

    test("leaves already-bulleted, blank-separated, and other-heading fenced content byte-identical and unwritten", () => {
      const dir = scratchDir("bulletize-noop");
      const subspecs = {
        "00-already-bulleted.md":
          "# Already bulleted\n\n## Decisions\n\n- First decision.\n- Second decision.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n",
        "01-blank-separated.md":
          "# Blank separated\n\n## Decisions\n\n- First decision.\n\n- Second decision.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n",
        "02-other-heading-fence.md":
          "# Other heading\n\n## Tasks\n\n```\nbare line one\nbare line two\n```\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n",
      };
      stageDraft(dir, subspecs);
      const beforeBytes = treeBytes(dir);
      const beforeMtimes = Object.keys(subspecs).map((file) => statSync(join(dir, file)).mtimeMs);

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      expect(treeBytes(dir)).toEqual(beforeBytes);
      const afterMtimes = Object.keys(subspecs).map((file) => statSync(join(dir, file)).mtimeMs);
      expect(afterMtimes).toEqual(beforeMtimes);
    });

    test("leaves bare lines inside a fenced block within Decisions untouched and unwritten", () => {
      const dir = scratchDir("bulletize-fenced-decisions");
      const file = "00-case.md";
      const body =
        "# Case\n\n## Decisions\n\n```\nfenced bare line one\nfenced bare line two\n```\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n";
      stageDraft(dir, { [file]: body });
      const beforeMtime = statSync(join(dir, file)).mtimeMs;

      normalizePlanDraftSpecDir(dir, "rewrite-allowed");

      expect(readFileSync(join(dir, file), "utf8")).toBe(body);
      expect(statSync(join(dir, file)).mtimeMs).toBe(beforeMtime);
    });

    test("never writes to disk in validate-only mode even with bare Decisions lines", () => {
      const dir = scratchDir("bulletize-durable-no-write");
      const file = "00-case.md";
      const body =
        "# Case\n\n## Decisions\n\nFirst bare decision line.\nSecond bare decision line.\n\n## Acceptance criteria\n\n- [ ] Behavior is proven.\n";
      stageDraft(dir, { [file]: body });
      const beforeMtime = statSync(join(dir, file)).mtimeMs;

      normalizePlanDraftSpecDir(dir, "validate-only");

      expect(readFileSync(join(dir, file), "utf8")).toBe(body);
      expect(statSync(join(dir, file)).mtimeMs).toBe(beforeMtime);
    });
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
