import { describe, expect, test } from "bun:test";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { applyOperatorSessionId } from "./daemon.ts";

describe("applyOperatorSessionId", () => {
  test("no-op when input carries no telemetry", () => {
    const input = mockWriteLoopInput();
    expect(applyOperatorSessionId(input, "daemon-id")).toBe(input);
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
