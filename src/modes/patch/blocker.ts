import { readFileSync, writeFileSync } from "node:fs";

export function recordBlocker(subspecPath: string, reason: string): void {
  const content = readFileSync(subspecPath, "utf8");

  if (content.includes("## Blocker")) {
    return;
  }

  const updatedContent = `${content}\n## Blocker\n\n${reason}\n`;
  writeFileSync(subspecPath, updatedContent);
}

export function commitBlocker(subspecPath: string, reason: string): void {
  recordBlocker(subspecPath, reason);

  const { execSync } = require("node:child_process");

  const h1 = extractH1(subspecPath);

  execSync("git add -A", { stdio: "pipe" });

  const relativeSpecPath = subspecPath.split("/").slice(-2).join("/");
  const commitMessage = `WIP: ${h1}\n\nSpec: ${relativeSpecPath}\n\n## Blocker\n\n${reason}`;

  const command = `git commit -m "$(cat <<'EOF'\n${commitMessage}\nEOF\n)"`;
  execSync(command, { shell: "/bin/bash", stdio: "pipe" });
}

function extractH1(subspecPath: string): string {
  const content = readFileSync(subspecPath, "utf8");
  const match = content.match(/^# (.+)$/m);
  if (!match?.[1]) {
    return "Unknown";
  }
  return match[1].trim();
}
