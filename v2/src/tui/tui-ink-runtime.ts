import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";

type InkUi = {
  renderFn: InkRender;
  Text: InkText;
  Box?: (props: {
    children?: ReactNode;
    flexDirection?: "column" | "row";
    width?: number;
    height?: number;
    overflow?: "hidden" | "visible";
  }) => ReactElement;
  useInput?: InkUseInput;
  usePaste?: InkUsePaste;
};

type InkText = (props: { children?: ReactNode; color?: string }) => ReactElement;

export type InkUseInput = (
  inputHandler: (
    input: string,
    key: {
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
      return?: boolean;
      escape?: boolean;
      backspace?: boolean;
      delete?: boolean;
    },
  ) => void,
) => void;

export type InkUsePaste = (pasteHandler: (text: string) => void) => void;

/** Injectable renderer and input hook pair for TUI tests. */
export type InjectedInkUi = {
  renderFn: InkRender;
  Text?: InkText;
  Box?: InkUi["Box"];
  useInput?: InkUseInput;
  usePaste?: InkUsePaste;
};

/** Load production ink or inject a test render seam. */
export async function loadInkUi(inkRender?: InkRender | InjectedInkUi): Promise<InkUi> {
  if (inkRender !== undefined) {
    const injectedBox: InkUi["Box"] | undefined =
      typeof inkRender === "function"
        ? undefined
        : (inkRender.Box ?? ((({ children }) => createElement(Fragment, null, children)) as NonNullable<InkUi["Box"]>));
    return {
      renderFn: typeof inkRender === "function" ? inkRender : inkRender.renderFn,
      Text:
        typeof inkRender === "function"
          ? ({ children }) => createElement(Fragment, null, children)
          : (inkRender.Text ?? (({ children }) => createElement(Fragment, null, children))),
      ...(injectedBox === undefined ? {} : { Box: injectedBox }),
      ...(typeof inkRender === "function" ? {} : { useInput: inkRender.useInput }),
      ...(typeof inkRender === "function" ? {} : { usePaste: inkRender.usePaste }),
    };
  }

  const ink = await import("ink");
  const Box = ink.Box as NonNullable<InkUi["Box"]>;
  return {
    renderFn: ink.render,
    Box,
    // Forward props, not just children: dropping them here silently discards `color`.
    Text: ({ children, ...props }) => createElement(ink.Text, props, children),
    useInput: ink.useInput,
    usePaste: ink.usePaste,
  };
}
