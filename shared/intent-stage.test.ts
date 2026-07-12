import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listIntentStageMarkdownFiles,
  repairIntentStageContent,
  validateIntentFilenames,
  validateIntentStageContent,
  validateIntentStageStructure,
} from "./intent-stage.ts";

function stage(): string {
  return mkdtempSync(join(tmpdir(), "jarvis-intent-stage-"));
}

function writeIntent(dir: string, name: string, content: string): string {
  const path = join(dir, `${name}.md`);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("intent stage contract", () => {
  test("accepts valid flat intents", () => {
    const dir = stage();
    const path = writeIntent(
      dir,
      "one-thing",
      "---\nname: one-thing\n---\n\n# One Thing\n\n## Prerequisites\n\n- other thing\n",
    );
    const result = validateIntentFilenames(listIntentStageMarkdownFiles(dir));
    expect(result).toEqual({ ok: true, intents: [{ slug: "one-thing", path }] });
    expect(validateIntentStageContent(result.ok ? result.intents : [])).toEqual(result);
  });

  test("rejects empty, reserved, ordered, duplicate, and non-markdown output", () => {
    const dir = stage();
    expect(validateIntentFilenames([]).ok).toBe(false);
    expect(validateIntentFilenames([join(dir, "index.md")]).ok).toBe(false);
    expect(validateIntentFilenames([join(dir, "01-one.md")]).ok).toBe(false);
    expect(validateIntentFilenames([join(dir, "bad_name.md")]).ok).toBe(false);
    expect(validateIntentStageStructure(dir)).toEqual({ ok: true });
    writeFileSync(join(dir, "notes.txt"), "notes", "utf8");
    expect(validateIntentStageStructure(dir).ok).toBe(false);
    const one = join(dir, "one.md");
    expect(validateIntentFilenames([one, one]).ok).toBe(false);
  });

  test("repairs names, heading, prerequisites, issue references, and spacing", async () => {
    const dir = stage();
    const path = writeIntent(
      dir,
      "one-thing",
      "---\ndescription: x\n---\n\nname: wrong\n\n#123\n\n## Prerequisites\n\n\n",
    );
    await repairIntentStageContent(dir, () => {}, null);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("name: one-thing");
    expect(content).toContain("# One Thing");
    expect(content).toContain("See: #123");
    expect(content).toContain("\n## Prerequisites\n");
    expect(validateIntentStageContent([{ slug: "one-thing", path }]).ok).toBe(true);
  });

  test("rejects malformed frontmatter and prerequisite prose", () => {
    const dir = stage();
    const path = writeIntent(dir, "one-thing", "---\nname: wrong\n---\n\n# One Thing\n\n## Prerequisites\nprose\n");
    expect(validateIntentStageContent([{ slug: "one-thing", path }])).toEqual({
      ok: false,
      error: "intent: one-thing.md must declare name: one-thing",
    });
    writeFileSync(path, "---\nname: one-thing\n---\n\n# One Thing\n\n## Prerequisites\nprose\n", "utf8");
    expect(validateIntentStageContent([{ slug: "one-thing", path }]).ok).toBe(false);
  });
});
