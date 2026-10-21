/**
 * Deliberately small OpenAPI surface. Only GET/list operations for approved
 * doctypes are published. The host request handler enforces this allowlist
 * again; the OpenAPI document is discovery metadata, not the security boundary.
 */
const doctypeFields: Record<string, string[]> = {
  Customer: [
    "name", "customer_name", "customer_type", "customer_group", "territory",
    "default_currency", "disabled", "email_id", "mobile_no", "modified"
  ],
  Item: [
    "name", "item_name", "item_group", "stock_uom", "is_stock_item",
    "disabled", "standard_rate", "description", "modified"
  ],
  Supplier: [
    "name", "supplier_name", "supplier_group", "supplier_type",
    "default_currency", "disabled", "email_id", "mobile_no", "modified"
  ],
  "Sales Order": [
    "name", "customer", "customer_name", "transaction_date", "delivery_date",
    "status", "docstatus", "currency", "grand_total", "rounded_total",
    "per_delivered", "per_billed", "company", "modified"
  ]
};

const paths: Record<string, unknown> = {};
for (const doctype of Object.keys(doctypeFields)) {
  paths[`/api/resource/${encodeURIComponent(doctype)}`] = {
    get: {
      operationId: `list${doctype.replace(/[^A-Za-z0-9]/g, "")}Records`,
      summary: `List or search ${doctype} records (read-only)`,
      description:
        "GET only. Use fields from the approved list for this doctype. Filters are restricted to approved fields and safe comparison operators. Results are capped at 100 rows.",
      parameters: [
        { name: "fields", in: "query", required: false, schema: { type: "string" }, description: `JSON array of field names. Approved fields: ${doctypeFields[doctype].join(", ")}` },
        { name: "filters", in: "query", required: false, schema: { type: "string" }, description: 'JSON array of [doctype, field, operator, value] or [field, operator, value] filters.' },
        { name: "order_by", in: "query", required: false, schema: { type: "string" }, description: "Approved field followed by asc or desc." },
        { name: "limit_start", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000 } },
        { name: "limit_page_length", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
      ],
      responses: {
        "200": {
          description: "ERPNext resource list response",
          content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object", additionalProperties: true } } } } }
        },
        "400": { description: "Invalid or disallowed query" },
        "401": { description: "ERPNext rejected credentials" },
        "403": { description: "Forbidden operation" },
        "502": { description: "ERPNext upstream error" }
      }
    }
  };
}

export const ERPNEXT_OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "ERPNext Read-only Search API",
    version: "1.0.0",
    description: "Read-only search for Customer, Item, Supplier and Sales Order records. Write operations are not exposed."
  },
  servers: [{ url: "/" }],
  paths
};

export const ALLOWED_DOCTYPE_FIELDS = doctypeFields;
