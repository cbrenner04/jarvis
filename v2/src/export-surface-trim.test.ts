import { describe, expect, test } from "bun:test";

// Type-only symbols are erased at runtime, so a compile-time check pins them:
// each import below has no matching export, so tsc reports "has no exported
// member" — @ts-expect-error suppresses that expected error. If the symbol is
// re-exported, the error disappears and @ts-expect-error itself fails typecheck.
// @ts-expect-error Io must not be exported from cli.ts
import type { Io } from "./cli.ts";
// @ts-expect-error ExecutableRole must not be exported from agent-model-config.ts
import type { ExecutableRole } from "./config/agent-model-config.ts";
// @ts-expect-error RpcTransport must not be exported from rpc-transport.ts
import type { RpcTransport } from "./ipc/rpc-transport.ts";
// @ts-expect-error SimulatedOutcome must not be exported from testing/bindings.ts
import type { SimulatedOutcome } from "./testing/bindings.ts";
// @ts-expect-error TuiDaemonHealthResult, TuiDaemonStatusResult, TuiDaemonStartResult must not be exported from tui-daemon-client.ts
import type { TuiDaemonHealthResult, TuiDaemonStartResult, TuiDaemonStatusResult } from "./tui/tui-daemon-client.ts";

type _Unused = [
  Io,
  ExecutableRole,
  SimulatedOutcome,
  TuiDaemonHealthResult,
  TuiDaemonStatusResult,
  TuiDaemonStartResult,
  RpcTransport,
];

// EXECUTABLE_ROLES is a value (not type-only), so it survives to runtime and needs
// its own check; the type-only symbols above are already pinned by @ts-expect-error.
describe("export surface trim", () => {
  test("agent-model-config.ts does not export EXECUTABLE_ROLES", async () => {
    const module = await import("./config/agent-model-config.ts");
    expect(Object.keys(module)).not.toContain("EXECUTABLE_ROLES");
  });
});
