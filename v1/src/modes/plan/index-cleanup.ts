import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Strip non-contract lines from index.md.
 * Retains only: H1 title, subspec checklist items (matching parseIndex grammar), and blank lines.
 * No-ops when index.md is absent.
 * Skips write when content is unchanged.
 * Emits stderr notice when ≥1 lines are removed.
 */
export function stripNonContractIndexLines(args: { specDirPath: string; stderr?: (s: string) => void }): void {
  const indexPath = join(args.specDirPath, "index.md");
  if (!existsSync(indexPath)) {
    return; // No-op when index.md is absent
  }

  const content = readFileSync(indexPath, "utf8");
  const normalized = content.replace(/\r\n/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");

  // Split but preserve all lines including the final empty one from split if there's a trailing newline
  const allLines = normalized.split("\n");

  // If there's a trailing newline, the split creates an empty string at the end; remove it temporarily
  if (endsWithNewline && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }

  const retained: string[] = [];
  let removedCount = 0;

  for (const rawLine of allLines) {
    // Retain H1 heading
    if (/^#\s+.+/.test(rawLine)) {
      retained.push(rawLine);
      continue;
    }

    // Retain checklist items (matches parseIndex's grammar)
    if (/^\s*-\s+\[( |x|X)\]\s+\[.+?\]\((.+?)\)/.test(rawLine)) {
      retained.push(rawLine);
      continue;
    }

    // Retain blank lines
    if (rawLine.trim() === "") {
      retained.push(rawLine);
      continue;
    }

    // All other lines are removed
    removedCount += 1;
  }

  // Reconstruct the content
  let cleanedContent = retained.join("\n");
  if (endsWithNewline) {
    cleanedContent += "\n";
  }

  // Skip write if content is unchanged
  if (cleanedContent === content) {
    return;
  }

  // Write the cleaned content
  writeFileSync(indexPath, cleanedContent, "utf8");

  // Emit stderr notice if lines were removed
  if (removedCount > 0) {
    args.stderr?.(`plan: stripped ${removedCount} non-contract line(s) from index.md\n`);
  }
}
