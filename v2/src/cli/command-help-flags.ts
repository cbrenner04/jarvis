import type { CommandFlag } from "./command-tree.ts";

/** `parseArgs` options for `runInitCommand` / `jarvis init`. */
export const INIT_PARSE_ARG_OPTIONS = {
  profile: { type: "string" },
  name: { type: "string" },
  "target-dir": { type: "string" },
  scaffold: { type: "boolean" },
  check: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

/** Flags accepted by `runInitCommand`, in help declaration order. */
export const INIT_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--profile", argumentShape: "<name>", description: "Committed machine profile to select or verify." },
  { name: "--name", argumentShape: "<key>", description: "Project registry key; defaults to the worktree name." },
  { name: "--target-dir", argumentShape: "<dir>", description: "Planning directory, relative to the project root." },
  { name: "--scaffold", argumentShape: "", description: "Also create empty seeds/ and ready-intents/ directories." },
  { name: "--check", argumentShape: "", description: "Read-only: report readiness without writing config or repo." },
];

/** `parseArgs` options for `parseWriteArgs` / `jarvis run start`. */
export const WRITE_PARSE_ARG_OPTIONS = {
  "project-root": { type: "string" },
  project: { type: "string" },
  branch: { type: "string" },
  base: { type: "string" },
  spec: { type: "string" },
  artifact: { type: "string" },
  "max-iterations": { type: "string" },
} as const satisfies Record<string, { type: "string" }>;

/** Flags accepted by `parseWriteArgs`, in help declaration order. */
export const WRITE_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--project-root", argumentShape: "<path>", description: "Project repository root on disk." },
  { name: "--project", argumentShape: "<name>", description: "Registered project name." },
  { name: "--branch", argumentShape: "<name>", description: "Implementation branch name." },
  { name: "--base", argumentShape: "<ref>", description: "Base git ref for the branch." },
  { name: "--spec", argumentShape: "<path>", description: "Spec path (file or index)." },
  { name: "--artifact", argumentShape: "<path>", description: "Completion artifact path for single-file specs." },
  { name: "--max-iterations", argumentShape: "<n>", description: "Positive iteration budget cap." },
];

/** `parseArgs` options for `parseCleanupCliArgs` / `jarvis cleanup`. */
export const CLEANUP_PARSE_ARG_OPTIONS = {
  "dry-run": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  abandon: { type: "string" },
} as const satisfies Record<string, { type: "boolean" | "string"; short?: string }>;

type ParseArgOptionShape = { type: "boolean" | "string"; short?: string };

/** Parser-accepted argv tokens for help parity (long flags and short aliases). */
export function parityFlagsFromParseOptions(options: Record<string, ParseArgOptionShape>): readonly string[] {
  const flags: string[] = [];
  for (const key of Object.keys(options)) {
    flags.push(`--${key}`);
    const short = options[key]?.short;
    if (short !== undefined) {
      flags.push(`-${short}`);
    }
  }
  return flags;
}

/** Flags accepted by `parseCleanupCliArgs`, in help declaration order. */
export const CLEANUP_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--dry-run", argumentShape: "", description: "Preview retirement and archival without applying changes." },
  {
    name: "--yes",
    argumentShape: "",
    description: "Apply the retirement plan without interactive confirmation.",
  },
  { name: "-y", argumentShape: "", description: "Short alias for --yes." },
  {
    name: "--abandon",
    argumentShape: "<name>",
    description: "Retire a named worktree without the normal completion gate; mutually exclusive with <project>.",
  },
];

/** `parseArgs` options for `parseListArgv` / `jarvis run list`. */
export const RUN_LIST_PARSE_ARG_OPTIONS = {
  since: { type: "string" },
  limit: { type: "string" },
  project: { type: "string" },
  branch: { type: "string" },
  spec: { type: "string" },
  status: { type: "string" },
  all: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

/** Flags accepted by `parseListArgv`, in help declaration order. */
export const RUN_LIST_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--since", argumentShape: "<duration|timestamp>", description: "Only list runs at or after the cutoff." },
  { name: "--limit", argumentShape: "<positive-integer>", description: "Cap the number of runs returned." },
  { name: "--project", argumentShape: "<name>", description: "Only list runs for the exact project name." },
  { name: "--branch", argumentShape: "<name>", description: "Only list runs on the exact branch name." },
  { name: "--spec", argumentShape: "<path>", description: "Only list runs with the exact spec path." },
  {
    name: "--status",
    argumentShape: "<terminal-status>",
    description: "Only list runs with the exact terminal durable status.",
  },
  { name: "--all", argumentShape: "", description: "Also include dismissed runs; adds a trailing dismissed column." },
];

