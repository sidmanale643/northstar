import { assertEquals } from "@std/assert";
import {
  createPostgresIngestStore,
  handleIngestRequest,
  type IngestBatch,
  type IngestStore,
  sha256hex,
  validateEvents,
  validateRuns,
  validateSessions,
  validateSpans,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Mock persistence store
// ---------------------------------------------------------------------------

type MockIngestStore = IngestStore & {
  ingestCalls: IngestBatch[];
};

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

function createMockStore(options: {
  resolveApiKeyResult?: { data: unknown; error: unknown };
  ingestBatchResult?: { data: unknown; error: unknown };
}): MockIngestStore {
  const {
    resolveApiKeyResult = { data: [], error: null },
    ingestBatchResult = { data: {}, error: null },
  } = options;
  const ingestCalls: IngestBatch[] = [];

  return {
    ingestCalls,
    resolveProjectId: () => {
      if (resolveApiKeyResult.error) {
        throw new Error(getErrorMessage(resolveApiKeyResult.error));
      }

      const rows = resolveApiKeyResult.data;
      if (!Array.isArray(rows) || rows.length === 0) {
        return Promise.resolve(null);
      }

      const row = rows[0];
      if (
        typeof row !== "object" || row === null || !("project_id" in row) ||
        typeof row.project_id !== "string"
      ) {
        return Promise.resolve(null);
      }

      return Promise.resolve(row.project_id);
    },
    ingestBatch: (batch: IngestBatch) => {
      ingestCalls.push(batch);
      if (ingestBatchResult.error) {
        throw new Error(getErrorMessage(ingestBatchResult.error));
      }
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const SPAN_ID = "44444444-4444-4444-4444-444444444444";
const EVENT_ID = "55555555-5555-5555-5555-555555555555";

function createValidPayload(options: {
  includeProjectIds?: boolean;
  projectId?: string;
} = {}) {
  const { includeProjectIds = false, projectId = PROJECT_ID } = options;

  return {
    schema_version: 1,
    sessions: [
      {
        id: SESSION_ID,
        ...(includeProjectIds ? { project_id: projectId } : {}),
        created_at: "2024-01-01T00:00:00Z",
        metadata: {},
      },
    ],
    runs: [
      {
        id: RUN_ID,
        session_id: SESSION_ID,
        ...(includeProjectIds ? { project_id: projectId } : {}),
        name: "test-run",
        started_at: "2024-01-01T00:00:00Z",
        status: "running",
        metadata: {},
      },
    ],
    spans: [
      {
        id: SPAN_ID,
        run_id: RUN_ID,
        ...(includeProjectIds ? { project_id: projectId } : {}),
        kind: "agent",
        name: "test-span",
        started_at: "2024-01-01T00:00:00Z",
        status: "running",
        attributes: {},
      },
    ],
    events: [
      {
        id: EVENT_ID,
        run_id: RUN_ID,
        ...(includeProjectIds ? { project_id: projectId } : {}),
        type: "user_input",
        created_at: "2024-01-01T00:00:00Z",
        content: { text: "hello" },
        attributes: {},
      },
    ],
  };
}

function createAuthRequest(payload: unknown) {
  return new Request("http://localhost/functions/v1/ingest-traces", {
    method: "POST",
    headers: {
      authorization: "Bearer test-api-key",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Persistence tests
// ---------------------------------------------------------------------------

Deno.test("createPostgresIngestStore - binds ingest arrays as JSON", async () => {
  const jsonValues: unknown[] = [];
  const sql = Object.assign(
    () => Promise.resolve([]),
    {
      json: (value: unknown) => {
        jsonValues.push(value);
        return value;
      },
    },
  );
  const store = createPostgresIngestStore(
    sql as unknown as Parameters<typeof createPostgresIngestStore>[0],
  );
  const batch: IngestBatch = {
    projectId: PROJECT_ID,
    sessions: [],
    runs: [],
    spans: [],
    events: [],
  };

  await store.ingestBatch(batch);

  assertEquals(jsonValues, [
    batch.sessions,
    batch.runs,
    batch.spans,
    batch.events,
  ]);
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

Deno.test("validateSessions - accepts valid session", () => {
  const result = validateSessions([
    {
      id: SESSION_ID,
      project_id: PROJECT_ID,
      created_at: "2024-01-01T00:00:00Z",
      metadata: {},
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateSessions - rejects invalid UUID", () => {
  const result = validateSessions([
    {
      id: "not-a-uuid",
      project_id: PROJECT_ID,
      created_at: "2024-01-01T00:00:00Z",
    },
  ]);
  assertEquals(result, "sessions[0].id is not a valid UUID");
});

Deno.test("validateSessions - rejects invalid timestamp", () => {
  const result = validateSessions([
    {
      id: SESSION_ID,
      project_id: PROJECT_ID,
      created_at: "not-a-date",
    },
  ]);
  assertEquals(result, "sessions[0].created_at is not a valid ISO timestamp");
});

Deno.test("validateSessions - rejects undeclared fields", () => {
  const result = validateSessions([
    {
      id: SESSION_ID,
      created_at: "2024-01-01T00:00:00Z",
      unexpected: true,
    },
  ]);
  assertEquals(result, "sessions[0].unexpected is not allowed");
});

Deno.test("validateRuns - accepts valid run", () => {
  const result = validateRuns([
    {
      id: RUN_ID,
      session_id: SESSION_ID,
      project_id: PROJECT_ID,
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateRuns - rejects invalid status", () => {
  const result = validateRuns([
    {
      id: RUN_ID,
      session_id: SESSION_ID,
      project_id: PROJECT_ID,
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "invalid",
    },
  ]);
  assertEquals(result, "runs[0].status must be one of: running, ok, error");
});

Deno.test("validateRuns - rejects missing name", () => {
  const result = validateRuns([
    {
      id: RUN_ID,
      session_id: SESSION_ID,
      project_id: PROJECT_ID,
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
    },
  ]);
  assertEquals(result, "runs[0].name is required");
});

Deno.test("validateSpans - accepts valid span", () => {
  const result = validateSpans([
    {
      id: SPAN_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      kind: "agent",
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateSpans - rejects invalid kind", () => {
  const result = validateSpans([
    {
      id: SPAN_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      kind: "invalid",
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
    },
  ]);
  assertEquals(
    result,
    "spans[0].kind must be one of: agent, workflow, model, tool, custom",
  );
});

Deno.test("validateSpans - accepts all valid kinds", () => {
  const kinds = ["agent", "workflow", "model", "tool", "custom"];
  for (const kind of kinds) {
    const result = validateSpans([
      {
        id: SPAN_ID,
        run_id: RUN_ID,
        project_id: PROJECT_ID,
        kind,
        name: "test",
        started_at: "2024-01-01T00:00:00Z",
        status: "running",
      },
    ]);
    assertEquals(result, null);
  }
});

Deno.test("validateSpans - accepts optional parent_span_id", () => {
  const result = validateSpans([
    {
      id: SPAN_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      parent_span_id: "66666666-6666-6666-6666-666666666666",
      kind: "agent",
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateSpans - rejects non-integer iteration", () => {
  const result = validateSpans([
    {
      id: SPAN_ID,
      run_id: RUN_ID,
      kind: "agent",
      name: "test",
      started_at: "2024-01-01T00:00:00Z",
      status: "running",
      iteration: 1.5,
    },
  ]);
  assertEquals(result, "spans[0].iteration must be an integer");
});

Deno.test("validateEvents - accepts valid event", () => {
  const result = validateEvents([
    {
      id: EVENT_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      type: "user_input",
      created_at: "2024-01-01T00:00:00Z",
      content: { text: "hello" },
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateEvents - rejects invalid type", () => {
  const result = validateEvents([
    {
      id: EVENT_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      type: "invalid",
      created_at: "2024-01-01T00:00:00Z",
      content: { text: "hello" },
    },
  ]);
  assertEquals(
    result,
    "events[0].type must be one of: user_input, system_message, assistant_message, reasoning, tool_arguments, tool_result, final_response, custom",
  );
});

Deno.test("validateEvents - rejects missing content", () => {
  const result = validateEvents([
    {
      id: EVENT_ID,
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      type: "user_input",
      created_at: "2024-01-01T00:00:00Z",
    },
  ]);
  assertEquals(result, "events[0].content is required");
});

Deno.test("validateEvents - accepts null JSON content", () => {
  const result = validateEvents([
    {
      id: EVENT_ID,
      run_id: RUN_ID,
      type: "custom",
      created_at: "2024-01-01T00:00:00Z",
      content: null,
    },
  ]);
  assertEquals(result, null);
});

Deno.test("validateEvents - accepts all valid types", () => {
  const types = [
    "user_input",
    "system_message",
    "assistant_message",
    "reasoning",
    "tool_arguments",
    "tool_result",
    "final_response",
    "custom",
  ];
  for (const type of types) {
    const result = validateEvents([
      {
        id: EVENT_ID,
        run_id: RUN_ID,
        project_id: PROJECT_ID,
        type,
        created_at: "2024-01-01T00:00:00Z",
        content: {},
      },
    ]);
    assertEquals(result, null);
  }
});

// ---------------------------------------------------------------------------
// Handler tests - CORS
// ---------------------------------------------------------------------------

Deno.test("handleIngestRequest - handles OPTIONS preflight", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const supabase = createMockStore({});
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    res.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
});

Deno.test("handleIngestRequest - rejects non-POST methods", async () => {
  const req = new Request("http://localhost", { method: "GET" });
  const supabase = createMockStore({});
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, "Method not allowed");
});

// ---------------------------------------------------------------------------
// Handler tests - Authentication
// ---------------------------------------------------------------------------

Deno.test("handleIngestRequest - rejects missing authorization", async () => {
  const req = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const supabase = createMockStore({});
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Missing or invalid authorization header");
});

Deno.test("handleIngestRequest - rejects invalid API key", async () => {
  const req = createAuthRequest({});
  const supabase = createMockStore({
    resolveApiKeyResult: { data: [], error: null },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Invalid or revoked API key");
});

Deno.test("handleIngestRequest - handles API key resolution error", async () => {
  const req = createAuthRequest({});
  const supabase = createMockStore({
    resolveApiKeyResult: { data: null, error: { message: "DB error" } },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
});

// ---------------------------------------------------------------------------
// Handler tests - Validation
// ---------------------------------------------------------------------------

Deno.test("handleIngestRequest - rejects invalid JSON", async () => {
  const req = new Request("http://localhost", {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: "not json",
  });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid JSON body");
});

Deno.test("handleIngestRequest - rejects wrong schema_version", async () => {
  const req = createAuthRequest({ schema_version: 2 });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Unsupported schema_version (expected 1)");
});

Deno.test("handleIngestRequest - rejects non-object JSON bodies", async () => {
  const req = createAuthRequest([]);
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "JSON body must be an object");
});

Deno.test("handleIngestRequest - rejects sessions not array", async () => {
  const req = createAuthRequest({ schema_version: 1, sessions: "not-array" });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "sessions must be an array");
});

Deno.test("handleIngestRequest - rejects invalid session data", async () => {
  const req = createAuthRequest({
    schema_version: 1,
    sessions: [{ id: "bad" }],
  });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "sessions[0].id is not a valid UUID");
});

// ---------------------------------------------------------------------------
// Handler tests - Success
// ---------------------------------------------------------------------------

Deno.test("handleIngestRequest - accepts valid payload", async () => {
  const req = createAuthRequest(createValidPayload());
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: { data: { accepted: true }, error: null },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

Deno.test("handleIngestRequest - preserves nested cost tracking fields", async () => {
  const payload = createValidPayload();
  payload.runs[0].metadata = {
    cost_usd: 0.0023,
    total_input_tokens: 100,
    total_output_tokens: 25,
  };
  payload.spans[0].attributes = {
    model: "gpt-4o",
    cost_usd: 0.0023,
    input_tokens: 100,
    output_tokens: 25,
    pricing_source: "litellm",
  };
  const req = createAuthRequest(payload);
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
  });

  const res = await handleIngestRequest(req, supabase);

  assertEquals(res.status, 200);
  assertEquals(supabase.ingestCalls[0].runs[0].metadata, payload.runs[0].metadata);
  assertEquals(
    supabase.ingestCalls[0].spans[0].attributes,
    payload.spans[0].attributes,
  );
});

Deno.test("handleIngestRequest - stamps authenticated project_id onto SDK payload", async () => {
  const req = createAuthRequest(createValidPayload());
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: { data: { accepted: true }, error: null },
  });

  const res = await handleIngestRequest(req, supabase);

  assertEquals(res.status, 200);

  const batch = supabase.ingestCalls[0];

  assertEquals(batch.projectId, PROJECT_ID);
  assertEquals(batch.sessions[0].project_id, PROJECT_ID);
  assertEquals(batch.runs[0].project_id, PROJECT_ID);
  assertEquals(batch.spans[0].project_id, PROJECT_ID);
  assertEquals(batch.events[0].project_id, PROJECT_ID);
});

Deno.test("handleIngestRequest - orders parent spans before child spans", async () => {
  const parentSpanId = "66666666-6666-6666-6666-666666666666";
  const childSpanId = "77777777-7777-7777-7777-777777777777";

  const req = createAuthRequest({
    schema_version: 1,
    sessions: [
      {
        id: SESSION_ID,
        created_at: "2024-01-01T00:00:00Z",
        metadata: {},
      },
    ],
    runs: [
      {
        id: RUN_ID,
        session_id: SESSION_ID,
        name: "test-run",
        started_at: "2024-01-01T00:00:00Z",
        status: "running",
        metadata: {},
      },
    ],
    spans: [
      {
        id: childSpanId,
        run_id: RUN_ID,
        parent_span_id: parentSpanId,
        kind: "tool",
        name: "child",
        started_at: "2024-01-01T00:00:01Z",
        status: "ok",
        attributes: {},
      },
      {
        id: parentSpanId,
        run_id: RUN_ID,
        kind: "agent",
        name: "parent",
        started_at: "2024-01-01T00:00:00Z",
        status: "ok",
        attributes: {},
      },
    ],
    events: [],
  });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: { data: { accepted: true }, error: null },
  });

  const res = await handleIngestRequest(req, supabase);

  assertEquals(res.status, 200);

  assertEquals(
    supabase.ingestCalls[0].spans.map((span) => span.id),
    [parentSpanId, childSpanId],
  );
});

Deno.test("handleIngestRequest - accepts empty arrays", async () => {
  const req = createAuthRequest({
    schema_version: 1,
    sessions: [],
    runs: [],
    spans: [],
    events: [],
  });
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: { data: { accepted: true }, error: null },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

// ---------------------------------------------------------------------------
// Handler tests - RPC errors
// ---------------------------------------------------------------------------

Deno.test("handleIngestRequest - handles project mismatch error", async () => {
  const req = createAuthRequest(createValidPayload());
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: {
      data: null,
      error: { message: "session 123 belongs to a different project" },
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Payload contains invalid project references");
});

Deno.test("handleIngestRequest - handles missing project references as bad payloads", async () => {
  const req = createAuthRequest(createValidPayload());
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: {
      data: null,
      error: { message: "parent span 123 not found for project" },
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Payload contains invalid project references");
});

Deno.test("handleIngestRequest - handles generic RPC error", async () => {
  const req = createAuthRequest(createValidPayload());
  const supabase = createMockStore({
    resolveApiKeyResult: {
      data: [{ key_id: "x", project_id: PROJECT_ID }],
      error: null,
    },
    ingestBatchResult: {
      data: null,
      error: { message: "Some other error" },
    },
  });
  const res = await handleIngestRequest(req, supabase);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

Deno.test("sha256hex - produces correct hash", async () => {
  const hash = await sha256hex("test");
  assertEquals(
    hash,
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  );
});

Deno.test("sha256hex - handles empty string", async () => {
  const hash = await sha256hex("");
  assertEquals(
    hash,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
