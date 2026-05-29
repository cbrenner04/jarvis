import { describe, expect, test } from "bun:test";
import { assemblePrompt } from "./assemble.ts";
import type { PromptArtifact, PromptRegistry } from "./types.ts";

function makeRegistry(artifacts: PromptArtifact[]): PromptRegistry {
  const byId = new Map(artifacts.map((a) => [a.metadata.id, a]));
  return {
    getById(id: string): PromptArtifact {
      const artifact = byId.get(id);
      if (artifact === undefined) {
        throw new Error(`unknown prompt id \`${id}\``);
      }
      return artifact;
    },
    all(): ReadonlyArray<PromptArtifact> {
      return artifacts;
    },
  };
}

function fakeArtifact(id: string, body: string): PromptArtifact {
  return {
    metadata: {
      id,
      behavior: "plan",
      kind: "step",
      revision: "1",
      order: null,
      fragmentOf: [],
      overrides: [],
      add: [],
      remove: [],
      placeholders: [],
    },
    sourcePath: `/tmp/${id}.md`,
    body,
  };
}

describe("assemblePrompt", () => {
  test("assembles prompt in deterministic global -> behavior -> step order", () => {
    const registry = makeRegistry([
      fakeArtifact("g.one", "GLOBAL ONE"),
      fakeArtifact("b.one", "BEHAVIOR ONE"),
      fakeArtifact("step", "STEP BODY"),
    ]);
    expect(
      assemblePrompt({
        registry,
        globalFragmentIds: ["g.one"],
        behaviorFragmentIds: ["b.one"],
        stepPromptId: "step",
      }),
    ).toBe("GLOBAL ONE\n\nBEHAVIOR ONE\n\nSTEP BODY");
  });

  test("explicit remove is honored", () => {
    const registry = makeRegistry([
      fakeArtifact("g.one", "GLOBAL ONE"),
      fakeArtifact("b.one", "BEHAVIOR ONE"),
      fakeArtifact("b.two", "BEHAVIOR TWO"),
      fakeArtifact("step", "STEP BODY"),
    ]);
    expect(
      assemblePrompt({
        registry,
        globalFragmentIds: ["g.one"],
        behaviorFragmentIds: ["b.one"],
        addFragmentIds: ["b.two"],
        removeFragmentIds: ["b.one"],
        stepPromptId: "step",
      }),
    ).toBe("GLOBAL ONE\n\nBEHAVIOR TWO\n\nSTEP BODY");
  });

  test("unknown prompt ids fail at render-time lookup", () => {
    const registry = makeRegistry([fakeArtifact("step", "STEP BODY")]);
    expect(() =>
      assemblePrompt({
        registry,
        globalFragmentIds: [],
        behaviorFragmentIds: [],
        stepPromptId: "missing.step",
      }),
    ).toThrow("unknown prompt id `missing.step`");
  });
});
