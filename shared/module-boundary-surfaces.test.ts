import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifyModuleBoundaryText,
  MODULE_BOUNDARY_SURFACES,
  moduleBoundariesForAcceptanceCriteria,
  normalizePlanDraftSpecDir,
  orderModuleBoundariesForSplit,
  spansMultipleModuleBoundaries,
  splitResiduePattern,
} from "./module-boundary-surfaces.ts";

const PHRASE_FIXTURES = [
  ["The state-store persists run status atomically.", ["persistence"]],
  ["Daemon request handling rejects malformed socket messages.", ["daemon"]],
  ["The CLI validates run flags before dispatch.", ["cli"]],
] as const;

type FixtureChild = {
  file: string;
  decisions: string[];
  acceptanceCriteria: string[];
  documentationUpdates: string[];
};

type FixtureManifest = {
  forbiddenProvenance: string[];
  fixtures: Array<{
    name: string;
    parentSlug: string;
    planningLabels: string[];
    expectedChildren: FixtureChild[];
  }>;
};

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "module-boundary-surfaces");
const MANIFEST = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as FixtureManifest;
const PRESERVED_SECTIONS = [
  { key: "decisions", heading: "## Decisions", checkbox: false },
  { key: "acceptanceCriteria", heading: "## Acceptance criteria", checkbox: true },
  { key: "documentationUpdates", heading: "## Documentation updates", checkbox: false },
] as const;
const scratchRoot = resolve(".scratch");
const tempDirs: string[] = [];

function stagedFixture(name: string): string {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(join(scratchRoot, `module-boundary-${name}-`));
  tempDirs.push(dir);
  cpSync(join(FIXTURE_ROOT, name), dir, { recursive: true });
  return dir;
}

function sectionBulletLines(body: string, heading: string, checkbox: boolean): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^##\s/u.test(line ?? ""));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  const pattern = checkbox ? /^\s*-\s\[[ xX]\]\s+/u : /^\s*-\s+(?!\[[ xX]\])/u;
  return section.filter((line) => pattern.test(line));
}

function survivingParentBullets(body: string, parentSlug: string, heading: string, checkbox: boolean): string[] {
  const residue = splitResiduePattern(parentSlug);
  return sectionBulletLines(body, heading, checkbox).filter((line) => !residue.test(line));
}

function indexChecklistFiles(indexBody: string): string[] {
  return indexBody
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)$/u);
      return match?.[1] && /^\d{2}-.*\.md$/u.test(match[1]) ? [match[1]] : [];
    });
}

