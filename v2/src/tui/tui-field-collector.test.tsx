import { describe, expect, test } from "bun:test";
import type { LaunchFieldCollectionResult } from "./tui-field-collector.tsx";
import { collectLaunchFieldsViaInk } from "./tui-field-collector.tsx";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";

type FormElement = { props: { onDone: (result: LaunchFieldCollectionResult) => void } };

/** Drives `onDone` directly from the rendered element's props, bypassing ink's reconciler. */
function createMockInkRender(result: LaunchFieldCollectionResult): InkRender {
  return ((element: unknown) => {
    queueMicrotask(() => (element as FormElement).props.onDone(result));
    return {
      rerender() {},
      unmount() {},
      waitUntilExit: async () => {},
      cleanup() {},
      clear() {},
      waitUntilRenderFlush: async () => {},
    };
  }) as InkRender;
}

describe("collectLaunchFieldsViaInk", () => {
  test("uses loadInkUi boundary and completes with injected render seam", async () => {
    const expected: LaunchFieldCollectionResult = {
      ok: true,
      fields: {
        projectRoot: "/root",
        projectName: "proj",
        branchName: "main",
        baseRef: "main",
        specPath: "spec.md",
        artifactPath: "artifact.md",
      },
    };
    const result = await collectLaunchFieldsViaInk(createMockInkRender(expected));

    expect(result).toEqual(expected);
  });

  test("propagates a failure result from the injected render seam", async () => {
    const expected: LaunchFieldCollectionResult = { ok: false, errors: ["missing required field: project"] };
    const result = await collectLaunchFieldsViaInk(createMockInkRender(expected));

    expect(result).toEqual(expected);
  });
});

describe("loadInkUi smoke tests", () => {
  test("smoke: loadInkUi resolves without ink-load TDZ error", async () => {
    const ui = await loadInkUi();
    expect(ui.renderFn).toBeDefined();
    expect(ui.Text).toBeDefined();
    expect(ui.useInput).toBeDefined();
  });
});
