import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AirProxyAgent } from "../../src/agents/airproxy.ts";
import { CopilotAgent } from "../../src/agents/copilot.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-opencode-wrapper-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-opencode-wrapper-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(): string {
  const path = join(dir, "opencode");
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated) and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
pwd > "${dir}/cwd"
exit 0
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("AirProxyAgent", () => {
  test("name is 'airproxy'", () => {
    expect(String(new AirProxyAgent({ model: "AirProxy/test" }).name)).toBe(
      "airproxy",
    );
  });

  test("spawns `opencode run` with the AirProxy model", async () => {
    const bin = fakeBinary();
    const agent = new AirProxyAgent({
      binary: bin,
      model: "AirProxy/x",
    });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toBe(
      "run\0--model\0AirProxy/x\0--format\0default\0the prompt\0",
    );
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(readFileSync(join(dir, "cwd"), "utf8").trim()).toBe(
      realpathSync(cwd),
    );
  });
});

describe("CopilotAgent", () => {
  test("name is 'copilot'", () => {
    expect(
      String(new CopilotAgent({ model: "github-copilot/test" }).name),
    ).toBe("copilot");
  });

  test("spawns `opencode run` with the github-copilot model", async () => {
    const bin = fakeBinary();
    const agent = new CopilotAgent({
      binary: bin,
      model: "github-copilot/y",
    });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toBe(
      "run\0--model\0github-copilot/y\0--format\0default\0the prompt\0",
    );
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(readFileSync(join(dir, "cwd"), "utf8").trim()).toBe(
      realpathSync(cwd),
    );
  });
});
