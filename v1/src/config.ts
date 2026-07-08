import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { AGENT_NAMES, type AgentName, isAgentName, validateAgentOrderEntries } from "./agent-order-validation.ts";

export type { AgentName };
export { AGENT_NAMES };

let configWriteLocked = false;

function atomicWriteSync(file: string, content: string): void {
  if (configWriteLocked) {
    throw new Error("Config write in progress");
  }

  configWriteLocked = true;
  try {
    const dir = resolve(file, "..");
    mkdirSync(dir, { recursive: true });

    const pid = process.pid;
    const rand = randomBytes(4).toString("hex");
    const tmpFile = `${file}.tmp.${pid}.${rand}`;

    // Open with O_WRONLY|O_CREAT|O_EXCL so a colliding tmp path is a hard
    // error rather than silently truncated. fsync the data fd before close
    // so the kernel commits the page cache to disk; without that, a power
    // loss after rename can still lose the most-recent write.
    const fd = openSync(tmpFile, "wx");
    try {
      writeSync(fd, content, 0, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpFile, file);

    // fsync the parent directory so the rename itself is durable. Failures
    // here are non-fatal: some filesystems (notably some networked or
    // non-POSIX filesystems) reject directory fsync with EINVAL/EISDIR.
    let dirFd = -1;
    try {
      dirFd = openSync(dir, "r");
      fsyncSync(dirFd);
    } catch {
      // best-effort
    } finally {
      if (dirFd !== -1) {
        closeSync(dirFd);
      }
    }
  } finally {
    configWriteLocked = false;
  }
}

export const CONFIG_DIR = join(homedir(), ".jarvis");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");
export const TELEMETRY_PATH = join(CONFIG_DIR, "runs.jsonl");

export type Project = {
  root: string;
  origin?: string;
  git?: boolean;
  siblings?: string[];
  plan?: { specTimestamp?: boolean; commit?: boolean; targetDir?: string };
  updateSnapshotsCommand?: string;
  readyCommand?: string;
  fixCommand?: string;
  readyGateRetryBound?: number;
  installCommand?: string;
};

export type ProjectMatch = {
  key: string;
  root: string;
  origin?: string;
};

export type AgentEntry = {
  agent: AgentName;
  model: string;
};

export type PatchSubRoleAgentOrder = Partial<{
  reviewPanel: AgentEntry[];
  reviewActuator: AgentEntry[];
}>;

export type PatchSubRole = keyof PatchSubRoleAgentOrder;

export type ModeConfig = {
  agentOrder: AgentEntry[];
  specTimestamp?: boolean;
  commit?: boolean;
  targetDir?: string;
  prNarrative?: "template" | "agent";
  shrink?: "off" | "agent";
  subRoleAgentOrder?: PatchSubRoleAgentOrder;
};

export type ReviewModeConfig = {
  agentOrder?: AgentEntry[];
  passes: number;
};

export type Config = {
  version: 2;
  modes: {
    patch: ModeConfig;
    plan: ModeConfig;
    prompt: ModeConfig;
    review: ReviewModeConfig;
  };
  quotaFallback: "strict" | "lenient";
  weakQuotaExitCodes: number[];
  maxIterations: number;
  iterationTimeoutMs: number;
  idleOutputTimeoutMs?: number;
  runTimeoutMs?: number;
  logServerUrl?: string;
  logServerBind?: string;
  telemetryPath?: string | null;
  worktreeSymlinks?: string[];
  git: boolean;
  projects: Record<string, Project>;
};

export type ConfigOptions = {
  dir?: string;
  maxIterations?: number;
};

export const DEFAULT_AGENT_MODELS: Record<AgentName, string> = {
  claude: "haiku",
  codex: "gpt-5.4",
  cursor: "Composer 2.5",
  opencode: "opencode/deepseek-v4-flash-free",
};

const DEFAULT_AGENT_ORDER: AgentEntry[] = [
  { agent: "claude", model: DEFAULT_AGENT_MODELS.claude },
  { agent: "codex", model: DEFAULT_AGENT_MODELS.codex },
  { agent: "cursor", model: DEFAULT_AGENT_MODELS.cursor },
];

export const DEFAULT_CONFIG: Config = {
  version: 2,
  modes: {
    patch: {
      agentOrder: structuredClone(DEFAULT_AGENT_ORDER),
      prNarrative: "agent",
      shrink: "agent",
    },
    plan: {
      agentOrder: structuredClone(DEFAULT_AGENT_ORDER),
      prNarrative: "agent",
      targetDir: "spec",
    },
    prompt: { agentOrder: structuredClone(DEFAULT_AGENT_ORDER) },
    review: { passes: 1 },
  },
  quotaFallback: "lenient",
  weakQuotaExitCodes: [],
  maxIterations: 10,
  iterationTimeoutMs: 600_000,
  idleOutputTimeoutMs: 600000,
  logServerUrl: "http://127.0.0.1:4310/logs",
  logServerBind: "127.0.0.1:4310",
  telemetryPath: TELEMETRY_PATH,
  git: true,
  projects: {},
};

function resolvePaths(opts?: ConfigOptions): { dir: string; file: string } {
  const dir = opts?.dir ?? CONFIG_DIR;
  return { dir, file: join(dir, "config.json") };
}

function resolveSessionsDir(opts?: ConfigOptions): string {
  const dir = opts?.dir ?? CONFIG_DIR;
  return join(dir, "sessions");
}

function fail(file: string, message: string): never {
  throw new Error(`Invalid config at ${file}: ${message}`);
}

function validateConfig(input: unknown, file: string): Config {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail(file, "expected a JSON object");
  }
  const obj = input as Record<string, unknown>;

  if (obj.version !== 2) {
    const msg =
      obj.version === 1
        ? `config version 1 is not supported. Convert to version 2 by:\n  1. set "version": 2\n  2. remove "agentOrder", "planAgentOrder", and "patchModels" keys\n  3. add "modes": { "patch": { "agentOrder": [{"agent": "claude", "model": "haiku"}, ...] }, "plan": { "agentOrder": [...] } }\n  See spec/2026-05-14-cli-modes-and-config-v2/00-config-v2-modes.md for details.`
        : `missing or unsupported version (expected 2, got ${JSON.stringify(obj.version)})`;
    fail(file, msg);
  }

  if (obj.agentOrder !== undefined || obj.planAgentOrder !== undefined || obj.patchModels !== undefined) {
    fail(
      file,
      `legacy keys found: "agentOrder", "planAgentOrder", and "patchModels" are no longer supported. Each entry in "modes.patch.agentOrder" / "modes.plan.agentOrder" now carries its own model: [{"agent": "claude", "model": "haiku"}, ...]. See spec/2026-05-14-cli-modes-and-config-v2/00-config-v2-modes.md for details.`,
    );
  }

  const modes = obj.modes;
  if (modes === null || typeof modes !== "object" || Array.isArray(modes)) {
    fail(file, 'modes must be an object with "patch" and "plan" keys');
  }
  const modesObj = modes as Record<string, unknown>;

  const patchMode = modesObj.patch;
  if (patchMode === null || typeof patchMode !== "object" || Array.isArray(patchMode)) {
    fail(file, 'modes.patch must be an object with "agentOrder" array');
  }
  const patchModeObj = patchMode as Record<string, unknown>;
  const patchAgentOrder = validateAgentOrder(patchModeObj.agentOrder, "modes.patch.agentOrder", file);
  validateNoModeAgents(patchModeObj.agents, "modes.patch", file);

  let patchPrNarrative: "template" | "agent" = "agent";
  if (patchModeObj.prNarrative !== undefined) {
    patchPrNarrative = validatePrNarrative(patchModeObj.prNarrative, "modes.patch.prNarrative", (message) =>
      fail(file, message),
    );
  }

  let patchShrink: "off" | "agent" = "agent";
  if (patchModeObj.shrink !== undefined) {
    patchShrink = validateShrink(patchModeObj.shrink, "modes.patch.shrink", (message) => fail(file, message));
  }

  let patchSubRoleAgentOrder: PatchSubRoleAgentOrder | undefined;
  if (patchModeObj.subRoleAgentOrder !== undefined) {
    patchSubRoleAgentOrder = validatePatchSubRoleAgentOrder(patchModeObj.subRoleAgentOrder, file);
  }

  const patchAllowedKeys = new Set(["agentOrder", "agents", "prNarrative", "shrink", "subRoleAgentOrder"]);
  for (const key of Object.keys(patchModeObj)) {
    if (!patchAllowedKeys.has(key)) {
      fail(file, `modes.patch: unknown key ${JSON.stringify(key)}`);
    }
  }

  const planMode = modesObj.plan;
  if (planMode === null || typeof planMode !== "object" || Array.isArray(planMode)) {
    fail(file, 'modes.plan must be an object with "agentOrder" array');
  }
  const planModeObj = planMode as Record<string, unknown>;
  const planAgentOrder = validateAgentOrder(planModeObj.agentOrder, "modes.plan.agentOrder", file);
  validateNoModeAgents(planModeObj.agents, "modes.plan", file);

  let planSpecTimestamp: boolean | undefined;
  if (planModeObj.specTimestamp !== undefined) {
    if (typeof planModeObj.specTimestamp !== "boolean") {
      fail(file, "modes.plan.specTimestamp must be a boolean");
    }
    planSpecTimestamp = planModeObj.specTimestamp;
  }

  let planCommit: boolean | undefined;
  if (planModeObj.commit !== undefined) {
    if (typeof planModeObj.commit !== "boolean") {
      fail(file, "modes.plan.commit must be a boolean");
    }
    planCommit = planModeObj.commit;
  }

  let planTargetDir: string | undefined;
  if (planModeObj.targetDir !== undefined) {
    planTargetDir = validateTargetDir(planModeObj.targetDir, "modes.plan.targetDir", (message) => fail(file, message));
  }

  let planPrNarrative: "template" | "agent" = "agent";
  if (planModeObj.prNarrative !== undefined) {
    planPrNarrative = validatePrNarrative(planModeObj.prNarrative, "modes.plan.prNarrative", (message) =>
      fail(file, message),
    );
  }

  let promptAgentOrder: AgentEntry[];
  const promptMode = modesObj.prompt;
  if (promptMode === undefined) {
    // Default to patch agent order if not specified
    promptAgentOrder = structuredClone(patchAgentOrder);
  } else {
    if (promptMode === null || typeof promptMode !== "object" || Array.isArray(promptMode)) {
      fail(file, 'modes.prompt must be an object with "agentOrder" array');
    }
    const promptModeObj = promptMode as Record<string, unknown>;
    promptAgentOrder = validateAgentOrder(promptModeObj.agentOrder, "modes.prompt.agentOrder", file);
    validateNoModeAgents(promptModeObj.agents, "modes.prompt", file);
  }

  const reviewMode = modesObj.review ?? DEFAULT_CONFIG.modes.review;
  if (reviewMode === null || typeof reviewMode !== "object" || Array.isArray(reviewMode)) {
    fail(file, 'modes.review must be an object with "passes" and optional "agentOrder"');
  }
  const reviewModeObj = reviewMode as Record<string, unknown>;
  let reviewAgentOrder: AgentEntry[] | undefined;
  if (reviewModeObj.agentOrder !== undefined) {
    reviewAgentOrder = validateAgentOrder(reviewModeObj.agentOrder, "modes.review.agentOrder", file);
  }
  validateNoModeAgents(reviewModeObj.agents, "modes.review", file);
  const reviewPasses = validateNonNegativeInteger(
    reviewModeObj.passes ?? DEFAULT_CONFIG.modes.review.passes,
    "modes.review.passes",
    (message) => fail(file, message),
  );

  const maxIterations = validatePositiveInteger(
    obj.maxIterations ?? DEFAULT_CONFIG.maxIterations,
    "maxIterations",
    (message) => fail(file, message),
  );
  const quotaFallback = validateQuotaFallback(obj.quotaFallback ?? DEFAULT_CONFIG.quotaFallback, (message) =>
    fail(file, message),
  );

  const weakQuotaExitCodes = validateExitCodeList(
    obj.weakQuotaExitCodes ?? DEFAULT_CONFIG.weakQuotaExitCodes,
    "weakQuotaExitCodes",
    (message) => fail(file, message),
  );

  const iterationTimeoutMs = validatePositiveInteger(
    obj.iterationTimeoutMs ?? DEFAULT_CONFIG.iterationTimeoutMs,
    "iterationTimeoutMs",
    (message) => fail(file, message),
  );

  const idleOutputTimeoutMs = validateNonNegativeIntegerWithZeroDisable(
    obj.idleOutputTimeoutMs ?? 600000,
    "idleOutputTimeoutMs",
    (message) => fail(file, message),
  );

  let runTimeoutMs: number | undefined;
  if (obj.runTimeoutMs !== undefined) {
    runTimeoutMs = validatePositiveInteger(obj.runTimeoutMs, "runTimeoutMs", (message) => fail(file, message));
  }

  const logServerUrl = validateConfigString(
    obj.logServerUrl ?? DEFAULT_CONFIG.logServerUrl,
    "logServerUrl",
    (message) => fail(file, message),
  );
  const logServerBind = validateConfigString(
    obj.logServerBind ?? DEFAULT_CONFIG.logServerBind,
    "logServerBind",
    (message) => fail(file, message),
  );
  const defaultTelemetryPath = join(resolve(file, ".."), "runs.jsonl");
  const telemetryPath = validateOptionalStringOrNull(
    obj.telemetryPath,
    "telemetryPath",
    defaultTelemetryPath,
    (message) => fail(file, message),
  );

  const git = validateOptionalBoolean(obj.git, "git", DEFAULT_CONFIG.git, (message) => fail(file, message));

  // Unknown top-level keys (e.g. v2's "machineProfile", "agents") are preserved
  // verbatim rather than validated or dropped, so v1 writes never destroy them.
  const KNOWN_TOP_LEVEL_KEYS = new Set([
    "version",
    "agentOrder",
    "planAgentOrder",
    "patchModels",
    "modes",
    "quotaFallback",
    "weakQuotaExitCodes",
    "maxIterations",
    "iterationTimeoutMs",
    "idleOutputTimeoutMs",
    "runTimeoutMs",
    "logServerUrl",
    "logServerBind",
    "telemetryPath",
    "git",
    "projects",
  ]);
  const unknownTopLevel: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      unknownTopLevel[key] = obj[key];
    }
  }

  const rawProjects = obj.projects;
  if (rawProjects === null || typeof rawProjects !== "object" || Array.isArray(rawProjects)) {
    fail(file, "projects must be an object");
  }

  const projects: Record<string, Project> = {};
  const seenRoots = new Map<string, string>();
  for (const [name, value] of Object.entries(rawProjects as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(file, `project ${JSON.stringify(name)} must be an object`);
    }
    const root = (value as Record<string, unknown>).root;
    if (typeof root !== "string") {
      fail(file, `project ${JSON.stringify(name)} is missing root`);
    }
    if (!isAbsolute(root)) {
      fail(file, `project ${JSON.stringify(name)} root must be an absolute path (got ${JSON.stringify(root)})`);
    }
    const existing = seenRoots.get(root);
    if (existing !== undefined) {
      fail(
        file,
        `duplicate project root ${JSON.stringify(root)} (used by ${JSON.stringify(existing)} and ${JSON.stringify(name)})`,
      );
    }
    seenRoots.set(root, name);
    const project: Project = { root };
    const originRaw = (value as Record<string, unknown>).origin;
    if (originRaw !== undefined) {
      if (typeof originRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} origin must be a string`);
      }
      if (originRaw.trim() === "") {
        fail(file, `project ${JSON.stringify(name)} origin must be a non-empty string`);
      }
      project.origin = originRaw;
    }
    const gitRaw = (value as Record<string, unknown>).git;
    if (gitRaw !== undefined) {
      if (typeof gitRaw !== "boolean") {
        fail(file, `project ${JSON.stringify(name)} git must be a boolean`);
      }
      project.git = gitRaw;
    }
    const siblingsRaw = (value as Record<string, unknown>).siblings;
    if (siblingsRaw !== undefined) {
      if (!Array.isArray(siblingsRaw)) {
        fail(file, `project ${JSON.stringify(name)} siblings must be an array`);
      }
      const siblings: string[] = [];
      for (let i = 0; i < siblingsRaw.length; i++) {
        const sibling = siblingsRaw[i];
        if (typeof sibling !== "string") {
          fail(file, `project ${JSON.stringify(name)} siblings[${i}] must be a string`);
        }
        if (sibling.trim() === "") {
          fail(file, `project ${JSON.stringify(name)} siblings[${i}] must be a non-empty string`);
        }
        if (!isAbsolute(sibling)) {
          fail(
            file,
            `project ${JSON.stringify(name)} siblings[${i}] must be an absolute path (got ${JSON.stringify(sibling)})`,
          );
        }
        siblings.push(sibling);
      }
      if (siblings.length > 0) {
        project.siblings = siblings;
      }
    }
    const planRaw = (value as Record<string, unknown>).plan;
    if (planRaw !== undefined) {
      if (planRaw === null || typeof planRaw !== "object" || Array.isArray(planRaw)) {
        fail(file, `project ${JSON.stringify(name)} plan must be an object`);
      }
      const planObj = planRaw as Record<string, unknown>;
      const plan: {
        specTimestamp?: boolean;
        commit?: boolean;
        targetDir?: string;
      } = {};
      const specTimestampRaw = planObj.specTimestamp;
      if (specTimestampRaw !== undefined) {
        if (typeof specTimestampRaw !== "boolean") {
          fail(file, `project ${JSON.stringify(name)} plan.specTimestamp must be a boolean`);
        }
        plan.specTimestamp = specTimestampRaw;
      }
      const commitRaw = planObj.commit;
      if (commitRaw !== undefined) {
        if (typeof commitRaw !== "boolean") {
          fail(file, `project ${JSON.stringify(name)} plan.commit must be a boolean`);
        }
        plan.commit = commitRaw;
      }
      const targetDirRaw = planObj.targetDir;
      if (targetDirRaw !== undefined) {
        plan.targetDir = validateTargetDir(targetDirRaw, `project ${JSON.stringify(name)} plan.targetDir`, (message) =>
          fail(file, message),
        );
      }
      // Strict keys validation for plan object
      const allowedPlanKeys = new Set(["specTimestamp", "commit", "targetDir"]);
      for (const key of Object.keys(planObj)) {
        if (!allowedPlanKeys.has(key)) {
          fail(
            file,
            `project ${JSON.stringify(name)} plan: unknown key ${JSON.stringify(key)} (allowed: specTimestamp, commit, targetDir)`,
          );
        }
      }
      if (Object.keys(plan).length > 0) {
        project.plan = plan;
      }
    }
    const updateSnapshotsCommandRaw = (value as Record<string, unknown>).updateSnapshotsCommand;
    if (updateSnapshotsCommandRaw !== undefined) {
      if (typeof updateSnapshotsCommandRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} updateSnapshotsCommand must be a string`);
      }
      if (updateSnapshotsCommandRaw.trim() === "") {
        fail(file, `project ${JSON.stringify(name)} updateSnapshotsCommand must be a non-empty string`);
      }
      project.updateSnapshotsCommand = updateSnapshotsCommandRaw;
    }
    const readyCommandRaw = (value as Record<string, unknown>).readyCommand;
    if (readyCommandRaw !== undefined) {
      if (typeof readyCommandRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} readyCommand must be a string`);
      }
      if (readyCommandRaw.trim() === "") {
        fail(file, `project ${JSON.stringify(name)} readyCommand must be a non-empty string`);
      }
      project.readyCommand = readyCommandRaw;
    }
    const fixCommandRaw = (value as Record<string, unknown>).fixCommand;
    if (fixCommandRaw !== undefined) {
      if (typeof fixCommandRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} fixCommand must be a string`);
      }
      if (fixCommandRaw.trim() === "") {
        fail(file, `project ${JSON.stringify(name)} fixCommand must be a non-empty string`);
      }
      project.fixCommand = fixCommandRaw;
    }
    const installCommandRaw = (value as Record<string, unknown>).installCommand;
    if (installCommandRaw !== undefined) {
      if (typeof installCommandRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} installCommand must be a string`);
      }
      if (installCommandRaw.trim() === "") {
        fail(file, `project ${JSON.stringify(name)} installCommand must be a non-empty string`);
      }
      project.installCommand = installCommandRaw;
    }
    const readyGateRetryBoundRaw = (value as Record<string, unknown>).readyGateRetryBound;
    if (readyGateRetryBoundRaw !== undefined) {
      project.readyGateRetryBound = validateNonNegativeInteger(
        readyGateRetryBoundRaw,
        `project ${JSON.stringify(name)} readyGateRetryBound`,
        (message) => fail(file, message),
      );
    }
    // Strict keys validation for project object
    const allowedProjectKeys = new Set([
      "root",
      "origin",
      "git",
      "siblings",
      "plan",
      "updateSnapshotsCommand",
      "readyCommand",
      "fixCommand",
      "readyGateRetryBound",
      "installCommand",
    ]);
    const projectObj = value as Record<string, unknown>;
    for (const key of Object.keys(projectObj)) {
      if (!allowedProjectKeys.has(key)) {
        // Check if this is a known mis-nesting (specTimestamp or commit at project level)
        if (key === "specTimestamp" || key === "commit") {
          fail(
            file,
            `project ${JSON.stringify(name)}: unknown key ${JSON.stringify(key)}; did you mean ${JSON.stringify(`plan.${key}`)}?`,
          );
        }
        fail(
          file,
          `project ${JSON.stringify(name)}: unknown key ${JSON.stringify(key)} (allowed: root, origin, git, siblings, plan, updateSnapshotsCommand, readyCommand, fixCommand, readyGateRetryBound, installCommand)`,
        );
      }
    }
    projects[name] = project;
  }

  return {
    ...unknownTopLevel,
    version: 2,
    modes: {
      patch: {
        agentOrder: patchAgentOrder,
        prNarrative: patchPrNarrative,
        shrink: patchShrink,
        ...(patchSubRoleAgentOrder !== undefined ? { subRoleAgentOrder: patchSubRoleAgentOrder } : {}),
      },
      plan: {
        agentOrder: planAgentOrder,
        prNarrative: planPrNarrative,
        ...(planSpecTimestamp !== undefined ? { specTimestamp: planSpecTimestamp } : {}),
        ...(planCommit !== undefined ? { commit: planCommit } : {}),
        ...(planTargetDir !== undefined ? { targetDir: planTargetDir } : {}),
      },
      prompt: { agentOrder: promptAgentOrder },
      review: {
        passes: reviewPasses,
        ...(reviewAgentOrder !== undefined ? { agentOrder: reviewAgentOrder } : {}),
      },
    },
    quotaFallback,
    weakQuotaExitCodes,
    maxIterations,
    iterationTimeoutMs,
    ...(idleOutputTimeoutMs !== 600000 ? { idleOutputTimeoutMs } : {}),
    ...(runTimeoutMs !== undefined ? { runTimeoutMs } : {}),
    logServerUrl,
    logServerBind,
    ...(telemetryPath === undefined ? {} : { telemetryPath }),
    git,
    projects,
  };
}

function validateAgentOrder(input: unknown, fieldName: string, file: string): AgentEntry[] {
  if (!Array.isArray(input)) {
    fail(file, `${fieldName} must be an array`);
  }
  if (input.length === 0) {
    fail(file, `${fieldName} must be a non-empty array`);
  }
  const agentOrder: AgentEntry[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      fail(file, `${fieldName}[${i}] must be an object with "agent" and "model"`);
    }
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (key !== "agent" && key !== "model") {
        fail(file, `${fieldName}[${i}]: unknown key ${JSON.stringify(key)}`);
      }
    }
    if (typeof entry.agent !== "string" || !isAgentName(entry.agent)) {
      fail(
        file,
        `${fieldName}[${i}].agent: unknown agent ${JSON.stringify(entry.agent)} (allowed: ${AGENT_NAMES.join(", ")})`,
      );
    }
    if (typeof entry.model !== "string" || entry.model.trim() === "") {
      fail(file, `${fieldName}[${i}].model must be a non-empty string`);
    }
    agentOrder.push({ agent: entry.agent, model: entry.model });
  }
  const validationError = validateAgentOrderEntries(agentOrder, fieldName);
  if (validationError !== null) {
    fail(file, validationError);
  }
  return agentOrder;
}

function validatePatchSubRoleAgentOrder(input: unknown, file: string): PatchSubRoleAgentOrder {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail(file, "modes.patch.subRoleAgentOrder must be an object");
  }

  const raw = input as Record<string, unknown>;
  const allowedKeys = ["reviewPanel", "reviewActuator"] as const;
  const allowedKeySet = new Set<string>(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowedKeySet.has(key)) {
      fail(
        file,
        `modes.patch.subRoleAgentOrder: unknown key ${JSON.stringify(key)} (allowed: ${allowedKeys.join(", ")})`,
      );
    }
  }

  const subRoleAgentOrder: PatchSubRoleAgentOrder = {};
  for (const key of allowedKeys) {
    const value = raw[key];
    if (value !== undefined) {
      subRoleAgentOrder[key] = validateAgentOrder(value, `modes.patch.subRoleAgentOrder.${key}`, file);
    }
  }
  return subRoleAgentOrder;
}

function validateNoModeAgents(input: unknown, fieldName: string, file: string): void {
  if (input === undefined) {
    return;
  }

  fail(file, `${fieldName}.agents is no longer supported; configure agents through ${fieldName}.agentOrder`);
}

export function validatePositiveInteger(
  value: unknown,
  name: string,
  failWith: (message: string) => never = (message) => {
    throw new Error(message);
  },
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    failWith(`${name} must be a positive integer`);
  }
  return value;
}

export function validateNonNegativeInteger(
  value: unknown,
  name: string,
  failWith: (message: string) => never = (message) => {
    throw new Error(message);
  },
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    failWith(`${name} must be a non-negative integer`);
  }
  return value;
}

function validateNonNegativeIntegerWithZeroDisable(
  value: unknown,
  name: string,
  failWith: (message: string) => never = (message) => {
    throw new Error(message);
  },
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    failWith(`${name} must be a non-negative integer (0 to disable)`);
  }
  return value;
}

function validateConfigString(value: unknown, name: string, failWith: (message: string) => never): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failWith(`${name} must be a non-empty string`);
  }
  return value;
}

function validateOptionalStringOrNull(
  value: unknown,
  name: string,
  fallback: string | null | undefined,
  failWith: (message: string) => never,
): string | null | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    failWith(`${name} must be a non-empty string or null`);
  }
  return value;
}

function validateOptionalBoolean(
  value: unknown,
  name: string,
  fallback: boolean,
  failWith: (message: string) => never,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    failWith(`${name} must be a boolean`);
  }
  return value;
}

function validateQuotaFallback(value: unknown, failWith: (message: string) => never): "strict" | "lenient" {
  if (value === "strict" || value === "lenient") {
    return value;
  }
  failWith('quotaFallback must be "strict" or "lenient"');
}

function validatePrNarrative(value: unknown, name: string, failWith: (message: string) => never): "template" | "agent" {
  if (value === "template" || value === "agent") {
    return value;
  }
  failWith(`${name} must be "template" or "agent"`);
}

function validateShrink(value: unknown, name: string, failWith: (message: string) => never): "off" | "agent" {
  if (value === "off" || value === "agent") {
    return value;
  }
  failWith(`${name} must be "off" or "agent"`);
}

export function validateTargetDir(value: unknown, name: string, failWith: (message: string) => never): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failWith(`${name} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) {
    failWith(`${name} must be a relative path (got ${JSON.stringify(trimmed)})`);
  }
  if (trimmed.includes("..")) {
    failWith(`${name} must not contain ".." traversal (got ${JSON.stringify(trimmed)})`);
  }
  return trimmed;
}

