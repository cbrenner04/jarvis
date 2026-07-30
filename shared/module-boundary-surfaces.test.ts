import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifyModuleBoundaryText,
  MODULE_BOUNDARY_SURFACES,
  moduleBoundariesForAcceptanceCriteria,
  normalizePlanDraftSpecDir,
  splitResiduePattern,
  spansMultipleModuleBoundaries,
} from "./module-boundary-surfaces.ts";

const PHRASE_FIXTURES = [
  ["The state-store persists run status atomically.", ["persistence"]],
  ["Daemon request handling rejects malformed socket messages.", ["daemon"]],
  ["The CLI validates run flags before dispatch.", ["cli"]],
] as const;

type FixtureChild = {
  acceptanceCriteria: string[];
  decisions: string[];
  documentationUpdates: string[];
  file: string;
};

type FixtureManifest = {
  forbiddenProvenance: string[];
  fixtures: Array<{
    expectedChildren: FixtureChild[];
    name: string;
    parentSlug: string;
    planningLabels: string[];
  }>;
};

const PRESERVED_SECTIONS = [
  { checkbox: false, field: "decisions" as const, heading: "## Decisions" },
  { checkbox: true, field: "acceptanceCriteria" as const, heading: "## Acceptance criteria" },
  { checkbox: false, field: "documentationUpdates" as const, heading: "## Documentation updates" },
] as const;

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "module-boundary-surfaces");
const MANIFEST = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as FixtureManifest;
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
  const headingIndex = lines.indexOf(heading);
  if (headingIndex === -1) return [];
  const end = lines.findIndex((line, index) => index > headingIndex && /^##\s/u.test(line ?? ""));
  const sectionEnd = end === -1 ? lines.length : end;
  const bulletPattern = checkbox ? /^\s*-\s\[[ xX]\]\s+/u : /^\s*-\s+(?!\[[ xX]\]\s)/u;
  return lines.slice(headingIndex + 1, sectionEnd).filter((line) => bulletPattern.test(line));
}

function survivingParentBullets(parentBody: string, parentSlug: string, heading: string, checkbox: boolean): string[] {
  const residue = splitResiduePattern(parentSlug);
  return sectionBulletLines(parentBody, heading, checkbox).filter((line) => !residue.test(line));
}

function expectExactlyOnceUnion(
  children: readonly FixtureChild[],
  field: (typeof PRESERVED_SECTIONS)[number]["field"],
  parentSurviving: string[],
): void {
  const union = children.flatMap((child) => child[field]);
  expect(union.toSorted()).toEqual(parentSurviving.toSorted());
  expect(new Set(union).size).toBe(union.length);
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
      const parentFile = readdirSync(dir)
        .filter((file) => /^\d{2}-.*\.md$/u.test(file))
        .sort()[0];
      if (!parentFile) throw new Error(`${fixture.name} fixture is missing a drafted subspec`);
      const parentBody = readFileSync(join(dir, parentFile), "utf8");

      normalizePlanDraftSpecDir(dir);

      const emittedFiles = readdirSync(dir)
        .filter((file) => /^\d{2}-.*\.md$/u.test(file))
        .sort();
      expect(emittedFiles).toEqual(fixture.expectedChildren.map((child) => child.file));
      for (const child of fixture.expectedChildren) {
        const body = readFileSync(join(dir, child.file), "utf8");
        for (const { checkbox, field, heading } of PRESERVED_SECTIONS) {
          expect(sectionBulletLines(body, heading, checkbox)).toEqual(child[field]);
        }
      }
      for (const { checkbox, field, heading } of PRESERVED_SECTIONS) {
        expectExactlyOnceUnion(
          fixture.expectedChildren,
          field,
          survivingParentBullets(parentBody, fixture.parentSlug, heading, checkbox),
        );
      }
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

  test.each([
    {
      error: "multi-surface acceptance criterion",
      line: "- [ ] The state-store persists completed runs atomically,\n      and the CLI exposes the same completed run.",
      replace: "- [ ] The state-store persists completed runs atomically.",
    },
    {
      error: "multi-surface decisions",
      line: "- The state-store persists completed runs atomically, and the CLI exposes the same completed run.",
      replace: "- The state-store owns the completed-run persistence contract.",
    },
  ])("hard-errors before dropping a $error", ({ error, line, replace }) => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const source = readFileSync(sourcePath, "utf8").replace(replace, line);
    writeFileSync(sourcePath, source);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(error);
    expect(readFileSync(sourcePath, "utf8")).toContain(line);
  });

  test("retains downstream headings when a non-first child has an empty optional section", () => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const source = readFileSync(sourcePath, "utf8")
      .replace("- The command-line entrypoint owns flag validation before dispatch.", "")
      .replace("- Phase 1 phase-1-state-cli supersedes the prior draft.", "")
      .replace("- Split from the original proposal.", "");
    writeFileSync(sourcePath, source);

    normalizePlanDraftSpecDir(dir);

    const cliBody = readFileSync(join(dir, "01-cli.md"), "utf8");
    expect(cliBody).not.toContain("## Decisions");
    expect(cliBody).toContain("## Acceptance criteria");
    expect(cliBody).toContain("## Documentation updates");
    expect(sectionBulletLines(cliBody, "## Acceptance criteria", true)).toEqual([
      "- [ ] The CLI validates run flags before dispatch.",
    ]);
    expect(sectionBulletLines(cliBody, "## Documentation updates", false)).toEqual([
      "- Document CLI flag validation in install-and-config.",
    ]);
  });

  test.each([
    {
      error: "out-of-boundary decisions",
      line: "- Daemon RPC must validate plan requests before dispatch.",
      replace: "- The command-line entrypoint owns flag validation before dispatch.",
    },
    {
      error: "out-of-boundary documentation updates",
      line: "- Document daemon RPC validation in operator runbook.",
      replace: "- Document CLI flag validation in install-and-config.",
    },
  ])("hard-errors before dropping an $error", ({ error, line, replace }) => {
    const fixture = MANIFEST.fixtures[0];
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const sourcePath = join(dir, `00-${fixture.parentSlug}.md`);
    const source = readFileSync(sourcePath, "utf8").replace(replace, line);
    writeFileSync(sourcePath, source);

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow(error);
    expect(readFileSync(sourcePath, "utf8")).toContain(line);
  });
});
