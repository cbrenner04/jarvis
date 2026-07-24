import type { IpcClient } from "../ipc/client.ts";
import type { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { CliDeps } from "./deps.ts";
import type { Io } from "./io.ts";

export function formatLifecycleError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n`;
  }
  return `${String(error)}\n`;
}

export function formatRpcError(error: RpcError): string {
  return `${error.code}: ${error.message}\n`;
}

export function formatConnectionError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n`;
  }
  return `${String(error)}\n`;
}

export function parseStreamPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    throw new Error("invalid stream payload");
  }
  return JSON.parse(payload);
}

/** One transport per client: a client may carry several correlated requests (e.g. `run workflow`
 * issues `start` then `wait`), and closing the transport destroys the underlying socket. The
 * transport is torn down with the client by `withRunClient`. */
const clientTransports = new WeakMap<IpcClient, ReturnType<typeof createRpcTransport>>();

export async function request(client: IpcClient, method: string, params?: unknown): Promise<unknown> {
  let transport = clientTransports.get(client);
  if (transport === undefined) {
    transport = createRpcTransport(client);
    clientTransports.set(client, transport);
  }
  return await transport.request(method, params);
}

export async function withRunClient(
  io: Io,
  deps: CliDeps,
  fn: (client: IpcClient) => Promise<number>,
  socketPath: string = deps.socketPath,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    client = await deps.connectIpcClient(socketPath);
    return await fn(client);
  } catch (error) {
    io.stderr(formatConnectionError(error));
    return 1;
  } finally {
    client?.close();
  }
}
