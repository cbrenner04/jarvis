import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { validateTargetDir } from "../config.ts";

export type PlanInvocationCommon = {
  refineTurns?: number;
  reviewPasses?: number;
  repo?: string;
  targetDir?: string;
  cwd: string;
  resume: boolean;
  resumeDraft: boolean;
};

export type PlanInvocation = PlanInvocationCommon & { mode: "file"; readyIntentPath: string };

export type PlanParseResult =
  | { ok: true; invocation: PlanInvocation }
  | { ok: false; exitCode: number; message: string };

const FLAGS_WITH_VALUE = new Set(["--refine-turns", "--review-passes", "--repo", "--cwd", "--target-dir"]);

function parseNonNegativeInteger(
  raw: string,
  flag: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      message: `plan: invalid value for ${flag}: ${JSON.stringify(raw)} (expected non-negative integer)`,
    };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      ok: false,
      message: `plan: invalid value for ${flag}: ${JSON.stringify(raw)} (expected non-negative integer)`,
    };
  }
  return { ok: true, value: n };
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function parsePlanArgs(argv: readonly string[], processCwd: string): PlanParseResult {
  let refineTurns: number | undefined;
  let reviewPasses: number | undefined;
  let repo: string | undefined;
  let targetDir: string | undefined;
  let cwdFlag: string | undefined;
  let resume = false;
  let resumeDraft = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--resume") {
      resume = true;
      continue;
    }
    if (arg === "--resume-draft") {
      resumeDraft = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        return {
          ok: false,
          exitCode: 1,
          message: `plan: missing value for ${arg}`,
        };
      }
      i += 1;
      switch (arg) {
        case "--refine-turns": {
          const parsed = parseNonNegativeInteger(value, arg);
          if (!parsed.ok) {
            return { ok: false, exitCode: 1, message: parsed.message };
          }
          refineTurns = parsed.value;
          break;
        }
        case "--review-passes": {
          const parsed = parseNonNegativeInteger(value, arg);
          if (!parsed.ok) {
            return { ok: false, exitCode: 1, message: parsed.message };
          }
          reviewPasses = parsed.value;
          break;
        }
        case "--repo":
          repo = value;
          break;
        case "--target-dir":
          try {
            targetDir = validateTargetDir(value, "--target-dir", (message): never => {
              throw new Error(message);
            });
          } catch (err) {
            return {
              ok: false,
              exitCode: 1,
              message: (err as Error).message,
            };
          }
          break;
        case "--cwd":
          cwdFlag = value;
          break;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      return {
        ok: false,
        exitCode: 1,
        message: `plan: unknown flag ${arg}`,
      };
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: 1,
      message: "plan: too many arguments",
    };
  }
  if (resume && resumeDraft) {
    return {
      ok: false,
      exitCode: 1,
      message: "plan: --resume and --resume-draft cannot be combined",
    };
  }

  const cwd = cwdFlag !== undefined ? (isAbsolute(cwdFlag) ? cwdFlag : resolve(processCwd, cwdFlag)) : processCwd;

  const common: PlanInvocationCommon = { cwd, resume, resumeDraft };
  if (refineTurns !== undefined) common.refineTurns = refineTurns;
  if (reviewPasses !== undefined) common.reviewPasses = reviewPasses;
  if (repo !== undefined) common.repo = repo;
  if (targetDir !== undefined) common.targetDir = targetDir;

  if (positional.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      message: "plan: missing required ready-intent (<targetDir>/ready-intents/<name>.md)",
    };
  }

  const positionalArg = positional[0] as string;
  const candidatePath = isAbsolute(positionalArg) ? positionalArg : resolve(cwd, positionalArg);

  if (resume || resumeDraft) {
    return {
      ok: true,
      invocation: { ...common, mode: "file", readyIntentPath: candidatePath },
    };
  }

  if (isExistingFile(candidatePath)) {
    return {
      ok: true,
      invocation: { ...common, mode: "file", readyIntentPath: candidatePath },
    };
  }

  return {
    ok: false,
    exitCode: 1,
    message: `plan: path does not exist or is not a file: ${positionalArg}\nUse \`jarvis1 intent\` to author a ready-intent, then \`jarvis1 plan <targetDir>/ready-intents/<name>.md\``,
  };
}

export function describePlanInvocation(inv: PlanInvocation): string {
  return `plan: ready-intent=${inv.readyIntentPath}`;
}
