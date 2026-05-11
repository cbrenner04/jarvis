import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export function commitSubspec(subspecPath: string): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const indexPath = getIndexPath(subspecPath);
  const indexContent = readFileSync(indexPath, "utf8");

  const h1 = extractH1(subspecContent);
  if (!h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  const acceptanceCriteria = extractAcceptanceCriteria(subspecContent);
  if (!acceptanceCriteria) {
    throw new Error(
      `Subspec ${subspecPath} is missing ## Acceptance criteria section`,
    );
  }

  const subspecName = basename(subspecPath);
  const updatedIndexContent = updateIndexCheckbox(indexContent, subspecName);
  writeFileSync(indexPath, updatedIndexContent);

  execSync("git add -A", { stdio: "pipe" });

  const relativeSpecPath = relative(process.cwd(), subspecPath);
  const bodyFirstLine = `Spec: ${relativeSpecPath}`;
  const commitBody = `${bodyFirstLine}\n\n${acceptanceCriteria}`;

  const command = `git commit -m "$(cat <<'EOF'\n${h1}\n\n${commitBody}\nEOF\n)"`;
  execSync(command, { shell: "/bin/bash", stdio: "pipe" });
}

function getIndexPath(subspecPath: string): string {
  const dir = dirname(subspecPath);
  return `${dir}/index.md`;
}

function basename(path: string): string {
  return path.split("/").pop() || "";
}

function extractH1(content: string): string | null {
  const match = content.match(/^# (.+)$/m);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractAcceptanceCriteria(content: string): string | null {
  const match = content.match(
    /^## Acceptance criteria\n\n([\s\S]+?)(?=\n## |Z)/m,
  );
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function updateIndexCheckbox(content: string, subspecName: string): string {
  const escapedName = subspecName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^- \\[ \\] \\[(.+?)\\]\\(\\./${escapedName}\\)$`,
    "m",
  );
  return content.replace(pattern, (_match, linkText: string) => {
    return `- [x] [${linkText}](./${subspecName})`;
  });
}
