"""Docker HEALTHCHECK probe for the standalone ZoneCog bridge container.

Standard library only, so the container image needs no extra dependency
just to answer "is the bridge up" from `docker ps` / orchestrator probes.
"""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    port = os.environ.get("PORT", "7807")
    url = f"http://127.0.0.1:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return 0 if response.status == 200 else 1
    except (urllib.error.URLError, OSError):
        return 1


if __name__ == "__main__":
    sys.exit(main())
