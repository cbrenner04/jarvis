import { type ComponentType, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-client.ts";
import type { TuiViewState } from "./tui-entry.tsx";

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof import("ink").render;

type TextComponent = ComponentType<{ children?: ReactNode }>;

function LaunchSuccessFeedback({ runId, Text }: { runId: string; Text: TextComponent }): ReactElement {
  return createElement(Text, null, `Run started: ${runId}`);
}

function RpcErrorFeedback({
  code,
  message,
  Text,
}: {
  code: string;
  message: string;
  Text: TextComponent;
}): ReactElement {
  return createElement(Text, null, `${code}: ${message}`);
}

function ValidationFailureFeedback({ errors, Text }: { errors: readonly string[]; Text: TextComponent }): ReactElement {
  return createElement(Fragment, null, ...errors.map((error) => createElement(Text, { key: error }, error)));
}

function UnavailableFeedback({ Text }: { Text: TextComponent }): ReactElement {
  return createElement(
    Text,
    null,
    `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`,
  );
}

/**
 * Render operator-visible TUI launch feedback through ink.
 *
 * When `inkRender` is provided, ink is not loaded — the caller owns rendering.
 * When omitted, ink is dynamically imported to avoid yoga-layout TLA TDZ on
 * module evaluation (Bun/Linux).
 *
 * @param state Launch outcome or unavailable-daemon state.
 * @param inkRender Injectable ink render; defaults to production ink `render`.
 */
export async function showTuiInkFeedback(state: TuiViewState, inkRender?: InkRender): Promise<void> {
  let renderFn: InkRender;
  let Text: TextComponent;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Text = ink.Text;
  }

  let element: ReactElement;
  switch (state.kind) {
    case "launch-success":
      element = createElement(LaunchSuccessFeedback, { runId: state.runId, Text });
      break;
    case "rpc-error":
      element = createElement(RpcErrorFeedback, { code: state.code, message: state.message, Text });
      break;
    case "validation-failure":
      element = createElement(ValidationFailureFeedback, { errors: state.errors, Text });
      break;
    case "unavailable":
      element = createElement(UnavailableFeedback, { Text });
      break;
  }

  const instance = renderFn(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}
