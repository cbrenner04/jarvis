import { describe, expect, test } from "bun:test";
import type { ProjectMatch } from "../src/config.ts";
import { promptForProject } from "../src/disambiguation-prompt.ts";

function captureIo(): {
  io: { stdout: (s: string) => void; stderr: (s: string) => void };
  out: () => string;
  err: () => string;
} {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

const SAMPLES: ProjectMatch[] = [
  { key: "alpha", root: "/tmp/alpha", origin: "https://github.com/x/alpha" },
  { key: "beta", root: "/tmp/beta" },
];

describe("promptForProject", () => {
  test("selects by numeric index", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "2",
      isTty: true,
    });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.project.key).toBe("beta");
    }
    expect(cap.out()).toContain("Registered projects:");
    expect(cap.out()).toContain("1. alpha");
    expect(cap.out()).toContain("2. beta");
    expect(cap.out()).toContain("(no origin)");
  });

  test("selects by project name", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "alpha",
      isTty: true,
    });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.project.key).toBe("alpha");
    }
  });

  test("returns cancelled on 'q'", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "q",
      isTty: true,
    });
    expect(result.kind).toBe("cancelled");
  });

  test("returns cancelled on empty line", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "",
      isTty: true,
    });
    expect(result.kind).toBe("cancelled");
  });

  test("returns cancelled on EOF", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => undefined,
      isTty: true,
    });
    expect(result.kind).toBe("cancelled");
  });

  test("returns cancelled on out-of-range index", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "99",
      isTty: true,
    });
    expect(result.kind).toBe("cancelled");
    expect(cap.err()).toContain("not a valid choice");
  });

  test("returns cancelled on unknown name", async () => {
    const cap = captureIo();
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous",
      io: cap.io,
      readLine: async () => "nope",
      isTty: true,
    });
    expect(result.kind).toBe("cancelled");
    expect(cap.err()).toContain("not a valid choice");
  });

  test("non-TTY does not prompt and returns non-tty", async () => {
    const cap = captureIo();
    let readCalled = false;
    const result = await promptForProject({
      candidates: SAMPLES,
      reason: "ambiguous match",
      io: cap.io,
      readLine: async () => {
        readCalled = true;
        return "1";
      },
      isTty: false,
    });
    expect(result.kind).toBe("non-tty");
    expect(readCalled).toBe(false);
    expect(cap.err()).toContain("ambiguous match");
    expect(cap.err()).toContain("--repo");
    expect(cap.err()).toContain("alpha");
    expect(cap.err()).toContain("beta");
  });
});
