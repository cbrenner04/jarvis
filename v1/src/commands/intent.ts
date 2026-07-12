import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  listIntentStageMarkdownFiles,
  repairIntentStageContent as sharedRepairIntentStageContent,
  validateIntentFilenames as sharedValidateIntentFilenames,
  validateIntentStage as sharedValidateIntentStage,
  validateIntentStageContent as sharedValidateIntentStageContent,
  validateIntentStageStructure,
} from "../../../shared/intent-stage.ts";
import { realSubprocessRunner, type SubprocessRunner } from "../../../shared/subprocess.ts";
import type { Agent, AgentName } from "../agents/types.ts";
import { CONFIG_DIR, loadConfig, resolvePlanFlags, validateTargetDir } from "../config.ts";
import type { LogClient } from "../logging.ts";
import { keepIssueReferencesOffLineStart, runMarkdownlintAutofix } from "../markdownlint-repair.ts";
import { enterMode } from "../mode-entry.ts";
import { runIntentSplitTurn } from "../modes/plan/intent-split.ts";
import { getOpenPrState, maybeMarkPlanPrReady } from "../modes/plan/pr.ts";
import { computeProjectSafeId } from "../modes/plan/spec-paths.ts";
import { parseAgentFlagValues, prefixAgentFlagError } from "../parse-agent-flag.ts";
import { ensureDraftPr, renderAttribution as realRenderAttribution } from "../pr.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../quota-harness-messages.ts";
import {
  type CreateIntentWorktreeOptions,
  createWorktreeSymlinks,
  createIntentWorktree as realCreateIntentWorktree,
} from "../worktree.ts";

export type IntentIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type IntentCommandOptions = {
  io: IntentIo;
  args?: readonly string[];
  cwd?: string;
  config?: { dir?: string };
  logClient?: LogClient;
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  markdownlintHarnessRoot?: string | null;
  runner?: SubprocessRunner;
  createIntentWorktree?: (opts: CreateIntentWorktreeOptions) => Promise<string>;
  renderAttribution?: (opts: { cwd: string; base: string }) => string;
};

type IntentInvocationCommon = {
  repo?: string;
  targetDir?: string;
  cwd: string;
  agentFlags?: string[];
};

export type IntentInvocation =
  | (IntentInvocationCommon & { mode: "file"; seedPath: string })
  | (IntentInvocationCommon & { mode: "inline"; seedText: string });

export type IntentParseResult =
  | { ok: true; invocation: IntentInvocation }
  | { ok: false; exitCode: number; message: string };

const FLAGS_WITH_VALUE = new Set(["--repo", "--cwd", "--target-dir"]);

export const INTENT_USAGE = `Usage: jarvis1 intent [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] <raw-seed-file|"inline text">
                             Split one seed into authored intents under ready-intents/ and open a PR.
`;

const STAGE_DIR_NAME = ".jarvis-intent-stage";
const INTENT_FILE_RE = /^[a-z0-9-]+$/;

