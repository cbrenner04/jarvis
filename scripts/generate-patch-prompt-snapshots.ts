import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt } from "../v1/src/modes/patch/prompt.ts";

const patchPromptShared = buildPrompt("v1/spec/example/index.md", ["../shared-lib", "../infra"]);
const patchPromptWrapper = buildPrompt("v1/spec/example/index.md");

console.log("=== Patch Prompt Body (Shared) ===");
console.log(patchPromptShared);

console.log("\n=== Patch Prompt Body (Wrapper) ===");
console.log(patchPromptWrapper);

const fixtureDir = "./v1/test/fixtures/prompts/rendered";

// Shared snapshot (with siblings)
writeFileSync(join(fixtureDir, "patch.prompt.body@r5.shared.txt"), patchPromptShared);

// Wrapper snapshot (without siblings, matching the test)
const wrapped = `${patchPromptWrapper}\n<!-- jarvis-codex-invocation: fixture -->`;
writeFileSync(join(fixtureDir, "patch.prompt.body@r5.wrapper.codex.exec.stdin+marker.txt"), wrapped);

console.log("\nSnapshots written to:");
console.log(join(fixtureDir, "patch.prompt.body@r5.shared.txt"));
console.log(join(fixtureDir, "patch.prompt.body@r5.wrapper.codex.exec.stdin+marker.txt"));
