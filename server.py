#!/usr/bin/env python3
"""
Papa Stud — Paparazzi Screenshot Viewer
Entry point. Run with: python3 server.py
"""

import http.server
import os

from server.handler import Handler


def main():
    port = int(os.environ.get("PORT", 8770))

    http_server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)

    print(f"\n  Papa Stud is running!")
    print(f"    ->  http://localhost:{port}")
    print(f"    Press Ctrl+C to stop\n")

    try:
        http_server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping…")
        http_server.shutdown()


if __name__ == "__main__":
    main()
