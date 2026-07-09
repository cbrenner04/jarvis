import { describe, expect, test } from "bun:test";
import { applyOperatorSessionId } from "../execution/write-loop.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";

describe("applyOperatorSessionId", () => {
  test("attaches a valid telemetry object when input carries no telemetry", () => {
    const input = mockWriteLoopInput();
    const result = applyOperatorSessionId(input, "daemon-id");
    expect(result.telemetry?.operatorSessionId).toBe("daemon-id");
    expect(result.telemetry?.sinkPath).toBeUndefined();
    expect(result.telemetry?.workflow).toBeUndefined();
    expect(result.telemetry?.role).toBeUndefined();
  });

  test("same daemon id applied across multiple inputs", () => {
    const a = {
      ...mockWriteLoopInput(),
      telemetry: { sinkPath: "/tmp/a", operatorSessionId: "caller-a", workflow: "wf", role: "actuator" },
    };
    const b = {
      ...mockWriteLoopInput(),
      telemetry: { sinkPath: "/tmp/b", operatorSessionId: "caller-b", workflow: "wf", role: "actuator" },
    };

    const resultA = applyOperatorSessionId(a, "daemon-id");
    const resultB = applyOperatorSessionId(b, "daemon-id");

    expect(resultA.telemetry?.operatorSessionId).toBe("daemon-id");
    expect(resultB.telemetry?.operatorSessionId).toBe("daemon-id");
  });

  test("daemon id overrides a caller-supplied operatorSessionId", () => {
    const input = {
      ...mockWriteLoopInput(),
      telemetry: { sinkPath: "/tmp/sink", operatorSessionId: "caller-supplied", workflow: "wf", role: "actuator" },
    };

    const result = applyOperatorSessionId(input, "daemon-id");

    expect(result.telemetry?.operatorSessionId).toBe("daemon-id");
    expect(result.telemetry?.sinkPath).toBe("/tmp/sink");
    expect(result.telemetry?.workflow).toBe("wf");
    expect(result.telemetry?.role).toBe("actuator");
  });
});
