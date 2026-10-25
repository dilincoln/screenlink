import { describe, expect, test } from "bun:test";
import { availableUpdate, isNewer } from "./update.js";

describe("isNewer", () => {
  test("compares numerically, part by part", () => {
    expect(isNewer("v0.4.2", "0.4.1")).toBe(true);
    expect(isNewer("v0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("v0.4.1", "0.4.1")).toBe(false);
    expect(isNewer("v0.4.0", "0.4.1")).toBe(false);
  });

  test("ignores tags that are not plain versions", () => {
    expect(isNewer("nightly", "0.4.1")).toBe(false);
    expect(isNewer("v0.5.0-beta.1", "0.4.1")).toBe(false);
    expect(isNewer(undefined, "0.4.1")).toBe(false);
  });
});

describe("availableUpdate", () => {
  const page = "https://github.com/dilincoln/screenlink/releases/tag/v0.4.2";

  test("offers a newer release with its page", () => {
    expect(availableUpdate({ tag_name: "v0.4.2", html_url: page }, "0.4.1")).toEqual({ version: "0.4.2", url: page });
  });

  test("nothing when up to date or the response is unusable", () => {
    expect(availableUpdate({ tag_name: "v0.4.1", html_url: page }, "0.4.1")).toBeNull();
    expect(availableUpdate({ message: "API rate limit exceeded" }, "0.4.1")).toBeNull();
    expect(availableUpdate(null, "0.4.1")).toBeNull();
  });

  test("never hands out a link outside this repository's releases", () => {
    const update = availableUpdate({ tag_name: "v0.4.2", html_url: "https://example.com/x" }, "0.4.1");
    expect(update?.url).toBe("https://github.com/dilincoln/screenlink/releases/");
  });
});
