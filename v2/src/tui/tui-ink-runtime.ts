import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";

type InkUi = {
  renderFn: InkRender;
  Text: (props: { children?: ReactNode; color?: string }) => ReactElement;
  Box?: (props: { children?: ReactNode; flexDirection?: "column" | "row" }) => ReactElement;
  useInput?: (
    inputHandler: (
      input: string,
      key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean },
    ) => void,
  ) => void;
};

/** Load production ink or inject a test render seam. */
export async function loadInkUi(inkRender?: InkRender): Promise<InkUi> {
  if (inkRender !== undefined) {
    return {
      renderFn: inkRender,
      Text: ({ children }) => createElement(Fragment, null, children),
    };
  }

  const ink = await import("ink");
  const Box = ink.Box as (props: { children?: ReactNode; flexDirection?: "column" | "row" }) => ReactElement;
  return {
    renderFn: ink.render,
    Box,
    // Forward props, not just children: dropping them here silently discards `color`.
    Text: ({ children, ...props }) => createElement(ink.Text, props, children),
    useInput: ink.useInput,
  };
}
