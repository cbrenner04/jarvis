import { execSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
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

  const gitRoot = getGitRoot(subspecPath);
  execSync("git add -A", { cwd: gitRoot, stdio: "pipe" });

  const relativeSpecPath = relative(
    realpathSync(gitRoot),
    realpathSync(subspecPath),
  );
  const bodyFirstLine = `Spec: ${relativeSpecPath}`;
  const commitBody = `${bodyFirstLine}\n\n${acceptanceCriteria}`;
  const commitMessage = `${h1}\n\n${commitBody}`;

  execSync(
    `git commit -F - <<'JARVIS_COMMIT_MESSAGE'\n${commitMessage}\nJARVIS_COMMIT_MESSAGE\n`,
    { cwd: gitRoot, shell: "/bin/bash", stdio: "pipe" },
  );
}

function getGitRoot(subspecPath: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dirname(subspecPath),
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not find git root for ${subspecPath}: ${message}`);
  }
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
    /(?:^|\n)## Acceptance criteria\b[\s\S]*?(?=\n## |$)/,
  );
  if (!match?.[0]) {
    return null;
  }
  return match[0].trim();
}

function updateIndexCheckbox(content: string, subspecName: string): string {
  const escapedName = subspecName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uncheckedPattern = new RegExp(
    `^- \\[ \\] \\[(.+?)\\]\\(\\./${escapedName}\\)$`,
    "m",
  );
  if (uncheckedPattern.test(content)) {
    return content.replace(uncheckedPattern, (_match, linkText: string) => {
      return `- [x] [${linkText}](./${subspecName})`;
    });
  }

  const checkedPattern = new RegExp(
    `^- \\[[xX]\\] \\[(.+?)\\]\\(\\./${escapedName}\\)$`,
    "m",
  );
  if (checkedPattern.test(content)) {
    return content;
  }

  throw new Error(`index.md does not link to ${subspecName}`);
}
