import { LIMITS } from "./config.js";
import { ProductInputSchema, type KeySpec, type ProductInput } from "./schema.js";

export class InputError extends Error {}

/** Проверяет объект с данными товара. Характеристики с пустыми значениями отбрасываются. */
export function parseProductObject(data: unknown): ProductInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new InputError("Ожидается JSON-объект с описанием одного товара");
  }
  const result = ProductInputSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(корень)"}: ${i.message}`)
      .join("; ");
    throw new InputError(`Неверные входные данные: ${details}`);
  }
  const specs = Object.fromEntries(Object.entries(result.data.specs).filter(([, v]) => v !== ""));
  return { ...result.data, specs };
}

export function hasSpecs(p: ProductInput): boolean {
  return Object.keys(p.specs).length > 0;
}

/** Допустимая длина seo_description; если граница не задана, она не проверяется. */
export interface DescriptionBounds {
  min?: number;
  max?: number;
}

export function descriptionBounds(p: ProductInput): DescriptionBounds {
  // Для товаров из XML действует только верхняя граница.
  if (p.source === "xml") return { max: LIMITS.descriptionMax };

  if (!hasSpecs(p)) return {};
  return { min: LIMITS.descriptionMin, max: LIMITS.descriptionMax };
}

/** Чего не хватает во входных данных (для блока «Требует уточнения»). */
export function findMissing(p: ProductInput): string[] {
  const missing: string[] = [];
  if (!p.manufacturer) missing.push("производитель не указан");
  if (!p.description) missing.push("текстовое описание / тип прибора отсутствует");
  if (!hasSpecs(p)) {
    missing.push("технические характеристики отсутствуют полностью — требуется источник (паспорт, сайт производителя)");
  }
  return missing;
}

/** Характеристики берутся из входных данных как есть, без участия модели. */
export function buildKeySpecs(p: ProductInput): KeySpec[] {
  return Object.entries(p.specs).map(([name, value]) => ({ name, value }));
}
