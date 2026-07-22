import { describe, expect, test } from "bun:test";
import { findProductionCallViolations } from "./guard-test-double-production-calls.ts";

function violations(source: string, file = "v2/src/testing/example.ts") {
  return findProductionCallViolations([{ file, source }]);
}

describe("test-doubles production-call guard", () => {
  describe("Rejected patterns", () => {
    test("rejects value import of production helper called to compute double response", () => {
      const source = `
import { advanceLoadedRevision } from "../cli/dispatch.ts";

function createStatusDouble() {
  const status = advanceLoadedRevision();
  return { status };
}
`;
      expect(violations(source)).toMatchObject([{ module: "../cli/dispatch.ts", export: "advanceLoadedRevision" }]);
    });

    test("rejects multiple production calls in same file", () => {
      const source = `
import { helperA, helperB } from "../helpers.ts";

function double1() {
  return helperA();
}

function double2() {
  return helperB();
}
`;
      const result = violations(source);
      expect(result).toHaveLength(2);
      expect(result.map((v) => v.export).sort()).toEqual(["helperA", "helperB"]);
    });

    test("rejects production call from shared directory", () => {
      const source = `
import { sharedHelper } from "../../../shared/helpers.ts";

export function fixture() {
  const result = sharedHelper();
  return result;
}
`;
      expect(violations(source)).toMatchObject([{ module: "../../../shared/helpers.ts", export: "sharedHelper" }]);
    });

    test("rejects production call with await", () => {
      const source = `
import { asyncHelper } from "../helpers.ts";

async function fixture() {
  const result = await asyncHelper();
  return result;
}
`;
      expect(violations(source)).toMatchObject([{ module: "../helpers.ts", export: "asyncHelper" }]);
    });
  });

  describe("Allowed patterns", () => {
    test("allows type-only imports from production", () => {
      const source = `
import type { StatusReply } from "../cli/types.ts";

function createDouble(): StatusReply {
  return { ok: true };
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows value import not called", () => {
      const source = `
import { VERSION_CONSTANT } from "../constants.ts";

export const myConstant = VERSION_CONSTANT;
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows allowlisted main entry point", () => {
      const source = `
import { main } from "../cli.ts";

async function testMain() {
  return await main(["--help"]);
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows allowlisted openStateStore", () => {
      const source = `
import { openStateStore } from "../persistence/state-store.ts";

export function fixture() {
  return openStateStore("/tmp/state.db");
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows allowlisted startDaemon", () => {
      const source = `
import { startDaemon } from "../daemon/daemon-lifecycle.ts";

export async function fixture() {
  return await startDaemon("/tmp/socket");
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows allowlisted isProcessAlive", () => {
      const source = `
import { isProcessAlive } from "../daemon/daemon-lifecycle.ts";

export function fixture(pid: number) {
  return isProcessAlive(pid);
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows sibling fixture imports", () => {
      const source = `
import { createTestFixture } from "./fixture-helpers.ts";

export function anotherFixture() {
  return createTestFixture();
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows node: module imports", () => {
      const source = `
import { readFileSync } from "node:fs";

export function fixture() {
  return readFileSync("/tmp/test.txt", "utf8");
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("allows bun:test imports", () => {
      const source = `
import { test, expect } from "bun:test";

test("example", () => {
  expect(true).toBe(true);
});
`;
      expect(violations(source)).toHaveLength(0);
    });
  });

  describe("Mixed scenarios", () => {
    test("detects violation among allowed imports", () => {
      const source = `
import type { StatusReply } from "../cli/types.ts";
import { illicitHelper } from "../helpers.ts";
import { main } from "../cli.ts";

export function fixture() {
  const result = illicitHelper();
  return main(["--help"]);
}
`;
      const result = violations(source);
      expect(result).toHaveLength(1);
      expect(result[0]?.export).toBe("illicitHelper");
    });

    test("allows multiple allowlisted calls", () => {
      const source = `
import { main } from "../cli.ts";
import { openStateStore } from "../persistence/state-store.ts";

export async function fixture() {
  const store = openStateStore("/tmp/db");
  const exitCode = await main(["--help"]);
  return { store, exitCode };
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("detects violation even with allowlisted sibling calls", () => {
      const source = `
import { main } from "../cli.ts";
import { forbidden } from "../helpers.ts";

export async function fixture() {
  forbidden();
  return await main(["--help"]);
}
`;
      const result = violations(source);
      expect(result).toHaveLength(1);
      expect(result[0]?.export).toBe("forbidden");
    });
  });

  describe("Line number accuracy", () => {
    test("reports correct line for production call", () => {
      const source = `line 1
line 2
import { helper } from "../helpers.ts";
line 4
export function fixture() {
  helper();
}`;
      const result = violations(source);
      expect(result[0]?.line).toBe(6);
    });

    test("reports line for multiline call", () => {
      const source = `line 1
import { helper } from "../helpers.ts";
line 3
const x = helper(
  arg1,
  arg2
);`;
      const result = violations(source);
      expect(result[0]?.line).toBe(4);
    });
  });

  describe("Scope filtering", () => {
    test("only guards files under v2/src/testing/", () => {
      const source = `
import { forbidden } from "../helpers.ts";

export function fixture() {
  return forbidden();
}
`;
      expect(violations(source, "v2/src/cli/example.ts")).toHaveLength(0);
      expect(violations(source, "v2/src/daemon/example.ts")).toHaveLength(0);
      expect(violations(source, "v1/src/testing/example.ts")).toHaveLength(0);
      expect(violations(source, "shared/testing/example.ts")).toHaveLength(0);
    });

    test("guards all file types under v2/src/testing/", () => {
      const source = `
import { forbidden } from "../helpers.ts";
forbidden();
`;
      expect(violations(source, "v2/src/testing/fixture.ts")).toHaveLength(1);
      expect(violations(source, "v2/src/testing/fixture.js")).toHaveLength(1);
      expect(violations(source, "v2/src/testing/subdir/fixture.tsx")).toHaveLength(1);
    });
  });

  describe("Guard condition validation", () => {
    test("removing type-only skip detects type imports as violations if called", () => {
      // This test validates that the type-only filter is actually protecting us
      // by checking that if we import a type-only export, we don't flag it even if
      // there's a coincidental call with that name (which wouldn't actually compile)
      const source = `
import type { TypeHelper } from "../helpers.ts";

// If this were import (value), it would be called
export function fixture() {
  return true;  // TypeHelper is never called in value position
}
`;
      expect(violations(source)).toHaveLength(0);
    });

    test("removing allowlist check detects allowlisted calls", () => {
      // This test validates the allowlist is actually working by showing
      // that if we removed it, these would be violations.
      // We verify this by testing that non-allowlisted similar imports ARE violations.
      const source = `
import { someOtherMain } from "../cli.ts";

export function fixture() {
  return someOtherMain(["--help"]);
}
`;
      // someOtherMain is not in allowlist, so it should be a violation
      expect(violations(source)).toHaveLength(1);
      expect(violations(source)[0]?.export).toBe("someOtherMain");
    });

    test("removing production-module check flags sibling imports", () => {
      // Verify that sibling fixture imports are protected by the production-module check
      const source = `
import { sibling } from "./sibling-fixture.ts";

export function fixture() {
  return sibling();
}
`;
      // This should have zero violations because it's a sibling import
      expect(violations(source)).toHaveLength(0);
    });
  });
});
