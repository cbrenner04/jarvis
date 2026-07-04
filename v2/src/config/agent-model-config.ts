import { readFileSync } from "node:fs";

type Role = "plan" | "implement" | "adversary" | "advocate" | "adjudicator" | "actuator";
const REQUIRED_ROLES: readonly Role[] = ["plan", "implement", "adversary", "advocate", "adjudicator", "actuator"];

export type Model = {
  readonly adapterModel: string;
  readonly priceKey: string;
};

export type ModelEscalation = {
  readonly rungs: readonly Model[];
};

export type ModelsByRole = Partial<Record<Role | "operator", ModelEscalation>>;

export type AgentModelConfig = Record<string, ModelsByRole | undefined>;

export type LoadError = {
  readonly errors: readonly string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function loadAgentModelConfig(
  filePath: string,
  agents: readonly string[],
): AgentModelConfig | LoadError {
  const errors: string[] = [];

  // Check for duplicate agent names
  const agentSet = new Set<string>();
  for (const agent of agents) {
    if (agentSet.has(agent)) {
      errors.push(`duplicate agent name: ${agent}`);
    }
    agentSet.add(agent);
  }

  let jsonData: unknown;
  try {
    const raw = readFileSync(filePath, "utf-8");
    jsonData = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      errors.push(`malformed JSON in ${filePath}: ${err.message}`);
    } else if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      errors.push(`file not found: ${filePath}`);
    } else {
      errors.push(`failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { errors };
  }

  // Check for object top level
  if (!isObject(jsonData)) {
    errors.push("config file must be a JSON object");
    return { errors };
  }

  const config: Record<string, ModelsByRole> = {};

  // Validate each project-configured agent
  for (const agent of agents) {
    const agentEntry = jsonData[agent];

    // Check if agent has an entry (agent present in file but not required by project is OK)
    if (agentEntry === undefined) {
      errors.push(`missing agent entry: ${agent}`);
      continue;
    }

    // Check if agent entry is an object
    if (!isObject(agentEntry)) {
      errors.push(`agent ${agent}: value must be an object`);
      continue;
    }

    const modelsByRole: ModelsByRole = {};

    // Validate required roles
    for (const role of REQUIRED_ROLES) {
      const roleEntry = agentEntry[role];

      if (roleEntry === undefined) {
        errors.push(`agent ${agent}: missing required role ${role}`);
        continue;
      }

      if (!isObject(roleEntry)) {
        errors.push(`agent ${agent}, role ${role}: value must be an object`);
        continue;
      }

      const rungs = roleEntry.rungs;

      // Check rungs existence and type
      if (rungs === undefined) {
        errors.push(`agent ${agent}, role ${role}: missing rungs`);
        continue;
      }

      if (!isArray(rungs)) {
        errors.push(`agent ${agent}, role ${role}: rungs must be an array`);
        continue;
      }

      if (rungs.length === 0) {
        errors.push(`agent ${agent}, role ${role}: rungs must not be empty`);
        continue;
      }

      // Validate each rung
      const validRungs: Model[] = [];
      let hasRungErrors = false;
      for (let i = 0; i < rungs.length; i++) {
        const rung = rungs[i];

        if (!isObject(rung)) {
          errors.push(`agent ${agent}, role ${role}, rung ${i}: value must be an object`);
          hasRungErrors = true;
          continue;
        }

        const adapterModel = rung.adapterModel;
        const priceKey = rung.priceKey;

        if (adapterModel === undefined) {
          errors.push(`agent ${agent}, role ${role}, rung ${i}: missing adapterModel`);
          hasRungErrors = true;
        } else if (!isString(adapterModel)) {
          errors.push(`agent ${agent}, role ${role}, rung ${i}: adapterModel must be a string`);
          hasRungErrors = true;
        }

        if (priceKey === undefined) {
          errors.push(`agent ${agent}, role ${role}, rung ${i}: missing priceKey`);
          hasRungErrors = true;
        } else if (!isString(priceKey)) {
          errors.push(`agent ${agent}, role ${role}, rung ${i}: priceKey must be a string`);
          hasRungErrors = true;
        }

        if (!hasRungErrors && isString(adapterModel) && isString(priceKey)) {
          validRungs.push({ adapterModel, priceKey });
        }
      }

      if (validRungs.length > 0) {
        modelsByRole[role] = { rungs: validRungs };
      }
    }

    // Handle optional operator role (ignore if present, not an error if missing)
    const operatorEntry = agentEntry.operator;
    if (operatorEntry !== undefined) {
      if (isObject(operatorEntry)) {
        const rungs = operatorEntry.rungs;
        if (isArray(rungs) && rungs.length > 0) {
          const validRungs: Model[] = [];
          for (let i = 0; i < rungs.length; i++) {
            const rung = rungs[i];
            if (
              isObject(rung) &&
              isString(rung.adapterModel) &&
              isString(rung.priceKey)
            ) {
              validRungs.push({
                adapterModel: rung.adapterModel,
                priceKey: rung.priceKey,
              });
            }
          }
          if (validRungs.length > 0) {
            modelsByRole.operator = { rungs: validRungs };
          }
        }
      }
    }

    config[agent] = modelsByRole;
  }

  if (errors.length > 0) {
    return { errors };
  }

  return config;
}
