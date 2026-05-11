import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countUnchecked,
  getFirstUncheckedTask,
  isComplete,
  MalformedSpecError,
} from "../src/completion.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-completion-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("completion detection", () => {
  test("treats a spec with all checked tasks as complete", () => {
    const spec = writeSpec(["- [x] first", "  - [X] second"].join("\n"));

    expect(countUnchecked(spec)).toBe(0);
    expect(isComplete(spec)).toBe(true);
  });

  test("counts unchecked tasks in a mixed spec", () => {
    const spec = writeSpec(
      ["# Spec", "- [x] done", "- [ ] todo", "  - [ ] nested"].join("\n"),
    );

    expect(countUnchecked(spec)).toBe(2);
    expect(isComplete(spec)).toBe(false);
  });

  test("counts all tasks in an all-unchecked spec", () => {
    const spec = writeSpec(["- [ ] first", "- [ ] second"].join("\n"));

    expect(countUnchecked(spec)).toBe(2);
    expect(isComplete(spec)).toBe(false);
  });

  test("throws MalformedSpecError when the spec has no checkboxes", () => {
    const spec = writeSpec(["# Spec", "No task list here."].join("\n"));

    expect(() => countUnchecked(spec)).toThrow(MalformedSpecError);
    expect(() => isComplete(spec)).toThrow(
      /no GitHub-style task list checkboxes/,
    );
  });

  test("throws a clear error when the file is missing", () => {
    const missing = join(dir, "missing.md");

    expect(() => countUnchecked(missing)).toThrow(
      `Unable to read spec file at ${missing}`,
    );
  });

  test("returns first unchecked task with unchecked ordinal and total", () => {
    const spec = writeSpec(
      [
        "# Spec",
        "- [x] done",
        "  - [ ] first nested todo",
        "- [ ] second todo",
      ].join("\n"),
    );

    expect(getFirstUncheckedTask(spec)).toEqual({
      line: "first nested todo",
      ordinal: 1,
      total: 2,
    });
  });

  test("throws when no unchecked tasks remain", () => {
    const spec = writeSpec(["- [x] done", "- [X] done too"].join("\n"));

    expect(() => getFirstUncheckedTask(spec)).toThrow(/Spec is complete/);
  });
});

function writeSpec(contents: string): string {
  const path = join(dir, "spec.md");
  writeFileSync(path, contents);
  return path;
}
