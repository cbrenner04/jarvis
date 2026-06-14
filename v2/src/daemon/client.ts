import { existsSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import {
  type DaemonRequest,
  type DaemonResponse,
  encodeFrame,
  errorResponse,
  ProtocolError,
  parseResponseLine,
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
