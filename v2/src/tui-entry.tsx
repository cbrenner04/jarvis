import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import {
  type ConnectTuiDaemonOptions,
  connectTuiDaemon,
  TUI_DAEMON_SOCKET_DISPLAY,
  type TuiDaemonClient,
  TuiDaemonConnectionError,
  TuiDaemonRpcError,
} from "./tui-daemon-client.ts";
import {
  collectLaunchFieldsViaInk,
  type LaunchFieldCollectionResult,
  type TuiLaunchFieldCollector,
} from "./tui-field-collector.tsx";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { buildWriteLoopInput } from "./write-loop-input.ts";

export { TUI_DAEMON_SOCKET_DISPLAY };

/** Operator-visible TUI view state for launch and unavailable feedback. */
export type TuiViewState =
  | { kind: "launch-success"; runId: string }
  | { kind: "rpc-error"; code: string; message: string }
  | { kind: "validation-failure"; errors: readonly string[] }
  | { kind: "unavailable" };

/** Injectable view host for tests and alternate renderers. */
export type TuiViewHost = {
  /**
   * Record or render operator-visible launch feedback.
   * @param state Launch outcome or unavailable-daemon state.
   */
  show(state: TuiViewState): void | Promise<void>;
};

export type { InkRender };

/** Dependencies for {@link runTuiEntry}. */
export type RunTuiEntryDeps = {
  /** Unix socket path; production default is `~/.jarvis/daemon.sock`. */
  socketPath?: string;
  /** Injectable daemon client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options?: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** Injectable launch field collector; defaults to {@link collectLaunchFieldsViaInk}. */
  collectLaunchFields?: TuiLaunchFieldCollector;
  /** Binding factory for launch payload construction; defaults to {@link createAgentBindings}. */
  createBindings?: (agentIds: readonly string[]) => readonly InvocationBinding[];
  /** When set, skips ink and records state (tests). */
  viewHost?: TuiViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender;
};

async function showWithInk(state: TuiViewState, inkRender?: InkRender): Promise<void> {
  const { showTuiInkFeedback } = await import("./tui-ink-feedback.tsx");
  await showTuiInkFeedback(state, inkRender);
}

async function present(state: TuiViewState, deps: RunTuiEntryDeps): Promise<void> {
  if (deps.viewHost !== undefined) {
    await deps.viewHost.show(state);
    return;
  }
  await showWithInk(state, deps.inkRender);
}

function formatRpcError(error: TuiDaemonRpcError): TuiViewState {
  return { kind: "rpc-error", code: error.code, message: error.message };
}

/**
 * Connect, prove liveness, collect launch fields, start a detached run, and exit.
 *
 * @param deps Optional socket path, daemon client, field collector, view host, and ink render seams.
 * @returns `0` on successful `start`; `1` on validation, guard, RPC, or unavailable-daemon failure.
 */
export async function runTuiEntry(deps?: RunTuiEntryDeps): Promise<number> {
  const resolved = deps ?? {};
  const connectFn = resolved.connectTuiDaemon ?? connectTuiDaemon;
  const collectFields = resolved.collectLaunchFields ?? collectLaunchFieldsViaInk;
  const createBindings = resolved.createBindings ?? createAgentBindings;
  const connectOptions = resolved.socketPath !== undefined ? { socketPath: resolved.socketPath } : undefined;

  let client: TuiDaemonClient | undefined;
  try {
    client = await connectFn(connectOptions);
    await client.health();
    await client.status();

    const collected: LaunchFieldCollectionResult = await collectFields();
    if (!collected.ok) {
      await present({ kind: "validation-failure", errors: collected.errors }, resolved);
      return 1;
    }

    const built = buildWriteLoopInput(collected.fields, createBindings);
    if (!built.ok) {
      await present({ kind: "validation-failure", errors: built.errors }, resolved);
      return 1;
    }

    const started = await client.start(built.input);
    await present({ kind: "launch-success", runId: started.runId }, resolved);
    return 0;
  } catch (error) {
    if (error instanceof TuiDaemonConnectionError) {
      await present({ kind: "unavailable" }, resolved);
      return 1;
    }
    if (error instanceof TuiDaemonRpcError) {
      await present(formatRpcError(error), resolved);
      return 1;
    }
    throw error;
  } finally {
    client?.close();
  }
}
