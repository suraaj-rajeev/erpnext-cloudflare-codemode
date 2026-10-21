import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { openApiMcpServer } from "@cloudflare/codemode/mcp";
import { createLegacyMcpHandler } from "agents/mcp";
import { ERPNEXT_OPENAPI_SPEC } from "./openapi";
import { bearerMatches, parseAllowedResourcePath, RequestPolicyError, validateQuery } from "./security";

interface Env {
  LOADER: { get(name: string): unknown };
  ERPNEXT_BASE_URL: string;
  ERPNEXT_API_KEY: string;
  ERPNEXT_API_SECRET: string;
  MCP_ACCESS_TOKEN: string;
}

const MAX_RESPONSE_BYTES = 1_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function validBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ERPNEXT_BASE_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ERPNEXT_BASE_URL must be HTTPS and must not contain credentials, query, or hash");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function normalizeQuery(query: Record<string, unknown> | undefined): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (!["fields", "filters", "order_by", "limit_start", "limit_page_length"].includes(key)) {
      throw new RequestPolicyError(`Query parameter is not allowed: ${key}`);
    }
    if (typeof value === "string" || typeof value === "number") normalized[key] = String(value);
    else if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
      normalized[key] = JSON.stringify(value);
    } else {
      throw new RequestPolicyError(`Invalid query parameter: ${key}`);
    }
  }
  return normalized;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        name: "ERPNext Cloudflare Code Mode",
        status: "ok",
        mcp_endpoint: "/mcp",
        access: "authenticated",
        operations: "read-only",
        doctypes: ["Customer", "Item", "Supplier", "Sales Order"]
      });
    }

    if (url.pathname !== "/mcp") return json({ error: "Not found" }, 404);
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!await bearerMatches(request.headers.get("authorization"), env.MCP_ACCESS_TOKEN ?? "")) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (!env.ERPNEXT_BASE_URL || !env.ERPNEXT_API_KEY || !env.ERPNEXT_API_SECRET) {
      return json({ error: "Server is missing required ERPNext secrets" }, 503);
    }

    let base: URL;
    try {
      base = validBaseUrl(env.ERPNEXT_BASE_URL);
    } catch {
      return json({ error: "Invalid ERPNEXT_BASE_URL configuration" }, 500);
    }

    const server = openApiMcpServer({
      spec: ERPNEXT_OPENAPI_SPEC,
      executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
      name: "erpnext-readonly",
      version: "1.0.0",
      request: async (options) => {
        if (options.method !== "GET") {
          throw new RequestPolicyError("Only GET requests are permitted", 403);
        }
        const doctype = parseAllowedResourcePath(options.path);
        const query = validateQuery(doctype, normalizeQuery(options.query as Record<string, unknown> | undefined));
        const upstreamUrl = new URL(`/api/resource/${encodeURIComponent(doctype)}`, base.origin);
        const prefix = base.pathname.replace(/\/+$/, "");
        upstreamUrl.pathname = `${prefix}${upstreamUrl.pathname}`;
        upstreamUrl.search = query.toString();

        const upstream = await fetch(upstreamUrl.toString(), {
          method: "GET",
          headers: {
            authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}`,
            accept: "application/json"
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!upstream.ok) throw new Error(`ERPNext request failed with status ${upstream.status}`);
        const contentType = upstream.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("ERPNext returned an unexpected content type");
        }
        const text = await upstream.text();
        if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
          throw new Error("ERPNext response exceeded the 1 MB response limit; reduce the page size");
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("ERPNext returned invalid JSON");
        }
      }
    });

    return createLegacyMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  }
};
