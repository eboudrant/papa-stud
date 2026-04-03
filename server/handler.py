import http.server
import os
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class Handler(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/" or self.path == "":
            self._serve_file(STATIC_DIR / "index.html", "text/html")
        elif self.path.startswith("/static/"):
            rel = self.path[len("/static/"):]
            file_path = STATIC_DIR / rel
            if file_path.resolve().is_relative_to(STATIC_DIR) and file_path.is_file():
                self._serve_file(file_path)
            else:
                self._send(404, "Not found")
        elif self.path.startswith("/api/"):
            self._handle_api()
        else:
            self._send(404, "Not found")

    def _handle_api(self):
        if self.path == "/api/health":
            self._send_json('{"status":"ok"}')
        else:
            self._send(404, '{"error":"not found"}', "application/json")

    def _serve_file(self, path, content_type=None):
        path = Path(path)
        if not path.is_file():
            self._send(404, "Not found")
            return
        if content_type is None:
            content_type = self._guess_type(path)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send(self, code, body, content_type="text/plain"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, body):
        self._send(200, body, "application/json")

    @staticmethod
    def _guess_type(path):
        ext = path.suffix.lower()
        return {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
        }.get(ext, "application/octet-stream")

    def log_message(self, format, *args):
        print(f"  {self.address_string()} - {format % args}")
