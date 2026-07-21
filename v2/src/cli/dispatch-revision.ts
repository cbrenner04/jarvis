import { resolve } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { parseStatusResult } from "../daemon/daemon-wire.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { request } from "./ipc.ts";

export const revisionMismatchMessage = (loadedRevision: string, currentRevision: string): string =>
  `daemon revision mismatch: loaded=${loadedRevision} current=${currentRevision}; restart the daemon before starting or resuming work\n`;

export type GetCurrentRevision = () => Promise<string>;
export type GetExecutableDigest = () => Promise<string>;

const jarvisRepoRoot = resolve(import.meta.dir, "../../..");

export async function getInvokingRevision(): Promise<string> {
  return await getCurrentHeadAsync(jarvisRepoRoot, realAsyncSubprocessRunner);
}

export async function getInvokingExecutableDigest(): Promise<string> {
  return await getExecutableTreeDigest(jarvisRepoRoot, realAsyncSubprocessRunner);
}

/** Advance recorded HEAD when dispatch reports a matching executable digest with HEAD drift. */
export function advanceLoadedRevision(
  loadedRevision: string,
  loadedExecutableDigest: string,
  params: unknown,
): string {
  const guard =
    typeof params === "object" && params !== null
      ? (params as { currentRevision?: unknown; currentExecutableDigest?: unknown })
      : {};
  const currentRevision = typeof guard.currentRevision === "string" ? guard.currentRevision : undefined;
  const currentExecutableDigest =
    typeof guard.currentExecutableDigest === "string" ? guard.currentExecutableDigest : undefined;
  if (
    currentExecutableDigest !== undefined &&
    currentExecutableDigest === loadedExecutableDigest &&
    currentRevision !== undefined &&
    currentRevision !== loadedRevision
  ) {
    return currentRevision;
  }
  return loadedRevision;
}

export async function dispatchRevisionMismatch(
  fetchStatus: (params: { currentRevision: string; currentExecutableDigest: string }) => Promise<unknown>,
  getCurrentRevision: GetCurrentRevision = getInvokingRevision,
  getExecutableDigest: GetExecutableDigest = getInvokingExecutableDigest,
): Promise<string | undefined> {
  const currentRevision = await getCurrentRevision();
  const currentExecutableDigest = await getExecutableDigest();
  const status = parseStatusResult(await fetchStatus({ currentRevision, currentExecutableDigest }));
  if (status?.loadedRevision === undefined || status.loadedExecutableDigest === undefined) {
    throw new RpcConnectionError("malformed RPC reply: invalid daemon status result");
  }
  return status.loadedExecutableDigest === currentExecutableDigest
    ? undefined
    : revisionMismatchMessage(status.loadedRevision, currentRevision);
}

/** Reject new work before its mutating IPC request when the daemon loaded another executable tree. */
export async function guardWorkDispatch(
  client: IpcClient,
  getCurrentRevision: GetCurrentRevision = getInvokingRevision,
  getExecutableDigest: GetExecutableDigest = getInvokingExecutableDigest,
): Promise<string | undefined> {
  return await dispatchRevisionMismatch(
    (params) => request(client, "status", params),
    getCurrentRevision,
    getExecutableDigest,
  );
}
