import { basename } from "node:path";
import { parseImportFile, planImport, type User } from "@denarii/core";
import { buildImportSql } from "@denarii/db";

export type D1Target = "local" | "remote";

export interface ImportOptions {
  file: string;
  target: D1Target;
  /** Validate and report without writing. */
  dryRun: boolean;
  user: Omit<User, "id">;
  stripPrefixes: readonly string[];
}

export interface ImportDeps {
  readFile(path: string): Promise<string>;
  /** Runs the statements against D1 in one file. Throws on failure. */
  execute(statements: string[], target: D1Target): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}

/** `denarii import <file.json|file.csv>` (SPEC §10). Returns the exit code. */
export async function runImport(options: ImportOptions, deps: ImportDeps): Promise<number> {
  const name = basename(options.file);
  const parsed = parseImportFile(name, await deps.readFile(options.file));
  const planned = parsed.ok
    ? planImport(parsed.rows, {
        timezone: options.user.timezone,
        stripPrefixes: options.stripPrefixes,
      })
    : parsed;
  if (!planned.ok) {
    for (const { line, message } of planned.errors) deps.error(`${name}:${line}: ${message}`);
    deps.error(`${planned.errors.length} error(s). Nothing was imported.`);
    return 1;
  }

  const { plan } = planned;
  deps.log(
    `${name}: ${plan.purchases.length} purchases, ${plan.groups.length} groups, ` +
      `${plan.categories.length} categories, ${plan.paymentMethods.length} payment methods, ` +
      `${plan.merchantRules.length} merchant rules.`,
  );
  if (options.dryRun) {
    deps.log("Dry run: nothing was written.");
    return 0;
  }
  await deps.execute(buildImportSql(plan, options.user), options.target);
  deps.log(`Imported into ${options.target} D1. Rows already imported were skipped.`);
  return 0;
}
