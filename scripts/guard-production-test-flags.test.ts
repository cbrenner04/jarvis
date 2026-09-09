import { describe, expect, test } from "bun:test";
import { findProductionInvertHookViolations, isTestFile, shouldScanFile } from "./guard-production-test-flags.ts";

function violations(source: string, file = "v2/src/example.ts") {
  return findProductionInvertHookViolations([{ file, source }]);
}

const ROOTS = ["v2/src", "shared"] as const;

describe("production invert-hook guard", () => {
  describe("set*ForTest exports", () => {
    test.each(ROOTS)("rejects export function setFooForTest under %s", (root) => {
      expect(violations("export function setFooForTest() {}", `${root}/module.ts`)).toMatchObject([
        { shape: "set*ForTest export" },
      ]);
    });

    test.each(ROOTS)("allows setFooForTest export in .test.ts under %s", (root) => {
      expect(violations("export function setFooForTest() {}", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows setFooForTest export in .test.tsx under %s", (root) => {
      expect(violations("export function setFooForTest() {}", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects setFooForTest export in production .tsx", () => {
      expect(violations("export function setFooForTest() {}", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "set*ForTest export" },
      ]);
    });
  });

  describe("setInvert*ForTest exports", () => {
    test.each(ROOTS)("rejects export function setInvertFooForTest under %s", (root) => {
      expect(violations("export function setInvertFooForTest() {}", `${root}/module.ts`)).toMatchObject([
        { shape: "setInvert*ForTest export" },
      ]);
    });

    test.each(ROOTS)("allows setInvertFooForTest export in .test.ts under %s", (root) => {
      expect(violations("export function setInvertFooForTest() {}", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows setInvertFooForTest export in .test.tsx under %s", (root) => {
      expect(violations("export function setInvertFooForTest() {}", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects setInvertFooForTest export in production .tsx", () => {
      expect(violations("export function setInvertFooForTest() {}", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "setInvert*ForTest export" },
      ]);
    });
  });

  describe("*ForTest module variables", () => {
    test.each(ROOTS)("rejects fooForTest module variable under %s", (root) => {
      expect(violations("let fooForTest = false;", `${root}/module.ts`)).toMatchObject([
        { shape: "*ForTest module variable" },
      ]);
    });

    test.each(ROOTS)("allows fooForTest module variable in .test.ts under %s", (root) => {
      expect(violations("let fooForTest = false;", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows fooForTest module variable in .test.tsx under %s", (root) => {
      expect(violations("const fooForTest = false;", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects fooForTest module variable in production .tsx", () => {
      expect(violations("let fooForTest = false;", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "*ForTest module variable" },
      ]);
    });
  });

  describe("invert*ForTest module variables", () => {
    test.each(ROOTS)("rejects invertFooForTest module variable under %s", (root) => {
      expect(violations("let invertFooForTest = false;", `${root}/module.ts`)).toMatchObject([
        { shape: "invert*ForTest module variable" },
      ]);
    });

    test.each(ROOTS)("allows invertFooForTest module variable in .test.ts under %s", (root) => {
      expect(violations("let invertFooForTest = false;", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows invertFooForTest module variable in .test.tsx under %s", (root) => {
      expect(violations("const invertFooForTest = false;", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects invertFooForTest module variable in production .tsx", () => {
      expect(violations("let invertFooForTest = false;", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "invert*ForTest module variable" },
      ]);
    });
  });

  describe("*ForTest parameters", () => {
    test.each([
      ["fooForTest", "function run(fooForTest: boolean) {}"],
      ["fooForTest optional", "function run(fooForTest?: boolean) {}"],
      ["fooForTest arrow", "const run = (fooForTest) => fooForTest;"],
      ["fooForTest constructor", "class C { constructor(fooForTest: boolean) {} }"],
    ])("rejects %s parameter in production file", (_label, source) => {
      expect(violations(source, "v2/src/example.ts")).toMatchObject([{ shape: "*ForTest parameter" }]);
    });

    test.each(ROOTS)("rejects fooForTest parameter under %s", (root) => {
      expect(violations("function run(fooForTest: boolean) {}", `${root}/module.ts`)).toMatchObject([
        { shape: "*ForTest parameter" },
      ]);
    });

    test.each([
      ["fooForTest", "function run(fooForTest: boolean) {}"],
      ["fooForTest optional", "function run(fooForTest?: boolean) {}"],
    ])("allows %s parameter in .test.ts", (_label, source) => {
      expect(violations(source, "v2/src/example.test.ts")).toEqual([]);
    });

    test.each([
      ["fooForTest", "function run(fooForTest: boolean) {}"],
      ["fooForTest optional", "function run(fooForTest?: boolean) {}"],
    ])("allows %s parameter in .test.tsx", (_label, source) => {
      expect(violations(source, "v2/src/tui/View.test.tsx")).toEqual([]);
    });

    test("rejects fooForTest parameter in production .tsx", () => {
      expect(violations("function run(fooForTest: boolean) {}", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "*ForTest parameter" },
      ]);
    });
  });

  describe("invert* parameters", () => {
    test.each([
      ["invertFoo", "function run(invertFoo: boolean) {}"],
      ["invertFooForTest", "function run(invertFooForTest?: boolean) {}"],
      ["invertFoo rest", "function run(...invertFoo: boolean[]) {}"],
      ["invertFoo arrow", "const run = (invertFoo) => invertFoo;"],
      ["invertFoo constructor", "class C { constructor(invertFoo: boolean) {} }"],
    ])("rejects %s parameter in production file", (_label, source) => {
      expect(violations(source, "v2/src/example.ts")).toMatchObject([{ shape: "invert* parameter" }]);
    });

    test.each([
      ["invertFoo", "function run(invertFoo: boolean) {}"],
      ["invertFooForTest", "function run(invertFooForTest?: boolean) {}"],
    ])("allows %s parameter in .test.ts", (_label, source) => {
      expect(violations(source, "v2/src/example.test.ts")).toEqual([]);
    });

    test.each([
      ["invertFoo", "function run(invertFoo: boolean) {}"],
      ["invertFooForTest", "function run(invertFooForTest?: boolean) {}"],
    ])("allows %s parameter in .test.tsx", (_label, source) => {
      expect(violations(source, "v2/src/tui/View.test.tsx")).toEqual([]);
    });

    test("rejects invertFoo parameter in production .tsx", () => {
      expect(violations("function run(invertFoo: boolean) {}", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "invert* parameter" },
      ]);
    });

    test.each(ROOTS)("rejects invertFoo parameter under %s", (root) => {
      expect(violations("function run(invertFoo: boolean) {}", `${root}/module.ts`)).toMatchObject([
        { shape: "invert* parameter" },
      ]);
    });
  });

  describe("*ForTest type members", () => {
    test.each([
      ["interface property", "interface Options { fooForTest?: boolean; }"],
      ["type alias property", "type Options = { fooForTest: boolean; };"],
      ["type parameter", "type Options<T extends { fooForTest: boolean }> = T;"],
    ])("rejects %s in production file", (_label, source) => {
      expect(violations(source, "v2/src/example.ts")).toMatchObject([{ shape: "*ForTest type member" }]);
    });

    test.each(ROOTS)("rejects fooForTest type member under %s", (root) => {
      expect(violations("interface Options { fooForTest?: boolean; }", `${root}/module.ts`)).toMatchObject([
        { shape: "*ForTest type member" },
      ]);
    });

    test.each(ROOTS)("allows fooForTest type member in .test.ts under %s", (root) => {
      expect(violations("interface Options { fooForTest?: boolean; }", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows fooForTest type member in .test.tsx under %s", (root) => {
      expect(violations("type Options = { fooForTest: boolean; };", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects fooForTest type member in production .tsx", () => {
      expect(violations("interface Options { fooForTest?: boolean; }", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "*ForTest type member" },
      ]);
    });
  });

  describe("invert*ForTest type members", () => {
    test.each([
      ["interface property", "interface Options { invertFooForTest?: boolean; }"],
      ["type alias property", "type Options = { invertFooForTest: boolean; };"],
      ["type parameter", "type Options<T extends { invertFooForTest: boolean }> = T;"],
    ])("rejects %s in production file", (_label, source) => {
      expect(violations(source, "v2/src/example.ts")).toMatchObject([{ shape: "invert*ForTest type member" }]);
    });

    test.each(ROOTS)("rejects invertFooForTest type member under %s", (root) => {
      expect(violations("interface Options { invertFooForTest?: boolean; }", `${root}/module.ts`)).toMatchObject([
        { shape: "invert*ForTest type member" },
      ]);
    });

    test.each(ROOTS)("allows invertFooForTest type member in .test.ts under %s", (root) => {
      expect(violations("interface Options { invertFooForTest?: boolean; }", `${root}/module.test.ts`)).toEqual([]);
    });

    test.each(ROOTS)("allows invertFooForTest type member in .test.tsx under %s", (root) => {
      expect(violations("type Options = { invertFooForTest: boolean; };", `${root}/View.test.tsx`)).toEqual([]);
    });

    test("rejects invertFooForTest type member in production .tsx", () => {
      expect(violations("interface Options { invertFooForTest?: boolean; }", "v2/src/tui/Panel.tsx")).toMatchObject([
        { shape: "invert*ForTest type member" },
      ]);
    });
  });

  describe("scope and skips", () => {
    test("skips shared/prompts/step-rules.ts", () => {
      const source =
        'export const DEFAULT_WRITE_STEP_RULES = "Do not add `set*ForTest`/`set*ForTests` exports, `invert*ForTest` and `*ForTest`/`*ForTests` module variables, `invert*` function parameters, `*ForTest`/`*ForTests` function parameters, `invert*ForTest` type members, or `*ForTest`/`*ForTests` type members in production code.";';
      expect(violations(source, "shared/prompts/step-rules.ts")).toEqual([]);
    });

    test("does not scan paths outside scan roots", () => {
      expect(violations("export function setInvertFooForTest() {}", "scripts/example.ts")).toEqual([]);
      expect(violations("export function setInvertFooForTest() {}", "v2/spec/example.ts")).toEqual([]);
    });
  });

  describe("extension gate", () => {
    test(".test. basename exclusion skips test fixtures", () => {
      // Inversion target: `isTestFile` in scripts/guard-production-test-flags.ts —
      // flipping the `.test.` basename exclusion to scan test paths makes this subcase RED.
      const source = "export function setInvertFooForTest() {}";
      expect(isTestFile("v2/src/module.test.ts")).toBe(true);
      expect(isTestFile("v2/src/tui/View.test.tsx")).toBe(true);
      expect(shouldScanFile("v2/src/module.test.ts")).toBe(false);
      expect(shouldScanFile("v2/src/tui/View.test.tsx")).toBe(false);
      expect(violations(source, "v2/src/module.test.ts")).toEqual([]);
      expect(violations(source, "v2/src/tui/View.test.tsx")).toEqual([]);
    });
  });
});
