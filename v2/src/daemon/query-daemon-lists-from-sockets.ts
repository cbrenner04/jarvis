import type { CliDeps } from "../cli/deps.ts";

export type QueryDaemonListsDeps = Pick<CliDeps, "connectIpcClient" | "socketPath">;
