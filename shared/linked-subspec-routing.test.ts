import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceLinkedSubspecCheckbox,
  completeLinkedSubspec,
  findModifiedLinkedCheckbox,
  resolveActiveLinkedSubspec,
} from "./linked-subspec-routing.ts";

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
function setup(index: string, files: Record<string, string> = {}): string {
  root = mkdtempSync(join(tmpdir(), "shared-linked-routing-"));
  writeFileSync(join(root, "index.md"), index);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

describe("shared linked-subspec routing", () => {
  test("handles direct, empty, completed, malformed, unreadable, active, terminal, and multiple links", () => {
    let dir = setup("# Direct\n\n- [ ] Task\n");
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "requires_index" });
    dir = setup("# Empty\n");
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "empty_index" });
    dir = setup("# Done\n\n- [x] [One](one.md)\n", { "one.md": "# One" });
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "already_complete" });
    dir = setup("# Outside\n\n- [ ] [One](../one.md)\n");
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "link_out_of_tree" });
    dir = setup("# Missing\n\n- [ ] [One](one.md)\n");
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "link_unreadable" });
    dir = setup("# Many\n\n- [x] [One](one.md)\n- [ ] [Two](two.md)\n- [ ] [Three](three.md)\n", {
      "one.md": "# One\n\n## Acceptance criteria\n\n- [x] Done\n",
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n",
      "three.md": "# Three\n\n## Acceptance criteria\n\n- [ ] Todo\n",
    });
    const active = resolveActiveLinkedSubspec(join(dir, "index.md"), dir);
    expect(active).toMatchObject({ ok: true, isTerminal: false, active: { index: 1 } });
  });

  test("selects the second link by criteria when the first is criteria-complete despite an unchecked index box", () => {
    // @mutate shared/linked-subspec-routing.ts "selected === undefined && incomplete" -> "selected === undefined && !incomplete"
    const dir = setup("# Tree\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n", {
      "one.md": "# One\n\n## Acceptance criteria\n\n- [x] Done\n",
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n",
    });
    const active = resolveActiveLinkedSubspec(join(dir, "index.md"), dir);
    expect(active).toMatchObject({ ok: true, isTerminal: true, active: { index: 1 } });
  });

  test("reports already_complete when every subspec is criteria-complete despite unchecked index boxes", () => {
    const dir = setup("# Tree\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n", {
      "one.md": "# One\n\n## Acceptance criteria\n\n- [x] Done\n",
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [x] Done\n",
    });
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "already_complete" });
  });

  test("computes isTerminal from remaining criteria, not selected-link position", () => {
    const files = {
      "one.md": "# One\n\n## Acceptance criteria\n\n- [ ] Todo\n",
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [x] Done\n",
      "three.md": "# Three\n\n## Acceptance criteria\n\n- [x] Done\n",
    };
    let dir = setup("# Tree\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n- [ ] [Three](three.md)\n", files);
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({
      ok: true,
      isTerminal: true,
      active: { index: 0 },
    });

    dir = setup("# Tree\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n- [ ] [Three](three.md)\n", {
      ...files,
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n",
    });
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({
      ok: true,
      isTerminal: false,
      active: { index: 0 },
    });
  });

  test("classifies a broken link before a later otherwise-selectable incomplete link", () => {
    const dir = setup("# Tree\n\n- [ ] [One](missing.md)\n- [ ] [Two](two.md)\n", {
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n",
    });
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({ errorKind: "link_unreadable" });
  });

  test("skips a link with zero acceptance criteria in favor of a later incomplete link", () => {
    const dir = setup("# Tree\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n", {
      "one.md": "# One\n",
      "two.md": "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n",
    });
    expect(resolveActiveLinkedSubspec(join(dir, "index.md"), dir)).toMatchObject({
      ok: true,
      isTerminal: true,
      active: { index: 1 },
    });
  });

  test("classifies completion, detects routing mutation, and advances", () => {
    const before = "# Index\n\n- [ ] [One](one.md)\n- [ ] [Two](two.md)\n";
    const active = { index: 0, isTerminal: false } as const;
    expect(
      completeLinkedSubspec(before, before, active, "# One\n\n## Acceptance criteria\n\n- [ ] Required\n"),
    ).toEqual({ ok: false, errorKind: "link_incomplete" });
    const mutated = before.replace("- [ ] [One]", "- [x] [One]");
    expect(completeLinkedSubspec(before, mutated, active, "# One\n\n## Acceptance criteria\n\n- [x] Done\n")).toEqual({
      ok: false,
      errorKind: "index_routing_mutated",
    });
    const result = completeLinkedSubspec(before, before, active, "# One\n\n## Acceptance criteria\n\n- [x] Done\n");
    expect(result).toMatchObject({ ok: true, isTerminal: false, indexContent: expect.stringContaining("- [x] [One]") });
    expect(findModifiedLinkedCheckbox(before, mutated)?.modifiedIndex).toBe(0);
    expect(advanceLinkedSubspecCheckbox(before, 1)).toContain("- [x] [Two]");
  });
});
