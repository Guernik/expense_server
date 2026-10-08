import { describe, expect, it } from "vitest";
import { parseDotenv, parseImportArgs } from "./args";
import { type D1Target, type ImportOptions, runImport } from "./import-command";

const CSV = `date,time,merchant,amount,currency,payment_method,category,group,comment
2026-09-14,22:32,AXION VILLA ALLENDE,15000.01,ARS,Galicia Visa Crédito 3551,Fuel,Transport,
2026-09-15,,MERPAGO=RAPPI,8500,ARS,Mercado Pago cuenta,Delivery,Food,dinner
`;

function harness(content: string) {
  const out: string[] = [];
  const err: string[] = [];
  const executed: { statements: string[]; target: D1Target }[] = [];
  const deps = {
    readFile: async () => content,
    execute: async (statements: string[], target: D1Target) => {
      executed.push({ statements, target });
    },
    log: (m: string) => out.push(m),
    error: (m: string) => err.push(m),
  };
  const options: ImportOptions = {
    file: "/data/history.csv",
    target: "remote",
    dryRun: false,
    user: { telegramChatId: "42", locale: "en", timezone: "America/Argentina/Cordoba" },
    stripPrefixes: ["MERPAGO="],
  };
  return { out, err, executed, deps, options };
}

describe("runImport", () => {
  it("executes the import SQL against the chosen D1", async () => {
    const h = harness(CSV);
    expect(await runImport(h.options, h.deps)).toBe(0);
    expect(h.executed).toHaveLength(1);
    expect(h.executed[0]?.target).toBe("remote");
    const sql = h.executed[0]?.statements.join("\n") ?? "";
    expect(sql).toContain("'RAPPI'");
    expect(sql).toContain("'Galicia Visa Crédito 3551'");
    expect(h.out[0]).toBe(
      "history.csv: 2 purchases, 2 groups, 2 categories, 2 payment methods, 2 merchant rules.",
    );
  });

  it("reports invalid rows with line numbers and writes nothing", async () => {
    const h = harness(`${CSV}2026-09-16,,BAR,abc,ARS,Mercado Pago cuenta,Coffee,Food,\n`);
    expect(await runImport(h.options, h.deps)).toBe(1);
    expect(h.executed).toEqual([]);
    expect(h.err).toEqual([
      'history.csv:4: amount: must be a positive number with "." as the decimal separator',
      "1 error(s). Nothing was imported.",
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const h = harness(CSV);
    expect(await runImport({ ...h.options, dryRun: true }, h.deps)).toBe(0);
    expect(h.executed).toEqual([]);
  });
});

describe("parseImportArgs", () => {
  const env = { TELEGRAM_CHAT_ID: "123", TIMEZONE: "UTC", LOCALE: "es" };

  it("defaults to local D1 and reads the user from the environment", () => {
    expect(parseImportArgs(["import", "a.json"], env)).toEqual({
      ok: true,
      args: {
        file: "a.json",
        target: "local",
        dryRun: false,
        chatId: "123",
        timezone: "UTC",
        locale: "es",
      },
    });
  });

  it("takes flags over the environment", () => {
    const result = parseImportArgs(
      ["import", "a.csv", "--remote", "--dry-run", "--chat-id=-99", "--timezone", "Europe/Madrid"],
      env,
    );
    expect(result).toMatchObject({
      ok: true,
      args: { target: "remote", dryRun: true, chatId: "-99", timezone: "Europe/Madrid" },
    });
  });

  it("rejects bad input", () => {
    expect(parseImportArgs(["import"], env).ok).toBe(false);
    expect(parseImportArgs(["export", "a.json"], env).ok).toBe(false);
    expect(parseImportArgs(["import", "a.json", "--local", "--remote"], env).ok).toBe(false);
    expect(parseImportArgs(["import", "a.json"], {}).ok).toBe(false);
    expect(parseImportArgs(["import", "a.json", "--timezone", "Mars/Base"], env).ok).toBe(false);
    expect(parseImportArgs(["import", "a.json", "--locale", "fr"], env).ok).toBe(false);
    expect(parseImportArgs(["import", "a.json", "--nope"], env).ok).toBe(false);
  });
});

describe("parseDotenv", () => {
  it("reads KEY=value lines", () => {
    expect(
      parseDotenv("# c\nTELEGRAM_CHAT_ID=123\nexport LOCALE=\"es\"\nTIMEZONE = 'UTC'\n"),
    ).toEqual({ TELEGRAM_CHAT_ID: "123", LOCALE: "es", TIMEZONE: "UTC" });
  });
});
