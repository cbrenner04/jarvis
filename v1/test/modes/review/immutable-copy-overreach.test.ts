import { describe, expect, test } from "bun:test";
import {
  IMMUTABLE_COPY_OVERREACH_NOTICE_PREFIX,
  recoverImmutableCopyOverreach,
  verdictReferencesPinnedIntentPath,
} from "../../../src/modes/review/immutable-copy-overreach.ts";

describe("verdictReferencesPinnedIntentPath", () => {
  test("detects literal and backtick-wrapped intent.md references", () => {
    expect(verdictReferencesPinnedIntentPath("Update intent.md frontmatter")).toBe(true);
    expect(verdictReferencesPinnedIntentPath("Do not edit `intent.md`.")).toBe(true);
    expect(verdictReferencesPinnedIntentPath("Update INTENT.md")).toBe(false);
    expect(verdictReferencesPinnedIntentPath("No path reference here.")).toBe(false);
  });
});

describe("recoverImmutableCopyOverreach", () => {
  test("no-ops when validation already passes", () => {
    const writes: string[] = [];
    const result = recoverImmutableCopyOverreach({
      copies: [{ relativePath: "intent.md", snapshot: "before\n" }],
      readCurrent: () => "after\n",
      writeSnapshot: (_path, bytes) => {
        writes.push(bytes);
      },
      validation: { valid: true, error: null },
      revalidate: () => ({ valid: false, error: "should not run" }),
      emitNotice: () => {
        throw new Error("should not emit");
      },
    });
    expect(result.recovered).toBe(false);
    expect(result.validation.valid).toBe(true);
    expect(writes).toEqual([]);
  });

  test("recovers immutable-only drift via snapshot write and re-validation", () => {
    let current = "dirty\n";
    const notices: string[] = [];
    const result = recoverImmutableCopyOverreach({
      copies: [{ relativePath: "intent.md", snapshot: "before\n" }],
      readCurrent: () => current,
      writeSnapshot: (_path, bytes) => {
        current = bytes;
      },
      validation: { valid: false, error: "intent.md was modified (not allowed)" },
      revalidate: () => ({ valid: true, error: null }),
      verdict: "Also tighten intent.md.",
      emitNotice: (text) => {
        notices.push(text);
      },
    });
    expect(result.recovered).toBe(true);
    expect(current).toBe("before\n");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(IMMUTABLE_COPY_OVERREACH_NOTICE_PREFIX);
    expect(notices[0]).toContain("  intent.md\n");
    expect(notices[0]).toContain("  verdict requirements for intent.md were not applied\n");
  });

  test("does not recover when drift coexists with another validation failure", () => {
    let current = "dirty\n";
    const result = recoverImmutableCopyOverreach({
      copies: [{ relativePath: "intent.md", snapshot: "before\n" }],
      readCurrent: () => current,
      writeSnapshot: (_path, bytes) => {
        current = bytes;
      },
      validation: { valid: false, error: "index.md was deleted" },
      revalidate: () => ({ valid: false, error: "index.md was deleted" }),
      emitNotice: () => {
        throw new Error("should not emit");
      },
    });
    expect(result.recovered).toBe(false);
    expect(result.validation.error).toBe("index.md was deleted");
  });

  test("does not recover when isRecoverableDrift rejects drift", () => {
    let current = "dirty\n";
    const result = recoverImmutableCopyOverreach({
      copies: [
        {
          relativePath: "intent.md",
          snapshot: "before\n",
          isRecoverableDrift: () => false,
        },
      ],
      readCurrent: () => current,
      writeSnapshot: (_path, bytes) => {
        current = bytes;
      },
      validation: { valid: false, error: "intent.md was modified beyond adding a ## Blocker section" },
      revalidate: () => ({ valid: true, error: null }),
      emitNotice: () => {
        throw new Error("should not emit");
      },
    });
    expect(result.recovered).toBe(false);
    expect(current).toBe("dirty\n");
  });
});