function assertManifestUnion(
  fixture: FixtureManifest["fixtures"][number],
  section: (typeof PRESERVED_SECTIONS)[number],
): void {
  const parentBody = readFileSync(join(FIXTURE_ROOT, fixture.name, `00-${fixture.parentSlug}.md`), "utf8");
  const union = fixture.expectedChildren.flatMap((child) => child[section.key]);
  const surviving = survivingParentBullets(parentBody, fixture.parentSlug, section.heading, section.checkbox);
  expect([...union].sort()).toEqual([...surviving].sort());
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("module boundary surfaces", () => {
  test("classifies committed phrases", () => {
    expect(MODULE_BOUNDARY_SURFACES).toEqual(["persistence", "daemon", "cli", "execution-loop"]);

    for (const [phrase, expected] of PHRASE_FIXTURES) {
      expect(classifyModuleBoundaryText(phrase)).toEqual([...expected]);
    }
  });

  test("detects a three-boundary acceptance-criteria union", () => {
    const acceptanceCriteria = PHRASE_FIXTURES.map(([phrase]) => phrase);

    expect(moduleBoundariesForAcceptanceCriteria(acceptanceCriteria)).toEqual(["persistence", "daemon", "cli"]);
    expect(spansMultipleModuleBoundaries(acceptanceCriteria)).toBe(true);
  });

  test("ignores zero-match text when detecting multiple boundaries", () => {
    const acceptanceCriteria = [
      "The state-store persists run status atomically.",
      "Persisted records survive process restart.",
      "The behavior remains covered by a regression test.",
    ];

    expect(classifyModuleBoundaryText(acceptanceCriteria[2] ?? "")).toEqual([]);
    expect(moduleBoundariesForAcceptanceCriteria(acceptanceCriteria)).toEqual(["persistence"]);
    expect(spansMultipleModuleBoundaries(acceptanceCriteria)).toBe(false);
  });

  test("leaves a single-boundary staged tree unchanged", () => {
    mkdirSync(scratchRoot, { recursive: true });
    const dir = mkdtempSync(join(scratchRoot, "module-boundary-single-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "index.md"), "# Staged plan\r\n\r\n- [ ] [03 - Persistence](./03-persistence.md)\r\n");
    writeFileSync(
      join(dir, "03-persistence.md"),
      "# Preserve this title\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] The state-store persists runs atomically.\r\n",
    );
    const beforeFiles = readdirSync(dir).sort();
    const beforeBytes = beforeFiles.map((file) => readFileSync(join(dir, file)));

    normalizePlanDraftSpecDir(dir);

    const afterFiles = readdirSync(dir).sort();
    expect(afterFiles).toEqual(beforeFiles);
    expect(afterFiles.map((file) => readFileSync(join(dir, file)))).toEqual(beforeBytes);
  });

  for (const fixture of MANIFEST.fixtures) {
    test(`normalizes the ${fixture.name} staged tree without provenance`, () => {
      const dir = stagedFixture(fixture.name);

      normalizePlanDraftSpecDir(dir);

      const emittedFiles = readdirSync(dir)
        .filter((file) => /^\d{2}-.*\.md$/u.test(file))
        .sort();
      const expectedFiles = fixture.expectedChildren.map((child) => child.file);
      expect(emittedFiles).toEqual(expectedFiles);
      expect(indexChecklistFiles(readFileSync(join(dir, "index.md"), "utf8"))).toEqual(expectedFiles);
      for (const child of fixture.expectedChildren) {
        const body = readFileSync(join(dir, child.file), "utf8");
        for (const section of PRESERVED_SECTIONS) {
          expect(sectionBulletLines(body, section.heading, section.checkbox)).toEqual(child[section.key]);
        }
      }
      for (const section of PRESERVED_SECTIONS) assertManifestUnion(fixture, section);
      const durableText = [
        ...emittedFiles,
        ...emittedFiles.map((file) => readFileSync(join(dir, file), "utf8")),
        readFileSync(join(dir, "index.md"), "utf8"),
      ]
        .join("\n")
        .toLowerCase();
      const forbidden = [...MANIFEST.forbiddenProvenance, fixture.parentSlug, ...fixture.planningLabels].map((text) =>
        text.toLowerCase(),
      );
      for (const phrase of forbidden) expect(durableText).not.toContain(phrase);
      if (fixture.name === "k2") {
        expect(readFileSync(join(dir, "00-persistence.md"), "utf8")).toContain(
          "Keep this unrelated draft scope for callers.",
        );
      }
    });
  }

  test("inverting draft dependency order guard fails k4", () => {
    const fixture = MANIFEST.fixtures.find((entry) => entry.name === "k4");
    if (!fixture) throw new Error("k4 fixture is missing");
    const dir = stagedFixture("k4");

    normalizePlanDraftSpecDir(dir);

    const emittedFiles = readdirSync(dir)
      .filter((file) => /^\d{2}-.*\.md$/u.test(file))
      .sort();
    expect(emittedFiles).toEqual(fixture.expectedChildren.map((child) => child.file));
    expect(emittedFiles[0]).toBe("00-cli.md");
    const cliBody = readFileSync(join(dir, "00-cli.md"), "utf8");
    expect(cliBody).toContain("The behavior remains covered by a regression test.");
    expect(readFileSync(join(dir, "01-persistence.md"), "utf8")).not.toContain(
      "The behavior remains covered by a regression test.",
    );
  });

  test("orders prerequisite requires/depends-on bullets with prerequisite surface first", () => {
    const body = [
      "## Prerequisites",
      "",
      "- The CLI depends on persistence.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] The state-store persists completed runs atomically.",
      "- [ ] The CLI validates run flags before dispatch.",
    ].join("\n");
    const boundaries = moduleBoundariesForAcceptanceCriteria([
      "The state-store persists completed runs atomically.",
      "The CLI validates run flags before dispatch.",
    ]);
    expect(orderModuleBoundariesForSplit(body, boundaries)).toEqual(["persistence", "cli"]);
  });

  test("hard-errors contradictory draft dependency edges", () => {
    const k4Draft = readFileSync(join(FIXTURE_ROOT, "k4", "00-cli-first-state.md"), "utf8");
    const body = k4Draft.replace(
      "- Implement CLI before persistence.",
      "- Implement CLI before persistence.\n- Implement persistence before CLI.",
    );
    const boundaries = moduleBoundariesForAcceptanceCriteria([
      "The state-store persists completed runs atomically.",
      "The CLI validates run flags before dispatch.",
    ]);
    expect(() => orderModuleBoundariesForSplit(body, boundaries)).toThrow(
      "contradictory module-boundary dependency order",
    );
  });

  test("hard-errors before dropping a multi-surface acceptance criterion", () => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const multiSurface =
      "- [ ] The state-store persists completed runs atomically,\n      and the CLI exposes the same completed run.";
    const source = readFileSync(sourcePath, "utf8").replace(
      "- [ ] The state-store persists completed runs atomically.",
      multiSurface,
    );
    writeFileSync(sourcePath, source);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("multi-surface ## Acceptance criteria bullet");
    expect(readFileSync(sourcePath, "utf8")).toContain(multiSurface);
  });

  test("hard-errors before dropping an out-of-union decision bullet", () => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const outOfUnion = "- Stage the write-loop before splitting.";
    const source = readFileSync(sourcePath, "utf8").replace(
      "- Validate CLI flags before dispatch.",
      `- Validate CLI flags before dispatch.\n${outOfUnion}`,
    );
    writeFileSync(sourcePath, source);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("out-of-union ## Decisions bullet");
    expect(readFileSync(sourcePath, "utf8")).toContain(outOfUnion);
    expect(readdirSync(dir).filter((file) => /^\d{2}-.*\.md$/u.test(file))).toEqual([`00-${fixture.parentSlug}.md`]);
  });

  test("hard-errors before dropping an out-of-union documentation bullet", () => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const outOfUnion = "- Document execution-loop staging in the operator runbook.";
    const source = readFileSync(sourcePath, "utf8").replace(
      "- Document CLI flag validation in install-and-config.",
      `- Document CLI flag validation in install-and-config.\n${outOfUnion}`,
    );
    writeFileSync(sourcePath, source);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("out-of-union ## Documentation updates bullet");
    expect(readFileSync(sourcePath, "utf8")).toContain(outOfUnion);
    expect(readdirSync(dir).filter((file) => /^\d{2}-.*\.md$/u.test(file))).toEqual([`00-${fixture.parentSlug}.md`]);
  });
});

