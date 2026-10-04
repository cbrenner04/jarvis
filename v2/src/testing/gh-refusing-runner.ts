import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";

/** Real subprocess runner that rejects any `gh` call, so an unmocked `gh` fails deterministically instead of reaching the ambient CLI. */
export const ghRefusingRealRunner: AsyncSubprocessRunner = {
  runAsync: (cmd, args, cwd, options) =>
    cmd === "gh"
      ? Promise.reject(new Error(`unmocked gh call: gh ${args.join(" ")}`))
      : realAsyncSubprocessRunner.runAsync(cmd, args, cwd, options),
};
