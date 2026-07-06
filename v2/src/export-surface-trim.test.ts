import { describe, expect, test } from "bun:test";

// Type-only symbols are erased at runtime, so a compile-time check pins them:
// each import below has no matching export, so tsc reports "has no exported
// member" — @ts-expect-error suppresses that expected error. If the symbol is
// re-exported, the error disappears and @ts-expect-error itself fails typecheck.
// @ts-expect-error Io must not be exported from cli.ts
import type { Io } from "./cli.ts";
// @ts-expect-error ExecutableRole must not be exported from agent-model-config.ts
import type { ExecutableRole } from "./config/agent-model-config.ts";
// @ts-expect-error SimulatedOutcome must not be exported from testing/bindings.ts
import type { SimulatedOutcome } from "./testing/bindings.ts";
// @ts-expect-error TuiDaemonHealthResult, TuiDaemonStatusResult, TuiDaemonStartResult must not be exported from tui-daemon-client.ts
import type { TuiDaemonHealthResult, TuiDaemonStartResult, TuiDaemonStatusResult } from "./tui/tui-daemon-client.ts";
// @ts-expect-error TuiDaemonRpcTransport must not be exported from tui-daemon-rpc-transport.ts
import type { TuiDaemonRpcTransport } from "./tui/tui-daemon-rpc-transport.ts";

type _Unused = [
  Io,
  ExecutableRole,
  SimulatedOutcome,
  TuiDaemonHealthResult,
  TuiDaemonStatusResult,
  TuiDaemonStartResult,
  TuiDaemonRpcTransport,
];

describe("export surface trim", () => {
  test("cli.ts does not export Io", async () => {
    const module = await import("./cli.ts");
    expect(Object.keys(module)).not.toContain("Io");
  });

  test("agent-model-config.ts does not export EXECUTABLE_ROLES or ExecutableRole", async () => {
    const module = await import("./config/agent-model-config.ts");
    expect(Object.keys(module)).not.toContain("EXECUTABLE_ROLES");
    expect(Object.keys(module)).not.toContain("ExecutableRole");
  });

  test("testing/bindings.ts does not export SimulatedOutcome", async () => {
    const module = await import("./testing/bindings.ts");
    expect(Object.keys(module)).not.toContain("SimulatedOutcome");
  });

  test("tui-daemon-client.ts does not export TuiDaemonHealthResult, TuiDaemonStatusResult, or TuiDaemonStartResult", async () => {
    const module = await import("./tui/tui-daemon-client.ts");
    expect(Object.keys(module)).not.toContain("TuiDaemonHealthResult");
    expect(Object.keys(module)).not.toContain("TuiDaemonStatusResult");
    expect(Object.keys(module)).not.toContain("TuiDaemonStartResult");
  });

  test("tui-daemon-rpc-transport.ts does not export TuiDaemonRpcTransport", async () => {
    const module = await import("./tui/tui-daemon-rpc-transport.ts");
    expect(Object.keys(module)).not.toContain("TuiDaemonRpcTransport");
  });
});