function validateExitCodeList(value: unknown, name: string, failWith: (message: string) => never): number[] {
  if (!Array.isArray(value)) {
    failWith(`${name} must be an array of integers`);
  }
  const result: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || !Number.isFinite(entry)) {
      failWith(`${name} entries must be integers (got ${JSON.stringify(entry)})`);
    }
    result.push(entry);
  }
  return result;
}

function serialize(cfg: Config): string {
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function loadConfig(opts?: ConfigOptions): Config {
  const { dir, file } = resolvePaths(opts);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const cfg = withOptionOverrides(
      {
        ...structuredClone(DEFAULT_CONFIG),
        telemetryPath: join(dir, "runs.jsonl"),
      },
      opts,
    );
    atomicWriteSync(file, serialize(cfg));
    return cfg;
  }
  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(file, `not valid JSON (${(err as Error).message})`);
  }
  return withOptionOverrides(validateConfig(parsed, file), opts);
}

function withOptionOverrides(cfg: Config, opts?: ConfigOptions): Config {
  if (opts?.maxIterations === undefined) {
    return cfg;
  }
  return {
    ...cfg,
    maxIterations: validatePositiveInteger(opts.maxIterations, "maxIterations"),
  };
}

export function writeConfig(cfg: Config, opts?: ConfigOptions): void {
  const { dir, file } = resolvePaths(opts);
  const validated = validateConfig(cfg, file);
  mkdirSync(dir, { recursive: true });
  atomicWriteSync(file, serialize(validated));
}

