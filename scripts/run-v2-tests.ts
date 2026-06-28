import { spawnSync } from "node:child_process";
import { agentRunnableV2Tests, integrationV2Tests } from "./v2-test-files.ts";

const mode = process.argv[2];
const files = mode === "integration" ? integrationV2Tests() : mode === "agent" ? agentRunnableV2Tests() : [];

if (files.length === 0) {
  process.stderr.write(`error: unknown or empty v2 test mode "${mode ?? ""}"\n`);
  process.exit(1);
}

const result = spawnSync("bun", ["test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
