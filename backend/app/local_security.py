"""A per-launch local bridge secret, not a Codex/OpenAI credential."""

import hmac
import os
from urllib.parse import urlsplit

from starlette.responses import JSONResponse


class LocalAccessMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {key.lower(): value for key, value in scope["headers"]}
        host = headers.get(b"host", b"").decode("latin1")
        try:
            local = urlsplit("http://" + host).hostname in {"localhost", "127.0.0.1", "::1"}
        except ValueError:
            local = False
        if not local:
            return await JSONResponse({"detail": "仅允许本机访问。"}, status_code=403)(scope, receive, send)
        if scope["path"].startswith("/api/") and scope["path"] != "/api/health":
            expected = os.environ.get("PAPER_READER_LOCAL_TOKEN", "")
            supplied = headers.get(b"x-reader-token", b"")
            if not expected:
                return await JSONResponse({"detail": "请通过项目启动脚本启动本地服务。"}, status_code=503)(scope, receive, send)
            if not hmac.compare_digest(supplied, expected.encode()):
                return await JSONResponse({"detail": "未授权的本地请求。"}, status_code=403)(scope, receive, send)
        await self.app(scope, receive, send)
