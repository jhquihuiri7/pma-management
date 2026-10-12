/**
 * Read the model's answer into one category of a closed list (plan §8).
 *
 * The prompts ask for the bare category name, but models wrap it: reasoning
 * blocks, code fences, quotes, a trailing period, "Contribución complementaria
 * (Alineación parcial)", or a short sentence around it. Anything that does not
 * resolve to exactly one category is invalid, and the request is retried.
 */

export const CONTRIBUCIONES = [
  "Contribución directa",
  "Contribución complementaria",
  "Alineación relativa",
  "Sin alineación",
] as const;
export type Contribucion = typeof CONTRIBUCIONES[number];

export const TIPOS_INVERSION = [
  "Adquisición de bienes",
  "Bienes-servicios",
  "Estudios",
  "Obras",
  "Servicios",
  "Contratación de personal",
  "Sin datos",
] as const;
export type TipoInversion = typeof TIPOS_INVERSION[number];

/** Lowercase, no accents, no punctuation, single spaces. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Drop what models add around the answer: reasoning, fences, parentheses. */
export function limpiarRespuesta(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/gi, " ") // an unterminated reasoning block
    .replace(/```[a-z]*\n?/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .trim();
}

function match<T extends string>(
  raw: string,
  categorias: readonly T[],
  alias: Record<string, T> = {},
  claves: Record<string, T> = {},
): T | null {
  const text = normalize(limpiarRespuesta(raw));
  if (!text) return null;
  const opciones = new Map<string, T>(categorias.map((c) => [normalize(c), c]));
  for (const [k, v] of Object.entries(alias)) opciones.set(normalize(k), v);

  const exact = opciones.get(text);
  if (exact) return exact;

  // An answer naming two categories ("directa o complementaria") is not one.
  const padded0 = ` ${text} `;
  const porClave = new Set(Object.entries(claves).filter(([k]) => padded0.includes(` ${normalize(k)} `)).map(([, v]) => v));
  if (porClave.size > 1) return null;

  // A sentence around the name: keep the categories that appear as whole words,
  // drop any that is only part of a longer match ("servicios" inside
  // "bienes servicios"), and accept the answer only if one category remains.
  const padded = ` ${text} `;
  const found = [...opciones.keys()].filter((k) => padded.includes(` ${k} `));
  const maximal = found.filter((k) => !found.some((other) => other !== k && other.includes(k)));
  const resolved = new Set(maximal.map((k) => opciones.get(k)!));
  return resolved.size === 1 ? [...resolved][0] : null;
}

/** "Sin datos" is the same category as "Sin alineación" (plan §8). */
export function interpretarContribucion(raw: string): Contribucion | null {
  return match(raw, CONTRIBUCIONES, { "Sin datos": "Sin alineación" }, {
    directa: "Contribución directa",
    complementaria: "Contribución complementaria",
    relativa: "Alineación relativa",
    "sin alineación": "Sin alineación",
    "sin datos": "Sin alineación",
  });
}

export function interpretarInversion(raw: string): TipoInversion | null {
  return match(raw, TIPOS_INVERSION, { "Bienes servicios": "Bienes-servicios", "Bienes y servicios": "Bienes-servicios" });
}
