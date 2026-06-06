import postgres from "postgres";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedPromptRow = {
  prompt_id: string;
  prompt_version_id: string;
  version_number: number;
  content: string;
  model: string | null;
  temperature: number | string | null;
  max_tokens: number | null;
  variables: unknown;
  content_hash: string;
};

export interface PromptStore {
  resolveProjectId(keyHash: string): Promise<string | null>;
  resolvePrompt(input: {
    projectId: string;
    slug: string;
    label: string;
    version: number | null;
  }): Promise<ResolvedPromptRow | null>;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getVersion(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizePromptVersion(row: ResolvedPromptRow): Record<string, unknown> {
  return {
    id: row.prompt_version_id,
    prompt_id: row.prompt_id,
    version_number: row.version_number,
    content: row.content,
    model: row.model,
    temperature: row.temperature === null ? null : Number(row.temperature),
    max_tokens: row.max_tokens,
    variables: row.variables,
    content_hash: row.content_hash,
  };
}

export function createPostgresPromptStore(
  sql: ReturnType<typeof postgres>,
): PromptStore {
  return {
    async resolveProjectId(keyHash: string): Promise<string | null> {
      const rows = await sql<{ project_id: string }[]>`
        SELECT project_id
        FROM private.resolve_api_key(${keyHash})
      `;
      return rows[0]?.project_id ?? null;
    },

    async resolvePrompt(input): Promise<ResolvedPromptRow | null> {
      const rows = await sql<ResolvedPromptRow[]>`
        SELECT *
        FROM public.dashboard_resolve_prompt(
          ${input.projectId}::uuid,
          ${input.slug},
          ${input.label},
          ${input.version}::integer
        )
      `;
      return rows[0] ?? null;
    },
  };
}

export async function handlePromptRequest(
  req: Request,
  store: PromptStore,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const url = new URL(req.url);
  if (!url.pathname.endsWith("/resolve")) {
    return jsonResponse(404, { error: "Not found" });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return jsonResponse(401, {
      error: "Missing or invalid authorization header",
    });
  }

  let projectId: string | null;
  try {
    projectId = await store.resolveProjectId(await sha256hex(token));
  } catch (error) {
    console.error("resolve_api_key error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }

  if (projectId === null || !UUID_RE.test(projectId)) {
    return jsonResponse(401, { error: "Invalid or revoked API key" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!isRecord(body)) {
    return jsonResponse(400, { error: "JSON body must be an object" });
  }

  const slug = getString(body.slug) ?? getString(body.name);
  if (!slug) {
    return jsonResponse(400, { error: "slug is required" });
  }

  const label = getString(body.label) ?? "prod";
  const version = getVersion(body.version);
  if (body.version !== undefined && version === null) {
    return jsonResponse(400, { error: "version must be an integer" });
  }

  try {
    const prompt = await store.resolvePrompt({
      projectId,
      slug,
      label,
      version,
    });
    if (prompt === null) {
      return jsonResponse(404, { error: "Prompt not found" });
    }
    return jsonResponse(200, {
      prompt_version: normalizePromptVersion(prompt),
    });
  } catch (error) {
    console.error("dashboard_resolve_prompt error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
}

if (import.meta.main) {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  const store = createPostgresPromptStore(sql);

  Deno.serve((req: Request) => handlePromptRequest(req, store));
}
