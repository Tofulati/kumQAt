import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backendBase(): string {
  return (process.env.QA_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.join("/");
  const src = new URL(req.url);
  const target = `${backendBase()}/${path}${src.search}`;

  const method = req.method.toUpperCase();
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  const res = await fetch(target, {
    method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
  });

  const out = new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
  });
  const outCt = res.headers.get("content-type");
  if (outCt) out.headers.set("content-type", outCt);
  return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path ?? []);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path ?? []);
}
