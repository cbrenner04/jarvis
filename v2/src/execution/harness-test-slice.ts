import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { SANDBOX_SUFFIX } from "../../../scripts/test-slice.ts";
import { errorMessage } from "../../../shared/error-message.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { trackProcessGroup, type VerifierProcessGroupRecorder } from "./verifier-process-groups.ts";

/** Worktree-root sidecar an implement agent writes to ask Jarvis to run integration-slice test files outside its sandbox. */
export const HARNESS_TEST_SLICE_REQUEST_FILE = ".jarvis-test-slice-request";
const OUTPUT_MAX_CHARS = 16 * 1024;
const MEASUREMENT_TERMS =
  /\b(faster|slower|speed|timing|timed|duration|seconds?|ms|wall|measured?|measurement|count)\b/i;
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

function isRunnableRequestPath(worktreePath: string, path: string): boolean {
  if (isAbsolute(path) || !path.endsWith(SANDBOX_SUFFIX)) return false;
  const normalized = normalize(path);
  if (normalized.startsWith("..")) return false;
  const full = join(worktreePath, normalized);
  return existsSync(full) && statSync(full).isFile();
}

/** Reads and deletes the request sidecar; only existing in-worktree `*.sandbox-unrunnable.test.ts` paths are admitted. */
export function takeHarnessTestSliceRequest(worktreePath: string): HarnessTestSliceRequest | undefined {
  const path = join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE);
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  rmSync(path, { force: true });
  const files: string[] = [];
  const rejected: string[] = [];
  for (const line of new Set(lines)) {
    (isRunnableRequestPath(worktreePath, line) ? files : rejected).push(line);
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
      (criterion.text.match(SANDBOX_FILE_PATTERN) ?? []).some(
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
      const output = await runner.runAsync("sh", ["-c", 'exec bun test "$@" 2>&1', "sh", ...files], worktreePath, {
        timeoutMs,
        signal,
        processGroup: tracked.processGroup,
      });
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
