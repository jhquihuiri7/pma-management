/**
 * The two classification prompts, copied literally from the user's tested
 * prompts (docs/pg2030-plan.md, anexo A). Do not edit them: their wording is
 * what was tested. This file is generated from the annex; if the annex
 * changes, regenerate it and bump PROMPT_VERSION so every goal is re-queued.
 */

/** Part of each request's fingerprint. */
export const PROMPT_VERSION = "anexo-a-v1";

const CONTRIBUCION = "Actúa como analista de planificación estratégica del Régimen Especial de Galápagos.\n\nVas a recibir:\n\n1. Una meta institucional (formulada por una entidad pública).\n2. Un texto de referencia (relacionado con el Plan Galápagos 2030, sus ejes, objetivos, indicadores o hitos).\n\nTu tarea es analizar la relación entre la meta institucional y el texto proporcionado y determinar el nivel de alineación, utilizando exclusivamente los siguientes criterios:\n\nContribución directa (Alineación total):\nLa meta institucional coincide plenamente con los indicadores, hitos u objetivos estratégicos del Plan 2030. Existe una relación causal clara y verificable. Si se cumple la meta institucional, se impacta directamente en los indicadores del Plan.\n\nContribución complementaria (Alineación parcial):\nLa meta apoya el cumplimiento del objetivo estratégico, pero no lo cubre en su totalidad o se enfoca en un componente específico (administrativo, operativo, logístico, técnico, etc.). Contribuye al resultado final de forma indirecta o secundaria.\n\nAlineación relativa (Alineación programática):\nLa meta está dentro de las competencias de los ejes del Plan Galápagos 2030, pero su indicador no suma directamente a los hitos o metas estratégicas de largo plazo. Es gestión pública válida, pero su impacto en el Plan es difícil de cuantificar.\n\nSin alineación: (Sin datos)\nEl contexto no tiene información suficiente para determinar una relación directa, complementaria o relativa con la meta institucional. No se puede asumir impacto alguno en el Plan Galápagos 2030 basado en la información proporcionada.\n\nDatos de referencia:\nMETA INSTITUCIONAL: {meta}\nTEXTO DE REFERENCIA: {contexto}\n\nReglas importantes:\n\n* No reformules las categorías.\n* No combines categorías.\n* Selecciona únicamente una.\n* Basa tu análisis únicamente en la información proporcionada.\n* Si la información es insuficiente para determinar alineación directa, no asumas impacto; evalúa según evidencia explícita.\n\n\nDebes responder unicamente con la categoría que corresponda a la relación entre la meta institucional y el texto de referencia, siguiendo estrictamente los criterios definidos.: Contribución directa, Contribución complementaria o Alineación relativa";

const INVERSION = "Actúa como analista de planificación estratégica del Régimen Especial de Galápagos.\n\nVas a recibir:\n\n1. Una meta institucional (formulada por una entidad pública).\n2. Un texto de referencia (relacionado con el Plan Galápagos 2030, sus ejes, objetivos, indicadores o hitos).\n\nTu tarea es analizar la relación entre la meta institucional y el texto proporcionado y determinar el tipo de inversión, utilizando exclusivamente los siguientes criterios:\n\n-Adquisición de bienes\n-Bienes-servicios\n-Estudios \n-Obras\n-Servicios\n-Contratación de personal\n\n\nDatos de referencia:\nMETA INSTITUCIONAL: {meta}\nTEXTO DE REFERENCIA: {contexto}\n\nReglas importantes:\n\n* No reformules las categorías.\n* No combines categorías.\n* Selecciona únicamente una, si no hay información suficiente para determinarla entonces responde con \"Sin datos\".\n* Basa tu análisis únicamente en la información proporcionada.\n* Si la información es insuficiente para determinar alineación directa, no asumas impacto; evalúa según evidencia explícita.\n\n\nDebes responder unicamente con la categoría que corresponda a la relación entre la meta institucional y el texto de referencia, siguiendo estrictamente los criterios definidos.: Adquisición de bienes, Bienes-servicios, Estudios, Obras, Servicios o Contratación de personal";

function fill(template: string, meta: string, contexto: string): string {
  // Function replacers: a "$" in the user's text must not be read as a pattern.
  return template.replace("{meta}", () => meta).replace("{contexto}", () => contexto);
}

export function promptContribucion(meta: string, contexto: string): string {
  return fill(CONTRIBUCION, meta, contexto);
}

export function promptInversion(meta: string, contexto: string): string {
  return fill(INVERSION, meta, contexto);
}
