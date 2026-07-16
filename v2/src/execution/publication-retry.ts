const OUTPUT_TAIL_MAX_CHARS = 4096;

export type PublicationFailure = {
  operation: string;
  message: string;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
};

type OutputError = Error & { code?: unknown; status?: unknown; stdout?: unknown; stderr?: unknown };
const details = new WeakMap<Error, PublicationFailure>();

function textTail(value: unknown): string | undefined {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) return undefined;
  const text = value.toString().trim();
  if (text.length === 0) return undefined;
  return text.length > OUTPUT_TAIL_MAX_CHARS ? text.slice(-OUTPUT_TAIL_MAX_CHARS) : text;
}

/** Normalize command evidence once, retaining bounded independently-labelled output tails. */
export function normalizePublicationFailure(operation: string, thrown: unknown): PublicationFailure {
  const error: OutputError = thrown instanceof Error ? (thrown as OutputError) : new Error(String(thrown));
  const status = typeof error.status === "number" ? error.status : typeof error.code === "number" ? error.code : undefined;
  const stdoutTail = textTail(error.stdout);
  const stderrTail = textTail(error.stderr);
  return {
    operation,
    message: error.message,
    ...(status !== undefined ? { exitCode: status } : {}),
    ...(stdoutTail !== undefined ? { stdoutTail } : {}),
    ...(stderrTail !== undefined ? { stderrTail } : {}),
  };
}

export function publicationFailureFor(error: unknown): PublicationFailure | undefined {
  return error instanceof Error ? details.get(error) : undefined;
}

export class NonFastForwardPublicationError extends Error {
  constructor(readonly failure: PublicationFailure, options?: ErrorOptions) {
    super(`Non-fast-forward push rejection; ${failure.message}`, options);
    this.name = "NonFastForwardPublicationError";
  }
}

/** Only known transport failures retry; explicit permanent diagnostics always win. */
export function isTransientPublicationFailure(failure: PublicationFailure): boolean {
  const text = `${failure.message}\n${failure.stdoutTail ?? ""}\n${failure.stderrTail ?? ""}`.toLowerCase();
  if (/auth|permission|forbidden|not found|invalid|rate.?limit|\b429\b|non-fast-forward|failed to push some refs/.test(text)) return false;
  return /network|connection (?:reset|refused|timed out)|econnreset|econnrefused|etimedout|broken pipe|\b(?:502|503|504)\b|temporary failure/.test(text);
}

export function formatPublicationFailure(failure: PublicationFailure): string {
  const parts = [failure.message, `exit=${failure.exitCode ?? "unknown"}`];
  if (failure.stdoutTail !== undefined) parts.push(`stdout: ${failure.stdoutTail}`);
  if (failure.stderrTail !== undefined) parts.push(`stderr: ${failure.stderrTail}`);
  return parts.join("; ");
}

export async function runPublicationWithRetry<T>(
  operation: string,
  action: () => Promise<T>,
  options: { delay: (ms: number) => Promise<void>; retryNotice: (message: string) => void; isSuccess?: (error: unknown) => boolean },
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (options.isSuccess?.(error)) return undefined as T;
      const original = error instanceof Error ? error : new Error(String(error));
      const failure = normalizePublicationFailure(operation, original);
      details.set(original, failure);
      if (/non-fast-forward|failed to push some refs/i.test(`${failure.message}\n${failure.stderrTail ?? ""}`)) {
        const divergence = new NonFastForwardPublicationError(failure, { cause: original });
        details.set(divergence, failure);
        throw divergence;
      }
      if (!isTransientPublicationFailure(failure) || attempt === 3) throw original;
      options.retryNotice(`${operation}: ${formatPublicationFailure(failure)}; retrying (attempt ${attempt + 1}/3)`);
      await options.delay(1000);
    }
  }
  throw new Error("unreachable publication retry state");
}
