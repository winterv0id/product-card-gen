import { extname } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ProductInput } from "./schema.js";
import { InputError, parseProductObject } from "./validate.js";

/** Один товар из файла: либо готовый product, либо описание ошибки. */
export interface LoadedItem {
  id: string; // пусто для файла с одним товаром
  product?: ProductInput;
  error?: string;
}

export interface LoadResult {
  items: LoadedItem[];
  notes: string[]; // сведения о том, что было исправлено автоматически
}

const SERVICE_PARAMS = new Set(["артикул", "код товара"]);

/** Убирает лишние запятые перед } и ]*/
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonLenient(raw: string): { value: unknown; fixed: boolean } {
  const text = raw.replace(/^\uFEFF/, "");
  try {
    return { value: JSON.parse(text), fixed: false };
  } catch (e) {
    try {
      return { value: JSON.parse(stripTrailingCommas(text)), fixed: true };
    } catch {
      throw new InputError(`Некорректный JSON: ${(e as Error).message}`);
    }
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "offer" || name === "param",
});

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]).trim();
  return "";
}

function findOffers(node: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((n) => findOffers(n, out));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "offer") out.push(...(value as unknown[]));
      else findOffers(value, out);
    }
  }
  return out;
}

function offerToObject(offer: unknown) {
  const o = (typeof offer === "object" && offer !== null ? offer : {}) as Record<string, unknown>;
  const specs: Record<string, string> = {};
  for (const p of (o.param as unknown[] | undefined) ?? []) {
    const name = typeof p === "object" && p ? String((p as Record<string, unknown>)["@_name"] ?? "").trim() : "";
    if (!name || SERVICE_PARAMS.has(name.toLowerCase())) continue;
    specs[name] = textOf(p);
  }
  return {
    name: textOf(o.name),
    manufacturer: textOf(o.vendor),
    description: textOf(o.typePrefix),
    specs,
  };
}

function parseXml(raw: string): LoadResult {
  // В файле несколько <offer> подряд без общего корня
  const wrapped = `<root>${raw.replace(/^\uFEFF/, "").replace(/<\?xml[^>]*\?>/i, "")}</root>`;
  const valid = XMLValidator.validate(wrapped);
  if (valid !== true) throw new InputError(`Некорректный XML: ${valid.err.msg} (строка ${valid.err.line})`);

  const offers = findOffers(xmlParser.parse(wrapped));
  if (offers.length === 0) throw new InputError("В XML не найдено ни одного элемента <offer>");

  const items = offers.map((offer, i): LoadedItem => {
    const rawId = (offer as Record<string, unknown> | null)?.["@_id"];
    const id = typeof rawId === "string" && rawId ? rawId : String(i + 1);
    try {
      return { id, product: { ...parseProductObject(offerToObject(offer)), source: "xml" } };
    } catch (e) {
      return { id, error: (e as Error).message };
    }
  });
  return { items, notes: [] };
}

/** Загрузка товаров из файла: .xml (YML-подобный offer) или JSON (объект либо массив объектов). */
export function loadProducts(path: string, raw: string): LoadResult {
  if (extname(path).toLowerCase() === ".xml") return parseXml(raw);

  const { value, fixed } = parseJsonLenient(raw);
  const notes = fixed ? ["в JSON были лишние запятые — исправлены автоматически"] : [];
  if (!Array.isArray(value)) return { items: [{ id: "", product: parseProductObject(value) }], notes };
  if (value.length === 0) throw new InputError("Массив товаров пуст");

  const items = value.map((v, i): LoadedItem => {
    try {
      return { id: String(i + 1), product: parseProductObject(v) };
    } catch (e) {
      return { id: String(i + 1), error: (e as Error).message };
    }
  });
  return { items, notes };
}
