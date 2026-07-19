import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type GuardViolation = { file: string; line: number; construct: string };
type GuardFile = { file: string; source: string };

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function guarded(file: string): boolean {
  return (
    (file.startsWith("v2/src/daemon/") || file.startsWith("v2/src/execution/")) &&
    file.endsWith(".test.ts") &&
    file.endsWith(".sandbox-unrunnable.test.ts")
  );
}

export function findDeterminismViolations(files: readonly GuardFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const { file, source } of files) {
    if (!guarded(file)) continue;

    // Find all Bun.sleep calls
    for (const match of source.matchAll(/\bBun\s*(?:\.\s*sleep|\[\s*["']sleep\s*["']\s*\])\s*\(/g)) {
      violations.push({
        file,
        line: lineAt(source, match.index ?? 0),
        construct: "Bun.sleep",
      });
    }

    // Find direct timer-backed waits (setTimeout, setInterval) that are not part of a bounded loop
    // We detect: new Promise((resolve) => setTimeout(...)) or await new Promise((resolve) => setTimeout(...))
    // But we need to exclude those inside a while loop with a bounded condition (Date.now() or signal check)
    for (const match of source.matchAll(
      /await\s+new\s+Promise\s*\(\s*\(resolve\)\s*=>\s*set(?:Timeout|Interval)\s*\(/g,
    )) {
      const index = match.index ?? 0;
      // Look backwards from this match to see if it's inside a bounded loop
      const beforeMatch = source.slice(0, index);

      // Find the last "while" keyword before this promise
      const lastWhileMatch = [...beforeMatch.matchAll(/\bwhile\s*\(/g)].pop();
      if (!lastWhileMatch) {
        // No while loop, so this is a bare timer wait
        violations.push({
          file,
          line: lineAt(source, index),
          construct: "timer-backed wait",
        });
        continue;
      }

      // Check if the while condition includes a boundary (Date.now() < deadline or signal?.aborted)
      const whileStart = lastWhileMatch.index ?? 0;
      const whileParenEnd = findMatchingParen(source, whileStart + 5); // "while" is 5 chars
      const whileCondition = source.slice(whileStart + 6, whileParenEnd);

      // Check for deadline pattern or signal abort pattern
      const isDeadlineBounded = /Date\.now\s*\(\)\s*<\s*\w+/.test(whileCondition);
      const isSignalBounded = /signal\?\.aborted|controller\.signal\.aborted/i.test(whileCondition);

      if (!isDeadlineBounded && !isSignalBounded) {
        violations.push({
          file,
          line: lineAt(source, index),
          construct: "timer-backed wait",
        });
      }
    }
  }

  return violations;
}

function findMatchingParen(source: string, openParenIndex: number): number {
  let depth = 1;
  for (let i = openParenIndex + 1; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function collectFiles(root: string, cwd: string): GuardFile[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return collectFiles(path, cwd);
      const file = relative(cwd, path);
      return entry.isFile() && /\.test\.tsx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
    });
  } catch {
    return [];
  }
}

export function runDeterminismGuard(cwd: string): GuardViolation[] {
  const files = [...collectFiles(join(cwd, "v2/src/daemon"), cwd), ...collectFiles(join(cwd, "v2/src/execution"), cwd)];
  return findDeterminismViolations(files);
}

if (import.meta.main) {
  const violations = runDeterminismGuard(process.cwd());
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.construct}`);
  if (violations.length > 0) process.exitCode = 1;
}
