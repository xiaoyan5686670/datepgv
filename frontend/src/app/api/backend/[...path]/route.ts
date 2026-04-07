import type { NextRequest } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";

import { ACCESS_TOKEN_KEY } from "@/lib/api";

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
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
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
  const subpath = pathSegments.length ? pathSegments.join("/") : "";
  if (!subpath) {
    return new Response("Not Found", { status: 404 });
  }

  let target = `${backendOrigin()}/api/v1/${subpath}${request.nextUrl.search}`;
  let headers = forwardRequestHeaders(request.headers);

  const shared = {
    method: request.method,
    headers,
    redirect: "manual" as const,
    dispatcher: backendHttpAgent,
  };

  // Handle redirects manually to preserve auth headers
  let response =
    request.method === "GET" || request.method === "HEAD"
      ? await undiciFetch(target, shared)
      : await undiciFetch(target, {
          ...shared,
          body: await request.arrayBuffer(),
        });

  // If redirected, follow with same headers
  if (response.status === 307 || response.status === 308) {
    const location = response.headers.get("location");
    if (location) {
      // Convert relative redirect to absolute if needed
      const redirectUrl = location.startsWith("http") ? location : `${backendOrigin()}${location}`;
      response = await undiciFetch(redirectUrl, shared);
    }
  }

  // undici body stream type differs from DOM BodyInit; runtime is compatible for piping.
  return new Response(response.body as unknown as BodyInit, {
    status: response.status,
    statusText: response.statusText,
    headers: forwardResponseHeaders(response.headers as unknown as Headers),
  });
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

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
