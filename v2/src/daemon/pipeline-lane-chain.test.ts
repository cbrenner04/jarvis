import { describe, expect, test } from "bun:test";
import {
  buildFanOutLaneChain,
  type LaneProgress,
  laneChainFromArtifact,
  laneChainGate,
  laneChainSuccessors,
  parseLaneDeclaration,
  persistLaneChain,
} from "./pipeline-lane-chain.ts";

function intent(prerequisites: string[], frontmatter = ""): string {
  return `---\nname: x\n${frontmatter}---\n\n## Prerequisites\n\n${prerequisites.map((p) => `- ${p}`).join("\n")}\n\n## Decisions\n\n- d (delivered by: nope)\n`;
}

describe("pipeline lane chain", () => {
  test("declarations read explicit `independent:` and Prerequisites-only delivered-by providers", () => {
    expect(parseLaneDeclaration(intent(["seam (delivered by: a)", "other (already true: yes)"]))).toEqual({
      deliveredBy: ["a"],
    });
    expect(parseLaneDeclaration(intent([], "independent: true\n"))).toEqual({ independent: true, deliveredBy: [] });
    expect(parseLaneDeclaration(intent([], "independent: false\n"))).toEqual({ independent: false, deliveredBy: [] });
  });

  test("unrelated lanes are independent; providers and consumers chain providers-first; frontmatter overrides", () => {
    expect(buildFanOutLaneChain(["a", "b"], [intent([]), undefined])).toEqual({
      dependent: [],
      independent: new Set(["a", "b"]),
    });
    const chained = buildFanOutLaneChain(["b", "a", "c"], [intent(["x (delivered by: a)"]), intent([]), intent([])]);
    expect(chained.dependent).toEqual(["a", "b"]);
    expect([...chained.independent]).toEqual(["c"]);
    const overridden = buildFanOutLaneChain(
      ["a", "b"],
      [intent([], "independent: false\n"), intent(["x (delivered by: a)"], "independent: true\n")],
    );
    expect(overridden.dependent).toEqual(["a"]);
    expect([...overridden.independent]).toEqual(["b"]);
  });

  test("the persisted chain round-trips; an artifact without one reads as no chain", () => {
    const chain = buildFanOutLaneChain(["a", "b"], [intent([]), intent(["x (delivered by: a)"])]);
    expect(laneChainFromArtifact({ laneChain: persistLaneChain(chain) })).toEqual(chain);
    expect(laneChainFromArtifact({ entryRunId: "r", specPath: "s" })).toBeUndefined();
    expect(laneChainFromArtifact({ laneChain: { dependent: "a" } })).toBeUndefined();
  });

  test("gates hold, open, and sever along the chain", () => {
    const chain = { dependent: ["a", "c"], independent: new Set(["b"]) };
    const progress: Record<string, LaneProgress> = { a: "open", b: "open", c: "open" };
    const gate = (lane: string) => laneChainGate(chain, lane, (key) => progress[key] ?? "open");
    expect(gate("b")).toEqual({ kind: "open" });
    expect(gate("a")).toEqual({ kind: "held" });
    progress.b = "dead";
    expect(gate("a")).toEqual({ kind: "open" });
    expect(gate("c")).toEqual({ kind: "held" });
    progress.a = "complete";
    expect(gate("c")).toEqual({ kind: "open", predecessor: "a" });
    progress.a = "dead";
    expect(gate("c")).toEqual({ kind: "severed", predecessor: "a" });

    expect(laneChainSuccessors(chain, "b")).toEqual(["a"]);
    expect(laneChainSuccessors(chain, "a")).toEqual(["c"]);
    expect(laneChainSuccessors(chain, "c")).toEqual([]);
  });
});
