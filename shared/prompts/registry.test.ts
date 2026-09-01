import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPromptRegistry } from "./registry.ts";

function withFrontmatter(meta: string, body = "Body"): string {
  return `---\n${meta}\n---\n${body}\n`;
}

function writePromptFixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-prompt-registry-"));
  const file = join(dir, "prompt.md");
  writeFileSync(file, content, "utf8");
  return file;
}

describe("prompt registry load validation", () => {
  test("loads first-rollout prompt artifacts by stable id", () => {
    const registry = createPromptRegistry();
    const ids = registry.all().map((artifact) => artifact.metadata.id);

    expect(ids).toContain("global.terse");
    expect(ids).toContain("global.no-hard-wrap");
    expect(ids).toContain("global.documentation");
    expect(ids).toContain("global.naming");
    expect(ids).toContain("patch.prompt.body");
    expect(ids).toContain("patch.rules");
    expect(ids).toContain("plan.prompt.draft");
    expect(ids).toContain("plan.decisions-ledger");
    expect(ids).toContain("plan.defer-to-consumer");
    expect(ids).toContain("plan.prompt.review-actuator");
    expect(ids).toContain("intent.prompt.split");
    expect(ids).toContain("write.execute");
    expect(ids).toContain("implement.prompt.review.critic");
    expect(ids).toContain("implement.prompt.review.adversary");
    expect(ids).toContain("implement.prompt.review.advocate");
    expect(ids).toContain("implement.prompt.review.adjudicator");
  });

  test("missing required metadata is a load-time error", () => {
    const entry = withFrontmatter("id: example.prompt\nbehavior: plan\nkind: step");
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow();
  });

  test("duplicate ids are rejected during load", () => {
    const a = withFrontmatter("id: dup.prompt\nbehavior: plan\nkind: step\nrevision: 1", "A");
    const b = withFrontmatter("id: dup.prompt\nbehavior: plan\nkind: step\nrevision: 2", "B");
    expect(() => createPromptRegistry([writePromptFixture(a), writePromptFixture(b)])).toThrow("duplicate prompt id");
  });

  test("unknown fragment membership reference is rejected during load", () => {
    const entry = withFrontmatter(
      "id: fragment.prompt\nbehavior: plan\nkind: fragment\nrevision: 1\nfragmentOf: [missing.parent]",
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow("unknown fragment membership reference");
  });

  test("unknown explicit override target is rejected during load", () => {
    const entry = withFrontmatter(
      "id: override.prompt\nbehavior: plan\nkind: step\nrevision: 1\noverrides: [missing.target]",
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow("unknown explicit override target");
  });

  test("retired plan intent-authoring prompts are unavailable", () => {
    const registry = createPromptRegistry();
    const ids = registry.all().map((artifact) => artifact.metadata.id);

    // intent-draft and intent-split moved to intent mode; refine retired with
    // the intent/refine pipeline (no longer reachable from plan or resume).
    expect(ids).not.toContain("plan.prompt.intent-draft");
    expect(ids).not.toContain("plan.prompt.intent-split");
    expect(ids).not.toContain("plan.prompt.refine");
  });

  test("retired dead registry prompt artifacts are unavailable", () => {
    const registry = createPromptRegistry();
    const ids = registry.all().map((artifact) => artifact.metadata.id);

    expect(ids).not.toContain("plan.prompt.review");
    expect(ids).not.toContain("patch.prompt.review");
    expect(ids).not.toContain("patch.prompt.review.critic");
  });

  test("parses placeholder declarations from frontmatter", () => {
    const entry = withFrontmatter(
      "id: placeholders.prompt\nbehavior: plan\nkind: step\nrevision: 1\nplaceholders: [WORKDIR:string!, NAME:string!]",
      "<WORKDIR> <NAME>",
    );
    const registry = createPromptRegistry([writePromptFixture(entry)]);
    expect(registry.getById("placeholders.prompt").metadata.placeholders).toEqual([
      { name: "WORKDIR", type: "string", required: true },
      { name: "NAME", type: "string", required: true },
    ]);
  });

  test("invalid placeholder declarations fail during load", () => {
    const entry = withFrontmatter(
      "id: bad.placeholders\nbehavior: plan\nkind: step\nrevision: 1\nplaceholders: [WORKDIR:number!]",
      "<WORKDIR>",
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow("invalid placeholder declaration");
  });

  test("variant substitution without replaceAll parses successfully", () => {
    const entry = withFrontmatter(
      [
        "id: no-replace-all.prompt",
        "behavior: plan",
        "kind: step",
        "revision: 1",
        'variants: {"v":[{"anchor":"A","replacement":"B"}]}',
      ].join("\n"),
    );
    const registry = createPromptRegistry([writePromptFixture(entry)]);
    expect(registry.getById("no-replace-all.prompt").metadata.variants).toEqual({
      v: [{ anchor: "A", replacement: "B" }],
    });
  });

  test("non-boolean replaceAll in variant substitution fails during load", () => {
    const entry = withFrontmatter(
      [
        "id: bad.replace-all.prompt",
        "behavior: plan",
        "kind: step",
        "revision: 1",
        'variants: {"v":[{"anchor":"A","replacement":"B","replaceAll":"yes"}]}',
      ].join("\n"),
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow("replaceAll must be boolean");
  });

  test("loads variants and optionalSections from JSON frontmatter", () => {
    const entry = withFrontmatter(
      [
        "id: variants.prompt",
        "behavior: plan",
        "kind: step",
        "revision: 1",
        "placeholders: [SPEC_PATH:string!]",
        'variants: {"flat-layout":[{"anchor":"A","replacement":"B","replaceAll":true}]}',
        'optionalSections: [{"header":"H","begin":"<<","end":">>","placeholder":"SPEC_PATH"}]',
      ].join("\n"),
      "<SPEC_PATH>",
    );
    const registry = createPromptRegistry([writePromptFixture(entry)]);
    const metadata = registry.getById("variants.prompt").metadata;
    expect(metadata.variants).toEqual({
      "flat-layout": [{ anchor: "A", replacement: "B", replaceAll: true }],
    });
    expect(metadata.optionalSections).toEqual([{ header: "H", begin: "<<", end: ">>", placeholder: "SPEC_PATH" }]);
  });

  test("absent variants and optionalSections default to empty values", () => {
    const entry = withFrontmatter("id: legacy.prompt\nbehavior: plan\nkind: step\nrevision: 1", "Body");
    const registry = createPromptRegistry([writePromptFixture(entry)]);
    const metadata = registry.getById("legacy.prompt").metadata;
    expect(metadata.variants).toEqual({});
    expect(metadata.optionalSections).toEqual([]);
  });

  test("malformed variants or optionalSections JSON fails during load", () => {
    const badVariants = withFrontmatter(
      "id: bad.variants\nbehavior: plan\nkind: step\nrevision: 1\nvariants: {not-json",
    );
    const badOptionalSections = withFrontmatter(
      "id: bad.optional\nbehavior: plan\nkind: step\nrevision: 1\noptionalSections: [not-json",
    );
    expect(() => createPromptRegistry([writePromptFixture(badVariants)])).toThrow("invalid JSON for `variants`");
    expect(() => createPromptRegistry([writePromptFixture(badOptionalSections)])).toThrow(
      "invalid JSON for `optionalSections`",
    );
  });

  test("empty variant id fails during load", () => {
    const entry = withFrontmatter(
      'id: empty.variant\nbehavior: plan\nkind: step\nrevision: 1\nvariants: {"":[{"anchor":"X","replacement":"Y"}]}',
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow("variant id must not be empty");
  });

  test("optionalSections placeholder not declared in placeholders fails during load", () => {
    const entry = withFrontmatter(
      [
        "id: bad.optional.binding",
        "behavior: plan",
        "kind: step",
        "revision: 1",
        "placeholders: [SPEC_PATH:string!]",
        'optionalSections: [{"header":"H","begin":"<<","end":">>","placeholder":"MISSING"}]',
      ].join("\n"),
    );
    expect(() => createPromptRegistry([writePromptFixture(entry)])).toThrow(
      "optionalSections placeholder `MISSING` is not declared in placeholders",
    );
  });
});
