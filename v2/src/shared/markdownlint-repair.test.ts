import { expect, test } from "bun:test";
import { runMarkdownlintAutofix } from "./markdownlint-repair.ts";
import { AsyncSubprocessError, type AsyncSubprocessOptions } from "./subprocess.ts";

test("markdownlint autofix is bounded, group-killed, and reports a timeout instead of passing silently", async () => {
  const warnings: string[] = [];
  let seen: AsyncSubprocessOptions | undefined;
  await runMarkdownlintAutofix({
    files: ["doc.md"],
    warn: (message) => warnings.push(message),
    runner: {
      async runAsync(_cmd, _args, _cwd, options) {
        seen = options;
        throw new AsyncSubprocessError("Command timed out after 120000ms: bun", undefined, "", "", "ETIMEDOUT");
      },
    },
  });
  expect(seen?.timeoutMs).toBe(120_000);
  expect(seen?.processGroup).toBeDefined();
  expect(warnings).toEqual(["warning: markdownlint autofix timed out after 120000ms; skipping autofix\n"]);
});
