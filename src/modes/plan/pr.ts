export function buildPlanPrHeader(opts: { name: string }): string {
  const lines = [
    "This PR was authored by `jarvis plan`. It contains a generated",
    `spec tree under \`spec/${opts.name}/\` for human review.`,
    "",
    `- Intent: \`spec/${opts.name}/intent.md\``,
    `- Index: \`spec/${opts.name}/index.md\``,
    "",
    "Plan mode never marks this PR ready for review. Once you have",
    "reviewed (and edited) the spec, mark it ready and merge to `main`.",
    "Implementation work begins in a separate run with `jarvis run",
    `spec/${opts.name}/index.md\` after the merge.`,
  ];
  return lines.join("\n");
}
