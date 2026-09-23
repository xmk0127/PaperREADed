"use client";

import { useEffect, useState } from "react";

type HealthState = "loading" | "ready" | "error";

interface HealthPayload {
  status: string;
  message: string;
}

export function HealthStatus() {
  const [state, setState] = useState<HealthState>("loading");
  const [message, setMessage] = useState("正在连接后端");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/local/health", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Health check returned ${response.status}`);
        }

        const payload = (await response.json()) as HealthPayload;
        setState(payload.status === "ok" ? "ready" : "error");
        setMessage(payload.status === "ok" ? "前后端已连接" : payload.message);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState("error");
        setMessage("后端暂未连接");
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <div className={`health health--${state}`} role="status" aria-live="polite">
      <span className="health__dot" aria-hidden="true" />
      {message}
    </div>
  );
}
