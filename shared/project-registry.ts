import { resolve, sep } from "node:path";

export type ProjectRegistryEntry = { root: string; origin?: string };

export type ProjectMatch = {
  key: string;
  root: string;
  origin?: string;
};

/** Longest-root-prefix match of a path against the project registry. */
export function findProjectMatch(p: string, projects: Record<string, ProjectRegistryEntry>): ProjectMatch | undefined {
  const target = resolve(p);
  let best: ProjectMatch | undefined;
  let bestLen = -1;
  for (const [key, project] of Object.entries(projects)) {
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
