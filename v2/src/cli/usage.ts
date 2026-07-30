export const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status|log>\n";
export const DAEMON_LOG_USAGE = "usage: jarvis daemon log [--follow]\n";
export const CONFIG_USAGE = "usage: jarvis config <show|path|set-agents> [args]\n";
export const RUN_USAGE = "usage: jarvis run <start|list|log|pause|resume|kill|wait|workflow> [args]\n";
export const RUN_LOG_USAGE = "usage: jarvis run log <run-id> [--follow]\n";
export const RUN_LIST_USAGE =
  "usage: jarvis run list [--since <duration|timestamp>] [--limit <positive-integer>] [--project <name>] [--branch <name>] [--spec <path>] [--status <terminal-status>]\n";
export const TUI_USAGE = "usage: jarvis tui\n";
export const TUI_LOG_USAGE = "usage: jarvis tui log <run-id>\n";
export const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n";
export const WORKFLOW_IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty] [--detach]\n";
export const WORKFLOW_INTENT_USAGE =
  "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light] [--detach]\n";
export const WORKFLOW_PLAN_USAGE =
  "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light] [--reset-despite-dirty] [--detach]\n";
export const WORKFLOW_USAGE = "usage: jarvis run workflow <intent|plan|implement> [flags]\n";
export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--yes|-y] [--abandon <name>]\n";
export const PIPELINE_START_USAGE =
  "usage: jarvis pipeline start <project> (--seed <path> | --seed-text <text>) [--detach]\n";
export const PIPELINE_LIST_USAGE = "usage: jarvis pipeline list\n";
export const PIPELINE_WAIT_USAGE = "usage: jarvis pipeline wait <pipeline-id>\n";
export const PIPELINE_APPROVE_USAGE = "usage: jarvis pipeline approve <pipeline-id> <stage-id>\n";
export const PIPELINE_REJECT_USAGE = "usage: jarvis pipeline reject <pipeline-id> <stage-id>\n";
export const PIPELINE_RESUME_USAGE = "usage: jarvis pipeline resume <pipeline-id>\n";
export const PIPELINE_USAGE = "usage: jarvis pipeline <start|list|wait|approve|reject|resume> [args]\n";
export const HELP_USAGE = "usage: jarvis help\n";
