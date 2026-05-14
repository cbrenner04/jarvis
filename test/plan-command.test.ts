import { describe, expect, test } from "bun:test";
import {
  PLAN_STUB_MESSAGE,
  PLAN_USAGE,
  planCommand,
} from "../src/commands/plan.ts";

function captureIo() {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

describe("planCommand", () => {
  test("no args → stub message on stderr, exit 2", () => {
    const cap = captureIo();
    const code = planCommand({ io: cap.io });
    expect(code).toBe(2);
    expect(cap.err()).toBe(PLAN_STUB_MESSAGE);
    expect(cap.out()).toBe("");
  });

  test("--help prints usage to stdout, exit 0", () => {
    const cap = captureIo();
    const code = planCommand({ io: cap.io, args: ["--help"] });
    expect(code).toBe(0);
    expect(cap.out()).toBe(PLAN_USAGE);
    expect(cap.err()).toBe("");
  });

  test("-h prints usage to stdout, exit 0", () => {
    const cap = captureIo();
    const code = planCommand({ io: cap.io, args: ["-h"] });
    expect(code).toBe(0);
    expect(cap.out()).toBe(PLAN_USAGE);
    expect(cap.err()).toBe("");
  });

  test("usage advertises full surface", () => {
    expect(PLAN_USAGE).toContain("--interview-turns");
    expect(PLAN_USAGE).toContain("--review-passes");
    expect(PLAN_USAGE).toContain("--repo");
    expect(PLAN_USAGE).toContain("--cwd");
    expect(PLAN_USAGE).toContain("--resume");
    expect(PLAN_USAGE).toContain("intent-file-or-text");
  });

  test("ignores other args and exits with stub", () => {
    const cap = captureIo();
    const code = planCommand({
      io: cap.io,
      args: ["--repo", "foo", "intent.md"],
    });
    expect(code).toBe(2);
    expect(cap.err()).toBe(PLAN_STUB_MESSAGE);
  });
});
