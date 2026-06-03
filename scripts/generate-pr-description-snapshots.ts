import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrDescriptionPrompt as buildPatchPrDescriptionPrompt } from "../v1/src/modes/patch/pr-description-prompt.ts";
import { buildPrDescriptionPrompt as buildPlanPrDescriptionPrompt } from "../v1/src/modes/plan/pr-description-prompt.ts";

const patchPrompt = buildPatchPrDescriptionPrompt({
  specPath: "v1/spec/example/index.md",
  specContext: "Example spec context",
});

const planPrompt = buildPlanPrDescriptionPrompt({
  intent: "Example intent",
  specContext: "Example spec context",
});

console.log("=== Patch PR Description Prompt ===");
console.log(patchPrompt);
console.log("\n=== Plan PR Description Prompt ===");
console.log(planPrompt);

const fixtureDir = "./v1/test/fixtures/prompts/rendered";
writeFileSync(
  join(fixtureDir, "patch.prompt.pr-description@r1.shared.txt"),
  patchPrompt + "\n",
);
writeFileSync(
  join(fixtureDir, "plan.prompt.pr-description@r1.shared.txt"),
  planPrompt + "\n",
);

console.log("\nSnapshots written to:");
console.log(join(fixtureDir, "patch.prompt.pr-description@r1.shared.txt"));
console.log(join(fixtureDir, "plan.prompt.pr-description@r1.shared.txt"));
