/** Shared helpers for CLI scripts (run via `npm run cli:*`). */
import * as readline from "node:readline";

export function parseArgs(argv: string[]): { flags: Record<string, string>; booleans: Set<string> } {
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      flags[arg.slice(2)] = argv[++i]!;
    } else {
      booleans.add(arg.slice(2));
    }
  }
  return { flags, booleans };
}

/** Apply --data-root before any app module reads the environment. */
export function applyDataRootFlag(flags: Record<string, string>): void {
  if (flags["data-root"]) {
    process.env.DATA_ROOT = flags["data-root"];
  }
}

/** Prompt for a password without echoing it to the terminal. */
export function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlInternal = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = rlInternal._writeToOutput.bind(rl);
    rlInternal._writeToOutput = (s: string) => {
      // Echo nothing while the secret is being typed (keep newlines).
      original(s.includes("\n") ? s : "");
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new Error("Aborted"));
    });
  });
}

export function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(2);
  }
  return value;
}