function planHarnessLog(logClient: LogClient, text: string, tag: "harness" | "outbound" = "harness"): void {
  void logClient
    .send({
      namespace: "jarvis",
      text,
      tag,
    })
    .catch(() => {});
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function parseIntentArgs(argv: readonly string[], processCwd: string): IntentParseResult {
  let repo: string | undefined;
  let cwdFlag: string | undefined;
  let targetDir: string | undefined;
  const agentFlags: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--agent") {
      const value = argv[i + 1];
      if (value === undefined) {
        return {
          ok: false,
          exitCode: 1,
          message: "intent: missing value for --agent",
        };
      }
      i += 1;
      agentFlags.push(value);
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        return {
          ok: false,
          exitCode: 1,
          message: `intent: missing value for ${arg}`,
        };
      }
      i += 1;
      if (arg === "--repo") {
        repo = value;
      } else if (arg === "--cwd") {
        cwdFlag = value;
      } else if (arg === "--target-dir") {
        try {
          targetDir = validateTargetDir(value, "--target-dir", (message): never => {
            throw new Error(message);
          });
        } catch (err) {
          return {
            ok: false,
            exitCode: 1,
            message: `intent: ${(err as Error).message}`,
          };
        }
      }
      continue;
    }
    if (arg.startsWith("--")) {
      return {
        ok: false,
        exitCode: 1,
        message: `intent: unknown flag ${arg}`,
      };
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      message: 'intent: missing required seed (<raw-seed-file|"inline text">)',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: 1,
      message: "intent: too many arguments",
    };
  }

  const cwd = cwdFlag !== undefined ? (isAbsolute(cwdFlag) ? cwdFlag : resolve(processCwd, cwdFlag)) : processCwd;
  const arg = positional[0] as string;
  const candidatePath = isAbsolute(arg) ? arg : resolve(cwd, arg);
  const invocation: IntentInvocation = isExistingFile(candidatePath)
    ? { mode: "file", seedPath: candidatePath, cwd }
    : { mode: "inline", seedText: arg, cwd };
  if (repo !== undefined) {
    invocation.repo = repo;
  }
  if (targetDir !== undefined) {
    invocation.targetDir = targetDir;
  }
  if (agentFlags.length > 0) {
    invocation.agentFlags = agentFlags;
  }
  return { ok: true, invocation };
}

function deriveRunName(inv: IntentInvocation): string {
  if (inv.mode === "file") {
    return toKebabCase(basename(inv.seedPath).replace(/\.[^.]*$/, "")) || "intent";
  }
  const words = inv.seedText.split(/\s+/).slice(0, 6);
  return toKebabCase(words.join(" ")).slice(0, 40) || "intent";
}

function relativeSeedLabel(projectRoot: string, seedPath: string): string {
  const rel = relative(projectRoot, seedPath);
  return rel.startsWith("..") ? seedPath : rel;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("../"));
}

function listModifiedPaths(cwd: string, runner: SubprocessRunner): string[] {
  const output = runner.run("git", ["status", "--porcelain"], cwd);
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
}

function parseIntentFrontmatterName(text: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if ((lines[0] ?? "") !== "---") {
    return null;
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---") {
      break;
    }
    const match = /^name:\s*(.+)\s*$/.exec(line);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function hasPrerequisitesSection(text: string): boolean {
  return /^## Prerequisites\s*$/m.test(text.replace(/\r\n/g, "\n"));
}

function hasValidPrerequisitesSection(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  const headingMatch = /^## Prerequisites\s*$/m.exec(normalized);
  if (headingMatch === null || headingMatch.index === undefined) return false;
  const afterHeading = normalized.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  const body = (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)).trim();
  if (body.length === 0) return true;
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .every((line) => /^- \S.*$/.test(line));
}

