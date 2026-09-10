import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleStepTemplate } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { renderArtifactTemplate } from "./render.ts";

const registry = loadPromptRegistry();

describe("implement-owned prompt artifacts", () => {
  test("registry carries implement ids and not the retired patch ids", () => {
    const ids = registry.all().map((artifact) => artifact.metadata.id);
    expect(ids).toContain("implement.prompt.body");
    expect(ids).toContain("implement.rules");
    expect(ids).not.toContain("patch.prompt.body");
    expect(ids).not.toContain("patch.rules");
    expect(ids).toContain("patch.prompt.shrink");
  });

  test("assembled implement step prompt uses implement vocabulary, not Patch Mode", () => {
    const artifact = registry.getById("implement.prompt.body");
    const template = assembleStepTemplate(registry, "implement.prompt.body");
    const rendered = renderArtifactTemplate(
      { ...artifact, body: template },
      {
        SPEC_PATH: "spec/index.md",
        SIBLINGS_BLOCK: "",
        REPO_GUIDANCE: "",
        ACTIVE_SUBSPEC_PATH: "spec/01-step.md\n",
        ACTIVE_SUBSPEC_BODY: "# Step",
        PATCH_RULES: registry.getById("implement.rules").body.trim(),
        TIMEOUT_CHECKPOINT_CONTEXT: "",
        STEP_RULES: "",
      },
    );
    expect(rendered).not.toContain("Patch Mode");
    expect(rendered).not.toMatch(/patch mode/i);
    expect(rendered).toContain("# Implement");
    expect(rendered).toContain("Execute the active spec only.");
  });

  test("implement review roles and intent split declare their own behavior lanes", () => {
    for (const role of ["critic", "adversary", "advocate", "adjudicator"]) {
      expect(registry.getById(`implement.prompt.review.${role}`).metadata.behavior).toBe("implement");
    }
    expect(registry.getById("intent.prompt.split").metadata.behavior).toBe("intent");
    expect(registry.getById("implement.prompt.body").metadata.behavior).toBe("implement");
  });

  test("intent split assembles globals only, no plan fragments", () => {
    const assembled = assembleStepTemplate(registry, "intent.prompt.split");
    const stepBody = registry.getById("intent.prompt.split").body.trim();
    const fragmentPrefix = assembled.slice(0, assembled.indexOf(stepBody));
    for (const id of ["global.terse", "global.no-hard-wrap", "global.documentation"]) {
      expect(fragmentPrefix).toContain(registry.getById(id).body.trim());
    }
    for (const id of ["plan.decisions-ledger", "plan.defer-to-consumer", "global.naming"]) {
      expect(fragmentPrefix).not.toContain(registry.getById(id).body.trim());
    }
  });

  test("implement.rules is target-repo-neutral", () => {
    const body = registry.getById("implement.rules").body;
    expect(body).not.toMatch(/\bbun\b/);
    expect(body).not.toContain("machine/user-config");
    expect(body).not.toContain("setInterval");
    expect(body).not.toContain("Patch Mode");
    expect(body).toContain("Run the scoped test script(s) for the surfaces you touched");
  });

  test("the migrated jarvis-specific rules live in this repo's injected guidance", async () => {
    const guidance = await Bun.file(new URL("../../AGENTS.md", import.meta.url)).text();
    expect(guidance).toContain("re-run once serially as `bun test`");
    expect(guidance).toContain("never read the ambient machine config");
    expect(guidance).toContain("`setTimeout` or `setInterval` callback");
  });
});

describe("implement prompt id wiring", () => {
  test("execution-loop and review-implement production paths carry no retired patch ids", () => {
    const root = new URL("../../", import.meta.url).pathname;
    const executionDir = join(root, "v2/src/execution");
    const production = readdirSync(executionDir)
      .filter((name) => name.endsWith(".ts") && !name.includes(".test.") && !name.endsWith(".test-support.ts"))
      .map((name) => join(executionDir, name));
    production.push(join(root, "shared/prompts/review-implement.ts"));
    expect(production.length).toBeGreaterThan(1);
    for (const file of production) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("patch.prompt.body");
      expect(source, file).not.toContain("patch.rules");
    }
  });
});
