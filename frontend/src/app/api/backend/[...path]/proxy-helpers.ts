import type { NextRequest } from "next/server";

export const MAX_BUFFERED_BODY_BYTES = 10 * 1024 * 1024;

export function normalizePathSegments(pathSegments: string[]): string {
  return pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function resolveRedirectUrl(baseOrigin: string, location: string): URL | null {
  try {
    const next = new URL(location, `${baseOrigin}/`);
    const allowed = new URL(baseOrigin);
    return next.origin === allowed.origin ? next : null;
  } catch {
    return null;
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const name = (error as { name?: unknown }).name;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    name === "ConnectTimeoutError" ||
    name === "HeadersTimeoutError" ||
    name === "BodyTimeoutError"
  );
}

export async function readBufferedBody(request: NextRequest): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentLengthRaw = request.headers.get("content-length");
  if (contentLengthRaw) {
    const parsed = Number(contentLengthRaw);
    if (Number.isFinite(parsed) && parsed > MAX_BUFFERED_BODY_BYTES) {
      throw new Response("Payload Too Large", { status: 413 });
    }
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BUFFERED_BODY_BYTES) {
    throw new Response("Payload Too Large", { status: 413 });
  }
  return body;
}