export function registerProject(name: string, root: string, opts?: ConfigOptions & { origin?: string }): void {
  if (!isAbsolute(root)) {
    throw new Error(`Project root must be absolute: ${root}`);
  }
  const cfg = loadConfig(opts);
  for (const [existingName, project] of Object.entries(cfg.projects)) {
    if (project.root === root && existingName !== name) {
      throw new Error(`Project root ${root} is already registered as ${JSON.stringify(existingName)}`);
    }
  }
  // Preserve existing project if re-registering the same name
  const existing = cfg.projects[name];
  const project: Project = existing ? { ...existing } : { root };

  // Always overwrite root with the new value
  project.root = root;

  // Only overwrite origin if the caller supplied a non-empty origin
  if (opts?.origin !== undefined && opts.origin.trim() !== "") {
    project.origin = opts.origin;
  }

  cfg.projects[name] = project;
  writeConfig(cfg, opts);
}

export function setProjectOrigin(name: string, origin: string, opts?: ConfigOptions): void {
  const cfg = loadConfig(opts);
  const project = cfg.projects[name];
  if (project === undefined) {
    throw new Error(`Project ${JSON.stringify(name)} is not registered`);
  }
  cfg.projects[name] = { ...project, origin };
  writeConfig(cfg, opts);
}

