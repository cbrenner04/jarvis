import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectProductionSourceFiles,
  findProductionInvertHookViolations,
  isTestFile,
  runProductionInvertHookGuard,
  shouldScanFile,
} from "./guard-production-test-flags.ts";

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
        'export const DEFAULT_WRITE_STEP_RULES = "Do not add `*ForTest`/`*ForTests` type members, function parameters, module variables, or exported functions/variables, nor `invert*` function parameters, in production code.";';
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

  describe("real-source shapes", () => {
    test("flags a ForTest member after a nested object member in a real WriteLoopInput excerpt", () => {
      const source = [
        "export type WriteLoopInput = WriteExecuteInput & {",
        "  /** Optional binding resolution overrides. */",
        "  bindingResolution?: { resolve: (id: string) => ResolvedAgentBinding; retries?: number };",
        "  readyFinalizer?: ReadyFinalizer;",
        "  /** Test seam: skip persisted-fence enforcement on completed-run retry and resume recovery. */",
        "  bypassPersistedReadyGateRepairFenceForTest?: boolean;",
        "  landingContractReprompt?: { violation: string; offendingFile: string };",
        "};",
      ].join("\n");
      expect(violations(source, "v2/src/execution/write-loop.ts")).toEqual([
        { file: "v2/src/execution/write-loop.ts", line: 6, shape: "*ForTest type member" },
      ]);
    });

    test("flags a seam declared on an intersection type alias", () => {
      const source = [
        "export type ReviewMutationResumeDeps = IntentFinalizationResumeDeps & {",
        "  mutationRepair?: { verifier: MutationVerifier };",
        "  bypassPersistedReadyGateRepairFenceForTest?: boolean;",
        "  mutationRepairBindingFactoryForTest?: (binding: ResolvedAgentBinding) => InvocationBinding;",
        "};",
        "type A = B & { fooForTest?: boolean };",
        "type U = C | { barForTests: number };",
      ].join("\n");
      expect(violations(source, "v2/src/execution/workflow-runner-resume.ts")).toEqual([
        { file: "v2/src/execution/workflow-runner-resume.ts", line: 3, shape: "*ForTest type member" },
        { file: "v2/src/execution/workflow-runner-resume.ts", line: 4, shape: "*ForTest type member" },
        { file: "v2/src/execution/workflow-runner-resume.ts", line: 6, shape: "*ForTest type member" },
        { file: "v2/src/execution/workflow-runner-resume.ts", line: 7, shape: "*ForTest type member" },
      ]);
    });

    test("flags an exported ForTest function without a set prefix", () => {
      const source = [
        "let peak = 0;",
        "export function resetVerifierTestRunTrackingForTest(): void {",
        "  peak = 0;",
        "}",
        "export function isInsideTimerCallbackForTest(content: string, lineNum: number): boolean {",
        "  return content.length > lineNum;",
        "}",
        "export const buildFixtureForTests = () => peak;",
        "function helper() {}",
        "export { helper as helperForTest };",
      ].join("\n");
      expect(violations(source, "v2/src/execution/diff-derived-mutation-verifier.ts")).toEqual([
        { file: "v2/src/execution/diff-derived-mutation-verifier.ts", line: 2, shape: "*ForTest export" },
        { file: "v2/src/execution/diff-derived-mutation-verifier.ts", line: 5, shape: "*ForTest export" },
        { file: "v2/src/execution/diff-derived-mutation-verifier.ts", line: 8, shape: "*ForTest export" },
        { file: "v2/src/execution/diff-derived-mutation-verifier.ts", line: 8, shape: "*ForTest module variable" },
        { file: "v2/src/execution/diff-derived-mutation-verifier.ts", line: 10, shape: "*ForTest export" },
      ]);
    });

    test("does not flag mentions that are not declarations", () => {
      const source = [
        "import type { RunnerForTests } from './runners.ts';",
        "const runners = new Map<string, RunnerForTests>();",
        "function run(deps: { enabled: boolean }, fooForTest: never) {",
        "  if (deps.enabled) {",
        "    return runners.size;",
        "  }",
        "  return 0;",
        "}",
        "export function check(deps: Deps): boolean {",
        "  const fooForTest = deps.fooForTest === true;",
        "  if (fooForTest) {",
        "    return true;",
        "  }",
        "  return invertFoo(deps);",
        "}",
      ].join("\n");
      // Only the parameter declaration on line 3 is a seam; the type argument, property access,
      // local binding, and condition are mentions.
      expect(violations(source, "v2/src/example.ts")).toEqual([
        { file: "v2/src/example.ts", line: 3, shape: "*ForTest parameter" },
      ]);
    });

    test("reports every seam present in the scan roots", () => {
      const cwd = join(import.meta.dir, "..");
      const reported = new Set(
        runProductionInvertHookGuard(cwd).map((violation) => `${violation.file}:${violation.line}`),
      );
      const candidatePattern = /(?<![.\w])((?:invert\w+)|(?:\w+ForTests?))(?=\s*[?:(=,)])/g;
      const candidates: string[] = [];
      for (const { file } of collectProductionSourceFiles(cwd)) {
        const lines = readFileSync(join(cwd, file), "utf8").split("\n");
        lines.forEach((text, index) => {
          const code = text.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          for (const match of code.matchAll(candidatePattern)) {
            const name = match[1] ?? "";
            if (!/ForTests?$/.test(name) && !/^invert[A-Z]/.test(name)) continue;
            candidates.push(`${file}:${index + 1}`);
          }
        });
      }
      const missed = candidates.filter((candidate) => !reported.has(candidate));
      expect(missed).toEqual([]);
    });
  });
});
