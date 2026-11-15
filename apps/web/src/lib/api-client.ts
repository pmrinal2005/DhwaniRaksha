import { z } from "zod";
import { exactnessSchema, sourceSchema, type Exactness, type DataSource } from "@/lib/telemetry/event-schema";

export const apiErrorSchema = z.object({
  error_code: z.string().optional(),
  message: z.string().optional(),
  detail: z.union([z.string(), z.object({ error_code: z.string().optional(), message: z.string().optional() }).loose(), z.array(z.unknown())]).optional(),
  error: z.object({ type: z.string().optional(), message: z.string().optional(), code: z.string().optional() }).loose().optional(),
}).loose();

export class DashApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number, public readonly path: string) {
    super(message);
    this.name = "DashApiError";
  }
}

export function responseSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, source: sourceSchema, exactness: exactnessSchema }).loose();
}

export type ApiPayload<T> = { data: T; source: DataSource; exactness: Exactness };
export const apiOrigin = (process.env.NEXT_PUBLIC_DASH_API_ORIGIN ?? "").replace(/\/$/, "");

export function dashboardUrl(path: string, params?: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => { if (value) query.set(key, value); });
  return `${apiOrigin}${path}${query.size ? `?${query}` : ""}`;
}

async function request(path: string, init?: RequestInit) {
  const url = dashboardUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: "include",
      signal: init?.signal ?? controller.signal,
      headers: { Accept: "application/json", ...init?.headers },
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      const detail = parsed.success ? parsed.data : undefined;
      const nestedDetail = typeof detail?.detail === "object" && !Array.isArray(detail.detail) ? detail.detail : undefined;
      const code = detail?.error_code ?? nestedDetail?.error_code ?? detail?.error?.type ?? detail?.error?.code ?? `HTTP_${response.status}`;
      const message = detail?.message ?? nestedDetail?.message ?? detail?.error?.message ?? (typeof detail?.detail === "string" ? detail.detail : response.statusText);
      throw new DashApiError(message || "Dashboard request failed", code, response.status, path);
    }
    return body;
  } catch (error) {
    if (error instanceof DashApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new DashApiError("The dashboard backend did not respond in time.", "UPSTREAM_TIMEOUT", 504, path);
    throw new DashApiError(error instanceof Error ? error.message : "Dashboard backend is unreachable.", "BACKEND_UNREACHABLE", 0, path);
  } finally {
    clearTimeout(timer);
  }
}

export async function getDashboard<T extends z.ZodType>(path: string, schema: T, init?: RequestInit): Promise<ApiPayload<z.infer<T>>> {
  const body = await request(path, init);
  const result = responseSchema(schema).safeParse(body);
  if (!result.success) throw new DashApiError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), "INVALID_API_SCHEMA", 502, path);
  return result.data as ApiPayload<z.infer<T>>;
}

export async function postDashboard<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<ApiPayload<z.infer<T>>> {
  const response = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = responseSchema(schema).safeParse(response);
  if (!result.success) throw new DashApiError("The backend returned an invalid mutation response.", "INVALID_API_SCHEMA", 502, path);
  return result.data as ApiPayload<z.infer<T>>;
}
