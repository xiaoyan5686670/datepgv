import type { NextRequest } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";

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

function forwardRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      out.append(key, value);
    }
  });
  out.delete("host");
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

  const target = `${backendOrigin()}/api/v1/${subpath}${request.nextUrl.search}`;
  const headers = forwardRequestHeaders(request.headers);

  const shared = {
    method: request.method,
    headers,
    redirect: "manual" as const,
    dispatcher: backendHttpAgent,
  };

  const upstream =
    request.method === "GET" || request.method === "HEAD"
      ? await undiciFetch(target, shared)
      : await undiciFetch(target, {
          ...shared,
          body: await request.arrayBuffer(),
        });

  // undici body stream type differs from DOM BodyInit; runtime is compatible for piping.
  return new Response(upstream.body as unknown as BodyInit, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardResponseHeaders(upstream.headers as unknown as Headers),
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