function normalizePrerequisitesSectionSpacing(text: string): string {
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === "## Prerequisites");
  if (headingIndex === -1) {
    return text;
  }

  let changed = false;
  let index = headingIndex;

  let beforeStart = index;
  while (beforeStart > 0 && (lines[beforeStart - 1] ?? "").trim() === "") {
    beforeStart -= 1;
  }
  if (beforeStart === index) {
    if (index > 0) {
      lines.splice(index, 0, "");
      index += 1;
      changed = true;
    }
  } else if (index - beforeStart > 1) {
    lines.splice(beforeStart, index - beforeStart - 1);
    index = beforeStart + 1;
    changed = true;
  }

  let afterEnd = index + 1;
  while (afterEnd < lines.length && (lines[afterEnd] ?? "").trim() === "") {
    afterEnd += 1;
  }
  const blankCountAfter = afterEnd - (index + 1);
  if (blankCountAfter === 0) {
    lines.splice(index + 1, 0, "");
    changed = true;
  } else if (blankCountAfter > 1) {
    lines.splice(index + 2, blankCountAfter - 1);
    changed = true;
  }

  return changed ? lines.join("\n") : text;
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function repairIntentFile(path: string, slug: string): void {
  const content = readFileSync(path, "utf8");
  let text = content.replace(/\r\n/g, "\n");
  let modified = false;

  const lines = text.split("\n");
  let blockEndIdx = -1;
  const hasLeadingDash = (lines[0] ?? "") === "---";

  // Find frontmatter block end
  if (hasLeadingDash) {
    for (let i = 1; i < lines.length; i += 1) {
      if ((lines[i] ?? "") === "---") {
        blockEndIdx = i;
        break;
      }
    }
  }

  // Repair frontmatter name:
  if (blockEndIdx === -1 && !hasLeadingDash) {
    // Case 1: No frontmatter block, prepend one
    lines.unshift("---", `name: ${slug}`, "---");
    blockEndIdx = 2; // After prepending, the closing --- is at index 2
    modified = true;
  } else if (blockEndIdx !== -1) {
    // Frontmatter exists with proper closing, check for name: key
    let hasName = false;
    let nameLineIdx = -1;
    let nameValue: string | null = null;

    for (let i = 1; i < blockEndIdx; i += 1) {
      const line = lines[i] ?? "";
      const match = /^name:\s*(.*)$/.exec(line);
      if (match) {
        hasName = true;
        nameLineIdx = i;
        nameValue = (match[1] ?? "").trim();
        break;
      }
    }

    if (hasName && nameLineIdx !== -1 && nameValue !== slug) {
      // Case 3: Rewrite if mismatched or empty
      lines[nameLineIdx] = `name: ${slug}`;
      modified = true;
    } else if (!hasName) {
      // Case 2: Insert name: into existing block (before the closing ---)
      lines.splice(blockEndIdx, 0, `name: ${slug}`);
      blockEndIdx += 1; // Adjust blockEndIdx since we inserted a line
      modified = true;
    }
  }
  // If blockEndIdx === -1 && hasLeadingDash, unterminated frontmatter: skip repair

  // Repair body heading: enforce first non-blank line (after frontmatter) is a # heading
  const bodyStartIdx = blockEndIdx !== -1 ? blockEndIdx + 1 : 0;
  let firstNonBlankIdx = -1;
  for (let i = bodyStartIdx; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim().length > 0) {
      firstNonBlankIdx = i;
      break;
    }
  }

  const derivedTitle = `# ${slugToTitle(slug)}`;
  if (firstNonBlankIdx !== -1) {
    const firstNonBlankLine = lines[firstNonBlankIdx] ?? "";
    // Check if it's already a heading
    const nameLineMatch = /^name:\s*(.*)$/.exec(firstNonBlankLine.trim());
    if (firstNonBlankLine.trim().startsWith("#")) {
      // Already a heading, leave untouched
    } else if (nameLineMatch && (nameLineMatch[1] ?? "").trim() === slug) {
      // Duplicate name: line, replace with heading
      lines[firstNonBlankIdx] = derivedTitle;
      modified = true;
    } else {
      // Other prose without heading, prepend heading
      lines.splice(firstNonBlankIdx, 0, derivedTitle);
      modified = true;
    }
  } else {
    // No first non-blank line in body, append heading
    lines.push(derivedTitle);
    modified = true;
  }

  text = lines.join("\n");

  // Keep issue references off line-start to avoid MD018 corruption
  const withFixedReferences = keepIssueReferencesOffLineStart(text);
  if (withFixedReferences !== text) {
    text = withFixedReferences;
    modified = true;
  }

  // Repair Prerequisites section: trim trailing blank lines before appending to fix MD012
  if (!hasPrerequisitesSection(text)) {
    // Trim trailing blank lines before appending
    text = `${text.replace(/\n+$/, "")}\n\n## Prerequisites\n`;
    modified = true;
  }

  const normalizedSpacing = normalizePrerequisitesSectionSpacing(text);
  if (normalizedSpacing !== text) {
    text = normalizedSpacing;
    modified = true;
  }

  if (modified) {
    writeFileSync(path, text, "utf8");
  }
}

