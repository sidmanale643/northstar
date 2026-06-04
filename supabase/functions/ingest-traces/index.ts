import postgres from "postgres";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function corsResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const VALID_SPAN_KINDS = new Set([
  "agent",
  "workflow",
  "model",
  "tool",
  "custom",
]);

const VALID_STATUSES = new Set(["running", "ok", "error"]);

const VALID_EVENT_TYPES = new Set([
  "user_input",
  "system_message",
  "assistant_message",
  "reasoning",
  "tool_arguments",
  "tool_result",
  "final_response",
  "custom",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
      .test(
        v,
      )
  ) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateOptionalProjectId(
  value: unknown,
  path: string,
): string | null {
  if (value == null) {
    return null;
  }

  if (!isUuid(value)) {
    return `${path} is not a valid UUID`;
  }

  return null;
}

function validateKeys(
  record: Record<string, unknown>,
  path: string,
  allowedKeys: Set<string>,
): string | null {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return `${path}.${key} is not allowed`;
    }
  }
  return null;
}

const SESSION_KEYS = new Set([
  "id",
  "project_id",
  "created_at",
  "ended_at",
  "metadata",
]);

const RUN_KEYS = new Set([
  "id",
  "session_id",
  "project_id",
  "name",
  "started_at",
  "ended_at",
  "status",
  "error",
  "metadata",
]);

const SPAN_KEYS = new Set([
  "id",
  "run_id",
  "project_id",
  "parent_span_id",
  "kind",
  "name",
  "started_at",
  "ended_at",
  "status",
  "error",
  "iteration",
  "attributes",
]);

const EVENT_KEYS = new Set([
  "id",
  "run_id",
  "span_id",
  "project_id",
  "type",
  "created_at",
  "content",
  "attributes",
]);

export function validateSessions(sessions: unknown[]): string | null {
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (!isPlainObject(s)) return `sessions[${i}] is not an object`;
    const keysError = validateKeys(s, `sessions[${i}]`, SESSION_KEYS);
    if (keysError) return keysError;
    if (!isUuid(s.id)) return `sessions[${i}].id is not a valid UUID`;
    const projectIdError = validateOptionalProjectId(
      s.project_id,
      `sessions[${i}].project_id`,
    );
    if (projectIdError) return projectIdError;
    if (!isIsoDate(s.created_at)) {
      return `sessions[${i}].created_at is not a valid ISO timestamp`;
    }
    if (s.ended_at != null && !isIsoDate(s.ended_at)) {
      return `sessions[${i}].ended_at is not a valid ISO timestamp`;
    }
    if (s.metadata != null && !isPlainObject(s.metadata)) {
      return `sessions[${i}].metadata must be an object`;
    }
  }
  return null;
}

export function validateRuns(runs: unknown[]): string | null {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!isPlainObject(r)) return `runs[${i}] is not an object`;
    const keysError = validateKeys(r, `runs[${i}]`, RUN_KEYS);
    if (keysError) return keysError;
    if (!isUuid(r.id)) return `runs[${i}].id is not a valid UUID`;
    if (!isUuid(r.session_id)) {
      return `runs[${i}].session_id is not a valid UUID`;
    }
    const projectIdError = validateOptionalProjectId(
      r.project_id,
      `runs[${i}].project_id`,
    );
    if (projectIdError) return projectIdError;
    if (typeof r.name !== "string" || r.name.length === 0) {
      return `runs[${i}].name is required`;
    }
    if (!isIsoDate(r.started_at)) {
      return `runs[${i}].started_at is not a valid ISO timestamp`;
    }
    if (r.ended_at != null && !isIsoDate(r.ended_at)) {
      return `runs[${i}].ended_at is not a valid ISO timestamp`;
    }
    if (typeof r.status !== "string" || !VALID_STATUSES.has(r.status)) {
      return `runs[${i}].status must be one of: ${
        [...VALID_STATUSES].join(", ")
      }`;
    }
    if (r.error != null && !isPlainObject(r.error)) {
      return `runs[${i}].error must be an object`;
    }
    if (r.metadata != null && !isPlainObject(r.metadata)) {
      return `runs[${i}].metadata must be an object`;
    }
  }
  return null;
}

