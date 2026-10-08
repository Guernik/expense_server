import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePack } from "@denarii/core";
import { parseDotenv, parseImportArgs } from "./args";
import { type D1Target, runImport } from "./import-command";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLOUDFLARE_APP = join(ROOT, "apps/cloudflare");
const RULES = join(ROOT, "rules");

/** Runs SQL statements as one file through wrangler, against the app's `DB` binding. */
async function executeWithWrangler(statements: string[], target: D1Target): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "denarii-import-"));
  const file = join(dir, "import.sql");
  try {
    await writeFile(file, `${statements.join("\n")}\n`);
    const result = spawnSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", `--${target}`, `--file=${file}`, "--yes"],
      { cwd: CLOUDFLARE_APP, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`wrangler exited with ${result.status}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Processor prefixes stripped by the bundled rule packs, so imported merchants match live ones. */
function bundledStripPrefixes(): string[] {
  const prefixes = new Set<string>();
  for (const country of readdirSync(RULES, { withFileTypes: true })) {
    if (!country.isDirectory() || country.name === "node_modules") continue;
    for (const file of readdirSync(join(RULES, country.name))) {
      if (!file.endsWith(".yaml")) continue;
      const name = `${country.name}.${file.replace(/\.yaml$/, "")}`;
      const pack = parsePack(name, readFileSync(join(RULES, country.name, file), "utf8"));
      for (const rule of pack.rules) {
        for (const prefix of rule.transform.strip_prefixes ?? []) prefixes.add(prefix);
      }
    }
  }
  return [...prefixes];
}

function devVars(): Record<string, string> {
  const path = join(CLOUDFLARE_APP, ".dev.vars");
  return existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : {};
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseImportArgs(argv, { ...devVars(), ...process.env });
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const { args } = parsed;
  // npm runs workspace scripts in the package directory; resolve paths from where it was called.
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), args.file);
  return runImport(
    {
      file,
      target: args.target,
      dryRun: args.dryRun,
      user: { telegramChatId: args.chatId, locale: args.locale, timezone: args.timezone },
      stripPrefixes: bundledStripPrefixes(),
    },
    {
      readFile: (path) => readFile(path, "utf8"),
      execute: executeWithWrangler,
      log: (message) => console.log(message),
      error: (message) => console.error(message),
    },
  );
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
