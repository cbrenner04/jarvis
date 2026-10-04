/**
 * Closed catalog of actions a free-text router may select, plus the pure validator that turns a
 * router's untrusted output into a typed action or a named rejection. No I/O: path existence,
 * project resolution, and daemon preconditions belong to the dispatcher.
 */

export type RoutingActionField = { readonly required: boolean };
export type RoutingActionSchema = Readonly<Record<string, RoutingActionField>>;

const required = { required: true } as const;
const optional = { required: false } as const;

/** Whitelist of routable actions with their exact argument fields. Every value is a string. */
export const ROUTING_ACTION_CATALOG = {
  "pipeline.start": { seedPath: required, project: optional },
  "pipeline.approve": { pipelineId: required },
  "pipeline.reject": { pipelineId: required },
  "pipeline.resume": { pipelineId: required },
  "run.kill": { runId: required },
  "run.resume": { runId: required },
  "run.log": { runId: required },
} as const satisfies Record<string, RoutingActionSchema>;

export type RoutingActionName = keyof typeof ROUTING_ACTION_CATALOG;

type ArgsOf<S extends RoutingActionSchema> = {
  [K in keyof S as S[K]["required"] extends true ? K : never]: string;
} & {
  [K in keyof S as S[K]["required"] extends false ? K : never]?: string;
};

/** A validated request: the action name plus exactly its catalog fields. */
export type RoutingAction = {
  [N in RoutingActionName]: { action: N } & ArgsOf<(typeof ROUTING_ACTION_CATALOG)[N]>;
}[RoutingActionName];

export type RoutingRejection =
  | { reason: "malformed-request" }
  | { reason: "unknown-action"; action: string }
  | { reason: "extra-field"; action: RoutingActionName; field: string }
  | { reason: "missing-field"; action: RoutingActionName; field: string }
  | { reason: "wrong-type"; action: RoutingActionName; field: string }
  | { reason: "command-payload"; action: RoutingActionName; field: string };

export type RoutingValidation = { ok: true; action: RoutingAction } | { ok: false; rejection: RoutingRejection };

const MAX_ARGUMENT_LENGTH = 1024;
/** Shell metacharacters, quotes, whitespace, and control characters: none belong in a path, ID, or project name. */
const COMMAND_PAYLOAD_PATTERN = /[\s;&|<>`$(){}'"\\]|\p{Cc}/u;

/** True when a string argument could be read as a command line or executable payload rather than a bare value. */
export function looksLikeCommandPayload(value: string): boolean {
  return (
    value.length === 0 ||
    value.length > MAX_ARGUMENT_LENGTH ||
    value.startsWith("-") ||
    value.startsWith("#!") ||
    COMMAND_PAYLOAD_PATTERN.test(value)
  );
}

function isRoutingActionName(name: string): name is RoutingActionName {
  return Object.hasOwn(ROUTING_ACTION_CATALOG, name);
}

function rejectField(
  action: RoutingActionName,
  schema: RoutingActionSchema,
  field: string,
  value: unknown,
): RoutingRejection | undefined {
  const spec = schema[field];
  if (spec === undefined) return { reason: "extra-field", action, field };
  if (value === undefined) return spec.required ? { reason: "missing-field", action, field } : undefined;
  if (typeof value !== "string") return { reason: "wrong-type", action, field };
  if (looksLikeCommandPayload(value)) return { reason: "command-payload", action, field };
  return undefined;
}

/** Validates untrusted router output against the catalog. No coercion, no partial acceptance. */
export function validateRoutingRequest(input: unknown): RoutingValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, rejection: { reason: "malformed-request" } };
  }
  const request = input as Record<string, unknown>;
  const name = request.action;
  if (typeof name !== "string") return { ok: false, rejection: { reason: "malformed-request" } };
  if (!isRoutingActionName(name)) return { ok: false, rejection: { reason: "unknown-action", action: name } };

  const schema: RoutingActionSchema = ROUTING_ACTION_CATALOG[name];
  const fields = new Set([...Object.keys(schema), ...Object.keys(request).filter((key) => key !== "action")]);
  const action: Record<string, string> = { action: name };
  for (const field of fields) {
    const value = request[field];
    const rejection = rejectField(name, schema, field, value);
    if (rejection !== undefined) return { ok: false, rejection };
    if (typeof value === "string") action[field] = value;
  }
  return { ok: true, action: action as RoutingAction };
}
