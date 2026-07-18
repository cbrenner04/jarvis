import { resolve } from "node:path";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { parseStatusResult } from "../daemon/daemon-wire.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { request } from "./ipc.ts";

export const revisionMismatchMessage = (loadedRevision: string, currentRevision: string): string =>
  `daemon revision mismatch: loaded=${loadedRevision} current=${currentRevision}; restart the daemon before starting or resuming work\n`;

export type GetCurrentRevision = () => Promise<string>;

export async function getInvokingRevision(): Promise<string> {
  return await getCurrentHeadAsync(resolve(import.meta.dir, "../../.."), realAsyncSubprocessRunner);
}

/** Reject new work before its mutating IPC request when the daemon loaded another source revision. */
export async function guardWorkDispatch(
  client: IpcClient,
  getCurrentRevision: GetCurrentRevision = getInvokingRevision,
): Promise<string | undefined> {
  const status = parseStatusResult(await request(client, "status"));
  if (status?.loadedRevision === undefined) {
    throw new RpcConnectionError("malformed RPC reply: invalid daemon status result");
  }
  const currentRevision = await getCurrentRevision();
  return status.loadedRevision === currentRevision
    ? undefined
    : revisionMismatchMessage(status.loadedRevision, currentRevision);
}
