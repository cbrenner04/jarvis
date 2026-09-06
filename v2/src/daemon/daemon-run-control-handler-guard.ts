export const DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOLS = ["activeRunsByHandler", "activeRunForHandler"] as const;

export const DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOL_SCAN_EXCLUDED_FILES = [
  "daemon-run-control-handler-guard.ts",
] as const;

export type DaemonRunControlHandlerGuardViolation = {
  file: string;
  symbol: (typeof DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOLS)[number];
  line: number;
};

export function scanDaemonRunControlHandlerForbiddenSymbols(
  sources: Readonly<Record<string, string>>,
): DaemonRunControlHandlerGuardViolation[] {
  const violations: DaemonRunControlHandlerGuardViolation[] = [];
  for (const [file, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    for (const symbol of DAEMON_RUN_CONTROL_HANDLER_FORBIDDEN_SYMBOLS) {
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
