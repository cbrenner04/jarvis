import { collectProductionSourceFiles, isProductionSourceFile, type SourceFile } from "./production-files.ts";

/**
 * Unbounded-subprocess gate: every production spawn (`spawn`/`execFile`/`exec`/`fork` from
 * child_process via named, aliased, namespace, or require bindings; `Bun.spawn`; `Bun.$`) must pass a
 * real `timeout`/`timeoutMs`/`signal` property in its call arguments. `AsyncSubprocessRunner.runAsync`
 * is bounded by its non-optional default, so it is not scanned; `Bun.spawnSync` and the sync
 * child_process APIs are already refused by `guard-sync-child-processes.ts`. A genuinely
 * fire-and-forget or self-bounded call site is allowed by a marker comment on its line or the line
 * above: `// guard-unbounded-subprocess: <reason>` (per call site, so new spawns in the same file are
 * still caught).
 */
export const ALLOW_MARKER = "guard-unbounded-subprocess:";

export type UnboundedSubprocessViolation = { file: string; line: number; name: string };

const CHILD_PROCESS_NAMES = ["spawn", "execFile", "exec", "fork"] as const;
const CHILD_PROCESS_MODULE = `["'](?:node:)?child_process["']`;
/** A property (not a comment, not `: undefined`): `timeout: x`, `signal,` shorthand, `{ signal }`. */
const BOUND_PROPERTY =
  /(?:(?:(?<!\$)\{|,)\s*(?:timeout|timeoutMs|signal)\s*[,}])|\b(?:timeout|timeoutMs|signal)\s*:\s*(?!undefined\b)\S/;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function isChildProcessName(name: string | undefined): name is string {
  return name !== undefined && (CHILD_PROCESS_NAMES as readonly string[]).includes(name);
}

/** Callable pattern (source regex fragment) -> canonical child_process name. */
function childProcessCallPatterns(source: string): Map<string, string> {
  const patterns = new Map<string, string>();
  const named = [
    new RegExp(`\\bimport\\s+\\{([^}]*)\\}\\s+from\\s*${CHILD_PROCESS_MODULE}`, "g"),
    new RegExp(`\\{([^}]*)\\}\\s*=\\s*(?:require|await\\s+import)\\(\\s*${CHILD_PROCESS_MODULE}\\s*\\)`, "g"),
  ];
  for (const pattern of named) {
    for (const match of source.matchAll(pattern)) {
      for (const raw of (match[1] ?? "").split(",")) {
        const spec = raw.trim();
        if (spec.length === 0 || spec.startsWith("type ")) continue;
        const [name, alias] = spec.split(/\s+as\s+|\s*:\s*/).map((part) => part.trim());
        if (isChildProcessName(name)) patterns.set(`(?<![.\\w])${alias ?? name}`, name);
      }
    }
  }
  const namespaces = [
    new RegExp(`\\bimport\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s*${CHILD_PROCESS_MODULE}`, "g"),
    new RegExp(`\\bimport\\s+(\\w+)\\s+from\\s*${CHILD_PROCESS_MODULE}`, "g"),
    new RegExp(
      `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:require|await\\s+import)\\(\\s*${CHILD_PROCESS_MODULE}\\s*\\)`,
      "g",
    ),
  ];
  for (const pattern of namespaces) {
    for (const match of source.matchAll(pattern)) {
      for (const name of CHILD_PROCESS_NAMES) patterns.set(`\\b${match[1]}\\s*\\.\\s*${name}`, name);
    }
  }
  // A local rebinding (`const spawn = seams.spawn ?? realSpawn`) still reaches the real call.
  for (const [pattern, canonical] of [...patterns]) {
    const local = /\(\?<!\[\.\\w\]\)(\w+)$/.exec(pattern)?.[1];
    if (local === undefined) continue;
    for (const match of source.matchAll(new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=[^;\\n]*\\b${local}\\b`, "g"))) {
      if (match[1] !== undefined) patterns.set(`(?<![.\\w])${match[1]}`, canonical);
    }
  }
  return patterns;
}

/** Text of the balanced call argument list starting at `openIndex` (the `(`). */
function callArguments(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return source.slice(openIndex);
}

function allowedByMarker(lines: readonly string[], line: number): boolean {
  return [lines[line - 1], lines[line - 2]].some((text) => text?.includes(ALLOW_MARKER) === true);
}

export function findUnboundedSubprocessViolations(files: readonly SourceFile[]): UnboundedSubprocessViolation[] {
  return files.flatMap(({ file, source }) => {
    if (!isProductionSourceFile(file) || file.startsWith("v2/docs/")) return [];
    const lines = source.split("\n");
    const violations: UnboundedSubprocessViolation[] = [];
    const report = (index: number, name: string) => {
      const line = lineAt(source, index);
      if (!allowedByMarker(lines, line)) violations.push({ file, line, name });
    };
    const checkCalls = (name: string, callPattern: RegExp) => {
      for (const match of source.matchAll(callPattern)) {
        const open = match.index + match[0].length - 1;
        if (!BOUND_PROPERTY.test(stripComments(callArguments(source, open)))) report(match.index, name);
      }
    };
    for (const [pattern, canonical] of childProcessCallPatterns(source)) {
      checkCalls(canonical, new RegExp(`${pattern}\\s*\\(`, "g"));
    }
    checkCalls("Bun.spawn", /\bBun\s*\.\s*spawn\s*\(/g);
    // `Bun.$` has no timeout/signal option: every use needs a marker.
    for (const match of source.matchAll(/\bBun\s*\.\s*\$/g)) report(match.index, "Bun.$");
    if (/\bimport\s+\{[^}]*\$[^}]*\}\s+from\s*["']bun["']/.test(source)) {
      for (const match of source.matchAll(/(?<![.\w$])\$\s*`/g)) report(match.index, "Bun.$");
    }
    return violations;
  });
}

if (import.meta.main) {
  const violations = findUnboundedSubprocessViolations(collectProductionSourceFiles(process.cwd()));
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}: unbounded ${violation.name} (pass timeout/signal or mark \`// ${ALLOW_MARKER} <reason>\`)`,
    );
  }
  if (violations.length > 0) process.exitCode = 1;
}
