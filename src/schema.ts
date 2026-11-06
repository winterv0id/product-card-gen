import { z } from "zod";

/** Текстовое поле, которое может отсутствовать, быть null или числом. */
const optText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null ? "" : String(v).trim()));

/** Входные данные о товаре. Обязательно только название. */
export const ProductInputSchema = z.object({
  name: z.string({ error: "поле name обязательно" }).trim().min(1, "поле name пустое"),
  manufacturer: optText,
  specs: z.record(z.string(), optText).optional().default({}),
  description: optText,
});
/** source: "xml" проставляет загрузчик XML, для товаров из JSON поля нет. */
export type ProductInput = z.output<typeof ProductInputSchema> & { source?: "xml" };

/** Поля, которые генерирует модель */
export const GeneratedSchema = z.object({
  seo_title: z.string(),
  seo_description: z.string(),
  search_queries: z.array(z.string()),
  commercial_block: z.object({
    suitable_for: z.string(),
    tasks: z.string(),
  }),
});
export type Generated = z.infer<typeof GeneratedSchema>;

/** JSON Schema для structured output в Ollama. */
export const generatedJsonSchema = (() => {
  const schema = z.toJSONSchema(GeneratedSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

export interface KeySpec {
  name: string;
  value: string;
}

export interface ProductCard {
  product: { name: string; manufacturer: string };
  seo_title: string;
  seo_description: string;
  key_specs: KeySpec[];
  search_queries: string[];
  commercial_block: { suitable_for: string; tasks: string };
  missing_data: string[];
  warnings: string[];
}
