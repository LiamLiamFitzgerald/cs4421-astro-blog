import { err, ok, type Result } from "../core/result";

/** Largest report body accepted, in bytes. Anything bigger is refused unread. */
export const MAX_REPORT_BYTES = 4096;

/** An unexpected error seen in a visitor's browser, as accepted by the server. */
export interface ClientErrorReport {
  /** Where in the app it happened, for example "command:BuildSettlement". */
  readonly context: string;
  readonly name: string;
  readonly message: string;
  /** Path of the page, without query string. */
  readonly page: string;
}

const LIMITS = { context: 100, name: 100, message: 500, page: 200 } as const;

/**
 * Validates an untrusted report body. Pure, so the API route stays thin and
 * every rule here is unit- and mutation-tested. Returns why a report was
 * refused rather than throwing.
 */
export function parseClientErrorReport(body: unknown): Result<ClientErrorReport, string> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("report must be a JSON object");
  }
  const fields = body as Record<string, unknown>;
  const report: Partial<Record<keyof ClientErrorReport, string>> = {};
  for (const key of Object.keys(LIMITS) as (keyof ClientErrorReport)[]) {
    const value = fields[key] ?? (key === "name" ? "Error" : undefined);
    if (typeof value !== "string" || value.trim() === "") return err(`${key} must be a non-empty string`);
    if (value.length > LIMITS[key]) return err(`${key} must be at most ${LIMITS[key]} characters`);
    report[key] = value;
  }
  const complete = report as ClientErrorReport;
  if (!complete.page.startsWith("/")) return err("page must be a path starting with /");
  return ok(complete);
}
