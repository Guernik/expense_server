const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** SPEC §4.2: decode entities, NFC, collapse whitespace, trim. */
export function normalizeText(input: string): string {
  return decodeEntities(input).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Notification body: same as normalizeText plus a trailing "." removed. */
export function normalizeBody(input: string): string {
  return normalizeText(input).replace(/\.$/, "");
}

/** SPEC §5.4: uppercase, collapse spaces, strip processor prefixes. */
export function normalizeMerchant(raw: string, stripPrefixes: readonly string[] = []): string {
  let merchant = normalizeText(raw).toUpperCase();
  for (const prefix of stripPrefixes) {
    const upper = prefix.toUpperCase();
    if (merchant.startsWith(upper)) {
      merchant = merchant.slice(upper.length).trim();
      break;
    }
  }
  return merchant;
}
