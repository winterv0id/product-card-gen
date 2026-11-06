import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInput } from "./helpers.js";
import { buildKeySpecs, findMissing } from "../src/validate.js";

test("полностью отсутствующие характеристики попадают в отчёт", () => {
  const p = parseInput('{"name":"Прибор","manufacturer":null,"specs":{"питание":""}}');
  const missing = findMissing(p).join("\n");
  assert.match(missing, /производитель/);
  assert.match(missing, /описание/);
  assert.match(missing, /характеристики отсутствуют полностью/);
  assert.deepEqual(buildKeySpecs(p), []);
});