/** `parseArgs` options for `jarvis daemon log`. */
export const DAEMON_LOG_PARSE_ARG_OPTIONS = {
  follow: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" }>;

/** Flags accepted by `jarvis daemon log`, in help declaration order. */
export const DAEMON_LOG_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--follow", argumentShape: "", description: "Stream new log bytes after the retained snapshot." },
];

export const RUN_LOG_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--follow", argumentShape: "", description: "Keep tailing new records after the replay." },
];

/** `parseArgs` options for `jarvis run log`. */
export const RUN_LOG_PARSE_ARG_OPTIONS = {
  follow: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" }>;

/** `parseArgs` options for `runActionCommand` (`kill`) / `jarvis run kill`. */
export const RUN_KILL_PARSE_ARG_OPTIONS = {
  force: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" }>;

export const RUN_KILL_HELP_FLAGS: readonly CommandFlag[] = [
  {
    name: "--force",
    argumentShape: "",
    description: "Force-settle a stale non-active run that resume refuses; bypasses the ordinary abort path.",
  },
];

const WORKFLOW_STALE_RESET_OVERRIDE_FLAG: CommandFlag = {
  name: "--reset-despite-dirty",
  argumentShape: "",
  description:
    "Retire a stale workspace on incomplete re-run even when the worktree is dirty; porcelain or listing errors still refuse.",
};

const WORKFLOW_LANDED_CRITERIA_OVERRIDE_FLAG: CommandFlag = {
  name: "--reset-despite-landed-criteria",
  argumentShape: "",
  description:
    "Retire a stale workspace on incomplete re-run even when the worktree spec has criteria ticked absent from base.",
};

const WORKFLOW_DETACH_FLAG: CommandFlag = {
  name: "--detach",
  argumentShape: "",
  description:
    "Return after daemon admission with the workflow entry run ID on stdout; do not block on workflow completion.",
};

const WORKFLOW_REVIEW_FLAGS: readonly CommandFlag[] = [
  {
    name: "--review-passes",
    argumentShape: "<n>",
    description: "Adversarial review pass count (non-negative integer).",
  },
  {
    name: "--review-behavior",
    argumentShape: "debate|light",
    description: "Review style for each pass.",
  },
];

export const WORKFLOW_INTENT_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--seed", argumentShape: "<path>", description: "Path to a seed file." },
  { name: "--seed-text", argumentShape: "<text>", description: "Seed prose inline." },
  { name: "--target-dir", argumentShape: "<dir>", description: "Directory for the new spec tree." },
  ...WORKFLOW_REVIEW_FLAGS,
  WORKFLOW_DETACH_FLAG,
];

export const WORKFLOW_PLAN_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--ready-intent", argumentShape: "<path>", description: "Path to a ready intent file." },
  { name: "--target-dir", argumentShape: "<dir>", description: "Directory for the new spec tree." },
  ...WORKFLOW_REVIEW_FLAGS,
  WORKFLOW_STALE_RESET_OVERRIDE_FLAG,
  WORKFLOW_LANDED_CRITERIA_OVERRIDE_FLAG,
  WORKFLOW_DETACH_FLAG,
];

