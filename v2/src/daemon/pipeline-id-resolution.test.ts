import { describe, expect, test } from "bun:test";
import {
  PIPELINE_ID_PREFIX_MIN_LENGTH,
  resolvePipelineIdArgument,
  uniquePipelineIdPrefixes,
} from "./pipeline-id-resolution.ts";

function storeOf(ids: readonly string[]): Parameters<typeof resolvePipelineIdArgument>[0] {
  const rows = ids.map(
    (id) => ({ id }) as unknown as ReturnType<Parameters<typeof resolvePipelineIdArgument>[0]["listPipelines"]>[number],
  );
  return {
    loadPipeline: (pipelineId) => rows.find((row) => row.id === pipelineId) ?? null,
    listPipelines: () => rows,
  };
}

const A = "aaaaaaaa-1111-4000-8000-000000000001";
const B = "aaaaaaaa-2222-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("resolvePipelineIdArgument", () => {
  test("an exact id resolves even when it is also a prefix of another id", () => {
    const store = storeOf([A, `${A}-child`]);
    expect(resolvePipelineIdArgument(store, A)).toEqual({ kind: "resolved", pipelineId: A });
  });

  test("a strict prefix of exactly one id resolves; a prefix of none is unmatched with the argument unchanged", () => {
    const store = storeOf([A, B, C]);
    expect(resolvePipelineIdArgument(store, "cccccccc")).toEqual({ kind: "resolved", pipelineId: C });
    expect(resolvePipelineIdArgument(store, "aaaaaaaa-1")).toEqual({ kind: "resolved", pipelineId: A });
    expect(resolvePipelineIdArgument(store, "dddddddd")).toEqual({ kind: "unmatched", pipelineId: "dddddddd" });
  });

  test("a prefix shared by two ids is ambiguous and names both candidates in sorted order", () => {
    const store = storeOf([B, A, C]);
    expect(resolvePipelineIdArgument(store, "aaaaaaaa")).toEqual({ kind: "ambiguous", candidates: [A, B] });
  });

  test("arguments shorter than the minimum prefix length never prefix-resolve", () => {
    const store = storeOf([C]);
    const short = "c".repeat(PIPELINE_ID_PREFIX_MIN_LENGTH - 1);
    expect(resolvePipelineIdArgument(store, short)).toEqual({ kind: "unmatched", pipelineId: short });
    expect(resolvePipelineIdArgument(store, "c")).toEqual({ kind: "unmatched", pipelineId: "c" });
  });
});

describe("uniquePipelineIdPrefixes", () => {
  test("prints eight characters when unique and lengthens colliding prefixes until they differ", () => {
    expect(uniquePipelineIdPrefixes([A, B, C])).toEqual(
      new Map([
        [A, "aaaaaaaa-1"],
        [B, "aaaaaaaa-2"],
        [C, "cccccccc"],
      ]),
    );
  });

  test("every printed prefix resolves back to its own id", () => {
    const ids = [A, B, C];
    const store = storeOf(ids);
    for (const [id, prefix] of uniquePipelineIdPrefixes(ids)) {
      expect(resolvePipelineIdArgument(store, prefix)).toEqual({ kind: "resolved", pipelineId: id });
    }
  });
});
