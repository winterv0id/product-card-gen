import { parseProductObject } from "../src/validate.js";

/** Разбирает строку с JSON одного товара (без проверок формата файла). */
export const parseInput = (raw: string) => parseProductObject(JSON.parse(raw));
