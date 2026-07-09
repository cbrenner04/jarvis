/** Transport, wire-protocol, or malformed-payload failure while talking to the daemon socket. */
export class RpcConnectionError extends Error {
  /**
   * @param message Operator- or caller-facing summary of the transport failure.
   * @param options Optional `cause` from the underlying connect or frame read.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RpcConnectionError";
  }
}

/** Correlated daemon `error` frame on any RPC (`health`, `status`, `list`, `start`, `pause`, `resume`, `kill`, `wait`, …). */
export class RpcError extends Error {
  /** Daemon error code from the correlated `error` frame. */
  readonly code: string;

  /**
   * @param code Daemon error code from the correlated `error` frame.
   * @param message Daemon error message from the correlated `error` frame.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}
