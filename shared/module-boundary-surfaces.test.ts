import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifyModuleBoundaryText,
  MODULE_BOUNDARY_SURFACES,
  moduleBoundariesForAcceptanceCriteria,
  normalizePlanDraftSpecDir,
  setInvertPartitionPreservationGuardForTest,
  spansMultipleModuleBoundaries,
  splitResiduePattern,
} from "./module-boundary-surfaces.ts";

const PHRASE_FIXTURES = [
  ["The state-store persists run status atomically.", ["persistence"]],
  ["Daemon request handling rejects malformed socket messages.", ["daemon"]],
  ["The CLI validates run flags before dispatch.", ["cli"]],
] as const;

type ExpectedChild = {
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
    expectedChildren: ExpectedChild[];
  }>;
};

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

const PRESERVED_SECTIONS = [
  ["## Decisions", false, "decisions"],
  ["## Acceptance criteria", true, "acceptanceCriteria"],
  ["## Documentation updates", false, "documentationUpdates"],
] as const;

function sectionBulletLines(body: string, sectionHeading: string, checkbox: boolean): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.indexOf(sectionHeading);
  if (heading === -1) return [];
  const end = lines.findIndex((line, index) => index > heading && /^##\s/u.test(line ?? ""));
  const bulletRe = checkbox ? /^\s*-\s\[[ xX]\]\s+/u : /^\s*-\s+/u;
  return lines.slice(heading + 1, end === -1 ? undefined : end).filter((line) => bulletRe.test(line));
}

function survivingParentBullets(parentBody: string, sectionHeading: string, checkbox: boolean, parentSlug: string): string[] {
  const residue = splitResiduePattern(parentSlug);
  return sectionBulletLines(parentBody, sectionHeading, checkbox).filter((line) => !residue.test(line));
}

function assertFixturePreservation(dir: string, fixture: FixtureManifest["fixtures"][number], parentBody: string): void {
  for (const [heading, checkbox, key] of PRESERVED_SECTIONS) {
    for (const child of fixture.expectedChildren) {
      expect(sectionBulletLines(readFileSync(join(dir, child.file), "utf8"), heading, checkbox)).toEqual(child[key]);
    }
    expect(fixture.expectedChildren.flatMap((child) => child[key])).toEqual(
      survivingParentBullets(parentBody, heading, checkbox, fixture.parentSlug),
    );
  }
}

afterEach(() => {
  setInvertPartitionPreservationGuardForTest(false);
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
      if (!parentFile) throw new Error(`${fixture.name} fixture is missing a parent subspec`);
      const parentBody = readFileSync(join(dir, parentFile), "utf8");

      normalizePlanDraftSpecDir(dir);

      const emittedFiles = readdirSync(dir)
        .filter((file) => /^\d{2}-.*\.md$/u.test(file))
        .sort();
      expect(emittedFiles).toEqual(fixture.expectedChildren.map((child) => child.file));
      assertFixturePreservation(dir, fixture, parentBody);
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

    expect(() => normalizePlanDraftSpecDir(dir)).toThrow("multi-surface bullet");
    expect(readFileSync(sourcePath, "utf8")).toContain(multiSurface);
  });

  test("inverting partition preservation guard fails k2 decisions, acceptance criteria, and documentation updates", () => {
    const fixture = MANIFEST.fixtures.find((entry) => entry.name === "k2");
    if (!fixture) throw new Error("k2 fixture is missing");
    const dir = stagedFixture(fixture.name);
    const parentFile = `00-${fixture.parentSlug}.md`;
    const parentBody = readFileSync(join(dir, parentFile), "utf8");

    setInvertPartitionPreservationGuardForTest(true);
    normalizePlanDraftSpecDir(dir);

    expect(() => assertFixturePreservation(dir, fixture, parentBody)).toThrow();
  });

});
