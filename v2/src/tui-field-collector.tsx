import { createElement, Fragment, type ReactElement, useState } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { WriteLaunchFieldValues } from "./write-loop-input.ts";

/** Result of ink or injectable launch field collection. */
export type LaunchFieldCollectionResult =
  | { ok: true; fields: WriteLaunchFieldValues }
  | { ok: false; errors: string[] };

/** Injectable seam for TUI launch field collection. */
export type TuiLaunchFieldCollector = () => Promise<LaunchFieldCollectionResult>;

type FieldPrompt = { key: keyof WriteLaunchFieldValues; label: string; required: boolean };

const LAUNCH_FIELD_PROMPTS: readonly FieldPrompt[] = [
  { key: "projectRoot", label: "project-root", required: true },
  { key: "projectName", label: "project", required: true },
  { key: "branchName", label: "branch", required: true },
  { key: "baseRef", label: "base", required: true },
  { key: "specPath", label: "spec", required: true },
  { key: "artifactPath", label: "artifact", required: true },
  { key: "agents", label: "agents (optional)", required: false },
  { key: "maxIterations", label: "max-iterations (optional)", required: false },
];

type TextComponent = (props: { children?: string }) => ReactElement;
type UseInputHook = (
  inputHandler: (
    input: string,
    key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean },
  ) => void,
) => void;

function LaunchFieldForm({
  onDone,
  Text,
  useInput,
}: {
  onDone: (result: LaunchFieldCollectionResult) => void;
  Text: TextComponent;
  useInput: UseInputHook;
}): ReactElement {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [fields, setFields] = useState<Partial<WriteLaunchFieldValues>>({});

  const prompt = LAUNCH_FIELD_PROMPTS[index]!;

  const finish = (nextFields: Partial<WriteLaunchFieldValues>): void => {
    onDone({ ok: true, fields: nextFields as WriteLaunchFieldValues });
  };

  const advance = (submitted: string): void => {
    const trimmed = submitted.trim();
    if (prompt.required && trimmed.length === 0) {
      onDone({ ok: false, errors: [`missing required field: ${prompt.label}`] });
      return;
    }

    const nextFields = trimmed.length > 0 ? { ...fields, [prompt.key]: trimmed } : { ...fields };
    const nextIndex = index + 1;
    if (nextIndex >= LAUNCH_FIELD_PROMPTS.length) {
      finish(nextFields);
      return;
    }
    setFields(nextFields);
    setValue("");
    setIndex(nextIndex);
  };

  useInput((input, key) => {
    if (key.return) {
      advance(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && input.length > 0) {
      setValue((current) => current + input);
    }
  });

  return createElement(Text, null, `${prompt.label}: ${value}`);
}

/**
 * Collect launch fields through ink prompts backed by `useInput`.
 *
 * @param inkRender Injectable ink render; defaults to production ink `render`.
 */
export async function collectLaunchFieldsViaInk(inkRender?: InkRender): Promise<LaunchFieldCollectionResult> {
  let renderFn: InkRender;
  let Text: TextComponent;
  let useInput: UseInputHook;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
    useInput = () => {};
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Text = ink.Text as TextComponent;
    useInput = ink.useInput as UseInputHook;
  }

  return new Promise<LaunchFieldCollectionResult>((resolve) => {
    const instance = renderFn(
      createElement(LaunchFieldForm, {
        Text,
        useInput,
        onDone: (result) => {
          instance.unmount();
          resolve(result);
        },
      }),
    );
  });
}
