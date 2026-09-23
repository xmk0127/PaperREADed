import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

describe("Local backend proxy", () => {
  beforeEach(() => {
    vi.stubEnv("PAPER_READER_LOCAL_TOKEN", "launch-secret");
    vi.stubEnv("READER_BACKEND_URL", "http://127.0.0.1:8100");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("keeps the launch secret server-side and forwards only allowed headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://127.0.0.1:3100/api/local/papers", {
      headers: { Cookie: "private=ignored", Authorization: "Bearer ignored" },
    }), params("papers"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reader-token")).toBeNull();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:8100/api/papers");
    expect(options.headers.get("x-reader-token")).toBe("launch-secret");
    expect(options.headers.get("cookie")).toBeNull();
    expect(options.headers.get("authorization")).toBeNull();
  });

  it("rejects cross-origin, missing-origin writes and foreign hosts", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const cases: HeadersInit[] = [{ Origin: "https://evil.example" }, {}, { Origin: "http://evil.example", Host: "evil.example" }];
    for (const headers of cases) {
      const response = await POST(new Request("http://127.0.0.1:3100/api/local/analyses", { method: "POST", headers }), params("analyses"));
      expect(response.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unconfigured bridge, invalid targets and oversized requests", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const request = new Request("http://127.0.0.1:3100/api/local/papers");
    expect((await GET(request, params("../secret"))).status).toBe(404);
    vi.stubEnv("PAPER_READER_LOCAL_TOKEN", "");
    expect((await GET(request, params("papers"))).status).toBe(503);
    vi.stubEnv("PAPER_READER_LOCAL_TOKEN", "launch-secret");
    vi.stubEnv("READER_BACKEND_URL", "https://evil.example");
    expect((await GET(request, params("papers"))).status).toBe(503);
    vi.stubEnv("READER_BACKEND_URL", "http://127.0.0.1:8100");
    const tooLarge = new Request("http://127.0.0.1:3100/api/local/papers", { method: "POST", headers: { Origin: "http://127.0.0.1:3100", "Content-Length": String(40 * 1024 * 1024) } });
    expect((await POST(tooLarge, params("papers"))).status).toBe(413);
  });

  it("forwards same-origin jobs once and reports connection failure without retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://127.0.0.1:3100/api/local/analyses", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" },
      body: JSON.stringify({ paper_id: "p", target: "Lemma 1" }),
    }), params("analyses"));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
