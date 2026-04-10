import assert from "node:assert/strict";
import test from "node:test";

import {
  isTimeoutError,
  normalizePathSegments,
  readBufferedBody,
  resolveRedirectUrl,
} from "./proxy-helpers";

test("normalizePathSegments encodes reserved characters", () => {
  const out = normalizePathSegments(["a b", "x/y", "q?z"]);
  assert.equal(out, "a%20b/x%2Fy/q%3Fz");
});

test("resolveRedirectUrl allows same-origin absolute and relative locations", () => {
  const base = "https://api.example.com";
  assert.equal(
    resolveRedirectUrl(base, "/api/v1/chat/stream")?.toString(),
    "https://api.example.com/api/v1/chat/stream"
  );
  assert.equal(
    resolveRedirectUrl(base, "https://api.example.com/api/v1/auth/me")?.toString(),
    "https://api.example.com/api/v1/auth/me"
  );
});

test("resolveRedirectUrl rejects cross-origin locations", () => {
  const out = resolveRedirectUrl("https://api.example.com", "https://evil.example.net/steal");
  assert.equal(out, null);
});

test("isTimeoutError detects undici timeout variants", () => {
  assert.equal(isTimeoutError({ code: "UND_ERR_CONNECT_TIMEOUT" }), true);
  assert.equal(isTimeoutError({ name: "HeadersTimeoutError" }), true);
  assert.equal(isTimeoutError({ code: "SOME_OTHER_ERR" }), false);
});

test("readBufferedBody enforces payload limit via content-length", async () => {
  const req = {
    method: "POST",
    headers: new Headers({ "content-length": String(11 * 1024 * 1024) }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Parameters<typeof readBufferedBody>[0];

  await assert.rejects(readBufferedBody(req), (err: unknown) => {
    return err instanceof Response && err.status === 413;
  });
});

test("readBufferedBody accepts small payloads", async () => {
  const req = {
    method: "POST",
    headers: new Headers({ "content-length": "5" }),
    arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
  } as unknown as Parameters<typeof readBufferedBody>[0];

  const body = await readBufferedBody(req);
  assert.equal(body?.byteLength, 5);
});
