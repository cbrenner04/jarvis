import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { SANDBOX_SUFFIX } from "../../../scripts/test-slice.ts";
import { errorMessage } from "../shared/error-message.ts";
import { parseSpec } from "../shared/spec-parser.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackProcessGroup, type VerifierProcessGroupRecorder } from "./verifier-process-groups.ts";

/** Worktree-root sidecar an implement agent writes to ask Jarvis to run integration-slice test files outside its sandbox. */
export const HARNESS_TEST_SLICE_REQUEST_FILE = ".jarvis-test-slice-request";
const OUTPUT_MAX_CHARS = 16 * 1024;
/** Harness slice runs admitted per write loop (one active subspec). */
export const MAX_HARNESS_TEST_SLICE_RUNS = 3;
const MEASUREMENT_TERMS = /\b(faster|slower|speed(?:-?up)?|timing|duration|measured|measurement|measure)\b/i;
const SANDBOX_FILE_PATTERN = new RegExp(`[\\w./-]*${SANDBOX_SUFFIX.replace(/\./g, "\\.")}`, "g");

type HarnessTestSliceRequest = { files: string[]; rejected: string[] };
export type HarnessTestSliceResult = HarnessTestSliceRequest & {
  exitCode: number | null;
  durationMs: number;
  output: string;
};
export type HarnessTestSliceRunner = (input: {
  worktreePath: string;
  files: readonly string[];
  signal?: AbortSignal;
  processGroups?: VerifierProcessGroupRecorder;
  timeoutMs: number;
}) => Promise<{ exitCode: number | null; output: string }>;

export function referencesSandboxUnrunnableTest(text: string): boolean {
  return text.includes(SANDBOX_SUFFIX);
}

/** Concrete `*.sandbox-unrunnable.test.ts` names in text; a bare glob (`*.sandbox-unrunnable.test.ts`) names no file. */
function namedSandboxTestFiles(text: string): string[] {
  return (text.match(SANDBOX_FILE_PATTERN) ?? []).filter((name) => basename(name) !== SANDBOX_SUFFIX);
}

/** Why a requested path is refused, or undefined when it resolves to a named in-worktree sandbox-unrunnable test file. */
function requestPathRejection(worktreePath: string, path: string, subspecNames: readonly string[]): string | undefined {
  if (isAbsolute(path)) return "absolute path";
  if (!subspecNames.some((named) => namesSameTestFile(named, path))) return "not named by the active subspec";
  const full = join(worktreePath, path);
  if (!existsSync(full)) return "missing";
  const resolved = realpathSync(full);
  const fromRoot = relative(realpathSync(worktreePath), resolved);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return "outside the worktree";
  if (!resolved.endsWith(SANDBOX_SUFFIX) || !statSync(resolved).isFile())
    return "not a *.sandbox-unrunnable.test.ts file";
  return undefined;
}

/**
 * Reads and deletes the request sidecar. Admits only existing files inside the worktree (after symlink
 * resolution) that the active subspec names; `priorRuns` at the cap rejects every path.
 */
export function takeHarnessTestSliceRequest(
  worktreePath: string,
  subspecText: string,
  priorRuns: number,
): HarnessTestSliceRequest | undefined {
  const path = join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE);
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  rmSync(path, { force: true });
  const files: string[] = [];
  const rejected: string[] = [];
  const subspecNames = namedSandboxTestFiles(subspecText);
  for (const line of new Set(lines)) {
    const reason =
      priorRuns >= MAX_HARNESS_TEST_SLICE_RUNS
        ? `run cap of ${MAX_HARNESS_TEST_SLICE_RUNS} reached`
        : requestPathRejection(worktreePath, line, subspecNames);
    if (reason === undefined) files.push(line);
    else rejected.push(`${line} (${reason})`);
  }
  return { files, rejected };
}

function namesSameTestFile(named: string, run: string): boolean {
  return named === run || run.endsWith(`/${named}`) || named.endsWith(`/${run}`);
}

/** Ticked measurement criteria naming a `*.sandbox-unrunnable.test.ts` file with no recorded harness run of it. */
export function unverifiedMeasurementCriteria(subspecText: string, harnessRunFiles: readonly string[]): string[] {
  return parseSpec(subspecText)
    .acceptanceCriteria.filter((criterion) => criterion.checked && MEASUREMENT_TERMS.test(criterion.text))
    .filter((criterion) =>
      namedSandboxTestFiles(criterion.text).some(
        (named) => !harnessRunFiles.some((run) => namesSameTestFile(named, run)),
      ),
    )
    .map((criterion) => criterion.text);
}

export function truncateTestSliceOutput(output: string): string {
  return output.length <= OUTPUT_MAX_CHARS ? output : `[truncated]\n${output.slice(-OUTPUT_MAX_CHARS)}`;
}

/** Runs `bun test <files>` with combined stdout+stderr; a non-zero exit is a result, not a throw. */
export function createDefaultHarnessTestSliceRunner(
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): HarnessTestSliceRunner {
  return async ({ worktreePath, files, signal, processGroups, timeoutMs }) => {
    const tracked = trackProcessGroup(processGroups);
    try {
      const output = await runner.runAsync(
        "sh",
        ["-c", 'exec bun test "$@" 2>&1', "sh", "--", ...files.map((file) => `./${file}`)],
        worktreePath,
        {
          timeoutMs,
          signal,
          processGroup: tracked.processGroup,
        },
      );
      return { exitCode: 0, output };
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        return { exitCode: error.status ?? null, output: `${error.stdout}${error.stderr}` };
      }
      return { exitCode: null, output: errorMessage(error) };
    } finally {
      tracked.settle();
    }
  };
}
