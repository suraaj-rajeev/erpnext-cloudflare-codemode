# ERPNext Cloudflare Code Mode

A Cloudflare Worker that exposes a small, authenticated, **read-only** ERPNext API through Cloudflare Code Mode's MCP search-and-execute interface.

## Supported doctypes

- **Customer**
- **Item**
- **Supplier**
- **Sales Order**

Only list/search GET operations are exposed. There are no document creation, updates, submission, cancellation, deletion, arbitrary Frappe methods, or arbitrary outbound URLs.

## Architecture

1. An MCP client connects to `/mcp` using a separate `MCP_ACCESS_TOKEN`.
2. Cloudflare Code Mode exposes `search` and `execute` for the OpenAPI contract.
3. The host Worker validates each upstream operation and query against a doctype/field/operator allowlist.
4. The Worker authenticates to Frappe using server-side API credentials.
5. Code Mode's sandbox never receives the ERPNext credentials.

Use a dedicated ERPNext integration user with read-only roles and access limited to the required doctypes. Application restrictions are defense in depth, not a substitute for ERPNext permissions.

## Requirements

- Node.js 20 or newer
- npm
- Cloudflare account with Workers and Worker Loader support enabled
- ERPNext/Frappe site with API access enabled

## Install and run locally

```bash
npm install
cp .env.example .dev.vars
```

Edit `.dev.vars` with a test site's URL and credentials. Do not commit this file.

```bash
npm run typecheck
npm test
npm run dev
```

The public health endpoint is `GET /`. The MCP endpoint is `/mcp` and requires `Authorization: Bearer <MCP_ACCESS_TOKEN>`.

## Configure Cloudflare secrets

Set the non-secret base URL as a Worker variable in `wrangler.jsonc` and credentials as secrets:

```bash
npx wrangler secret put ERPNEXT_API_KEY
npx wrangler secret put ERPNEXT_API_SECRET
npx wrangler secret put MCP_ACCESS_TOKEN
npx wrangler deploy
```

Set `ERPNEXT_BASE_URL` to your ERPNext site's HTTPS origin, e.g. `https://example.frappe.cloud`. Never include credentials, query strings, or fragments in the URL.

Generate a long random MCP token. Keep it separate from the ERPNext API key and secret, and rotate it if exposed.

## Connect an MCP client

After deployment:

- Server URL: `https://<worker-name>.<your-subdomain>.workers.dev/mcp`
- Authorization header: `Bearer <your MCP_ACCESS_TOKEN>`

Call `search` first to inspect the approved endpoints, then `execute` to compose a query.

Example search code:

```js
async () => {
  const spec = await codemode.spec();
  return Object.entries(spec.paths).map(([path, methods]) => ({
    path,
    methods: Object.keys(methods)
  }));
}
```

Example execute code:

```js
async () => {
  const result = await codemode.request({
    method: "GET",
    path: "/api/resource/Customer",
    query: {
      fields: JSON.stringify(["name", "customer_name", "customer_group"]),
      filters: JSON.stringify([["Customer", "customer_name", "like", "%Acme%"]]),
      limit_page_length: 20
    }
  });
  return result.data;
}
```

Use only fields listed in `src/openapi.ts`. Sales Orders return summary-level fields; child item rows are not exposed by this API.

## Security controls

- Independent MCP bearer token and ERPNext credentials
- HTTPS-only ERPNext origin
- Fixed origin; no user-supplied hosts
- GET-only upstream access
- Doctype and field allowlists enforced by the host
- Filter operator and sort validation
- Page size capped at 100, filter count capped at 20
- Upstream timeout and response-size cap
- No-store health response; upstream error bodies are not exposed
- Secrets excluded from Git

## Validation status

Run `npm run typecheck` and `npm test` before deploying. Tests cover allowlists, query validation, and bearer-token matching. A live ERPNext smoke test is still required with a non-production, read-only integration user.

Cloudflare Code Mode is experimental and can introduce breaking changes. Verify the current Cloudflare documentation and test in a staging Worker before using production data.
