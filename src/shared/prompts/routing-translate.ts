/** Shape example shown to the router: argument fields sit beside `action`, never nested. */
export const ROUTING_OUTPUT_EXAMPLE = { action: "pipeline.approve", pipelineId: "<pipeline id>" } as const;

export function buildRoutingTranslatePrompt(opts: {
  cwd: string;
  requestText: string;
  actionCatalogExcerpt: string;
}): string {
  return [
    "Translate the operator request into exactly one JSON object that names a single catalog action and its arguments.",
    "Emit only that JSON object with no prose, markdown fences, or commentary.",
    'Put every argument as a top-level key beside "action", spelled exactly as in the catalog; never nest arguments under another key.',
    `Example shape: ${JSON.stringify(ROUTING_OUTPUT_EXAMPLE)}`,
    "",
    "Action catalog (field names; required vs optional):",
    opts.actionCatalogExcerpt,
    "",
    `Operator cwd: ${opts.cwd}`,
    "",
    "Operator request:",
    opts.requestText,
  ].join("\n");
}
