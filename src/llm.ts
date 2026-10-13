// src/llm.ts
import Groq from "groq-sdk";

/**
 * LLM abstraction — intentionally isolated from A2A/portfolio logic.
 * To swap providers, just change LLM_PROVIDER / LLM_API_KEY / LLM_MODEL
 * in .env. Any OpenAI-compatible endpoint works via LLM_BASE_URL.
 */

const LLM_PROVIDER = process.env.LLM_PROVIDER || "groq";
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || "";

// ── Default: openai/gpt-oss-120b ──
// Reasoning is strong for its size class, free on Groq's free tier, and
// stable (not a preview/deprecated model). Alternative options:
//   - openai/gpt-oss-20b     (smaller, faster, cheaper — good for dev)
//   - llama-3.3-70b-versatile (if available again on Groq)
//   - Switch provider to OpenAI/Anthropic via LLM_BASE_URL
const LLM_MODEL = process.env.LLM_MODEL || "openai/gpt-oss-120b";

const LLM_BASE_URL = process.env.LLM_BASE_URL;

const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? "0.3");
const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? "1500");

if (!LLM_API_KEY) {
  console.warn(
    "[WARN] LLM_API_KEY (or GROQ_API_KEY) is not set — the agent will fail to respond. " +
      "Get a free key at https://console.groq.com/keys"
  );
}

const client = new Groq({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL,
});

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  const completion = await client.chat.completions.create({
    model: LLM_MODEL,
    messages,
    temperature: LLM_TEMPERATURE,
    max_tokens: LLM_MAX_TOKENS,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("LLM returned an empty completion.");
  return text;
}

export const llmInfo = {
  provider: LLM_PROVIDER,
  model: LLM_MODEL,
  temperature: LLM_TEMPERATURE,
};
