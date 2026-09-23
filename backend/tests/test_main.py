import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app, base_url="http://127.0.0.1:8100")


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "paperreaded-api",
        "message": "后端连接正常",
    }


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:3000", "http://127.0.0.1:3000"],
)
def test_local_frontend_is_allowed_by_cors(origin: str) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
