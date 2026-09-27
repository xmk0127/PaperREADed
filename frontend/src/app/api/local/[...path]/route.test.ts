import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

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

  it("forwards arXiv references as JSON to the fixed local import endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "imported-paper" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ reference: "https://arxiv.org/pdf/2309.07041" });
    const response = await POST(new Request("http://127.0.0.1:3100/api/local/papers/arxiv", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" }, body,
    }), params("papers/arxiv"));
    expect(response.status).toBe(201);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:8100/api/papers/arxiv");
    expect(options.headers.get("content-type")).toBe("application/json");
    expect(new TextDecoder().decode(options.body)).toBe(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not allow untrusted arXiv imports or arbitrary remote proxy paths", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await POST(new Request("http://127.0.0.1:3100/api/local/papers/arxiv", {
      method: "POST", headers: { Origin: "https://evil.example" },
    }), params("papers/arxiv"))).status).toBe(403);
    for (const path of ["papers/url", "papers/arxiv/2309.07041", "https://arxiv.org/pdf/2309.07041"]) {
      expect((await POST(new Request("http://127.0.0.1:3100/api/local/papers/arxiv", {
        method: "POST", headers: { Origin: "http://127.0.0.1:3100" },
      }), params(path))).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a same-origin single-record deletion without exposing the launch secret", async () => {
    const id = "fe203b83-76f0-41c9-91ce-e598e32769d3";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ deleted_id: id }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await DELETE(new Request(`http://127.0.0.1:3100/api/local/analyses/${id}`, {
      method: "DELETE", headers: { Origin: "http://127.0.0.1:3100", Cookie: "private=ignored" },
    }), params(`analyses/${id}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted_id: id });
    expect(response.headers.get("x-reader-token")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe(`http://127.0.0.1:8100/api/analyses/${id}`);
    expect(options.method).toBe("DELETE");
    expect(options.headers.get("x-reader-token")).toBe("launch-secret");
    expect(options.headers.get("cookie")).toBeNull();
    expect(options.body).toBeUndefined();
  });

  it("rejects untrusted deletion requests and never allows bulk or paper deletion", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const untrusted: HeadersInit[] = [{}, { Origin: "https://evil.example" }, {
      Origin: "http://127.0.0.1:3100", "Sec-Fetch-Site": "cross-site",
    }];
    for (const headers of untrusted) {
      expect((await DELETE(new Request("http://127.0.0.1:3100/api/local/analyses/job", {
        method: "DELETE", headers,
      }), params("analyses/job"))).status).toBe(403);
    }
    for (const path of ["analyses", "papers/job", "analyses/job/cancel", "analyses/../papers"]) {
      expect((await DELETE(new Request(`http://127.0.0.1:3100/api/local/${path}`, {
        method: "DELETE", headers: { Origin: "http://127.0.0.1:3100" },
      }), params(path))).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves deletion conflicts and failures without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ detail: "请先取消分析。" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new Request("http://127.0.0.1:3100/api/local/analyses/job", {
      method: "DELETE", headers: { Origin: "http://127.0.0.1:3100" },
    });
    const conflict = await DELETE(request(), params("analyses/job"));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ detail: "请先取消分析。" });
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await DELETE(request(), params("analyses/job"))).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
