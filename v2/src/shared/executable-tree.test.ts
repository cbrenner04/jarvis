import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  EXECUTABLE_TREE_PATHSPECS,
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

  test("retired top-level shared path does not require a bounce", () => {
    expect(requiresDaemonBounceForChangedPath("shared/git.ts")).toBe(false);
  });
});

describe("getExecutableTreeDigest", () => {
  /** sha256 of the empty string — what an ls-tree matching nothing hashes to. */
  const EMPTY_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const SHARED_GIT_LS_TREE_LINE = "100644 blob deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\tv2/src/shared/git.ts";

  test("hashes ls-tree output that includes a tracked path under v2/src/shared", async () => {
    const repoRoot = "/repo";
    const runner = {
      runAsync: async (command: string, args: string[], cwd: string) => {
        if (command === "git" && args[0] === "rev-parse") {
          expect(cwd).toBe(repoRoot);
          return repoRoot;
        }
        if (command === "git" && args[0] === "ls-tree") {
          expect(args).toEqual(["ls-tree", "-r", "HEAD", "--", ...EXECUTABLE_TREE_PATHSPECS]);
          return SHARED_GIT_LS_TREE_LINE;
        }
        throw new Error(`unexpected git invocation: ${command} ${args.join(" ")}`);
      },
    };

    const digest = await getExecutableTreeDigest(repoRoot, runner);
    expect(digest).toBe(createHash("sha256").update(SHARED_GIT_LS_TREE_LINE).digest("hex"));
    expect(digest).not.toBe(EMPTY_DIGEST);
  });

  test("pre-move shared-only pathspec would omit v2/src/shared blobs", () => {
    const legacyPathspecs = [
      "v2/src",
      "shared",
      "package.json",
      "bun.lock",
      "tsconfig.json",
      "tsconfig.base.json",
      "v2/tsconfig.json",
      "v2/src/shared/tsconfig.json",
    ] as const;
    const legacyLine = "100644 blob deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\tshared/executable-tree.ts";
    const legacyDigest = createHash("sha256").update(legacyLine).digest("hex");
    const currentDigest = createHash("sha256").update(SHARED_GIT_LS_TREE_LINE).digest("hex");

    expect(legacyPathspecs).not.toContain("v2/src/shared");
    expect(legacyDigest).not.toBe(currentDigest);
    expect(legacyLine).not.toContain("v2/src/shared/");
  });

  test("returns a stable non-empty digest for the jarvis repo", async () => {
    const repoRoot = new URL("../../../", import.meta.url).pathname;
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
    const repoRoot = new URL("../../../", import.meta.url).pathname;
    const nested = new URL("../daemon/", import.meta.url).pathname;

    const fromRoot = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    const fromNested = await getExecutableTreeDigest(nested, realAsyncSubprocessRunner);

    expect(fromNested).toBe(fromRoot);
    expect(fromNested).not.toBe(EMPTY_DIGEST);
  });
});
