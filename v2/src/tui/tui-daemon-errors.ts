import { DAEMON_SOCKET_DISPLAY } from "../paths.ts";

/** Operator-facing socket path in unavailable-daemon feedback. */
export const TUI_DAEMON_SOCKET_DISPLAY = DAEMON_SOCKET_DISPLAY;

/** Transport, wire-protocol, or malformed-payload failure while talking to the daemon socket. */
export class TuiDaemonConnectionError extends Error {
  /**
   * @param message Operator- or caller-facing summary of the transport failure.
   * @param options Optional `cause` from the underlying connect or frame read.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TuiDaemonConnectionError";
  }
}

/** Correlated daemon `error` frame on any RPC (`health`, `status`, `list`, `start`, `pause`, `resume`, `kill`, `wait`, …). */
export class TuiDaemonRpcError extends Error {
  /** Daemon error code from the correlated `error` frame. */
  readonly code: string;

  /**
   * @param code Daemon error code from the correlated `error` frame.
   * @param message Daemon error message from the correlated `error` frame.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "TuiDaemonRpcError";
    this.code = code;
  }
}
