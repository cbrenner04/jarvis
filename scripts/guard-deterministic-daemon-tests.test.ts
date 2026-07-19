import { describe, expect, test } from "bun:test";
import { findDeterminismViolations } from "./guard-deterministic-daemon-tests.ts";

function violations(source: string, file = "v2/src/daemon/example.test.ts") {
  return findDeterminismViolations([{ file, source }]);
}

describe("deterministic daemon tests guard", () => {
  describe("Bun.sleep detection", () => {
    test("rejects Bun.sleep calls", () => {
      expect(violations("await Bun.sleep(100);")).toMatchObject([{ construct: "Bun.sleep" }]);
      expect(violations("Bun.sleep(50);")).toMatchObject([{ construct: "Bun.sleep" }]);
    });

    test('rejects Bun["sleep"] bracket notation', () => {
      expect(violations('await Bun["sleep"](100);')).toMatchObject([{ construct: "Bun.sleep" }]);
    });
  });

  describe("Timer-backed wait detection", () => {
    test("rejects bare setTimeout waits", () => {
      expect(violations("await new Promise((resolve) => setTimeout(resolve, 100));")).toMatchObject([
        { construct: "timer-backed wait" },
      ]);
    });

    test("rejects bare setInterval waits", () => {
      expect(violations("await new Promise((resolve) => setInterval(resolve, 100));")).toMatchObject([
        { construct: "timer-backed wait" },
      ]);
    });

    test("rejects multiple timer waits", () => {
      const source = `
        await new Promise((resolve) => setTimeout(resolve, 100));
        await new Promise((resolve) => setTimeout(resolve, 50));
      `;
      expect(violations(source)).toHaveLength(2);
    });
  });

  describe("Bounded polling allowance", () => {
    test("allows setImmediate polling", () => {
      expect(violations("await new Promise((resolve) => setImmediate(resolve));")).toHaveLength(0);
    });

    test("allows setTimeout inside bounded while loop with deadline", () => {
      const source = `
        const deadline = Date.now() + 5000;
        while (condition && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      `;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows setTimeout inside bounded while loop with signal abort", () => {
      const source = `
        while (!signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      `;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows complex deadline expressions", () => {
      const source = `
        const end = Date.now() + timeout;
        while (!done() && Date.now() < end) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      `;
      expect(violations(source)).toHaveLength(0);
    });

    test("rejects timer wait with while loop but no deadline or signal check", () => {
      const source = `
        while (condition) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      `;
      expect(violations(source)).toMatchObject([{ construct: "timer-backed wait" }]);
    });
  });

  describe("Sandbox-unrunnable exclusion", () => {
    test("excludes .sandbox-unrunnable.test.ts files", () => {
      const source = "await Bun.sleep(100);";
      expect(violations(source, "v2/src/daemon/example.sandbox-unrunnable.test.ts")).toHaveLength(0);
    });

    test("excludes .sandbox-unrunnable.test.ts from execution", () => {
      const source = "await new Promise((resolve) => setTimeout(resolve, 100));";
      expect(violations(source, "v2/src/execution/example.sandbox-unrunnable.test.ts")).toHaveLength(0);
    });
  });

  describe("Scope filtering", () => {
    test("only guards daemon and execution test files", () => {
      const source = "await Bun.sleep(100);";
      expect(violations(source, "v2/src/other/example.test.ts")).toHaveLength(0);
      expect(violations(source, "v1/src/daemon/example.test.ts")).toHaveLength(0);
      expect(violations(source, "shared/daemon.test.ts")).toHaveLength(0);
    });

    test("does not guard non-test files", () => {
      const source = "await Bun.sleep(100);";
      expect(violations(source, "v2/src/daemon/lifecycle.ts")).toHaveLength(0);
    });

    test("only guards .test.ts files, not other patterns", () => {
      const source = "await Bun.sleep(100);";
      expect(violations(source, "v2/src/daemon/example.spec.ts")).toHaveLength(0);
    });
  });

  describe("Line numbers", () => {
    test("reports correct line numbers for violations", () => {
      const source = `line 1
line 2
await Bun.sleep(100);
line 4`;
      expect(violations(source)).toMatchObject([{ line: 3 }]);
    });

    test("handles multiline violations", () => {
      const source = `line 1
line 2
await new Promise((resolve) =>
  setTimeout(resolve, 100)
);
line 6`;
      const result = violations(source);
      expect(result[0]?.line).toBe(3);
    });
  });
});
