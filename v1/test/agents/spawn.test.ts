import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/agents/spawn.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-spawn-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-spawn-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "agent");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record PWD so the test can inspect it.
printf '%s' "$PWD" > "${dir}/pwd"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("runAgent PWD normalization", () => {
  test("spawned child's PWD equals configured cwd, not parent's PWD", async () => {
    const bin = fakeBinary({ exit: 0 });

    const result = await runAgent(
      {
        name: "claude",
        binary: bin,
        cwd: realpathSync(cwd),
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      "test",
      { cwd },
    );

    expect(result.kind).toBe("ok");
    const childPwd = readFileSync(join(dir, "pwd"), "utf8");
    expect(childPwd).toBe(realpathSync(cwd));
  });

  test("spawned child does not receive OLDPWD", async () => {
    const bin = join(dir, "agent");
    const script = `#!/usr/bin/env bash
# Check if OLDPWD is set
if [ -z "$OLDPWD" ]; then
  echo "ok"
  exit 0
else
  echo "OLDPWD is set: $OLDPWD"
  exit 1
fi
`;
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);

    const result = await runAgent(
      {
        name: "claude",
        binary: bin,
        cwd: realpathSync(cwd),
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      "test",
      { cwd },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout.trim()).toBe("ok");
    }
  });
});
