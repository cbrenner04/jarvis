import { describe, expect, test } from "bun:test";
import { isValidElement } from "react";
import { loadInkUi } from "./tui-ink-runtime.ts";

// The monitor colors cells by passing `color` to the Text the runtime hands back. The
// production wrapper previously destructured only `children`, so `color` never reached
// ink and the TUI rendered monochrome while every color test stayed green — those tests
// asserted against their own injected Text, not this one.
describe("loadInkUi production Text", () => {
  test("forwards color to ink's Text", async () => {
    const { Text } = await loadInkUi();
    const element = Text({ children: "failed", color: "red" });

    expect(isValidElement(element)).toBe(true);
    expect((element.props as { color?: string }).color).toBe("red");
    expect((element.props as { children?: unknown }).children).toBe("failed");
  });

  test("omits color when the segment is untoned", async () => {
    const { Text } = await loadInkUi();
    const element = Text({ children: "not-live" });

    expect((element.props as { color?: string }).color).toBeUndefined();
  });
});
