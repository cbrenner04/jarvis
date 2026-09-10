import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEAD_EXPORT_ALLOWLIST,
  findDeadExports,
  moduleSurface,
  runDeadExportGuard,
  specifierResolver,
} from "./guard-dead-exports.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const NO_ALLOWLIST = new Map<string, string>();

function fixture(files: Record<string, string>) {
  return Object.entries(files).map(([file, source]) => ({ file, source }));
}

describe("dead-export gate", () => {
  test("reports a newly added export that nothing imports", () => {
    const files = fixture({
      "v2/src/execution/paths.ts": "export function used() {}\nexport function orphan() {}\n",
      "v2/src/execution/paths.test.ts": 'import { used } from "./paths.ts";\nused();\n',
    });
    expect(findDeadExports(files, REPO_ROOT, NO_ALLOWLIST)).toEqual([
      { file: "v2/src/execution/paths.ts", line: 2, symbol: "orphan" },
    ]);
  });

  test("an export referenced only inside its own file is dead", () => {
    const files = fixture({
      "v2/src/execution/self.ts": "export const LIMIT = 1;\nexport function bounded(n: number) { return n < LIMIT; }\n",
      "v2/src/execution/self.test.ts": 'import { bounded } from "./self.ts";\nbounded(0);\n',
    });
    expect(findDeadExports(files, REPO_ROOT, NO_ALLOWLIST)).toMatchObject([{ symbol: "LIMIT" }]);
  });

  test.each([
    ["type import", 'import type { Shape } from "./module.ts";'],
    ["namespace import", 'import * as mod from "./module.ts";\nmod;'],
    ["dynamic import", 'const mod = await import("./module.ts");\nmod;'],
    ["re-export", 'export { Shape } from "./module.ts";'],
    ["namespace re-export", 'export * from "./module.ts";'],
  ])("counts a %s as a reference", (_reach, importer) => {
    const files = fixture({
      "v2/src/execution/module.ts": "export type Shape = { n: number };\n",
      "v2/src/execution/consumer.ts": importer,
      "v2/src/execution/consumer.test.ts": 'import * as consumer from "./consumer.ts";\nconsumer;\n',
    });
    expect(findDeadExports(files, REPO_ROOT, NO_ALLOWLIST)).toEqual([]);
  });

  test("scopes to v2/src production modules only", () => {
    const files = fixture({
      "v2/src/execution/example.test.ts": "export const helper = 1;\n",
      "v2/src/execution/example.test-support.ts": "export const support = 1;\n",
      "v2/src/testing/fixture.ts": "export const fixture = 1;\n",
      "shared/util.ts": "export const util = 1;\n",
    });
    expect(findDeadExports(files, REPO_ROOT, NO_ALLOWLIST)).toEqual([]);
  });

  test("the allowlist exempts a named symbol only in its own file", () => {
    const files = fixture({
      "v2/src/a.ts": "export function entry() {}\n",
      "v2/src/b.ts": "export function entry() {}\n",
    });
    const allowlist = new Map([["v2/src/a.ts#entry", "entry point"]]);
    expect(findDeadExports(files, REPO_ROOT, allowlist)).toEqual([{ file: "v2/src/b.ts", line: 1, symbol: "entry" }]);
  });

  test("module surface reads every export form and destructured bindings", () => {
    const source = [
      "export function fn() {}",
      "export const a = 1, { b, c: d } = obj;",
      "export type T = 1;",
      "export interface I {}",
      "export enum E {}",
      "export class C {}",
      "const local = 1;",
      "export { local as renamed };",
      "export default fn;",
    ].join("\n");
    const surface = moduleSurface({ file: "v2/src/x.ts", source }, specifierResolver(new Set(), REPO_ROOT));
    expect([...surface.exports.keys()].sort()).toEqual(["C", "E", "I", "T", "a", "b", "d", "default", "fn", "renamed"]);
  });

  test("the current tree passes with the allowlist applied", () => {
    expect(runDeadExportGuard(REPO_ROOT)).toEqual([]);
    expect([...DEAD_EXPORT_ALLOWLIST.keys()]).toEqual(["v2/src/cli.ts#main"]);
  });

  test("the swept fully-dead symbols are absent from v2/src", () => {
    expect(existsSync(join(REPO_ROOT, "v2/src/export-surface-trim.test.ts"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "v2/src/testing/sandbox-git-repo.ts"))).toBe(false);
    const absent: Array<[string, string]> = [
      ["v2/src/execution/review-intent-enforcement.ts", "cleanupVerdictFile"],
      ["v2/src/testing/timer-callback-guard-fixture.ts", "registerStopPoll"],
      ["v2/src/testing/holdable-async-subprocess-runner.ts", "createHoldableAsyncSubprocessRunner"],
    ];
    for (const [file, symbol] of absent) {
      expect(readFileSync(join(REPO_ROOT, file), "utf8")).not.toContain(symbol);
    }
  });
});
