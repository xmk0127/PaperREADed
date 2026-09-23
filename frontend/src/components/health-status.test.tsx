import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthStatus } from "./health-status";

describe("HealthStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a successful frontend-backend connection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", message: "后端连接正常" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HealthStatus />);

    expect(screen.getByText("正在连接后端")).toBeInTheDocument();
    expect(await screen.findByText("前后端已连接")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows a useful fallback when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<HealthStatus />);

    expect(await screen.findByText("后端暂未连接")).toBeInTheDocument();
  });
});
