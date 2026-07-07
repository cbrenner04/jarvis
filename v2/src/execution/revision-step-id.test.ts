import { describe, expect, test } from "bun:test";
import { nextRevisionNumber, parseRevisionNumber, revisionStepId } from "./revision-step-id.ts";

describe("revisionStepId", () => {
  test("builds the <repeatStepId>~r<n> stepId", () => {
    expect(revisionStepId("implement", 1)).toBe("implement~r1");
    expect(revisionStepId("implement", 2)).toBe("implement~r2");
  });
});

describe("parseRevisionNumber", () => {
  test("extracts n from a matching stepId", () => {
    expect(parseRevisionNumber("implement~r1", "implement")).toBe(1);
    expect(parseRevisionNumber("implement~r12", "implement")).toBe(12);
  });

  test("returns null for a non-matching, self-referencing, or malformed stepId", () => {
    expect(parseRevisionNumber("other~r1", "implement")).toBeNull();
    expect(parseRevisionNumber("implement", "implement")).toBeNull();
    expect(parseRevisionNumber("implement~rX", "implement")).toBeNull();
    expect(parseRevisionNumber("implement~r0", "implement")).toBeNull();
  });
});

describe("nextRevisionNumber", () => {
  test("starts at 1 when no revisions exist", () => {
    expect(nextRevisionNumber([], "implement")).toBe(1);
    expect(nextRevisionNumber(["implement", "other"], "implement")).toBe(1);
  });

  test("is the highest existing revision plus one", () => {
    expect(nextRevisionNumber(["implement~r1"], "implement")).toBe(2);
    expect(nextRevisionNumber(["implement~r1", "implement~r2"], "implement")).toBe(3);
    expect(nextRevisionNumber(["implement~r2", "implement~r1"], "implement")).toBe(3);
  });

  test("ignores null/undefined stepIds", () => {
    expect(nextRevisionNumber([null, undefined, "implement~r1"], "implement")).toBe(2);
  });
});
