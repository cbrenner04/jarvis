export const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status|log>\n";
export const DAEMON_LOG_USAGE = "usage: jarvis daemon log [--follow]\n";
export const CONFIG_USAGE = "usage: jarvis config <show|path|set-agents> [args]\n";
export const RUN_USAGE = "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n";
export const TUI_USAGE = "usage: jarvis tui\n";
export const TUI_LOG_USAGE = "usage: jarvis tui log <run-id>\n";
export const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n";
export const WORKFLOW_IMPLEMENT_USAGE =
  "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light]\n";
export const WORKFLOW_INTENT_USAGE =
  "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n";
export const WORKFLOW_PLAN_USAGE =
  "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n";
export const WORKFLOW_USAGE = "usage: jarvis run workflow <intent|plan|implement> [flags]\n";
export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--abandon <name>]\n";
export const HELP_USAGE = "usage: jarvis help\n";
