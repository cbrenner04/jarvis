import type { OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";

const NAMED_ESCAPES: Readonly<Record<string, string>> = { "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" };

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const ENCODED_CHARS = /[\\\u0000-\u001f\u007f]/g;

/** Backslash, tab, newline, and carriage return use short escapes; any other C0 control or DEL becomes `\uXXXX`. */
function encodeText(value: string): string {
  return value.replace(
    ENCODED_CHARS,
    (char) => NAMED_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Labeled failure block: first line `failure:`, every later line two-space indented, one physical
 * line per field. Run identity is the host's concern and stays outside the block.
 */
export function formatOperatorFailureBlock(record: OperatorFailureRecord): string[] {
  return [
    "failure:",
    `  expectation: ${encodeText(record.expectation)}`,
    `  observation: ${encodeText(record.observation)}`,
    ...(record.nearMiss === undefined ? [] : [`  near miss: ${encodeText(record.nearMiss)}`]),
    `  reissue can help: ${record.retryable ? "yes" : "no"}`,
    ...record.referencedPaths.map((entry) => `  path (${entry.origin}): ${encodeText(entry.path)}`),
  ];
}
