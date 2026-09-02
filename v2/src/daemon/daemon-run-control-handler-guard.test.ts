import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DAEMON_DIR = import.meta.dir;

const FORBIDDEN_SYMBOLS = ["activeRunsByHandler", "activeRunForHandler"] as const;

export type DaemonRunControlHandlerGuardViolation = {
  file: string;
  symbol: (typeof FORBIDDEN_SYMBOLS)[number];
  line: number;
};

function listProductionDaemonSources(): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {};
  const walk = (absDir: string, relPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources[rel] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(DAEMON_DIR, "");
  return sources;
}

export function scanDaemonRunControlHandlerForbiddenSymbols(
  sources: Readonly<Record<string, string>>,
): DaemonRunControlHandlerGuardViolation[] {
  const violations: DaemonRunControlHandlerGuardViolation[] = [];
  for (const [file, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    for (const symbol of FORBIDDEN_SYMBOLS) {
      let from = 0;
      while (true) {
        const index = source.indexOf(symbol, from);
        if (index === -1) break;
        violations.push({
          file,
          symbol,
          line: source.slice(0, index).split("\n").length,
        });
        from = index + symbol.length;
      }
    }
  }
  return violations;
}

test("daemon production sources omit activeRunsByHandler and activeRunForHandler", () => {
  expect(scanDaemonRunControlHandlerForbiddenSymbols(listProductionDaemonSources())).toEqual([]);
});

test("guard reports reintroduced activeRun WeakMap back-channel symbols", () => {
  const sources = listProductionDaemonSources();
  const daemonSource = sources["daemon.ts"] ?? "";
  const preFix = `${daemonSource}
const activeRunsByHandler = new WeakMap<object, Map<string, ActiveRun>>();
export function activeRunForHandler(handlers: object, id: string): ActiveRun | undefined {
  return activeRunsByHandler.get(handlers)?.get(id);
}
`;
  const violations = scanDaemonRunControlHandlerForbiddenSymbols({ ...sources, "daemon.ts": preFix });
  expect(violations.some((violation) => violation.symbol === "activeRunsByHandler")).toBe(true);
  expect(violations.some((violation) => violation.symbol === "activeRunForHandler")).toBe(true);
});
