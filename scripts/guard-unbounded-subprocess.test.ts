import { describe, expect, test } from "bun:test";
import { findUnboundedSubprocessViolations } from "./guard-unbounded-subprocess.ts";

function violations(source: string, file = "v2/src/example.ts") {
  return findUnboundedSubprocessViolations([{ file, source }]);
}

describe("unbounded subprocess guard", () => {
  test.each([
    ["spawn", 'import { spawn } from "node:child_process";\nspawn("git", ["fetch"], { cwd });'],
    ["execFile alias", 'import { execFile as run } from "child_process";\nrun("gh", [], { cwd }, cb);'],
    [
      "local rebinding",
      'import { spawn as realSpawn } from "node:child_process";\nconst spawn = seams.spawn ?? realSpawn;\nspawn("x", []);',
    ],
    ["namespace import", 'import * as cp from "node:child_process";\ncp.spawn("git", [], { cwd });'],
    ["require binding", 'const cp = require("child_process");\ncp.execFile("git", [], cb);'],
    ["Bun.spawn", 'const proc = Bun.spawn(["git", "status"], { cwd });'],
    ["Bun.$", "await Bun.$`git fetch`;"],
    ["signal: undefined", 'import { spawn } from "node:child_process";\nspawn("git", [], { signal: undefined });'],
    ["bound token only in a comment", 'import { spawn } from "node:child_process";\nspawn("git", [] /* timeout */);'],
    ["template interpolation", 'import { exec } from "node:child_process";\nexec(`sleep ${timeoutMs}`, cb);'],
  ])("rejects an unbounded %s", (_name, source) => {
    expect(violations(source)).toHaveLength(1);
  });

  test.each([
    ["timeout", 'import { execFile } from "node:child_process";\nexecFile("git", [], { cwd, timeout: 1000 }, cb);'],
    ["signal shorthand", 'import { spawn } from "node:child_process";\nspawn("git", [], { signal });'],
    ["Bun.spawn timeout", 'Bun.spawn(["git"], { timeout: LIMIT });'],
  ])("accepts a call bounded by %s", (_name, source) => {
    expect(violations(source)).toEqual([]);
  });

  test("a marker allows only its own call site, not other spawns in the same file", () => {
    const source = [
      'import { spawn } from "node:child_process";',
      "// guard-unbounded-subprocess: fire-and-forget sink",
      'spawn("bash", ["-c", cmd]);',
      'spawn("git", ["fetch"]);',
    ].join("\n");
    expect(violations(source)).toEqual([{ file: "v2/src/example.ts", line: 4, name: "spawn" }]);
  });

  test("ignores type-only imports, tests, docs, and non-production files", () => {
    const source = 'import { spawn } from "node:child_process";\nspawn("bash", ["-c", cmd]);';
    expect(violations('import type { spawn } from "node:child_process";')).toEqual([]);
    expect(violations(source, "v2/src/example.test.ts")).toEqual([]);
    expect(violations(source, "v2/docs/research/example.ts")).toEqual([]);
    expect(violations(source, "scripts/example.ts")).toEqual([]);
  });
});
