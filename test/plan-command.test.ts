import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLAN_STUB_MESSAGE,
  PLAN_USAGE,
  planCommand,
} from "../src/commands/plan.ts";
import { parsePlanArgs } from "../src/commands/plan-args.ts";

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
  test("no args → interactive mode, stub on stderr, exit 2", () => {
    const cap = captureIo();
    const code = planCommand({ io: cap.io });
    expect(code).toBe(2);
    expect(cap.err()).toContain("plan mode: interactive");
    expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
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

  test("inline mode: positional that is not a file", () => {
    const cap = captureIo();
    const code = planCommand({
      io: cap.io,
      args: ["this is freeform intent"],
    });
    expect(code).toBe(2);
    expect(cap.err()).toContain("plan mode: inline");
    expect(cap.err()).toContain("this is freeform intent");
    expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
  });
});

describe("parsePlanArgs", () => {
  let tmp: string;
  let intentFile: string;

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), "jarvis-plan-args-"));
    intentFile = join(tmp, "intent.md");
    writeFileSync(intentFile, "intent");
  }
  function teardown() {
    rmSync(tmp, { recursive: true, force: true });
  }

  test("no positional → interactive", () => {
    setup();
    try {
      const res = parsePlanArgs([], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("interactive");
      expect(res.invocation.cwd).toBe(tmp);
      expect(res.invocation.resume).toBe(false);
    } finally {
      teardown();
    }
  });

  test("existing file → file mode with absolute intent path", () => {
    setup();
    try {
      const res = parsePlanArgs(["intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.intentPath).toBe(intentFile);
    } finally {
      teardown();
    }
  });

  test("non-existing path → inline mode preserving original text", () => {
    setup();
    try {
      const res = parsePlanArgs(["does-not-exist.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("inline");
      if (res.invocation.mode !== "inline") return;
      expect(res.invocation.intentText).toBe("does-not-exist.md");
    } finally {
      teardown();
    }
  });

  test("two positional args → exit 1 too many arguments", () => {
    setup();
    try {
      const res = parsePlanArgs(["a", "b"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("too many arguments");
    } finally {
      teardown();
    }
  });

  test("--interview-turns valid", () => {
    setup();
    try {
      const res = parsePlanArgs(["--interview-turns", "3"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.interviewTurns).toBe(3);
    } finally {
      teardown();
    }
  });

  test("--interview-turns negative → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--interview-turns", "-1"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--interview-turns");
    } finally {
      teardown();
    }
  });

  test("--review-passes non-integer → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--review-passes", "foo"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--review-passes");
    } finally {
      teardown();
    }
  });

  test("--repo missing value → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--repo"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("missing value for --repo");
    } finally {
      teardown();
    }
  });

  test("--repo captured", () => {
    setup();
    try {
      const res = parsePlanArgs(["--repo", "owner/repo"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.repo).toBe("owner/repo");
    } finally {
      teardown();
    }
  });

  test("--resume sets flag inert", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.resume).toBe(true);
      expect(res.invocation.mode).toBe("interactive");
    } finally {
      teardown();
    }
  });

  test("--cwd rewrites file resolution base", () => {
    setup();
    try {
      const otherCwd = mkdtempSync(join(tmpdir(), "jarvis-plan-other-"));
      try {
        // intent.md exists in `tmp`, not in `otherCwd`. processCwd is otherCwd
        // but --cwd points at tmp, so the file should resolve.
        const res = parsePlanArgs(["--cwd", tmp, "intent.md"], otherCwd);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.invocation.mode).toBe("file");
        if (res.invocation.mode !== "file") return;
        expect(res.invocation.intentPath).toBe(intentFile);
        expect(res.invocation.cwd).toBe(tmp);
      } finally {
        rmSync(otherCwd, { recursive: true, force: true });
      }
    } finally {
      teardown();
    }
  });

  test("unknown flag → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--bogus"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--bogus");
    } finally {
      teardown();
    }
  });
});
