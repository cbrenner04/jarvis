import { expect, test } from "bun:test";
import { parseStreamPayload } from "./codec.ts";

test("parseStreamPayload parses a JSON-string payload", () => {
  expect(parseStreamPayload('{"kind":"log","seq":1}')).toEqual({ kind: "log", seq: 1 });
});

test("parseStreamPayload rejects a non-string payload", () => {
  expect(() => parseStreamPayload({ kind: "log" })).toThrow("invalid stream payload");
});
