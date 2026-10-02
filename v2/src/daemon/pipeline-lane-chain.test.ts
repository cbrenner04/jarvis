import { describe, expect, test } from "bun:test";
import {
  buildFanOutLaneChain,
  type LaneProgress,
  laneChainGate,
  laneChainSuccessors,
  readyIntentDeclaresIndependent,
} from "./pipeline-lane-chain.ts";

describe("pipeline lane chain", () => {
  test("only `independent: true` frontmatter opts a lane out of serial chaining", () => {
    expect(readyIntentDeclaresIndependent("---\nname: a\nindependent: true\n---\nbody")).toBe(true);
    expect(readyIntentDeclaresIndependent("---\nname: a\nindependent: false\n---\n")).toBe(false);
    expect(readyIntentDeclaresIndependent("---\nname: a\n---\nindependent: true\n")).toBe(false);
    expect(readyIntentDeclaresIndependent("independent: true\n")).toBe(false);
  });

  test("unreadable ready-intents chain in authored order; independent lanes run first", () => {
    const chain = buildFanOutLaneChain(["a", "b", "c"], [undefined, "---\nindependent: true\n---\n", "---\n---\n"]);
    expect(chain.dependent).toEqual(["a", "c"]);
    expect([...chain.independent]).toEqual(["b"]);

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
