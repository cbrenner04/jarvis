import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

type Conflict = {
  path: string;
  existing: JsonValue;
  required: JsonValue;
};

export const SAFE_OPENCODE_PERMISSION = {
  edit: "allow",
  webfetch: "ask",
  websearch: "ask",
  codesearch: "ask",
  external_directory: "ask",
  bash: {
    "*": "allow",
    "curl*": "ask",
    "wget*": "ask",
    "npm install*": "ask",
    "bun add*": "ask",
    "pnpm add*": "ask",
    "yarn add*": "ask",
    "git push*": "ask",
    "git push --force*": "deny",
    "git clean*": "deny",
    "git reset --hard*": "deny",
    "rm -rf /*": "deny",
    "rm -rf ~*": "deny",
    "rm -rf $HOME*": "deny",
    "sudo*": "deny",
    "npm publish*": "deny",
  },
} satisfies JsonObject;

export type InstallOpencodePermissionsOptions = {
  home?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export type InstallOpencodePermissionsResult = {
  changed: boolean;
  path: string;
};

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatPath(parent: string, key: string): string {
  if (parent === "") {
    return key;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

function mergeRequired(
  existing: JsonObject,
  required: JsonObject,
  parentPath: string,
  conflicts: Conflict[],
): boolean {
  let changed = false;

  for (const [key, requiredValue] of Object.entries(required)) {
    const existingValue = existing[key];
    const path = formatPath(parentPath, key);

    if (existingValue === undefined) {
      existing[key] = cloneJson(requiredValue);
      changed = true;
      continue;
    }

    if (isJsonObject(requiredValue) && isJsonObject(existingValue)) {
      changed =
        mergeRequired(existingValue, requiredValue, path, conflicts) || changed;
      continue;
    }

    if (JSON.stringify(existingValue) === JSON.stringify(requiredValue)) {
      continue;
    }

    conflicts.push({
      path,
      existing: existingValue,
      required: requiredValue,
    });
  }

  return changed;
}

function readConfig(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return parsed as JsonObject;
}

function writeConfigAtomically(path: string, config: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(
    dirname(path),
    `.opencode.json.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmpPath, path);
}

function formatConflict(conflict: Conflict): string {
  return [
    `- ${conflict.path}`,
    `  existing: ${JSON.stringify(conflict.existing)}`,
    `  required: ${JSON.stringify(conflict.required)}`,
  ].join("\n");
}

export function installOpencodePermissions(
  opts: InstallOpencodePermissionsOptions = {},
): InstallOpencodePermissionsResult {
  const home = opts.home ?? homedir();
  const path = join(home, ".config", "opencode", "opencode.json");
  const config = readConfig(path);
  const conflicts: Conflict[] = [];
  const changed = mergeRequired(
    config,
    { permission: SAFE_OPENCODE_PERMISSION },
    "",
    conflicts,
  );

  if (conflicts.length > 0) {
    const first = conflicts[0];
    if (first === undefined) {
      throw new Error("conflicting opencode permissions");
    }
    opts.stderr?.(
      `error: existing ${path} sets ${first.path}=${JSON.stringify(first.existing)}; ` +
        `the safe-edits posture requires ${JSON.stringify(first.required)}.\n` +
        "Update manually or remove the conflicting key before re-running.\n\n" +
        `conflicting permission values:\n${conflicts.map(formatConflict).join("\n")}\n`,
    );
    throw new Error("conflicting opencode permissions");
  }

  if (changed || !existsSync(path)) {
    writeConfigAtomically(path, config);
    opts.stdout?.(`installed opencode permissions at ${path}\n`);
  } else {
    opts.stdout?.(`opencode permissions already installed at ${path}\n`);
  }

  return { changed, path };
}

if (import.meta.main) {
  try {
    installOpencodePermissions({
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message !== "conflicting opencode permissions"
    ) {
      process.stderr.write(`error: ${error.message}\n`);
    }
    process.exit(1);
  }
}