async function repairIntentStageContent(
  stagingDir: string,
  warn: (message: string) => void,
  harnessRootOverride?: string | null,
): Promise<void> {
  const files = listIntentStageMarkdownFiles(stagingDir);
  for (const path of files) {
    const slug = basename(path, ".md");
    repairIntentFile(path, slug);
  }

  await runMarkdownlintAutofix({
    files: listIntentStageMarkdownFiles(stagingDir),
    warn,
    ...(harnessRootOverride !== undefined ? { harnessRootOverride } : {}),
  });
}

function validateIntentFilenames(files: string[]):
  | {
      ok: true;
      intents: { slug: string; path: string }[];
    }
  | { ok: false; error: string } {
  if (files.length === 0) {
    return { ok: false, error: "intent: splitter produced no intent files" };
  }

  const seen = new Set<string>();
  const intents: { slug: string; path: string }[] = [];
  for (const path of files) {
    const slug = basename(path, ".md");
    if (!INTENT_FILE_RE.test(slug) || /^\d+-/.test(slug) || slug === "index") {
      return {
        ok: false,
        error: `intent: invalid emitted filename ${basename(path)}; expected <name>.md with no ordering prefix`,
      };
    }
    if (seen.has(slug)) {
      return { ok: false, error: `intent: duplicate emitted name ${slug}` };
    }
    seen.add(slug);
    intents.push({ slug, path });
  }

  return { ok: true, intents };
}

function validateIntentStageContent(intents: { slug: string; path: string }[]):
  | {
      ok: true;
      intents: { slug: string; path: string }[];
    }
  | { ok: false; error: string } {
  for (const { slug, path } of intents) {
    const content = readFileSync(path, "utf8");
    const frontmatterName = parseIntentFrontmatterName(content);
    if (frontmatterName !== slug) {
      return {
        ok: false,
        error: `intent: ${basename(path)} must declare name: ${slug}`,
      };
    }
    if (!hasPrerequisitesSection(content)) {
      return {
        ok: false,
        error: `intent: ${basename(path)} is missing ## Prerequisites`,
      };
    }
    if (!hasValidPrerequisitesSection(content)) {
      return {
        ok: false,
        error: `intent: ${basename(path)} must list prerequisites as one bullet per line`,
      };
    }
  }

  return { ok: true, intents };
}

function gateIntentStage(
  stagingDir: string,
  modifiedPaths: string[],
):
  | {
      ok: true;
      intents: { slug: string; path: string }[];
    }
  | { ok: false; error: string } {
  const allowedPrefix = `${STAGE_DIR_NAME}/`;
  const rogue = modifiedPaths.filter((path) => path !== STAGE_DIR_NAME && !path.startsWith(allowedPrefix));
  if (rogue.length > 0) {
    return {
      ok: false,
      error: `intent: splitter wrote outside ${STAGE_DIR_NAME}/: ${rogue.join(", ")}`,
    };
  }

  const dirEntries = readdirSync(stagingDir, { withFileTypes: true });
  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      return {
        ok: false,
        error: `intent: invalid splitter output ${entry.name}; expected only markdown files`,
      };
    }
  }

  const files = listIntentStageMarkdownFiles(stagingDir);
  return validateIntentFilenames(files);
}

async function _validateIntentStage(
  stagingDir: string,
  modifiedPaths: string[],
  warn: (message: string) => void,
  harnessRootOverride?: string | null,
): Promise<
  | {
      ok: true;
      intents: { slug: string; path: string }[];
    }
  | { ok: false; error: string }> {
  const gating = gateIntentStage(stagingDir, modifiedPaths);
  if (!gating.ok) {
    return gating;
  }

  await repairIntentStageContent(stagingDir, warn, harnessRootOverride);
  return validateIntentStageContent(gating.intents);
}