export function setGit(value: boolean, opts?: ConfigOptions): void {
  const cfg = loadConfig(opts);
  cfg.git = value;
  writeConfig(cfg, opts);
}

export function setProjectGit(name: string, value: boolean | undefined, opts?: ConfigOptions): void {
  const cfg = loadConfig(opts);
  const project = cfg.projects[name];
  if (project === undefined) {
    throw new Error(`Project ${JSON.stringify(name)} is not registered`);
  }
  const next: Project = { ...project };
  if (value !== undefined) {
    next.git = value;
  } else {
    delete next.git;
  }
  cfg.projects[name] = next;
  writeConfig(cfg, opts);
}

export function effectiveGit(cfg: Config, projectName?: string): boolean {
  if (projectName !== undefined) {
    const project = cfg.projects[projectName];
    if (project !== undefined && project.git !== undefined) {
      return project.git;
    }
  }
  return cfg.git;
}

export function resolvePlanFlags(
  cfg: Config,
  project: Project | undefined,
): { specTimestamp: boolean; commit: boolean; targetDir: string } {
  const globalPlan = cfg.modes?.plan;
  const projectPlan = project?.plan;
  return {
    specTimestamp: projectPlan?.specTimestamp ?? globalPlan?.specTimestamp ?? true,
    commit: projectPlan?.commit ?? globalPlan?.commit ?? true,
    targetDir: projectPlan?.targetDir ?? globalPlan?.targetDir ?? "spec",
  };
}

