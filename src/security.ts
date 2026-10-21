import { ALLOWED_DOCTYPE_FIELDS } from "./openapi";

const SAFE_OPERATORS = new Set([
  "=", "!=", ">", "<", ">=", "<=", "like", "not like", "in", "not in",
  "is", "between"
]);

export class RequestPolicyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RequestPolicyError";
  }
}

export function parseAllowedResourcePath(path: string): string {
  if (!path.startsWith("/") || path.includes("..") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    throw new RequestPolicyError("Invalid API path");
  }
  const match = /^\/api\/resource\/(Customer|Item|Supplier|Sales(?:%20| )Order)$/i.exec(path);
  if (!match) throw new RequestPolicyError("Only approved ERPNext resource endpoints are allowed", 403);
  const encoded = match[1];
  const doctype = decodeURIComponent(encoded);
  const canonical = Object.keys(ALLOWED_DOCTYPE_FIELDS).find(
    (name) => name.toLowerCase() === doctype.toLowerCase()
  );
  if (!canonical) throw new RequestPolicyError("Doctype is not allowed", 403);
  return canonical;
}

function parseJsonParam<T>(value: unknown, label: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new RequestPolicyError(`${label} must be a JSON string`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new RequestPolicyError(`${label} must contain valid JSON`);
  }
}

export function validateQuery(doctype: string, input: Record<string, unknown>): URLSearchParams {
  const allowedFields = ALLOWED_DOCTYPE_FIELDS[doctype];
  if (!allowedFields) throw new RequestPolicyError("Doctype is not allowed", 403);

  const output = new URLSearchParams();
  const fields = parseJsonParam<unknown>(input.fields, "fields");
  if (fields !== undefined) {
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > allowedFields.length ||
        fields.some((field) => typeof field !== "string" || !allowedFields.includes(field))) {
      throw new RequestPolicyError("fields contains an unapproved field");
    }
    output.set("fields", JSON.stringify([...new Set(fields)]));
  } else {
    output.set("fields", JSON.stringify(["name", ...allowedFields.filter((field) => field !== "name").slice(0, 8)]));
  }

  const filters = parseJsonParam<unknown>(input.filters, "filters");
  if (filters !== undefined) {
    if (!Array.isArray(filters) || filters.length > 20) throw new RequestPolicyError("filters must be an array with at most 20 entries");
    const normalized = filters.map((filter) => {
      if (!Array.isArray(filter)) throw new RequestPolicyError("Each filter must be an array");
      let field: unknown;
      let operator: unknown;
      let value: unknown;
      if (filter.length === 3) [field, operator, value] = filter;
      else if (filter.length === 4) {
        const [doctypeInFilter, f, op, v] = filter;
        if (doctypeInFilter !== doctype) throw new RequestPolicyError("Filter doctype does not match the requested resource");
        [field, operator, value] = [f, op, v];
      } else throw new RequestPolicyError("Filter must have 3 or 4 elements");
      if (typeof field !== "string" || !allowedFields.includes(field)) throw new RequestPolicyError("Filter field is not allowed");
      if (typeof operator !== "string" || !SAFE_OPERATORS.has(operator.toLowerCase())) throw new RequestPolicyError("Filter operator is not allowed");
      if (value === undefined || value === null || (typeof value === "object" && !Array.isArray(value))) throw new RequestPolicyError("Filter value must be a scalar or scalar array");
      if (Array.isArray(value) && (value.length > 100 || value.some((item) => item === null || typeof item === "object"))) {
        throw new RequestPolicyError("Filter array is invalid or too large");
      }
      return [doctype, field, operator.toLowerCase(), value];
    });
    output.set("filters", JSON.stringify(normalized));
  }

  if (input.order_by !== undefined && input.order_by !== "") {
    if (typeof input.order_by !== "string") throw new RequestPolicyError("order_by must be a string");
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(asc|desc)$/i.exec(input.order_by.trim());
    if (!match || !allowedFields.includes(match[1])) throw new RequestPolicyError("order_by must use an approved field and asc/desc");
    output.set("order_by", `${match[1]} ${match[2].toLowerCase()}`);
  }

  for (const key of ["limit_start", "limit_page_length"] as const) {
    if (input[key] !== undefined && input[key] !== "") {
      const number = Number(input[key]);
      const max = key === "limit_start" ? 100000 : 100;
      const min = key === "limit_start" ? 0 : 1;
      if (!Number.isInteger(number) || number < min || number > max) {
        throw new RequestPolicyError(`${key} must be an integer between ${min} and ${max}`);
      }
      output.set(key, String(number));
    }
  }
  if (!output.has("limit_page_length")) output.set("limit_page_length", "20");
  return output;
}

export async function bearerMatches(header: string | null, expected: string): Promise<boolean> {
  if (!header?.startsWith("Bearer ") || !expected) return false;
  const supplied = header.slice(7);
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 && supplied.length > 0;
}
