import arGalicia from "./ar/galicia.yaml";
import arMercadopago from "./ar/mercadopago.yaml";

/** Bundled rule packs (raw YAML), keyed by pack name. Enabled per install via RULE_PACKS. */
export const PACK_SOURCES: Readonly<Record<string, string>> = {
  "ar.galicia": arGalicia,
  "ar.mercadopago": arMercadopago,
};
