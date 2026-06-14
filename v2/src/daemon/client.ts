import { existsSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import {
  type DaemonRequest,
  type DaemonResponse,
  type DaemonStreamFrame,
  encodeFrame,
  errorResponse,
  ProtocolError,
  parseResponseLine,
  parseStreamLine,
} from "./protocol.ts";

export type DaemonClientOptions = {
  socketPath: string;
  timeoutMs?: number;
};

/**
 * Send one request and wait for the matching response frame.
 * @throws When the socket cannot be opened or the response times out.
 */
export function callDaemon(request: DaemonRequest, options: DaemonClientOptions): Promise<DaemonResponse> {
  if (!existsSync(options.socketPath)) {
    return Promise.reject(new Error(`ENOENT ${options.socketPath}`));
  }

  const timeoutMs = options.timeoutMs ?? 5_000;
  return new Promise((resolve, reject) => {
    const socket = connect(options.socketPath);
    let buffer = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`daemon request timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    socket.on("error", (error) => {
      finish(() => reject(error));
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = parseResponseLine(line);
          if (response.id !== request.id) continue;
          finish(() => resolve(response));
          return;
        } catch (error) {
          finish(() => reject(error));
          return;
        }
      }
    });

    socket.on("connect", () => {
      socket.write(encodeFrame(request));
    });
  });
}

/** Probe whether a daemon answers `status` on the socket. */
export async function isDaemonReachable(socketPath: string, timeoutMs = 1_000): Promise<boolean> {
  if (!existsSync(socketPath)) {
    return false;
  }
  try {
    const response = await callDaemon({ id: "probe", method: "status" }, { socketPath, timeoutMs });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Remove a stale socket file when no live daemon answers `status`.
 * @returns Whether a stale file was removed.
 */
export async function removeStaleSocket(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return false;
  if (await isDaemonReachable(socketPath)) {
    throw new Error("daemon already running");
  }
  unlinkSync(socketPath);
  return true;
}

/** Map handler failures into a client-visible response when the server stays alive. */
export function clientErrorFromProtocol(error: unknown, requestId: string): DaemonResponse {
  if (error instanceof ProtocolError) {
    return errorResponse(requestId, { code: error.code, message: error.message });
  }
  const message = error instanceof Error ? error.message : "unknown client error";
  return errorResponse(requestId, { code: "client_error", message });
}

export type LogTailClientOptions = DaemonClientOptions & {
  onRecord: (record: unknown) => void;
  onClose?: (reason: string) => void;
};

/**
 * Open a `log.tail` stream and dispatch `log.record` / `log.close` frames.
 * Resolves when the terminal response arrives or the socket closes.
 */
export function tailDaemon(
  params: { runId: string; fromSeq?: number },
  options: LogTailClientOptions,
): { close: () => void; done: Promise<DaemonResponse | null> } {
  const request: DaemonRequest = {
    id: crypto.randomUUID(),
    method: "log.tail",
    params,
  };
  const socket = connect(options.socketPath);
  let buffer = "";
  let settled = false;

  const done = new Promise<DaemonResponse | null>((resolve, reject) => {
    const finish = (value: DaemonResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, options.timeoutMs ?? 5_000);

    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    socket.on("close", () => finish(null));
    socket.on("data", (chunk) => {
      buffer = consumeTailLines(buffer, chunk.toString(), request.id, options, finish);
    });
    socket.on("connect", () => {
      socket.write(encodeFrame(request));
    });
  });

  return {
    close: () => socket.destroy(),
    done,
  };
}

function consumeTailLines(
  buffer: string,
  chunk: string,
  requestId: string,
  options: LogTailClientOptions,
  finish: (value: DaemonResponse | null) => void,
): string {
  const lines = `${buffer}${chunk}`.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const handled = handleTailFrame(line, requestId, options, finish);
    if (handled) return remainder;
  }
  return remainder;
}

function handleTailFrame(
  line: string,
  requestId: string,
  options: LogTailClientOptions,
  finish: (value: DaemonResponse | null) => void,
): boolean {
  const frame = parseFrameLine(line, requestId);
  if (!frame) return false;
  if (frame.type === "response") {
    finish(frame.response);
    return true;
  }
  dispatchTailStreamFrame(frame.stream, options);
  return false;
}

function dispatchTailStreamFrame(stream: DaemonStreamFrame, options: LogTailClientOptions): void {
  if (stream.event === "log.record") {
    options.onRecord(stream.data);
    return;
  }
  if (stream.event === "log.close") {
    options.onClose?.(streamCloseReason(stream.data));
  }
}

function streamCloseReason(data: unknown): string {
  if (typeof data === "object" && data !== null && "reason" in data && typeof data.reason === "string") {
    return data.reason;
  }
  return "closed";
}

type ParsedFrame = { type: "response"; response: DaemonResponse } | { type: "stream"; stream: DaemonStreamFrame };

function parseFrameLine(line: string, requestId: string): ParsedFrame | null {
  try {
    const response = parseResponseLine(line);
    if (response.id === requestId) {
      return { type: "response", response };
    }
    return null;
  } catch {
    try {
      const stream = parseStreamLine(line);
      if (stream.id === requestId) {
        return { type: "stream", stream };
      }
    } catch {
      return null;
    }
    return null;
  }
}
