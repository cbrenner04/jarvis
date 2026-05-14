import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type PlanInvocationCommon = {
  interviewTurns?: number;
  reviewPasses?: number;
  repo?: string;
  cwd: string;
  resume: boolean;
};

export type PlanInvocation =
  | (PlanInvocationCommon & { mode: "file"; intentPath: string })
  | (PlanInvocationCommon & { mode: "inline"; intentText: string })
  | (PlanInvocationCommon & { mode: "interactive" });

export type PlanParseResult =
  | { ok: true; invocation: PlanInvocation }
  | { ok: false; exitCode: number; message: string };

const FLAGS_WITH_VALUE = new Set([
  "--interview-turns",
  "--review-passes",
  "--repo",
  "--cwd",
]);

function parseNonNegativeInteger(
  raw: string,
  flag: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      message: `jarvis plan: invalid value for ${flag}: ${JSON.stringify(raw)} (expected non-negative integer)`,
    };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      ok: false,
      message: `jarvis plan: invalid value for ${flag}: ${JSON.stringify(raw)} (expected non-negative integer)`,
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

export function parsePlanArgs(
  argv: readonly string[],
  processCwd: string,
): PlanParseResult {
  let interviewTurns: number | undefined;
  let reviewPasses: number | undefined;
  let repo: string | undefined;
  let cwdFlag: string | undefined;
  let resume = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--resume") {
      resume = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        return {
          ok: false,
          exitCode: 1,
          message: `jarvis plan: missing value for ${arg}`,
        };
      }
      i += 1;
      switch (arg) {
        case "--interview-turns": {
          const parsed = parseNonNegativeInteger(value, arg);
          if (!parsed.ok) {
            return { ok: false, exitCode: 1, message: parsed.message };
          }
          interviewTurns = parsed.value;
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
        message: `jarvis plan: unknown flag ${arg}`,
      };
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: 1,
      message: "jarvis plan: too many arguments",
    };
  }

  const cwd =
    cwdFlag !== undefined
      ? isAbsolute(cwdFlag)
        ? cwdFlag
        : resolve(processCwd, cwdFlag)
      : processCwd;

  const common: PlanInvocationCommon = { cwd, resume };
  if (interviewTurns !== undefined) common.interviewTurns = interviewTurns;
  if (reviewPasses !== undefined) common.reviewPasses = reviewPasses;
  if (repo !== undefined) common.repo = repo;

  if (positional.length === 0) {
    return { ok: true, invocation: { ...common, mode: "interactive" } };
  }

  const positionalArg = positional[0] as string;
  const candidatePath = isAbsolute(positionalArg)
    ? positionalArg
    : resolve(cwd, positionalArg);
  if (isExistingFile(candidatePath)) {
    return {
      ok: true,
      invocation: { ...common, mode: "file", intentPath: candidatePath },
    };
  }
  return {
    ok: true,
    invocation: { ...common, mode: "inline", intentText: positionalArg },
  };
}

export function describePlanInvocation(inv: PlanInvocation): string {
  switch (inv.mode) {
    case "file":
      return `plan mode: file intent=${inv.intentPath}`;
    case "inline":
      return `plan mode: inline intent=${JSON.stringify(inv.intentText)}`;
    case "interactive":
      return "plan mode: interactive";
  }
}