export function validateSpans(spans: unknown[]): string | null {
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    if (!isPlainObject(sp)) return `spans[${i}] is not an object`;
    const keysError = validateKeys(sp, `spans[${i}]`, SPAN_KEYS);
    if (keysError) return keysError;
    if (!isUuid(sp.id)) return `spans[${i}].id is not a valid UUID`;
    if (!isUuid(sp.run_id)) return `spans[${i}].run_id is not a valid UUID`;
    const projectIdError = validateOptionalProjectId(
      sp.project_id,
      `spans[${i}].project_id`,
    );
    if (projectIdError) return projectIdError;
    if (sp.parent_span_id != null && !isUuid(sp.parent_span_id)) {
      return `spans[${i}].parent_span_id is not a valid UUID`;
    }
    if (typeof sp.kind !== "string" || !VALID_SPAN_KINDS.has(sp.kind)) {
      return `spans[${i}].kind must be one of: ${
        [...VALID_SPAN_KINDS].join(", ")
      }`;
    }
    if (typeof sp.name !== "string" || sp.name.length === 0) {
      return `spans[${i}].name is required`;
    }
    if (!isIsoDate(sp.started_at)) {
      return `spans[${i}].started_at is not a valid ISO timestamp`;
    }
    if (sp.ended_at != null && !isIsoDate(sp.ended_at)) {
      return `spans[${i}].ended_at is not a valid ISO timestamp`;
    }
    if (typeof sp.status !== "string" || !VALID_STATUSES.has(sp.status)) {
      return `spans[${i}].status must be one of: ${
        [...VALID_STATUSES].join(", ")
      }`;
    }
    if (sp.error != null && !isPlainObject(sp.error)) {
      return `spans[${i}].error must be an object`;
    }
    if (sp.iteration != null && !Number.isInteger(sp.iteration)) {
      return `spans[${i}].iteration must be an integer`;
    }
    if (sp.attributes != null && !isPlainObject(sp.attributes)) {
      return `spans[${i}].attributes must be an object`;
    }
  }
  return null;
}

export function validateEvents(events: unknown[]): string | null {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!isPlainObject(e)) return `events[${i}] is not an object`;
    const keysError = validateKeys(e, `events[${i}]`, EVENT_KEYS);
    if (keysError) return keysError;
    if (!isUuid(e.id)) return `events[${i}].id is not a valid UUID`;
    if (!isUuid(e.run_id)) return `events[${i}].run_id is not a valid UUID`;
    const projectIdError = validateOptionalProjectId(
      e.project_id,
      `events[${i}].project_id`,
    );
    if (projectIdError) return projectIdError;
    if (e.span_id != null && !isUuid(e.span_id)) {
      return `events[${i}].span_id is not a valid UUID`;
    }
    if (typeof e.type !== "string" || !VALID_EVENT_TYPES.has(e.type)) {
      return `events[${i}].type must be one of: ${
        [...VALID_EVENT_TYPES].join(", ")
      }`;
    }
    if (!isIsoDate(e.created_at)) {
      return `events[${i}].created_at is not a valid ISO timestamp`;
    }
    if (!Object.hasOwn(e, "content")) {
      return `events[${i}].content is required`;
    }
    if (e.attributes != null && !isPlainObject(e.attributes)) {
      return `events[${i}].attributes must be an object`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Project association
// ---------------------------------------------------------------------------

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type PersistedRecord = Record<string, JsonValue>;

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isPlainObject(value) && Object.values(value).every(isJsonValue);
}

function stampProjectId(
  records: unknown[],
  projectId: string,
): PersistedRecord[] {
  return records.map((record) => {
    if (!isPlainObject(record)) {
      throw new Error("validated record is not an object");
    }

    const stampedRecord: PersistedRecord = {};
    for (const [key, value] of Object.entries(record)) {
      if (!isJsonValue(value)) {
        throw new Error("validated record contains a non-JSON value");
      }
      stampedRecord[key] = value;
    }
    stampedRecord.project_id = projectId;
    return stampedRecord;
  });
}