export function resolveReviewPasses(cfg: Config, cliOverride?: number): number {
  if (cliOverride !== undefined) {
    return cliOverride;
  }
  return cfg.modes.review.passes;
}

export function resolveReviewAgentOrder(cfg: Config): AgentEntry[] {
  if (cfg.modes.review.agentOrder !== undefined) {
    return cfg.modes.review.agentOrder;
  }
  return cfg.modes.plan.agentOrder;
}

export function resolveSubRoleAgentOrder(cfg: Config, subRole: PatchSubRole): AgentEntry[] {
  const override = cfg.modes.patch.subRoleAgentOrder?.[subRole];
  if (override !== undefined) {
    return override;
  }
  switch (subRole) {
    case "reviewPanel":
      return resolveReviewAgentOrder(cfg);
    case "reviewActuator":
      return cfg.modes.patch.agentOrder;
  }
}

export function findProjectForPath(p: string, opts?: ConfigOptions): Project | undefined {
  const match = findProjectMatchForPath(p, opts);
  if (match === undefined) {
    return undefined;
  }
  const cfg = loadConfig(opts);
  const project: Project = { root: match.root };
  if (match.origin !== undefined) {
    project.origin = match.origin;
  }
  const full = cfg.projects[match.key];
  if (full?.plan !== undefined) {
    project.plan = full.plan;
  }
  return project;
}

export function findProjectMatchForPath(p: string, opts?: ConfigOptions): ProjectMatch | undefined {
  const target = resolve(p);
  const cfg = loadConfig(opts);
  let best: ProjectMatch | undefined;
  let bestLen = -1;
  for (const [key, project] of Object.entries(cfg.projects)) {
    const root = project.root;
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (target === root || target.startsWith(prefix)) {
      if (root.length > bestLen) {
        const match: ProjectMatch = { key, root };
        if (project.origin !== undefined) {
          match.origin = project.origin;
        }
        best = match;
        bestLen = root.length;
      }
    }
  }
  return best;
}

export function openSessionLog(namespace: string, timestamp: string, opts?: ConfigOptions): number {
  const sessionsDir = resolveSessionsDir(opts);
  mkdirSync(sessionsDir, { recursive: true });
  return openSync(join(sessionsDir, `${namespace}-${timestamp}.log`), "a");
}
