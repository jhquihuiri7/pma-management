import { env } from "../../../lib/env.js";

/**
 * The provider could not answer: network, timeout, 429, 5xx or no key. These
 * are retried forever with growing delays and never end a request (plan §8).
 */
export class ProveedorIaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProveedorIaError";
  }
}

/** Sends one prompt and returns the model's raw text. */
export type ClasificadorIa = (prompt: string) => Promise<string>;

/**
 * NVIDIA's OpenAI-compatible chat completions endpoint, called with plain
 * fetch (no SDK in the worker image). Temperature 0 so the same input keeps
 * getting the same category.
 */
export const llamarNvidia: ClasificadorIa = async (prompt) => {
  if (!env.NVIDIA_API_KEY) throw new ProveedorIaError("NVIDIA_API_KEY no está configurada");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PG2030_IA_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${env.NVIDIA_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.NVIDIA_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: env.PG2030_IA_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ProveedorIaError(controller.signal.aborted ? "Tiempo agotado" : `Red: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProveedorIaError(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = data?.choices?.[0]?.message?.content;
    // An empty answer (e.g. every token spent reasoning) is an answer outside
    // the list, not a provider failure: it counts toward the invalid limit.
    return typeof content === "string" ? content : "";
  } finally {
    clearTimeout(timer);
  }
};
