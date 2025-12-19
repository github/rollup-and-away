import { RateLimiter } from "limiter";

import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

import { getConfig, getModelEndpoint, loadPromptFile } from "@config";

import { getToken } from "@util/octokit";
import { handleUnexpectedResponse } from "@util/error";

import { type MemoryBank } from "@transform/memory";

import { SummaryCache } from "./cache";
import { insertPlaceholders } from "./hydration";
import { countTokens, truncate } from "./tokens";

export type Message = {
  role: "system" | "user" | "assistant" | "developer";
  content: string;
};

export type PromptParameters = {
  name?: string;
  description?: string;
  model: string;
  modelParameters?: {
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    // Most models are different, so need to handle unknown parameters too
    [key: string]: string | number | boolean | undefined;
  };
  messages: Array<Message>;
};

// Only make up to 15 requests per minute to the Models API
const limiter = new RateLimiter({
  tokensPerInterval: 15,
  interval: "minute",
});

export async function runPrompt(params: PromptParameters): Promise<string> {
  const { messages, model, modelParameters } = {
    messages: params.messages,
    model: params.model,
    modelParameters: params.modelParameters || {},
  };

  // Validate inputs
  if (!messages.find((msg) => msg.role === "user")) {
    throw new Error("No user message found in the prompt.");
  }

  if (model.startsWith("xai/")) {
    throw new Error("xai models are not supported");
  }

  const inputTokens = countTokens(model, messages);
  if (inputTokens !== undefined) {
    console.log("Input tokens:", inputTokens);
  }

  // TODO: Replace Markdown image tags by image_url messages

  // Finally call the Models API
  const token = await getToken();
  const endpoint = getModelEndpoint(token.kind);

  try {
    // TODO: Detailed debug info MODEL_NAME, etc. Prepare for Datadog
    const client = ModelClient(endpoint, new AzureKeyCredential(token.value), {
      apiVersion: "2025-04-01-preview",
      retryOptions: { maxRetries: 0 }, // Disable retries or it will wait 24 hours
      userAgentOptions: { userAgentPrefix: "github-actions-rollup-and-away" },
    });

    await limiter.removeTokens(1); // Wait for rate limit

    // For debugging hanging request issues
    console.log(`Calling /chat/completions for ${params.name}`);

    const response = await client.path("/chat/completions").post({
      body: {
        ...modelParameters,
        model,
        messages,
      },
      timeout: 3 * 60 * 1000, // Sometimes the AI never responds
    });

    if (isUnexpected(response)) {
      handleUnexpectedResponse(response);
    }

    const modelResponse = response.body.choices[0]?.message.content;
    if (!modelResponse) {
      throw new Error("No response from model.");
    } else if (modelResponse.startsWith("ERROR:")) {
      // Prevent Error text from showing up in the body, or being cached
      throw new Error(modelResponse);
    }

    console.log("Model response received.");

    return modelResponse;
  } catch (error: unknown) {
    // @ts-expect-error this is fine
    if (error.code === "content_filter") {
      // Return a string instead of an error to avoid breaking the flow
      return "The content was filtered due to a jailbreak attempt, or harmful content. May be a false positive.";
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Request Timeout. Please try again: ${JSON.stringify(error)}`,
      );
    }
    throw new Error(`Unexpected Error: ${JSON.stringify(error)}`);
  }
}

export type SummaryParameters = {
  content: string | MemoryBank;
  prompt: string | PromptParameters;
  placeholders?: Record<string, string>;
  truncateTokens?: number;
};

export async function generateSummary(
  params: SummaryParameters,
): Promise<string> {
  let { content, prompt, placeholders, truncateTokens } = params;

  if (!prompt) {
    throw new Error("Prompt cannot be empty.");
  } else if (typeof prompt === "string") {
    // Try to load the string as a prompt file

    prompt = loadPromptFile(prompt);
  }

  if (typeof content === "string") {
    // Convert string literal to MemoryBank format
    content = [{ content, sources: [content] }] as MemoryBank;
  }

  // Don't deduplicate sources here, as they are important for caching
  const sources = content.map((item) => item.sources).flat();

  // Check for a cache hit to avoid unnecessary generations
  const summaryCache = SummaryCache.getInstance();
  const cachedResponse = await summaryCache.get(prompt, sources);
  if (cachedResponse) {
    console.log("Using cached response for prompt:", prompt.name);
    return cachedResponse;
  }

  const input = content.map((item) => item.content).join("\n\n");
  // Insert summary content into a few sensible placeholders
  placeholders = {
    ...placeholders,
    input,
    content: input,
    memory: input,
  };

  let hydratedPrompt = insertPlaceholders(prompt, placeholders);

  truncateTokens = Number(truncateTokens || getConfig("TRUNCATE_TOKENS"));
  if (!isNaN(truncateTokens)) {
    hydratedPrompt = truncate(hydratedPrompt, truncateTokens);
  }

  const summary = await runPrompt(hydratedPrompt);

  // Save the summary in the cache
  summaryCache.set(prompt, sources, summary);

  return summary;
}
