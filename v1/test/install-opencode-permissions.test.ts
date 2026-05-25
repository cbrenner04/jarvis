import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installOpencodePermissions,
  SAFE_OPENCODE_PERMISSION,
} from "../../scripts/install-opencode-permissions.ts";

let home: string;

function configPath(): string {
  return join(home, ".config", "opencode", "opencode.json");
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
}

function writeConfig(value: unknown): void {
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(value, null, 2));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jarvis-opencode-permissions-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("installOpencodePermissions", () => {
  test("creates opencode config when none exists", () => {
    expect(existsSync(configPath())).toBe(false);

    const result = installOpencodePermissions({ home });

    expect(result.changed).toBe(true);
    expect(readConfig()).toEqual({ permission: SAFE_OPENCODE_PERMISSION });
  });

  test("preserves unrelated existing config while merging permission stanza", () => {
    writeConfig({
      provider: { local: { npm: "@opencode-ai/local" } },
      enabled_providers: ["local"],
      mcp: { docs: { command: "docs-mcp" } },
    });

    installOpencodePermissions({ home });

    expect(readConfig()).toEqual({
      provider: { local: { npm: "@opencode-ai/local" } },
      enabled_providers: ["local"],
      mcp: { docs: { command: "docs-mcp" } },
      permission: SAFE_OPENCODE_PERMISSION,
    });
  });

  test("does not rewrite an existing matching stanza", () => {
    writeConfig({ permission: SAFE_OPENCODE_PERMISSION });
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(configPath(), oldTime, oldTime);
    const before = statSync(configPath()).mtimeMs;

    const result = installOpencodePermissions({ home });

    expect(result.changed).toBe(false);
    expect(statSync(configPath()).mtimeMs).toBe(before);
  });

  test("exits non-zero for conflicting permission values", () => {
    writeConfig({
      permission: {
        edit: "ask",
        bash: {
          "*": "allow",
        },
      },
    });
    const before = readFileSync(configPath(), "utf8");
    let stderr = "";

    expect(() =>
      installOpencodePermissions({
        home,
        stderr: (message) => {
          stderr += message;
        },
      }),
    ).toThrow(/conflicting opencode permissions/);

    expect(stderr).toContain('sets permission.edit="ask"');
    expect(stderr).toContain('requires "allow"');
    expect(stderr).toContain("conflicting permission values");
    expect(readFileSync(configPath(), "utf8")).toBe(before);
  });
});
