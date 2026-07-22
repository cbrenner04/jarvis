import { getInvokingExecutableDigest } from "../cli/dispatch-revision.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { daemonPathsForDigest } from "../paths.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";

/**
 * Connected tail-log consumer over one IPC transport: replay persisted records, follow live appends, then close.
 * Iteration throws {@link RpcConnectionError} on transport loss, malformed payloads, or error `stream-end`.
 */
export type TuiLogTailClient = {
  /**
   * Open a tail stream for the run and yield `PersistedRecord`s in server `stream-data` arrival order.
   *
   * @returns Async iterable of parsed persisted log records until benign `stream-end`.
   * @throws {RpcConnectionError} On connection loss, malformed `stream-data`, error `stream-end`, or unexpected frames.
   */
  records(): AsyncIterable<PersistedRecord>;

  /**
   * Send `stream-end` for the opened tail stream (when any) and tear down the IPC transport.
   */
  close(): void;
};

/** Options for {@link connectTuiLogTail}; production defaults apply when omitted. */
export type ConnectTuiLogTailOptions = {
  /** Unix socket path; defaults to the invoking executable's keyed daemon. */
  socketPath?: string;
  /** Injectable IPC transport seam for tests and callers. */
  connectIpcClient?: (socketPath: string) => Promise<IpcClient>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function connectionError(message: string, cause?: unknown): RpcConnectionError {
  return new RpcConnectionError(message, cause !== undefined ? { cause } : undefined);
}

function streamEndError(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const { error } = payload;
  if (error === undefined) return undefined;
  return typeof error === "string" ? error : String(error);
}

function parsePersistedRecord(value: unknown): PersistedRecord {
  if (!isRecord(value)) {
    throw connectionError("malformed stream-data payload: expected PersistedRecord object");
  }
  const { runId, event } = value;
  if (typeof runId !== "string" || !isRecord(event)) {
    throw connectionError("malformed stream-data payload: invalid PersistedRecord envelope");
  }
  return value as PersistedRecord;
}

function parseStreamDataPayload(payload: unknown): PersistedRecord {
  if (typeof payload !== "string") {
    throw connectionError("malformed stream-data payload: expected string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw connectionError("malformed stream-data payload: invalid JSON", cause);
  }
  return parsePersistedRecord(parsed);
}

async function readTailFrame(client: IpcClient): Promise<IpcFrame> {
  try {
    return await client.nextFrame();
  } catch (cause) {
    if (cause instanceof Error && cause.message === "connection closed") {
      throw connectionError("IPC connection lost", cause);
    }
    throw connectionError("IPC frame read failed", cause);
  }
}

/**
 * Open a TUI log tail client on the production or injected socket.
 *
 * @param runId Run whose persisted log stream to open.
 * @param options Optional socket path and `connectIpcClient` seam.
 * @returns A client exposing `records` and `close` on one connection.
 * @throws {RpcConnectionError} When the socket is unreachable before `stream-open`.
 */
export async function connectTuiLogTail(runId: string, options?: ConnectTuiLogTailOptions): Promise<TuiLogTailClient> {
  const socketPath = options?.socketPath ?? daemonPathsForDigest(await getInvokingExecutableDigest()).socketPath;
  const connectFn = options?.connectIpcClient ?? connectIpcClient;

  let client: IpcClient;
  try {
    client = await connectFn(socketPath);
  } catch (cause) {
    throw connectionError(`cannot connect to daemon socket ${socketPath}`, cause);
  }

  let streamId: string | undefined;
  let closed = false;

  return {
    records() {
      return {
        async *[Symbol.asyncIterator]() {
          if (closed) {
            throw connectionError("tail client closed");
          }

          streamId = crypto.randomUUID();
          client.send({ kind: "stream-open", streamId, payload: { runId } });

          while (true) {
            const frame = await readTailFrame(client);

            if (frame.kind === "stream-data" && frame.streamId === streamId) {
              yield parseStreamDataPayload(frame.payload);
              continue;
            }

            if (frame.kind === "stream-end" && frame.streamId === streamId) {
              const error = streamEndError(frame.payload);
              if (error !== undefined) {
                throw connectionError(`tail stream failed: ${error}`);
              }
              return;
            }

            throw connectionError(`unexpected IPC frame during tail: ${frame.kind}`);
          }
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      if (streamId !== undefined) {
        client.send({ kind: "stream-end", streamId });
      }
      client.close();
    },
  };
}
