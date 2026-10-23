import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("Feature: limiting how often one client can call", () => {
  it("allows up to the limit in a window, then refuses", () => {
    const limiter = createRateLimiter(2, 1000, () => 0);
    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")]).toEqual([true, true, false]);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter(1, 1000, () => 0);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("starts afresh when the window has passed, and not before", () => {
    let t = 0;
    const limiter = createRateLimiter(1, 1000, () => t);
    limiter.allow("a");
    t = 999;
    expect(limiter.allow("a")).toBe(false);
    t = 1000;
    expect(limiter.allow("a")).toBe(true);
  });

  it("forgets every key when too many are tracked, so memory stays bounded", () => {
    const limiter = createRateLimiter(1, 1000, () => 0, 2);
    limiter.allow("a");
    limiter.allow("b");
    limiter.allow("c"); // clears a and b
    expect(limiter.allow("a")).toBe(true);
  });
});
