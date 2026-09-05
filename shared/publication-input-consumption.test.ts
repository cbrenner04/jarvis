import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumePublicationInputs } from "./publication-input-consumption.ts";

describe("publication input consumption", () => {
  // An external seed (git-disabled project) lives under ~/.jarvis/specs/<safeId>/seeds/, outside
  // the project root. Recording `sourceRoot: project.root` made every external input fail the
  // containment check and skip consumption silently — no unlink, no error — so the operator queue
  // never drained and the next run re-split the same seed. `sourceRoot` must be the root the
  // input was actually resolved against.
  test("consumes an external input when sourceRoot is the external home", () => {
    const base = mkdtempSync(join(tmpdir(), "jarvis-external-consume-"));
    const projectRoot = join(base, "project");
    const externalHome = join(base, "jarvis", "specs", "proj", "seeds");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(externalHome, { recursive: true });
    const seedPath = join(externalHome, "my-seed.md");
    writeFileSync(seedPath, "# seed\n");
    try {
      // Against the project root the input is not contained, so nothing is consumed.
      expect(
        consumePublicationInputs({ sourceRoot: projectRoot, publicationRoot: externalHome, inputPaths: [seedPath] }),
      ).toEqual([]);
      expect(existsSync(seedPath)).toBe(true);

      // Against the external home it is consumed.
      const consumed = consumePublicationInputs({
        sourceRoot: externalHome,
        publicationRoot: externalHome,
        inputPaths: [seedPath],
      });
      expect(consumed.length).toBe(1);
      expect(existsSync(seedPath)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

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
