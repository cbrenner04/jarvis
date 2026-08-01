import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultRunScopedTestsForMutationCheckpoints,
  verifyTickedMutationCheckpoints,
} from "./criteria-ticked-mutation-checkpoint-verifier.ts";
import { applyMutation } from "./diff-derived-mutation-verifier.ts";

describe("criteria-ticked mutation-checkpoint verifier", () => {
  test("skip-guard inversion applies valid syntax on indented guards", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "skip-guard-"));
    const relPath = "src/guard.ts";
    const filePath = join(worktree, relPath);
    mkdirSync(join(worktree, "src"), { recursive: true });
    const original =
      "export function run(x: number) {\n  // Mutation checkpoint: skipping positive guard must turn pin RED.\n  if (x > 0) return x;\n  return 0;\n}\n";
    writeFileSync(filePath, original, "utf8");

    const subspec = `## Acceptance criteria

- [x] \`guard.test.ts\` — run keeps positive; Mutation checkpoint: skipping positive guard must turn pin RED.
`;

    writeFileSync(
      join(worktree, "guard.test.ts"),
      `import { test } from "bun:test";
test("run keeps positive", () => {
  // Mutation checkpoint: skipping positive guard must turn pin RED.
});
`,
      "utf8",
    );

    const result = await verifyTickedMutationCheckpoints(worktree, subspec, {
      runScopedTests: async () => true,
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(filePath, "utf8")).toBe(original);
    if (!result.ok) {
      expect(result.hollow.some((hollow) => hollow.comment.includes("skipping positive guard"))).toBe(true);
    }
  });

  test("defaultRunScopedTestsForMutationCheckpoints times out instead of hanging", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "scoped-timeout-"));
    writeFileSync(
      join(worktree, "package.json"),
      JSON.stringify({
        scripts: {
          "test:slow": 'node -e "setTimeout(() => {}, 30_000)"',
        },
      }),
      "utf8",
    );

    const started = Date.now();
    const passed = await defaultRunScopedTestsForMutationCheckpoints(worktree, ["test:slow"], 1_000);
    const elapsed = Date.now() - started;

    expect(passed).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("restores production file after scoped-test timeout", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "restore-timeout-"));
    const relPath = "src/hollow-guard.ts";
    const filePath = join(worktree, relPath);
    mkdirSync(join(worktree, "src"), { recursive: true });
    const original = "export function keepPositive(value: number) {\n  if (!value) return false;\n  return true;\n}\n";
    writeFileSync(filePath, original, "utf8");
    writeFileSync(
      join(worktree, "package.json"),
      JSON.stringify({ scripts: { "test:v2": 'node -e "setTimeout(() => {}, 30_000)"' } }),
      "utf8",
    );
    writeFileSync(
      join(worktree, "hollow-guard.test.ts"),
      `import { test } from "bun:test";
test("keepPositive accepts one", () => {
  // Mutation checkpoint: negating \`!value\` guard must turn pin RED.
});
`,
      "utf8",
    );

    const subspec = `## Acceptance criteria

- [x] \`hollow-guard.test.ts\` — keepPositive accepts one; Mutation checkpoint: negating \`!value\` guard must turn pin RED.
`;

    await verifyTickedMutationCheckpoints(worktree, subspec, {
      runScopedTests: (cwd, scope) => defaultRunScopedTestsForMutationCheckpoints(cwd, scope, 1_000),
    });

    expect(readFileSync(filePath, "utf8")).toBe(original);
  });
});

test("skip-guard mutation candidate is syntactically valid when applied", () => {
  const line = "    if (x > 0) return x;";
  const mutated = applyMutation(line, {
    file: "guard.ts",
    line: 1,
    columnStart: 0,
    columnEnd: line.length,
    originalText: line,
    mutatedText: "    if (false /* MUTATED */ && (x > 0)) return x;",
    mutation: "skip-guard",
  });
  expect(mutated).toBe("    if (false /* MUTATED */ && (x > 0)) return x;");
});
