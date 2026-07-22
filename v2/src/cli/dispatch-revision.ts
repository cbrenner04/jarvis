import { resolve } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
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
export function advanceLoadedRevision(loadedRevision: string, loadedExecutableDigest: string, params: unknown): string {
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
