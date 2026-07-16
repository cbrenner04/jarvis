import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumePublicationInputs } from "./publication-input-consumption.ts";

describe("publication input consumption", () => {
  test("deletes safe mapped inputs and skips missing, external, and symlink-escaped targets", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-publication-input-"));
    const source = join(root, "source");
    const publication = join(root, "publication");
    const outside = join(root, "outside");
    try {
      mkdirSync(join(source, "seeds"), { recursive: true });
      mkdirSync(join(publication, "seeds"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      const safe = join(source, "seeds", "safe.md");
      const missing = join(source, "seeds", "missing.md");
      const escaped = join(source, "seeds", "escaped.md");
      const external = join(outside, "external.md");
      writeFileSync(safe, "safe\n");
      writeFileSync(escaped, "escaped\n");
      writeFileSync(external, "external\n");
      writeFileSync(join(publication, "seeds", "safe.md"), "safe\n");
      writeFileSync(join(outside, "escaped.md"), "keep\n");
      symlinkSync(join(outside, "escaped.md"), join(publication, "seeds", "escaped.md"));

      const sourceAlias = join(root, "source-alias");
      const publicationAlias = join(root, "publication-alias");
      symlinkSync(source, sourceAlias);
      symlinkSync(publication, publicationAlias);
      expect(
        consumePublicationInputs({
          sourceRoot: sourceAlias,
          publicationRoot: publicationAlias,
          inputPaths: [safe, missing, external, escaped],
        }),
      ).toEqual([safe]);
      expect(existsSync(join(publication, "seeds", "safe.md"))).toBe(false);
      expect(existsSync(join(outside, "escaped.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