function _validateExternalIntentStageStructure(stagingDir: string): { ok: true } | { ok: false; error: string } {
  try {
    const dirEntries = readdirSync(stagingDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        return {
          ok: false,
          error: `intent: invalid splitter output ${entry.name}; expected only markdown files`,
        };
      }
    }
  } catch {
    return {
      ok: false,
      error: `intent: failed to read stage directory`,
    };
  }
  return { ok: true };
}

function commitIntentSplit(opts: {
  worktreePath: string;
  branch: string;
  readyDirRel: string;
  seedLabel: string;
  emittedNames: string[];
  agentLabel: string;
  runner: SubprocessRunner;
}): void {
  opts.runner.run("git", ["add", "-A"], opts.worktreePath);
  const message = [
    `intent: split ${opts.emittedNames.length} intent${opts.emittedNames.length === 1 ? "" : "s"}`,
    "",
    `Spec: ${opts.readyDirRel}/`,
    "",
    `Seeded from ${opts.seedLabel}`,
    `Intents: ${opts.emittedNames.join(", ")}`,
    "",
    `Jarvis-Agent: ${opts.agentLabel}`,
  ].join("\n");
  opts.runner.run("git", ["commit", "-m", message], opts.worktreePath);
  opts.runner.run("git", ["push", "-u", "origin", opts.branch], opts.worktreePath);
}

function cleanupIntentState(projectRoot: string, worktreePath: string, branch: string, runner: SubprocessRunner): void {
  try {
    runner.run("git", ["worktree", "remove", "--force", worktreePath], projectRoot);
  } catch {
    // best-effort
  }
  try {
    runner.run("git", ["branch", "-D", branch], projectRoot);
  } catch {
    // best-effort
  }
}

function snapshotCheckoutPaths(projectRoot: string): Set<string> {
  const paths = new Set<string>();
  const entries = readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".gitignore") continue;
    paths.add(entry.name);
  }
  return paths;
}

function assertNoCheckoutPollution(
  projectRoot: string,
  baseline: Set<string>,
): { ok: true } | { ok: false; rogue: string[] } {
  const current = snapshotCheckoutPaths(projectRoot);
  const rogue: string[] = [];
  for (const path of current) {
    if (!baseline.has(path)) {
      rogue.push(path);
    }
  }
  return rogue.length === 0 ? { ok: true } : { ok: false, rogue };
}

