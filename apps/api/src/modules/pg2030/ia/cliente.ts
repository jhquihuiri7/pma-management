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

export type MensajeIa = { role: "system" | "user"; content: string };

/** An OpenAI-compatible endpoint (or the local Ollama) and the model to ask. */
export type ProveedorIa = { baseUrl: string; model: string; apiKey: string };

/** The classification provider (NVIDIA_*), which the report also uses unless it has its own. */
export function proveedorPg2030(): ProveedorIa {
  return { baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL, apiKey: env.NVIDIA_API_KEY };
}

export const esOllamaLocal = (baseUrl: string) => /(^|:)\/\/ollama(?::|\/|$)/.test(baseUrl.replace(/\/+$/, ""));

/**
 * One chat completion with plain fetch (no SDK in the images): the local
 * Ollama, NVIDIA or any OpenAI-compatible endpoint such as OpenRouter.
 * Failures to reach the provider throw ProveedorIaError; an empty answer is
 * returned as "" for the caller to judge.
 */
export async function chatIa(
  messages: MensajeIa[],
  {
    maxTokens,
    timeoutMs,
    temperature,
    proveedor = proveedorPg2030(),
    razonamiento = "normal",
  }: {
    maxTokens: number;
    timeoutMs: number;
    temperature: number;
    proveedor?: ProveedorIa;
    /**
     * OpenRouter only. "bajo" caps the model's thinking: with its default
     * effort Nemotron 3 Ultra spent 4096 tokens on a classification prompt and
     * returned nothing; at "low" it answers in ~10 s (tested 2026-11-24).
     */
    razonamiento?: "normal" | "bajo";
  },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      const base = proveedor.baseUrl.replace(/\/+$/, "");
      const localOllama = esOllamaLocal(base);
      // OpenRouter normalizes reasoning across models: keep it out of the answer.
      const openRouter = /openrouter\.ai/i.test(base);
      response = await fetch(localOllama ? `${base.replace(/\/v1$/, "")}/api/chat` : `${base}/chat/completions`, {
        method: "POST",
        headers: {
          ...(proveedor.apiKey ? { Authorization: `Bearer ${proveedor.apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(localOllama
          ? { model: proveedor.model, messages, stream: false, think: false,
              options: { temperature, num_predict: maxTokens } }
          : { model: proveedor.model, messages, temperature, max_tokens: maxTokens,
              ...(openRouter
                ? { reasoning: razonamiento === "bajo" ? { effort: "low", exclude: true } : { exclude: true } }
                : { think: false }) }),
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
      | { choices?: Array<{ message?: { content?: unknown } }>; message?: { content?: unknown } }
      | null;
    const content = data?.message?.content ?? data?.choices?.[0]?.message?.content;
    // An empty answer (e.g. every token spent reasoning) is an answer outside
    // the list, not a provider failure: it counts toward the invalid limit.
    return typeof content === "string" ? content : "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Goal classification. Temperature 0 so the same input keeps getting the same
 * category. A hosted model (Nemotron 3 Ultra on OpenRouter since 2026-11-24)
 * reasons before answering and that counts against max_tokens, so it gets room
 * for it; the local Ollama answers directly.
 */
export const llamarNvidia: ClasificadorIa = (prompt) =>
  chatIa([{ role: "user", content: prompt }], {
    maxTokens: esOllamaLocal(env.NVIDIA_BASE_URL) ? env.PG2030_IA_MAX_TOKENS : Math.max(env.PG2030_IA_MAX_TOKENS, 4096),
    timeoutMs: env.PG2030_IA_TIMEOUT_MS,
    temperature: 0,
    razonamiento: "bajo",
  });
