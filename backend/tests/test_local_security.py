from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.local_security import LocalAccessMiddleware


def secured_client():
    app = FastAPI()
    app.add_middleware(LocalAccessMiddleware)

    @app.get("/api/papers")
    def papers():
        return []

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return TestClient(app, base_url="http://127.0.0.1:8100")


def test_private_routes_fail_closed_without_launch_token(monkeypatch):
    monkeypatch.delenv("PAPER_READER_LOCAL_TOKEN", raising=False)
    assert secured_client().get("/api/papers").status_code == 503


def test_private_routes_require_correct_launch_token(monkeypatch):
    monkeypatch.setenv("PAPER_READER_LOCAL_TOKEN", "test-local-secret")
    client = secured_client()
    assert client.get("/api/papers").status_code == 403
    assert client.get("/api/papers", headers={"X-Reader-Token": "wrong"}).status_code == 403
    assert client.get("/api/papers", headers={"X-Reader-Token": "test-local-secret"}).status_code == 200
    assert client.get("/api/health").status_code == 200


def test_foreign_hosts_are_rejected_even_with_token(monkeypatch):
    monkeypatch.setenv("PAPER_READER_LOCAL_TOKEN", "test-local-secret")
    assert secured_client().get("/api/papers", headers={"Host": "attacker.example", "X-Reader-Token": "test-local-secret"}).status_code == 403
