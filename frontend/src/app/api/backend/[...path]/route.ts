import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardResponseHeaders(upstream.headers),
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
