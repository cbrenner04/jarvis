import { describe, expect, test } from "bun:test";
import {
  encodeFrame,
  errorResponse,
  okResponse,
  ProtocolError,
  parseRequestLine,
  parseResponseLine,
  parseStreamLine,
} from "./protocol.ts";

describe("daemon protocol", () => {
  test("encodeFrame appends newline", () => {
    expect(encodeFrame({ id: "1", method: "status" })).toBe('{"id":"1","method":"status"}\n');
  });

  test("parseRequestLine accepts params", () => {
    expect(parseRequestLine('{"id":"a","method":"stop","params":{"x":1}}')).toEqual({
      id: "a",
      method: "stop",
      params: { x: 1 },
    });
  });

  test("parseRequestLine rejects malformed JSON", () => {
    expect(() => parseRequestLine("{")).toThrow(ProtocolError);
  });

  test("parseResponseLine preserves error data", () => {
    expect(
      parseResponseLine(
        '{"id":"1","ok":false,"error":{"code":"active_invocations","message":"busy","data":{"activeRunIds":["r1"]}}}',
      ),
    ).toEqual({
      id: "1",
      ok: false,
      error: {
        code: "active_invocations",
        message: "busy",
        data: { activeRunIds: ["r1"] },
      },
    });
  });

  test("okResponse and errorResponse round-trip", () => {
    const ok = okResponse("req", { pid: 1 });
    const err = errorResponse("req", { code: "x", message: "y" });
    expect(parseResponseLine(encodeFrame(ok).trim())).toEqual(ok);
    expect(parseResponseLine(encodeFrame(err).trim())).toEqual(err);
  });

  test("parseStreamLine accepts log stream frames", () => {
    expect(parseStreamLine('{"kind":"stream","id":"t1","event":"log.record","data":{"seq":1}}')).toEqual({
      kind: "stream",
      id: "t1",
      event: "log.record",
      data: { seq: 1 },
    });
  });
});
