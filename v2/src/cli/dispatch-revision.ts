import { resolve } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";

const jarvisRepoRoot = resolve(import.meta.dir, "../../..");

let memoizedDigest: string | undefined;

/** Digest of the invoking checkout's executable tree; keys the daemon's socket/PID/log paths. */
export async function getInvokingExecutableDigest(): Promise<string> {
  if (memoizedDigest === undefined) {
    memoizedDigest = await getExecutableTreeDigest(jarvisRepoRoot, realAsyncSubprocessRunner);
  }
  return memoizedDigest;
}
