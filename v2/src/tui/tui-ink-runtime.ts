import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";

type InkUi = {
  renderFn: InkRender;
  Text: InkText;
  Box?: (props: { children?: ReactNode; flexDirection?: "column" | "row" }) => ReactElement;
  useInput?: InkUseInput;
};

type InkText = (props: { children?: ReactNode; color?: string }) => ReactElement;

export type InkUseInput = (
  inputHandler: (
    input: string,
    key: {
      ctrl?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      return?: boolean;
      escape?: boolean;
      backspace?: boolean;
      delete?: boolean;
    },
  ) => void,
) => void;

/** Injectable renderer and input hook pair for TUI tests. */
export type InjectedInkUi = { renderFn: InkRender; Text?: InkText; useInput?: InkUseInput };

/** Load production ink or inject a test render seam. */
export async function loadInkUi(inkRender?: InkRender | InjectedInkUi): Promise<InkUi> {
  if (inkRender !== undefined) {
    return {
      renderFn: typeof inkRender === "function" ? inkRender : inkRender.renderFn,
      Text:
        typeof inkRender === "function"
          ? ({ children }) => createElement(Fragment, null, children)
          : (inkRender.Text ?? (({ children }) => createElement(Fragment, null, children))),
      ...(typeof inkRender === "function" ? {} : { useInput: inkRender.useInput }),
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
