import type { NextRequest } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";

import { ACCESS_TOKEN_KEY } from "@/lib/api";
import {
  isTimeoutError,
  normalizePathSegments,
  readBufferedBody,
  resolveRedirectUrl,
} from "./proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Node fetch (undici) defaults include a response body timeout between chunks,
 * which breaks SSE chat streams ("Body Timeout Error" / failed to pipe response).
 */
const backendHttpAgent = new Agent({
  connectTimeout: 120_000,
  headersTimeout: 600_000,
  bodyTimeout: 0,
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 600_000,
});

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const PRESERVE_METHOD_REDIRECT = new Set([307, 308]);
const MAX_REDIRECT_FOLLOWS = 3;
function backendOrigin(): string {
  return (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

function rawTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const prefix = `${ACCESS_TOKEN_KEY}=`;
  for (const segment of cookieHeader.split(";")) {
    const part = segment.trim();
    if (!part.startsWith(prefix)) continue;
    const raw = part.slice(prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function forwardRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      !HOP_BY_HOP.has(lower) &&
      lower !== "forwarded" &&
      lower !== "x-forwarded-for" &&
      lower !== "x-forwarded-host" &&
      lower !== "x-forwarded-proto"
    ) {
      out.append(key, value);
    }
  });
  out.delete("host");
  // Some hosts strip Authorization before it reaches App Route handlers; client also sends
  // X-DatePGV-Authorization (see api.ts authFetchInit).
  let hasAuth = (out.get("authorization") ?? "").trim().length > 0;
  const alt = incoming.get("X-DatePGV-Authorization") ?? incoming.get("x-datepgv-authorization");
  if (!hasAuth && alt?.trim()) {
    const v = alt.trim();
    out.set("Authorization", v.toLowerCase().startsWith("bearer ") ? v : `Bearer ${v}`);
    hasAuth = true;
  }
  // Next.js may forward Cookie while stripping Authorization — mirror is set in setStoredAccessToken.
  if (!hasAuth) {
    const fromCookie = rawTokenFromCookieHeader(incoming.get("cookie"));
    if (fromCookie?.trim()) {
      out.set("Authorization", `Bearer ${fromCookie.trim()}`);
    }
  }
  return out;
}

function forwardResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      out.append(key, value);
    }
  });
  return out;
}

async function proxy(request: NextRequest, pathSegments: string[]) {
  const subpath = pathSegments.length ? normalizePathSegments(pathSegments) : "";
  if (!subpath) {
    return new Response("Not Found", { status: 404 });
  }

  const baseOrigin = backendOrigin();
  let target = `${baseOrigin}/api/v1/${subpath}${request.nextUrl.search}`;
  const headers = forwardRequestHeaders(request.headers);

  try {
    const bufferedBody = await readBufferedBody(request);
    let method = request.method.toUpperCase();
    let response: Awaited<ReturnType<typeof undiciFetch>>;

    for (let i = 0; i <= MAX_REDIRECT_FOLLOWS; i += 1) {
      response = await undiciFetch(target, {
        method,
        headers,
        redirect: "manual",
        dispatcher: backendHttpAgent,
        body: method === "GET" || method === "HEAD" ? undefined : bufferedBody,
      });

      if (!REDIRECT_STATUS.has(response.status)) {
        return new Response(response.body as unknown as BodyInit, {
          status: response.status,
          statusText: response.statusText,
          headers: forwardResponseHeaders(response.headers as unknown as Headers),
        });
      }

      if (i === MAX_REDIRECT_FOLLOWS) {
        return new Response("Bad Gateway", { status: 502 });
      }

      const location = response.headers.get("location");
      if (!location) {
        return new Response("Bad Gateway", { status: 502 });
      }

      const resolved = resolveRedirectUrl(baseOrigin, location);
      if (!resolved) {
        console.error("[backend-proxy] blocked cross-origin redirect", {
          method,
          location,
          target,
        });
        return new Response("Bad Gateway", { status: 502 });
      }

      if (!PRESERVE_METHOD_REDIRECT.has(response.status)) {
        method = "GET";
        headers.delete("content-length");
        headers.delete("content-type");
      }

      target = resolved.toString();
    }

    return new Response("Bad Gateway", { status: 502 });
  } catch (error) {
    if (error instanceof Response) return error;
    const status = isTimeoutError(error) ? 504 : 502;
    const err = error as { name?: string; message?: string };
    console.error("[backend-proxy] upstream request failed", {
      method: request.method,
      target,
      status,
      error: err?.name ?? "Error",
      message: err?.message ?? "Unknown",
    });
    return new Response(status === 504 ? "Gateway Timeout" : "Bad Gateway", { status });
  }
}

export async function GET(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}

export async function POST(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}

export async function PUT(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}

export async function OPTIONS(
  request: NextRequest,
  ctx: { params: { path: string[] } }
) {
  return proxy(request, ctx.params.path);
}