function renderIntentNextSteps(args: { prUrl: string; targetDir: string; emittedNames: string[] }): string {
  const lines = [
    "",
    "Next steps:",
    `  1. Review the draft PR: ${args.prUrl}`,
    "  2. Draft specs one intent at a time with:",
  ];
  for (const name of args.emittedNames) {
    lines.push(`       jarvis1 plan ${args.targetDir}/ready-intents/${name}.md`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderIntentNextStepsNoCommit(args: {
  project: { key: string; root: string };
  emittedPaths: string[];
}): string {
  const lines = ["", "Next steps:", "Draft specs one intent at a time with:"];
  for (const path of args.emittedPaths) {
    lines.push(`  jarvis1 plan --repo ${args.project.key} ${path}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function intentCommand(opts: IntentCommandOptions): Promise<number> {
  const args = opts.args ?? [];
  if (args.includes("--help") || args.includes("-h")) {
    opts.io.stdout(INTENT_USAGE);
    return 0;
  }

  const processCwd = opts.cwd ?? process.cwd();
  const parsed = parseIntentArgs(args, processCwd);
  if (!parsed.ok) {
    opts.io.stderr(`${parsed.message}\n`);
    if (parsed.message.includes("missing required seed")) {
      opts.io.stdout(INTENT_USAGE);
    }
    return parsed.exitCode;
  }

  const inv = parsed.invocation;
  const runner = opts.runner ?? realSubprocessRunner;
  const intentWorktreeCreator = opts.createIntentWorktree ?? realCreateIntentWorktree;
  const attrsRender = opts.renderAttribution ?? realRenderAttribution;
  const rawCfg = loadConfig(opts.config);
  let cfg = rawCfg;
  if (inv.agentFlags !== undefined && inv.agentFlags.length > 0) {
    const parsedAgents = parseAgentFlagValues(inv.agentFlags, rawCfg.modes.plan.agentOrder);
    if (!parsedAgents.ok) {
      opts.io.stderr(`${prefixAgentFlagError("intent", parsedAgents.message)}\n`);
      return 1;
    }
    cfg = {
      ...rawCfg,
      modes: {
        ...rawCfg.modes,
        plan: { ...rawCfg.modes.plan, agentOrder: parsedAgents.agentOrder },
      },
    };
  }
  const candidatePath = inv.mode === "file" ? inv.seedPath : join(inv.cwd, "intent");
  const entryOpts: Parameters<typeof enterMode>[0] = {
    candidatePath,
    io: { stderr: opts.io.stderr },
    logServerUrl: rawCfg.logServerUrl,
  };
  if (inv.repo !== undefined) {
    entryOpts.repoFlag = inv.repo;
  }
  if (opts.config !== undefined) {
    entryOpts.config = opts.config;
  }
  if (opts.logClient !== undefined) {
    entryOpts.logClient = opts.logClient;
  }
  const entry = await enterMode(entryOpts);
  if (entry.kind === "error") {
    opts.io.stderr(`${entry.message}\n`);
    return 1;
  }
  if (entry.kind === "ambiguous") {
    const names = entry.candidates.map((c) => `  - ${c.key}`).join("\n");
    opts.io.stderr(`${entry.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`);
    return 1;
  }
  if (entry.kind === "needs-prompt") {
    opts.io.stderr(
      "could not determine a target project for this intent and no projects are registered. Run `jarvis1 init` in a target repo, or pass --repo <name|url>.\n",
    );
    return 1;
  }
  if (entry.kind === "log-error") {
    return entry.exitCode;
  }

  const project = entry.resolution.resolved.project;
  const fullProject = cfg.projects[project.key];
  const { commit, targetDir: resolvedTargetDir } = resolvePlanFlags(cfg, fullProject);
  const targetDir = inv.targetDir ?? resolvedTargetDir;

  const planLogClient = entry.logClient;
  planHarnessLog(planLogClient, `intent: target project=${project.key} root=${project.root}`);
  planHarnessLog(planLogClient, `intent: resolved flags commit=${commit} targetDir=${targetDir}`);

  const jarvisConfigDir = opts.config?.dir ?? CONFIG_DIR;
  const externalRoot = join(jarvisConfigDir, "specs", computeProjectSafeId(project));

  const seedDir = commit ? join(project.root, targetDir, "seeds") : join(externalRoot, "seeds");
  const seedDirDisplay = commit ? `${targetDir}/seeds/` : `${seedDir}/`;
  if (inv.mode === "file" && !isPathInside(seedDir, inv.seedPath)) {
    opts.io.stderr(`intent: raw seed files must live under ${seedDirDisplay}\n`);
    return 1;
  }

  const seedLabel = inv.mode === "file" ? relativeSeedLabel(project.root, inv.seedPath) : "inline";
  const seedContent = inv.mode === "file" ? readFileSync(inv.seedPath, "utf8") : inv.seedText;
  const runStem = deriveRunName(inv);
  const runName = `${runStem}-${randomUUID().slice(0, 8)}`;

  if (!commit) {
    mkdirSync(externalRoot, { recursive: true });

    const externalStageDir = join(externalRoot, ".jarvis-intent-stage");
    rmSync(externalStageDir, { recursive: true, force: true });
    mkdirSync(externalStageDir, { recursive: true });

    const checkoutBaseline = snapshotCheckoutPaths(project.root);

    try {
      const splitResult = await runIntentSplitTurn({
        worktreePath: project.root,
        seedLabel,
        seedContent,
        stagingDir: externalStageDir,
        config: cfg,
        stderr: opts.io.stderr,
        additionalReadDirs: [externalStageDir],
        ...(opts.createAgent !== undefined ? { createAgent: opts.createAgent } : {}),
        onOutboundPrompt: (prompt) => planHarnessLog(planLogClient, prompt, "outbound"),
      });

      if (splitResult.result.kind !== "ok") {
        if (splitResult.result.kind === "quota") {
          opts.io.stderr(`intent: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
          return 2;
        }
        if (splitResult.result.kind === "model_config") {
          opts.io.stderr(`intent: model configuration error\n${splitResult.result.stderr}`);
          return 3;
        }
        opts.io.stderr(`intent: split failed\n${splitResult.result.stderr}`);
        return 1;
      }

      const checkoutPollution = assertNoCheckoutPollution(project.root, checkoutBaseline);
      if (!checkoutPollution.ok) {
        opts.io.stderr(
          `intent: splitter wrote into checkout (cwd=${project.root}): ${checkoutPollution.rogue.join(", ")}\n`,
        );
        return 1;
      }

      const stageDirStructure = validateIntentStageStructure(externalStageDir);
      if (!stageDirStructure.ok) {
        opts.io.stderr(`${stageDirStructure.error}\n`);
        return 1;
      }

      const files = listIntentStageMarkdownFiles(externalStageDir);
      const filenameValidation = sharedValidateIntentFilenames(files);
      if (!filenameValidation.ok) {
        opts.io.stderr(`${filenameValidation.error}\n`);
        return 1;
      }

      await sharedRepairIntentStageContent(externalStageDir, opts.io.stderr, opts.markdownlintHarnessRoot);

      const validation = sharedValidateIntentStageContent(filenameValidation.intents);
      if (!validation.ok) {
        opts.io.stderr(`${validation.error}\n`);
        return 1;
      }

      const emittedNames = validation.intents.map((intent) => intent.slug);
      const readyIntentsDir = join(externalRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });

      for (const intent of validation.intents) {
        const destination = join(readyIntentsDir, `${intent.slug}.md`);
        if (existsSync(destination)) {
          opts.io.stderr(`intent: ready-intents/${intent.slug}.md already exists; refusing to overwrite\n`);
          return 1;
        }
      }

      for (const intent of validation.intents) {
        renameSync(intent.path, join(readyIntentsDir, `${intent.slug}.md`));
      }

      rmSync(externalStageDir, { recursive: true, force: true });

      const emittedPaths = emittedNames.map((name) => join(readyIntentsDir, `${name}.md`));
      opts.io.stdout(
        renderIntentNextStepsNoCommit({
          project,
          emittedPaths,
        }),
      );
      opts.io.stderr(
        `intent: ${emittedNames.length} intent${emittedNames.length === 1 ? "" : "s"} written to ${readyIntentsDir}\n`,
      );
      return 0;
    } finally {
      if (existsSync(externalStageDir)) {
        rmSync(externalStageDir, { recursive: true, force: true });
      }
    }
  }

  const branch = `intent/${runName}`;
  let worktreePath: string;
  try {
    worktreePath = await intentWorktreeCreator({ projectRoot: project.root, name: runName });
    createWorktreeSymlinks(project.root, worktreePath, cfg.worktreeSymlinks);
  } catch (err) {
    opts.io.stderr(`failed to create intent worktree: ${(err as Error).message}\n`);
    return 1;
  }
  const baseBranch = runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], project.root).trim();
  const stageDir = join(worktreePath, STAGE_DIR_NAME);
  mkdirSync(stageDir, { recursive: true });
  let completed = false;

  try {
    const splitResult = await runIntentSplitTurn({
      worktreePath,
      seedLabel,
      seedContent,
      stagingDir: STAGE_DIR_NAME,
      config: cfg,
      stderr: opts.io.stderr,
      ...(opts.createAgent !== undefined ? { createAgent: opts.createAgent } : {}),
      onOutboundPrompt: (prompt) => planHarnessLog(planLogClient, prompt, "outbound"),
    });
    if (splitResult.result.kind !== "ok") {
      if (splitResult.result.kind === "quota") {
        opts.io.stderr(`intent: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
        return 2;
      }
      if (splitResult.result.kind === "model_config") {
        opts.io.stderr(`intent: model configuration error\n${splitResult.result.stderr}`);
        return 3;
      }
      opts.io.stderr(`intent: split failed\n${splitResult.result.stderr}`);
      return 1;
    }

    const validation = await sharedValidateIntentStage(
      stageDir,
      listModifiedPaths(worktreePath, runner),
      opts.io.stderr,
      opts.markdownlintHarnessRoot,
    );
    if (!validation.ok) {
      opts.io.stderr(`${validation.error}\n`);
      return 1;
    }

    const emittedNames = validation.intents.map((intent) => intent.slug);
    const readyDirRel = `${targetDir}/ready-intents`;
    const readyDirPath = join(worktreePath, readyDirRel);
    mkdirSync(readyDirPath, { recursive: true });
    for (const intent of validation.intents) {
      const destination = join(readyDirPath, `${intent.slug}.md`);
      if (existsSync(destination)) {
        opts.io.stderr(`intent: ${readyDirRel}/${intent.slug}.md already exists; refusing to overwrite\n`);
        return 1;
      }
    }
    for (const intent of validation.intents) {
      renameSync(intent.path, join(readyDirPath, `${intent.slug}.md`));
    }
    rmSync(stageDir, { recursive: true, force: true });

    commitIntentSplit({
      worktreePath,
      branch,
      readyDirRel,
      seedLabel,
      emittedNames,
      agentLabel: splitResult.agentLabel ?? "unknown",
      runner,
    });
    opts.io.stderr(`intent: split commit pushed\n`);

    const prResult = await ensureDraftPr({
      branch,
      base: baseBranch,
      title: `intent: ${runStem}`,
      bodyGenerator: async () =>
        [
          "# Intent split",
          "",
          `- Seed: \`${seedLabel}\``,
          ...emittedNames.map((name) => `- Intent: \`${targetDir}/ready-intents/${name}.md\``),
        ].join("\n"),
      footer: attrsRender({ cwd: worktreePath, base: baseBranch }),
      cwd: worktreePath,
    });
    const prUrl = runner.run("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], worktreePath).trim();
    opts.io.stdout(
      renderIntentNextSteps({
        prUrl,
        targetDir,
        emittedNames,
      }),
    );
    opts.io.stderr(`intent: draft PR #${prResult.number} ${prResult.created ? "opened" : "updated"}\n`);
    const intentFixCommand = cfg.projects[project.key]?.fixCommand;
    try {
      maybeMarkPlanPrReady({
        branch,
        cwd: worktreePath,
        timeoutMs: cfg.iterationTimeoutMs,
        getOpenPrState,
        skipBaseCurrentCheck: true,
        skipReadyGate: true,
        ...(intentFixCommand !== undefined ? { fixCommand: intentFixCommand } : {}),
      });
    } catch (err) {
      opts.io.stderr(`warning: could not mark PR ready for review: ${(err as Error).message}\n`);
    }
    completed = true;
    return 0;
  } finally {
    if (existsSync(stageDir)) {
      rmSync(stageDir, { recursive: true, force: true });
    }
    if (!completed) {
      cleanupIntentState(project.root, worktreePath, branch, runner);
    }
  }
}
