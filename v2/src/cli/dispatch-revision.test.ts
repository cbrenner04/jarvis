import { describe, expect, test } from "bun:test";
import { advanceLoadedRevision } from "./dispatch-revision.ts";

describe("advanceLoadedRevision", () => {
  test("advances when digest matches and HEAD drifted", () => {
    expect(
      advanceLoadedRevision("pre-merge-head", "shared-digest", {
        currentRevision: "post-merge-head",
        currentExecutableDigest: "shared-digest",
      }),
    ).toBe("post-merge-head");
  });

  test("does not advance when digest mismatches", () => {
    expect(
      advanceLoadedRevision("pre-merge-head", "daemon-digest", {
        currentRevision: "post-merge-head",
        currentExecutableDigest: "cli-digest",
      }),
    ).toBe("pre-merge-head");
  });

  test("does not advance when HEAD is unchanged", () => {
    expect(
      advanceLoadedRevision("same-head", "shared-digest", {
        currentRevision: "same-head",
        currentExecutableDigest: "shared-digest",
      }),
    ).toBe("same-head");
  });

  test("does not advance when params are missing or invalid", () => {
    expect(advanceLoadedRevision("loaded-head", "digest", {})).toBe("loaded-head");
    expect(advanceLoadedRevision("loaded-head", "digest", null)).toBe("loaded-head");
    expect(advanceLoadedRevision("loaded-head", "digest", { currentRevision: "new-head" })).toBe("loaded-head");
    expect(advanceLoadedRevision("loaded-head", "digest", { currentExecutableDigest: "digest" })).toBe("loaded-head");
    expect(
      advanceLoadedRevision("loaded-head", "digest", {
        currentRevision: 42,
        currentExecutableDigest: "digest",
      }),
    ).toBe("loaded-head");
    expect(
      advanceLoadedRevision("loaded-head", "digest", {
        currentRevision: "new-head",
        currentExecutableDigest: 42,
      }),
    ).toBe("loaded-head");
  });
});
