import { describe, expect, test } from "bun:test";
import {
  getExecutableTreeDigest,
  PATH_BOUNCE_CLASSIFICATION_FIXTURE,
  requiresDaemonBounceForChangedPath,
} from "./executable-tree.ts";
import { realAsyncSubprocessRunner } from "./subprocess.ts";

describe("requiresDaemonBounceForChangedPath", () => {
  test.each(PATH_BOUNCE_CLASSIFICATION_FIXTURE.map(({ path, bounceRequired }) => [path, bounceRequired] as const))(
    "%s -> bounceRequired=%s",
    (path, bounceRequired) => {
      expect(requiresDaemonBounceForChangedPath(path)).toBe(bounceRequired);
    },
  );
});

describe("getExecutableTreeDigest", () => {
  test("returns a stable non-empty digest for the jarvis repo", async () => {
    const repoRoot = new URL("../", import.meta.url).pathname;
    const first = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    const second = await getExecutableTreeDigest(repoRoot, realAsyncSubprocessRunner);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });
});
