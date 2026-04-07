import http.server
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from server import projects, scan_jobs, video

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "":
            self._serve_file(STATIC_DIR / "index.html", "text/html")
        elif self.path.startswith("/static/"):
            rel = self.path[len("/static/") :]
            file_path = STATIC_DIR / rel
            if file_path.resolve().is_relative_to(STATIC_DIR) and file_path.is_file():
                self._serve_file(file_path)
            else:
                self._send(404, "Not found")
        elif self.path.startswith("/api/"):
            self._handle_api_get()
        else:
            self._send(404, "Not found")

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._handle_api_post()
        else:
            self._send(404, "Not found")

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self._handle_api_put()
        else:
            self._send(404, "Not found")

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self._handle_api_delete()
        else:
            self._send(404, "Not found")

    # --- API GET ---

    def _handle_api_get(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            from server.watcher import HAS_WATCHDOG

            self._json_response(
                {
                    "status": "ok",
                    "watchMode": "native" if HAS_WATCHDOG else "polling",
                    "ffmpeg": video.has_ffmpeg(),
                }
            )
        elif path == "/api/projects":
            self._json_response(projects.list_projects())
        elif path == "/api/scans":
            self._json_response(projects.list_scans())
        elif path.startswith("/api/scans/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[4] == "watch":
                scan_id = parts[3]
                self._json_response({"watching": scan_jobs.is_watching(scan_id)})
            elif len(parts) == 4:
                scan_id = parts[3]
                page = int(qs.get("page", ["0"])[0])
                size = int(qs.get("size", ["50"])[0])
                status = qs.get("status", [None])[0]
                query = qs.get("q", [None])[0]
                module = qs.get("module", [None])[0]
                profile = qs.get("profile", [None])[0]
                sort = qs.get("sort", [None])[0]
                result = projects.get_scan(
                    scan_id, page, size, status, query, module, profile, sort
                )
                if result:
                    self._json_response(result)
                else:
                    self._send(404, '{"error":"scan not found"}', "application/json")
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        elif path.startswith("/api/scan-jobs/"):
            parts = path.split("/")
            if len(parts) == 4:
                job = scan_jobs.get_job(parts[3])
                if job:
                    self._json_response(job)
                else:
                    self._send(404, '{"error":"job not found"}', "application/json")
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        elif path == "/api/images":
            file_path = qs.get("path", [None])[0]
            if not file_path:
                self._send(400, '{"error":"path required"}', "application/json")
                return
            p = Path(file_path)
            if not p.is_file():
                self._send(404, '{"error":"file not found"}', "application/json")
                return
            if not projects.is_path_under_project(file_path):
                self._send(403, '{"error":"forbidden"}', "application/json")
                return
            self._serve_file(p)
        else:
            self._send(404, '{"error":"not found"}', "application/json")

    # --- API POST ---

    def _handle_api_post(self):
        path = urlparse(self.path).path

        if path == "/api/projects":
            body = self._read_body_json()
            if not body or "path" not in body:
                self._send(400, '{"error":"path required"}', "application/json")
                return
            name = body.get("name", Path(body["path"]).name)
            project = projects.add_project(name, body["path"])
            self._json_response(project, 201)

        elif path.startswith("/api/projects/") and path.endswith("/scan"):
            parts = path.split("/")
            if len(parts) == 5:
                project_id = parts[3]
                project = projects.get_project(project_id)
                if project:
                    job_id = scan_jobs.start_scan(
                        project_id,
                        project["name"],
                        project["path"],
                        project.get("profiles"),
                    )
                    self._json_response({"jobId": job_id}, 202)
                else:
                    self._send(404, '{"error":"project not found"}', "application/json")
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        elif path.startswith("/api/scans/") and path.endswith("/watch"):
            parts = path.split("/")
            if len(parts) == 5:
                if scan_jobs.start_watching(parts[3]):
                    self._json_response({"watching": True})
                else:
                    self._send(404, '{"error":"scan not found"}', "application/json")
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        elif path.startswith("/api/scan-jobs/") and path.endswith("/cancel"):
            parts = path.split("/")
            if len(parts) == 5:
                if scan_jobs.cancel_job(parts[3]):
                    self._json_response({"cancelled": True})
                else:
                    self._send(404, '{"error":"job not found"}', "application/json")
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        elif path.startswith("/api/scans/") and path.endswith("/video"):
            parts = path.split("/")
            if len(parts) == 5:
                scan_id = parts[3]
                scan = projects.get_scan(scan_id, page=0, size=10000)
                if not scan:
                    self._send(404, '{"error":"scan not found"}', "application/json")
                    return
                failures = [f for f in scan.get("failures", []) if f.get("delta_path")]
                if not failures:
                    self._send(
                        400, '{"error":"no failures to export"}', "application/json"
                    )
                    return
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    tmp_path = tmp.name
                try:
                    video.generate_video(failures, tmp_path)
                    with open(tmp_path, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "video/mp4")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        f'attachment; filename="papa-stud-{scan_id}.mp4"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self._send(500, json.dumps({"error": str(e)}), "application/json")
                finally:
                    os.unlink(tmp_path)
            else:
                self._send(404, '{"error":"not found"}', "application/json")
        else:
            self._send(404, '{"error":"not found"}', "application/json")

    # --- API PUT ---

    def _handle_api_put(self):
        path = urlparse(self.path).path

        # PUT /api/projects/{id}/profiles
        if path.startswith("/api/projects/") and path.endswith("/profiles"):
            parts = path.split("/")
            if len(parts) == 5:
                body = self._read_body_json()
                if not body or "profiles" not in body:
                    self._send(
                        400,
                        '{"error":"profiles required"}',
                        "application/json",
                    )
                    return
                result = projects.update_project_profiles(parts[3], body["profiles"])
                if result:
                    self._json_response(result)
                else:
                    self._send(404, '{"error":"project not found"}', "application/json")
                return

        # PUT /api/scans/{id}/failures/{filename}/status
        if "/failures/" in path and path.endswith("/status"):
            parts = path.split("/")
            # /api/scans/{id}/failures/{filename}/status -> 7 parts
            if len(parts) == 7:
                scan_id = parts[3]
                filename = parts[5]
                body = self._read_body_json()
                if not body or "status" not in body:
                    self._send(400, '{"error":"status required"}', "application/json")
                    return
                stats = projects.update_failure_status(
                    scan_id, filename, body["status"]
                )
                if stats:
                    self._json_response(stats)
                else:
                    self._send(404, '{"error":"not found"}', "application/json")
                return

        # PUT /api/scans/{id}/failures/batch
        if path.endswith("/failures/batch"):
            parts = path.split("/")
            if len(parts) == 6:
                scan_id = parts[3]
                body = self._read_body_json()
                if not body or "status" not in body or "filenames" not in body:
                    self._send(
                        400,
                        '{"error":"status and filenames required"}',
                        "application/json",
                    )
                    return
                stats = projects.batch_update_status(
                    scan_id, body["filenames"], body["status"]
                )
                if stats:
                    self._json_response(stats)
                else:
                    self._send(404, '{"error":"not found"}', "application/json")
                return

        self._send(404, '{"error":"not found"}', "application/json")

    # --- API DELETE ---

    def _handle_api_delete(self):
        path = urlparse(self.path).path

        if path.startswith("/api/projects/"):
            parts = path.split("/")
            if len(parts) == 4:
                projects.delete_project(parts[3])
                self._send(204, "")
                return

        if path.startswith("/api/scans/"):
            parts = path.split("/")
            if len(parts) == 5 and parts[4] == "watch":
                scan_jobs.stop_watching(parts[3])
                self._json_response({"watching": False})
                return
            if len(parts) == 4:
                scan_jobs.stop_watching(parts[3])
                projects.delete_scan(parts[3])
                self._send(204, "")
                return

        self._send(404, '{"error":"not found"}', "application/json")

    # --- Helpers ---

    def _read_body_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _json_response(self, data, code=200):
        body = json.dumps(data)
        self._send(code, body, "application/json")

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
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _send(self, code, body, content_type="text/plain"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
