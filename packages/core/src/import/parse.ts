/** A row of a backfill file (SPEC §10) before validation, with the line it starts on. */
export interface RawImportRow {
  line: number;
  values: Record<string, unknown>;
}

export interface ImportError {
  /** 1-based line in the file. */
  line: number;
  message: string;
}

export type ParseResult = { ok: true; rows: RawImportRow[] } | { ok: false; errors: ImportError[] };

/** Parses a backfill file by extension: `.json` (array of objects) or `.csv` (header row). */
export function parseImportFile(fileName: string, content: string): ParseResult {
  const text = content.replace(/^﻿/, "");
  if (/\.json$/i.test(fileName)) return parseJson(text);
  if (/\.csv$/i.test(fileName)) return parseCsv(text);
  return { ok: false, errors: [{ line: 0, message: "Expected a .json or .csv file" }] };
}

function parseJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ line: 1, message: `Invalid JSON: ${String(error)}` }] };
  }
  if (!Array.isArray(data)) {
    return { ok: false, errors: [{ line: 1, message: "Expected a JSON array of rows" }] };
  }
  const lines = elementLines(text);
  const rows: RawImportRow[] = [];
  const errors: ImportError[] = [];
  for (const [i, value] of data.entries()) {
    const line = lines[i] ?? 1;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push({ line, message: "Expected an object" });
    } else {
      rows.push({ line, values: value as Record<string, unknown> });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

/** Line where each element of a top-level JSON array starts. `text` must be valid JSON. */
function elementLines(text: string): number[] {
  const lines: number[] = [];
  let line = 1;
  let depth = 0;
  let inString = false;
  let expectElement = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") line++;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    if (depth === 1 && expectElement && c !== "]") {
      lines.push(line);
      expectElement = false;
    }
    if (c === '"') inString = true;
    else if (c === "[" || c === "{") {
      depth++;
      if (depth === 1) expectElement = true;
    } else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 1) expectElement = true;
  }
  return lines;
}

/** RFC 4180 CSV: comma separated, `"` quoting with `""` escapes, quoted fields may span lines. */
function parseCsv(text: string): ParseResult {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else field += c;
  }
  if (quoted) return { ok: false, errors: [{ line: recordLine, message: "Unclosed quote" }] };
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }

  const nonEmpty = records.filter((r) => r.fields.some((f) => f.trim() !== ""));
  const [header, ...body] = nonEmpty;
  if (!header) return { ok: false, errors: [{ line: 1, message: "Missing header row" }] };
  const columns = header.fields.map((f) => f.trim());
  const errors: ImportError[] = [];
  const rows: RawImportRow[] = [];
  for (const record of body) {
    if (record.fields.length !== columns.length) {
      errors.push({
        line: record.line,
        message: `Expected ${columns.length} columns, found ${record.fields.length}`,
      });
      continue;
    }
    const values: Record<string, unknown> = {};
    for (const [i, column] of columns.entries()) {
      const value = record.fields[i] ?? "";
      // Empty cells are missing values, so optional columns can be left blank.
      if (value.trim() !== "") values[column] = value;
    }
    rows.push({ line: record.line, values });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}
