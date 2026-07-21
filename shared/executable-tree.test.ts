import { describe, expect, test } from "bun:test";
import {
  getExecutableTreeDigest,
  PATH_BOUNCE_CLASSIFICATION_FIXTURE,
  requiresDaemonBounceForChangedPath,
} from "./executable-tree.ts";
import { realAsyncSubprocessRunner } from "./subprocess.ts";

describe("requiresDaemonBounceForChangedPath", () => {
  test.each(
    PATH_BOUNCE_CLASSIFICATION_FIXTURE.map(({ path, bounceRequired }) => [path, bounceRequired] as const),
  )("%s -> bounceRequired=%s", (path, bounceRequired) => {
    expect(requiresDaemonBounceForChangedPath(path)).toBe(bounceRequired);
  });
});

describe("getExecutableTreeDigest", () => {
  /** sha256 of the empty string — what an ls-tree matching nothing hashes to. */
  const EMPTY_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  test("returns a stable non-empty digest for the jarvis repo", async () => {
    const repoRoot = new URL("../", import.meta.url).pathname;
    const first = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    const second = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(first).not.toBe(EMPTY_DIGEST);
  });

  test("resolves the repo root, so a subdirectory cwd yields the same digest", async () => {
    // The pathspecs are repo-root-relative and git resolves pathspecs against cwd. The daemon
    // passes `import.meta.dir` (v2/src/daemon); without root resolution ls-tree matches nothing
    // there and the digest silently becomes sha256(""), never equal to the CLI's — so every
    // dispatch mismatches, bounces, mismatches again, and refuses.
    const repoRoot = new URL("../", import.meta.url).pathname;
    const nested = new URL("../v2/src/daemon/", import.meta.url).pathname;

    const fromRoot = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    const fromNested = await getExecutableTreeDigest(nested, realAsyncSubprocessRunner);

    expect(fromNested).toBe(fromRoot);
    expect(fromNested).not.toBe(EMPTY_DIGEST);
  });
});
