import { readFileSync } from "node:fs";

const blockerHeaderPattern = /^## Blocker$/m;

export function hasBlocker(subspecPath: string): boolean {
  const content = readFileSync(subspecPath, "utf8");
  return blockerHeaderPattern.test(content);
}

export function extractBlockerBody(subspecPath: string): string | null {
  const content = readFileSync(subspecPath, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blockerIndex = lines.findIndex((line) => line === "## Blocker");
  if (blockerIndex === -1) {
    return null;
  }

  const bodyLines: string[] = [];
  for (let i = blockerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^##\s+/.test(line)) {
      break;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();
  return body.length === 0 ? null : body;
}
