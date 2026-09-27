import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBodyBytes = 31 * 1024 * 1024;
const idPattern = "[a-zA-Z0-9_-]+";
const routes = new Map([
  ["GET", new RegExp(`^(health|codex/status|papers|analyses|papers/${idPattern}/pdf|papers/${idPattern}/pages/[1-9][0-9]*|analyses/${idPattern})$`)],
  ["POST", new RegExp(`^(papers|papers/arxiv|analyses|analyses/${idPattern}/cancel)$`)],
  ["DELETE", new RegExp(`^analyses/${idPattern}$`)],
]);

function failure(message: string, status: number) {
  return Response.json({ detail: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function trustedBrowserRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { return false; }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  const expected = `${url.protocol}//${host}`;
  const left = Buffer.from(origin);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!trustedBrowserRequest(request)) return failure("只允许从本机阅读器页面访问。", 403);
  const { path } = await context.params;
  const route = path.join("/");
  if (!routes.get(request.method)?.test(route)) return failure("接口不存在。", 404);
  const token = process.env.PAPER_READER_LOCAL_TOKEN;
  if (!token) return failure("本地服务未正确启动，请运行 python3 scripts/project.py start。", 503);
  let base: URL;
  try {
    base = new URL(process.env.READER_BACKEND_URL ?? "http://127.0.0.1:8100");
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) {
      throw new Error("Invalid local backend");
    }
  } catch { return failure("后端地址必须是本机 HTTP 地址。", 503); }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return failure("上传文件过大，请选择 30 MB 以内的 PDF。", 413);
  let body: Uint8Array | undefined;
  if (request.method === "POST" && request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBodyBytes) {
          await reader.cancel();
          return failure("上传文件过大，请选择 30 MB 以内的 PDF。", 413);
        }
        chunks.push(next.value);
      }
    } catch { return failure("上传中断，请重新选择文件。", 400); }
    body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  try {
    const headers = new Headers({ "X-Reader-Token": token });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const response = await fetch(new URL(`/api/${route}`, base), {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const outgoing = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition", "content-length"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch { return failure("后端未连接或请求超时，请检查启动终端。分析任务不会因此自动重复提交。", 502); }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
