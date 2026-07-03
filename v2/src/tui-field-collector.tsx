import { createElement, Fragment, type ReactElement, useState } from "react";
import type { WriteLaunchFieldValues } from "./execution/write-loop-input.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";

/** Result of ink or injectable launch field collection. */
export type LaunchFieldCollectionResult =
  | { ok: true; fields: WriteLaunchFieldValues }
  | { ok: false; errors: string[] };

/** Injectable seam for TUI launch field collection. */
export type TuiLaunchFieldCollector = () => Promise<LaunchFieldCollectionResult>;

const OPTIONAL_LAUNCH_FIELDS = new Set<keyof WriteLaunchFieldValues>(["agents", "maxIterations"]);

type LaunchFieldPrompt = { key: keyof WriteLaunchFieldValues; label: string };

const LAUNCH_FIELD_PROMPTS: readonly LaunchFieldPrompt[] = [
  { key: "projectRoot", label: "project-root" },
  { key: "projectName", label: "project" },
  { key: "branchName", label: "branch" },
  { key: "baseRef", label: "base" },
  { key: "specPath", label: "spec" },
  { key: "artifactPath", label: "artifact" },
  { key: "agents", label: "agents (optional)" },
  { key: "maxIterations", label: "max-iterations (optional)" },
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

  const prompt = promptAt(index);

  const advance = (submitted: string): void => {
    const trimmed = submitted.trim();
    if (!OPTIONAL_LAUNCH_FIELDS.has(prompt.key) && trimmed.length === 0) {
      onDone({ ok: false, errors: [`missing required field: ${prompt.label}`] });
      return;
    }

    const nextFields = trimmed.length > 0 ? { ...fields, [prompt.key]: trimmed } : { ...fields };
    const nextIndex = index + 1;
    if (nextIndex >= LAUNCH_FIELD_PROMPTS.length) {
      onDone({ ok: true, fields: nextFields as WriteLaunchFieldValues });
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

function promptAt(index: number): LaunchFieldPrompt {
  const prompt = LAUNCH_FIELD_PROMPTS[index];
  if (prompt === undefined) {
    throw new Error(`invalid launch prompt index: ${index}`);
  }
  return prompt;
}

/** Collect launch fields through ink prompts backed by `useInput`. */
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
