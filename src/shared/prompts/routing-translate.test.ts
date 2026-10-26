import { describe, expect, test } from "bun:test";
import { ROUTING_ACTION_CATALOG } from "../../cli/free-text-routing-actions.ts";
import { buildRoutingTranslatePrompt, ROUTING_OUTPUT_EXAMPLE } from "./routing-translate.ts";

describe("buildRoutingTranslatePrompt", () => {
  test("shows a flat example whose keys are exactly its catalog action's fields", () => {
    const { action, ...args } = ROUTING_OUTPUT_EXAMPLE;
    expect(Object.keys(args).sort()).toEqual(Object.keys(ROUTING_ACTION_CATALOG[action]).sort());
    const prompt = buildRoutingTranslatePrompt({ cwd: "/repo", requestText: "approve it", actionCatalogExcerpt: "x" });
    expect(prompt).toContain(JSON.stringify(ROUTING_OUTPUT_EXAMPLE));
    expect(prompt).toContain("never nest arguments");
  });
});