/** `parseArgs` options for `jarvis pipeline start`. */
export const PIPELINE_START_PARSE_ARG_OPTIONS = {
  seed: { type: "string" },
  "seed-text": { type: "string" },
  detach: { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

export const PIPELINE_START_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--seed", argumentShape: "<path>", description: "Path to a seed file." },
  { name: "--seed-text", argumentShape: "<text>", description: "Seed prose inline." },
  {
    name: "--detach",
    argumentShape: "",
    description: "Return after daemon admission with the pipeline ID on stdout; do not block on completion.",
  },
];

/** `parseArgs` options for `parsePipelineListArgs` / `jarvis pipeline list`. */
export const PIPELINE_LIST_PARSE_ARG_OPTIONS = {
  json: { type: "boolean" },
  all: { type: "boolean" },
  since: { type: "string" },
  state: { type: "string" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

const PIPELINE_STALE_RESET_OVERRIDE_PARSE_OPTIONS = {
  "reset-despite-dirty": { type: "boolean" },
  "reset-despite-landed-criteria": { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" }>;

/** `parseArgs` options for `parsePipelineResumeArgs` / `jarvis pipeline resume`. */
export const PIPELINE_RESUME_PARSE_ARG_OPTIONS = PIPELINE_STALE_RESET_OVERRIDE_PARSE_OPTIONS;

/** `parseArgs` options for `parsePipelineRecoverArgs` / `jarvis pipeline recover`. */
export const PIPELINE_RECOVER_PARSE_ARG_OPTIONS = PIPELINE_STALE_RESET_OVERRIDE_PARSE_OPTIONS;

/** Flags accepted by `parsePipelineResumeArgs`, in help declaration order. */
export const PIPELINE_RESUME_HELP_FLAGS: readonly CommandFlag[] = [
  WORKFLOW_STALE_RESET_OVERRIDE_FLAG,
  WORKFLOW_LANDED_CRITERIA_OVERRIDE_FLAG,
];

/** Flags accepted by `parsePipelineRecoverArgs`, in help declaration order. */
export const PIPELINE_RECOVER_HELP_FLAGS: readonly CommandFlag[] = [
  WORKFLOW_STALE_RESET_OVERRIDE_FLAG,
  WORKFLOW_LANDED_CRITERIA_OVERRIDE_FLAG,
];

/** Flags accepted by `parsePipelineListArgs`, in help declaration order. */
export const PIPELINE_LIST_HELP_FLAGS: readonly CommandFlag[] = [
  {
    name: "--json",
    argumentShape: "",
    description: "Print the unmodified pipeline_list snapshot; cannot combine with --since or --state.",
  },
  {
    name: "--all",
    argumentShape: "",
    description: "Include dismissed pipelines (requests includeDismissed: true); marks them in the human listing.",
  },
  {
    name: "--since",
    argumentShape: "<duration|timestamp>",
    description:
      "Only list pipelines created at or after the cutoff: a positive <n>d|h|m|s duration or a Date.parse-accepted timestamp.",
  },
  {
    name: "--state",
    argumentShape: "<pipeline-state>",
    description:
      "Only list pipelines with the exact state: pending, running, awaiting-approval, succeeded, failed, rejected, or interrupted.",
  },
];

/** `parseArgs` options for `jarvis notifications wait` and `jarvis notifications list`. */
export const NOTIFICATIONS_PARSE_ARG_OPTIONS = {
  since: { type: "string" },
  kind: { type: "string", multiple: true },
  project: { type: "string" },
} as const satisfies Record<string, { type: "string"; multiple?: boolean }>;

export const NOTIFICATIONS_HELP_FLAGS: readonly CommandFlag[] = [
  {
    name: "--since",
    argumentShape: "<cursor|duration|timestamp>",
    description:
      "Only consider deliveries at or after the bound: a delivery cursor, positive <n>d|h|m|s duration, or Date.parse-accepted timestamp; defaults to ledger start when omitted.",
  },
  {
    name: "--kind",
    argumentShape: "<incident-kind>",
    description: "Repeatable incident-kind filter; omit to match all kinds.",
  },
  {
    name: "--project",
    argumentShape: "<name>",
    description: "Only wake or list incidents whose project equals the given registered project name.",
  },
];

export const WORKFLOW_IMPLEMENT_HELP_FLAGS: readonly CommandFlag[] = [
  { name: "--branch", argumentShape: "<name>", description: "Implementation branch name." },
  { name: "--base", argumentShape: "<ref>", description: "Base git ref for the branch." },
  { name: "--spec", argumentShape: "<path>", description: "Spec path (file or index)." },
  { name: "--artifact", argumentShape: "<path>", description: "Completion artifact path for single-file specs." },
  ...WORKFLOW_REVIEW_FLAGS,
  WORKFLOW_STALE_RESET_OVERRIDE_FLAG,
  WORKFLOW_LANDED_CRITERIA_OVERRIDE_FLAG,
  WORKFLOW_DETACH_FLAG,
];
