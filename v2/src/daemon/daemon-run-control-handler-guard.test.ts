import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOL_SCAN_EXCLUDED_FILES,
  DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOLS,
  scanDaemonRunControlHandlerForbiddenSymbols,
} from "./daemon-run-control-handler-guard.ts";

const DAEMON_DIR = import.meta.dir;
const SCAN_EXCLUDED = new Set<string>(DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOL_SCAN_EXCLUDED_FILES);

function listProductionDaemonSources(): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {};
  const walk = (absDir: string, relPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !SCAN_EXCLUDED.has(entry.name)) {
        sources[rel] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(DAEMON_DIR, "");
  return sources;
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
  for (const symbol of DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOLS) {
    expect(violations.some((violation) => violation.symbol === symbol)).toBe(true);
  }
});
