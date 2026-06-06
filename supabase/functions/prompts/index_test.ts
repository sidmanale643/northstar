import { assertEquals } from "@std/assert";
import {
  handlePromptRequest,
  type PromptStore,
} from "./index.ts";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PROMPT_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";

function createStore(prompt = {
  prompt_id: PROMPT_ID,
  prompt_version_id: VERSION_ID,
  version_number: 2,
  content: "Hello {{ name }}",
  model: "gpt-4o-mini",
  temperature: "0.2",
  max_tokens: 256,
  variables: [{ name: "name", type: "string", required: true, default: null }],
  content_hash: "abc123",
}): PromptStore {
  return {
    resolveProjectId: () => Promise.resolve(PROJECT_ID),
    resolvePrompt: () => Promise.resolve(prompt),
  };
}

function request(body: unknown, path = "/functions/v1/prompts/resolve") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer northstar-key",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("handlePromptRequest resolves prompt versions", async () => {
  const response = await handlePromptRequest(
    request({ slug: "greeter", label: "prod", version: 2 }),
    createStore(),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    prompt_version: {
      id: VERSION_ID,
      prompt_id: PROMPT_ID,
      version_number: 2,
      content: "Hello {{ name }}",
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 256,
      variables: [
        { name: "name", type: "string", required: true, default: null },
      ],
      content_hash: "abc123",
    },
  });
});

Deno.test("handlePromptRequest accepts SDK name fallback", async () => {
  let resolvedSlug = "";
  const store: PromptStore = {
    resolveProjectId: () => Promise.resolve(PROJECT_ID),
    resolvePrompt: (input) => {
      resolvedSlug = input.slug;
      return Promise.resolve(null);
    },
  };

  const response = await handlePromptRequest(request({ name: "greeter" }), store);

  assertEquals(response.status, 404);
  assertEquals(resolvedSlug, "greeter");
});

Deno.test("handlePromptRequest rejects missing auth", async () => {
  const response = await handlePromptRequest(
    new Request("http://localhost/functions/v1/prompts/resolve", {
      method: "POST",
      body: JSON.stringify({ slug: "greeter" }),
    }),
    createStore(),
  );

  assertEquals(response.status, 401);
});