describe("keystone admissibility at plan draft", () => {
  function stageDraft(dir: string, subspecFile: string, acceptanceCriteriaBlock: string): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.md"), `# Staged plan\n\n- [ ] [Subspec](./${subspecFile})\n`);
    const sourcePath = join(dir, subspecFile);
    writeFileSync(sourcePath, `# Preserve this title\n\n## Acceptance criteria\n\n${acceptanceCriteriaBlock}\n`);
    return sourcePath;
  }

  function scratchDir(name: string): string {
    mkdirSync(scratchRoot, { recursive: true });
    const dir = mkdtempSync(join(scratchRoot, `keystone-${name}-`));
    tempDirs.push(dir);
    return dir;
  }

  const PROSE_KEYSTONE =
    "- [ ] Keystone checkpoint: inverting the undated-row ordering guard makes the scoped test fail.";
  const CANONICAL_KEYSTONE =
    "- [ ] `write.test.ts` — `pins the undated-row ordering`; Keystone checkpoint: inverting the guard makes the scoped test fail.";

  test("a prose-only keystone criterion refuses the staged draft", () => {
    // @mutate shared/module-boundary-surfaces.ts "const finding = unsatisfiable[0];" -> "const finding = undefined;"
    const dir = scratchDir("prose");
    stageDraft(dir, "00-persistence.md", PROSE_KEYSTONE);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("00-persistence.md");
  });

  test("the keystone refusal names the offending subspec file and criterion", () => {
    // @mutate shared/module-boundary-surfaces.ts "has an unsatisfiable keystone criterion: ${finding.firstLine}" -> "has an unsatisfiable keystone criterion"
    const dir = scratchDir("names-file");
    stageDraft(dir, "00-persistence.md", PROSE_KEYSTONE);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(
      "Keystone checkpoint: inverting the undated-row ordering guard makes the scoped test fail.",
    );
  });

  test("a single-boundary draft with a prose-only keystone still refuses", () => {
    const dir = scratchDir("single-boundary");
    stageDraft(dir, "00-persistence.md", `- [ ] The state-store persists runs atomically.\n${PROSE_KEYSTONE}`);

    expect(moduleBoundariesForAcceptanceCriteria(["The state-store persists runs atomically."])).toEqual([
      "persistence",
    ]);
    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("00-persistence.md");
  });

  test("a canonical keystone criterion is admitted", () => {
    const dir = scratchDir("canonical");
    stageDraft(dir, "00-guard.md", CANONICAL_KEYSTONE);

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("a canonical keystone criterion is admitted alongside a literal @mutate directive", () => {
    const dir = scratchDir("canonical-mutate");
    stageDraft(dir, "00-guard.md", `${CANONICAL_KEYSTONE}\n      // @mutate write.ts "if (invert)" -> "if (!invert)"`);

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("a double-backticked keystone mention is admitted", () => {
    const dir = scratchDir("double-backtick");
    stageDraft(
      dir,
      "00-guard.md",
      "- [ ] The guidance-sanctioned descriptive mention `` `Keystone checkpoint:` `` documents the marker.",
    );

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("a keystone criterion naming a nonexistent pin is admitted", () => {
    const dir = scratchDir("nonexistent-pin");
    stageDraft(
      dir,
      "00-guard.md",
      "- [ ] `nonexistent.test.ts` — `does not exist anywhere`; Keystone checkpoint: inverting a fictional guard fails a fictional test.",
    );

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("a human-only keystone-shaped criterion is admitted", () => {
    const dir = scratchDir("human-only");
    stageDraft(dir, "00-guard.md", `${PROSE_KEYSTONE.replace(/\.$/, "")} (Manual).`);

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });

  test("a tree with no keystone criteria still normalizes", () => {
    const dir = scratchDir("no-keystone");
    stageDraft(
      dir,
      "00-guard.md",
      "- [ ] `write.test.ts` — `pins the undated-row ordering`; Mutation checkpoint: inverting the guard makes the scoped test fail.",
    );

    expect(() => normalizePlanDraftSpecDir(dir)).not.toThrow();
  });
});
