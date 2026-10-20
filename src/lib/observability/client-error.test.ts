import { describe, expect, it } from "vitest";
import { parseClientErrorReport } from "./client-error";

const valid = {
  context: "command:BuildSettlement",
  name: "QuotaExceededError",
  message: "Quota exceeded",
  page: "/catan",
};

describe("Feature: accepting browser error reports", () => {
  it("given a valid report, it is accepted as is", () => {
    expect(parseClientErrorReport(valid)).toEqual({ ok: true, value: valid });
  });

  it("given no name, it defaults to Error", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.name;
    expect(parseClientErrorReport(rest)).toEqual({ ok: true, value: { ...rest, name: "Error" } });
  });

  it("given extra fields, they are dropped", () => {
    const result = parseClientErrorReport({ ...valid, stack: "secret", cookie: "x" });
    expect(result.ok && Object.keys(result.value).sort()).toEqual(["context", "message", "name", "page"]);
  });

  it.each([null, "text", 42, [valid]])("given %j, it is refused", (body) => {
    expect(parseClientErrorReport(body)).toEqual({ ok: false, error: "report must be a JSON object" });
  });

  it.each(["context", "message", "page"])("given no %s, it is refused", (key) => {
    const body: Record<string, unknown> = { ...valid };
    delete body[key];
    expect(parseClientErrorReport(body)).toEqual({ ok: false, error: `${key} must be a non-empty string` });
  });

  it.each(["context", "name", "message", "page"])("given a blank %s, it is refused", (key) => {
    expect(parseClientErrorReport({ ...valid, [key]: "  " })).toEqual({
      ok: false,
      error: `${key} must be a non-empty string`,
    });
  });

  it("given a field that is not a string, it is refused", () => {
    expect(parseClientErrorReport({ ...valid, message: 5 }).ok).toBe(false);
  });

  it.each([
    ["context", 100],
    ["name", 100],
    ["message", 500],
    ["page", 200],
  ] as const)("given %s at its limit of %i characters, it is accepted, and one more is refused", (key, limit) => {
    const at = key === "page" ? `/${"a".repeat(limit - 1)}` : "a".repeat(limit);
    expect(parseClientErrorReport({ ...valid, [key]: at }).ok).toBe(true);
    expect(parseClientErrorReport({ ...valid, [key]: `${at}a` })).toEqual({
      ok: false,
      error: `${key} must be at most ${limit} characters`,
    });
  });

  it("given a page that is a full URL, it is refused", () => {
    expect(parseClientErrorReport({ ...valid, page: "https://evil.example/" })).toEqual({
      ok: false,
      error: "page must be a path starting with /",
    });
  });
});