function getStringField(
  record: PersistedRecord,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function orderSpansByParent(
  spans: PersistedRecord[],
): PersistedRecord[] {
  const childrenByParent = new Map<string, PersistedRecord[]>();
  const roots: PersistedRecord[] = [];
  const spanIds = new Set(
    spans
      .map((span) => getStringField(span, "id"))
      .filter((id): id is string => id !== null),
  );

  for (const span of spans) {
    const parentSpanId = getStringField(span, "parent_span_id");
    if (parentSpanId !== null && spanIds.has(parentSpanId)) {
      const children = childrenByParent.get(parentSpanId) ?? [];
      children.push(span);
      childrenByParent.set(parentSpanId, children);
      continue;
    }

    roots.push(span);
  }

  const ordered: PersistedRecord[] = [];
  const seen = new Set<string>();

  const visit = (span: PersistedRecord) => {
    const spanId = getStringField(span, "id");
    if (spanId !== null) {
      if (seen.has(spanId)) {
        return;
      }
      seen.add(spanId);
    }

    ordered.push(span);

    if (spanId === null) {
      return;
    }

    for (const child of childrenByParent.get(spanId) ?? []) {
      visit(child);
    }
  };

  for (const span of roots) {
    visit(span);
  }

  if (ordered.length === spans.length) {
    return ordered;
  }

  for (const span of spans) {
    visit(span);
  }

  return ordered;
}

function isProjectReferenceError(message: string | undefined): boolean {
  return message?.includes("belongs to a different project") === true ||
    message?.includes("not found for project") === true;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export type IngestBatch = {
  projectId: string;
  sessions: PersistedRecord[];
  runs: PersistedRecord[];
  spans: PersistedRecord[];
  events: PersistedRecord[];
};

export interface IngestStore {
  resolveProjectId(keyHash: string): Promise<string | null>;
  ingestBatch(batch: IngestBatch): Promise<void>;
}

export function createPostgresIngestStore(
  sql: ReturnType<typeof postgres>,
): IngestStore {
  return {
    async resolveProjectId(keyHash: string): Promise<string | null> {
      const rows = await sql<{ project_id: string }[]>`
        SELECT project_id
        FROM private.resolve_api_key(${keyHash})
      `;
      return rows[0]?.project_id ?? null;
    },

    async ingestBatch(batch: IngestBatch): Promise<void> {
      await sql`
        SELECT private.ingest_batch(
          ${batch.projectId}::uuid,
          ${sql.json(batch.sessions)}::jsonb,
          ${sql.json(batch.runs)}::jsonb,
          ${sql.json(batch.spans)}::jsonb,
          ${sql.json(batch.events)}::jsonb
        )
      `;
    },
  };
}

// ---------------------------------------------------------------------------
// Handler (exported for testing)
// ---------------------------------------------------------------------------

export async function handleIngestRequest(
  req: Request,
  store: IngestStore,
): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return corsResponse(405, { error: "Method not allowed" });
  }

  // 1. Parse bearer token
  const token = extractBearerToken(req);
  if (!token) {
    return corsResponse(401, {
      error: "Missing or invalid authorization header",
    });
  }

  // 2. Hash token and resolve API key
  const keyHash = await sha256hex(token);
  let projectId: string | null;
  try {
    projectId = await store.resolveProjectId(keyHash);
  } catch (error) {
    console.error("resolve_api_key error:", error);
    return corsResponse(500, { error: "Internal server error" });
  }

  if (projectId === null) {
    return corsResponse(401, { error: "Invalid or revoked API key" });
  }

  // 3. Parse body
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return corsResponse(400, { error: "Invalid JSON body" });
  }

  if (!isPlainObject(parsedBody)) {
    return corsResponse(400, { error: "JSON body must be an object" });
  }
  const body = parsedBody;

  // 4. Validate schema_version
  if (body.schema_version !== 1) {
    return corsResponse(400, {
      error: "Unsupported schema_version (expected 1)",
    });
  }

  // 5. Extract arrays
  const rawSessions = body.sessions ?? [];
  const rawRuns = body.runs ?? [];
  const rawSpans = body.spans ?? [];
  const rawEvents = body.events ?? [];

  if (!Array.isArray(rawSessions)) {
    return corsResponse(400, { error: "sessions must be an array" });
  }
  if (!Array.isArray(rawRuns)) {
    return corsResponse(400, { error: "runs must be an array" });
  }
  if (!Array.isArray(rawSpans)) {
    return corsResponse(400, { error: "spans must be an array" });
  }
  if (!Array.isArray(rawEvents)) {
    return corsResponse(400, { error: "events must be an array" });
  }

  // 6. Validate each entity type
  const sessionsErr = validateSessions(rawSessions);
  if (sessionsErr) return corsResponse(400, { error: sessionsErr });

  const runsErr = validateRuns(rawRuns);
  if (runsErr) return corsResponse(400, { error: runsErr });

  const spansErr = validateSpans(rawSpans);
  if (spansErr) return corsResponse(400, { error: spansErr });

  const eventsErr = validateEvents(rawEvents);
  if (eventsErr) return corsResponse(400, { error: eventsErr });

  // 7. Stamp project_id on every record
  const sessions = stampProjectId(
    rawSessions,
    projectId,
  );
  const runs = stampProjectId(
    rawRuns,
    projectId,
  );
  const spans = stampProjectId(
    rawSpans,
    projectId,
  );
  const events = stampProjectId(
    rawEvents,
    projectId,
  );
  const orderedSpans = orderSpansByParent(spans);

  // 8. Call transactional RPC
  try {
    await store.ingestBatch({
      projectId,
      sessions,
      runs,
      spans: orderedSpans,
      events,
    });
  } catch (error) {
    console.error("ingest_batch error:", error);

    if (error instanceof Error && isProjectReferenceError(error.message)) {
      return corsResponse(400, {
        error: "Payload contains invalid project references",
      });
    }

    return corsResponse(500, { error: "Internal server error" });
  }

  return corsResponse(200, { accepted: true });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  const store = createPostgresIngestStore(sql);

  Deno.serve(async (req: Request) => {
    return handleIngestRequest(req, store);
  });
}
