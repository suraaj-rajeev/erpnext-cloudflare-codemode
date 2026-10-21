import { describe, expect, it } from "vitest";
import { bearerMatches, parseAllowedResourcePath, RequestPolicyError, validateQuery } from "../src/security";

describe("ERPNext resource allowlist", () => {
  it("allows the four supported doctypes", () => {
    expect(parseAllowedResourcePath("/api/resource/Customer")).toBe("Customer");
    expect(parseAllowedResourcePath("/api/resource/Item")).toBe("Item");
    expect(parseAllowedResourcePath("/api/resource/Supplier")).toBe("Supplier");
    expect(parseAllowedResourcePath("/api/resource/Sales%20Order")).toBe("Sales Order");
  });

  it("rejects doctypes and paths outside the allowlist", () => {
    expect(() => parseAllowedResourcePath("/api/resource/User")).toThrow(RequestPolicyError);
    expect(() => parseAllowedResourcePath("/api/method/frappe.auth.get_logged_user")).toThrow(RequestPolicyError);
    expect(() => parseAllowedResourcePath("/api/resource/Customer/anything")).toThrow(RequestPolicyError);
    expect(() => parseAllowedResourcePath("/api/resource/../User")).toThrow(RequestPolicyError);
  });
});

describe("query validation", () => {
  it("accepts approved fields, filters, sorting, and bounded pagination", () => {
    const query = validateQuery("Customer", {
      fields: JSON.stringify(["name", "customer_name"]),
      filters: JSON.stringify([["Customer", "customer_name", "like", "%Acme%"]]),
      order_by: "modified desc",
      limit_page_length: "50",
      limit_start: "0"
    });
    expect(query.get("fields")).toBe(JSON.stringify(["name", "customer_name"]));
    expect(JSON.parse(query.get("filters") ?? "[]")).toEqual([["Customer", "customer_name", "like", "%Acme%"]]);
    expect(query.get("limit_page_length")).toBe("50");
  });

  it("rejects unapproved fields and unsafe sorting", () => {
    expect(() => validateQuery("Customer", { fields: JSON.stringify(["name", "owner"]) })).toThrow(RequestPolicyError);
    expect(() => validateQuery("Customer", { order_by: "owner desc" })).toThrow(RequestPolicyError);
    expect(() => validateQuery("Customer", { limit_page_length: "1000" })).toThrow(RequestPolicyError);
  });

  it("rejects filters with disallowed fields or operators", () => {
    expect(() => validateQuery("Customer", { filters: JSON.stringify([["Customer", "owner", "=", "x"]]) })).toThrow(RequestPolicyError);
    expect(() => validateQuery("Customer", { filters: JSON.stringify([["Customer", "name", "delete", "x"]]) })).toThrow(RequestPolicyError);
  });
});

describe("MCP bearer authentication", () => {
  it("accepts only a matching bearer token", async () => {
    expect(await bearerMatches("Bearer secret-token", "secret-token")).toBe(true);
    expect(await bearerMatches("Bearer wrong", "secret-token")).toBe(false);
    expect(await bearerMatches(null, "secret-token")).toBe(false);
    expect(await bearerMatches("Bearer anything", "")).toBe(false);
  });
});
