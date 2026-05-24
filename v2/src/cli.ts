import packageJson from "../../package.json";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export function main(argv: readonly string[], io?: Io): number {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };

  if (argv.length === 1 && argv[0] === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  out.stdout("v2 not ready\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
