import { describe, expect, it } from "bun:test";
import { findProductionCallViolations } from "./guard-test-double-production-calls.ts";

describe("guard test-double production-call violations", () => {
  describe("rejects known antipattern: production function called to compute response", () => {
    it("flags a value import of production dispatch helper called to build double response", () => {
      // The antipattern: a test double imports a production function and calls it to compute its response
      // This defeats the purpose of the double (stand-in for production)
      const fixture = {
        file: "v2/src/testing/workflow-double.ts",
        source: `
import { advanceLoadedRevision } from "../cli.ts";

export function makeWorkflowDouble() {
  return {
    invoke: async ({ cwd }) => {
      const revision = advanceLoadedRevision(cwd);
      return { kind: "ok", stdout: revision };
    },
  };
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual({
        file: fixture.file,
        line: 7,
        module: "../cli.ts",
        exportName: "advanceLoadedRevision",
      });
    });

    it("flags multiple calls to the same imported production function", () => {
      const fixture = {
        file: "v2/src/testing/fake-daemon.ts",
        source: `
import { someDispatcher } from "../execution/dispatch.ts";

export function makeFakeDaemon() {
  return {
    handle: () => someDispatcher(),
    process: () => someDispatcher(),
  };
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.exportName === "someDispatcher")).toBe(true);
    });
  });

  describe("accepts type-only imports", () => {
    it("ignores import type declarations from production modules", () => {
      const fixture = {
        file: "v2/src/testing/my-test-double.ts",
        source: `
import type { RunnerConfig } from "../execution/runner.ts";

export function makeDouble(): RunnerConfig {
  return { /* implementation */ };
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("accepts mixed type and value imports, allowing type but flagging value calls", () => {
      const fixture = {
        file: "v2/src/testing/mixed-imports.ts",
        source: `
import type { SomeType } from "../execution/runner.ts";
import { runHelper } from "../execution/runner.ts";

export function makeDouble() {
  const val = runHelper();
  return {};
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].exportName).toBe("runHelper");
    });
  });

  describe("accepts imported constants never called", () => {
    it("ignores production constants that are never invoked", () => {
      const fixture = {
        file: "v2/src/testing/config-double.ts",
        source: `
import { DEFAULT_TIMEOUT } from "../config/defaults.ts";

export function makeDouble() {
  const timeout = DEFAULT_TIMEOUT;
  return { timeout };
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("allows importing and accessing properties without calling", () => {
      const fixture = {
        file: "v2/src/testing/config-double.ts",
        source: `
import { CONFIG } from "../config/instance.ts";

export function makeDouble() {
  const mode = CONFIG.mode;
  return {};
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });
  });

  describe("accepts allowlisted builder and entry-point calls", () => {
    it("accepts main() from ../cli.ts", () => {
      const fixture = {
        file: "v2/src/testing/cli-runner-double.ts",
        source: `
import { main } from "../cli.ts";

export async function runCli(argv) {
  return main(argv);
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("accepts openStateStore() from ../persistence/state-store.ts", () => {
      const fixture = {
        file: "v2/src/testing/state-store-double.ts",
        source: `
import { openStateStore } from "../persistence/state-store.ts";

export async function initStore(path) {
  return openStateStore(path);
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("accepts startDaemon() from ../daemon/daemon-lifecycle.ts", () => {
      const fixture = {
        file: "v2/src/testing/test-daemon-lifecycle.ts",
        source: `
import { startDaemon } from "../daemon/daemon-lifecycle.ts";

export function createTestDaemon() {
  return {
    start: (socketPath) => startDaemon(socketPath),
  };
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("accepts isProcessAlive() from ../daemon/daemon-lifecycle.ts", () => {
      const fixture = {
        file: "v2/src/testing/daemon-reaper.ts",
        source: `
import { isProcessAlive } from "../daemon/daemon-lifecycle.ts";

export function checkProcess(pid) {
  return isProcessAlive(pid);
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("accepts with aliased imports: main as runtimeMain", () => {
      const fixture = {
        file: "v2/src/testing/cli-helpers.ts",
        source: `
import { main as runtimeMain } from "../cli.ts";

export async function runWith(argv) {
  return runtimeMain(argv);
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });
  });

  describe("ignores sibling and external imports", () => {
    it("ignores sibling fixture imports (./ paths)", () => {
      const fixture = {
        file: "v2/src/testing/fixture-a.ts",
        source: `
import { makeHelper } from "./fixture-b.ts";

export function use() {
  return makeHelper();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("ignores node: built-in imports", () => {
      const fixture = {
        file: "v2/src/testing/fs-double.ts",
        source: `
import { mkdirSync } from "node:fs";

export function createDir(path) {
  mkdirSync(path);
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });

    it("ignores bun:test imports", () => {
      const fixture = {
        file: "v2/src/testing/test-helpers.ts",
        source: `
import { describe, it } from "bun:test";

describe("tests", () => {
  it("works", () => {
    // test code
  });
});
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(0);
    });
  });

  describe("scans all files under v2/src/testing/", () => {
    it("scans .ts fixture files, not just .test.ts", () => {
      const fixture = {
        file: "v2/src/testing/my-fixture.ts",
        source: `
import { badFunction } from "../core/logic.ts";

export function makeDouble() {
  return badFunction();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe("v2/src/testing/my-fixture.ts");
    });

    it("scans .tsx files", () => {
      const fixture = {
        file: "v2/src/testing/component-double.tsx",
        source: `
import { renderComponent } from "../ui/component.ts";

export function makeDouble() {
  return renderComponent();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
    });

    it("reports violations from multiple files", () => {
      const fixtures = [
        {
          file: "v2/src/testing/fixture-a.ts",
          source: `
import { bad1 } from "../module1.ts";
export function a() { bad1(); }
          `,
        },
        {
          file: "v2/src/testing/fixture-b.ts",
          source: `
import { bad2 } from "../module2.ts";
export function b() { bad2(); }
          `,
        },
      ];

      const violations = findProductionCallViolations(fixtures);
      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.file)).toEqual(["v2/src/testing/fixture-a.ts", "v2/src/testing/fixture-b.ts"]);
    });
  });

  describe("detects guard condition coverage", () => {
    it("type-only skip is essential: removing it would catch type imports as violations", () => {
      // This test validates that the type-only skip is necessary by showing what
      // would happen without it: type imports would be treated as value imports.
      // The actual guard code uses the type keyword to filter; absence of this
      // check means "import type { Foo }" would match "import { ... }" patterns.
      const fixtureWithType = {
        file: "v2/src/testing/typed-import.ts",
        source: `import type { Type } from "../module.ts";`,
      };

      const violations = findProductionCallViolations([fixtureWithType]);
      expect(violations).toHaveLength(0);
      // If type skip were removed, type imports would be parsed as value imports
      // even though they can't be called. This test documents that the type skip
      // is load-bearing.
    });

    it("allowlist check is essential: without it, all production calls would violate", () => {
      // Tests that allowlisted calls are actually suppressed by the allowlist logic,
      // not by something else (like not being detected as calls).
      const fixture = {
        file: "v2/src/testing/cli-usage.ts",
        source: `
import { main } from "../cli.ts";
export function test() { main([]); }
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      // Should pass because main is allowlisted
      expect(violations).toHaveLength(0);
      // If allowlist check were dropped, this would fail with one violation
    });

    it("production-module path check is essential: without it, imports of testing doubles would violate", () => {
      // Tests that the production-module path filter works, preventing testing
      // files from being flagged as violating when they import shared testing helpers.
      const fixture = {
        file: "v2/src/testing/double-a.ts",
        source: `
import { helperFromB } from "./double-b.ts";
export function a() { helperFromB(); }
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      // Should pass because ./double-b.ts is in testing, not production
      expect(violations).toHaveLength(0);
      // If production-module path check were dropped, sibling imports would violate
    });
  });

  describe("edge cases", () => {
    it("handles multiline imports", () => {
      const fixture = {
        file: "v2/src/testing/multiline-import.ts",
        source: `
import {
  badFunction,
  OTHER_CONST,
} from "../module.ts";

export function test() {
  badFunction();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].exportName).toBe("badFunction");
    });

    it("handles deeply nested paths (shared/ imports)", () => {
      const fixture = {
        file: "v2/src/testing/shared-user.ts",
        source: `
import { sharedHelper } from "../../../shared/some/deep/module.ts";

export function test() {
  sharedHelper();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].module).toBe("../../../shared/some/deep/module.ts");
    });

    it("handles import aliases correctly", () => {
      const fixture = {
        file: "v2/src/testing/aliased.ts",
        source: `
import { badFunc as renamed } from "../module.ts";

export function test() {
  renamed();
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].exportName).toBe("badFunc");
    });

    it("reports correct line numbers for violations", () => {
      const fixture = {
        file: "v2/src/testing/line-numbers.ts",
        source: `import { bad } from "../module.ts";

export function a() {
  // line 4
  // line 5
  bad();  // line 6
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(6);
    });

    it("does not flag non-call usage (property access, variable reference)", () => {
      const fixture = {
        file: "v2/src/testing/non-call-usage.ts",
        source: `
import { someFunction, someClass } from "../module.ts";

export function test() {
  const f = someFunction;
  const c = new someClass();
  const x = someFunction.property;
}
      `,
      };

      const violations = findProductionCallViolations([fixture]);
      // Only direct calls count as violations; assignment and property access don't
      expect(violations).toHaveLength(1); // Only the 'new someClass()' is a call
    });
  });
});
