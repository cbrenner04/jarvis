import { existsSync, realpathSync, unlinkSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/**
 * Consume source files from a publication workspace without following an
 * escaped source or target path. Stale inputs are deliberately best-effort.
 */
export function consumePublicationInputs(args: {
  sourceRoot: string;
  publicationRoot: string;
  inputPaths: readonly string[];
}): string[] {
  let sourceRoot: string;
  let publicationRoot: string;
  try {
    sourceRoot = realpathSync(args.sourceRoot);
    publicationRoot = realpathSync(args.publicationRoot);
  } catch {
    return [];
  }

  const consumed: string[] = [];
  for (const inputPath of args.inputPaths) {
    let sourcePath: string;
    try {
      sourcePath = realpathSync(inputPath);
    } catch {
      continue;
    }
    if (!isInside(sourceRoot, sourcePath)) continue;

    const targetPath = resolve(publicationRoot, relative(sourceRoot, sourcePath));
    if (!isInside(publicationRoot, targetPath) || !existsSync(targetPath)) continue;

    let canonicalTarget: string;
    try {
      canonicalTarget = realpathSync(targetPath);
    } catch {
      continue;
    }
    if (!isInside(publicationRoot, canonicalTarget)) continue;

    try {
      unlinkSync(targetPath);
      consumed.push(inputPath);
    } catch {
      // Publication already succeeded; an unconsumable queue entry is harmless.
    }
  }
  return consumed;
}
