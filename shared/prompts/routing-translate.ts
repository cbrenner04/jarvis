export function buildRoutingTranslatePrompt(opts: {
  cwd: string;
  requestText: string;
  actionCatalogExcerpt: string;
}): string {
  return [
    "Translate the operator request into exactly one JSON object that names a single catalog action and its arguments.",
    "Emit only that JSON object with no prose, markdown fences, or commentary.",
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
