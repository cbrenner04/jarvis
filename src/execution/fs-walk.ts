import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Absolute paths of every `.md` file under `dir` (recursive); an absent `dir` yields none. */
export function listMarkdownFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFilesRecursive(path));
    else if (entry.isFile() && path.endsWith(".md")) files.push(path);
  }
  return files;
}

/** Root-relative POSIX paths of every file under `root`, skipping directories named in `excludeDirs`. */
export function listRelativeFiles(
  root: string,
  excludeDirs: ReadonlySet<string>,
  dir = root,
  out: string[] = [],
): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listRelativeFiles(root, excludeDirs, full, out);
    else if (entry.isFile()) out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out;
}
