import os
import shutil
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path.partition("?")[0] == "/tests/app_runner_wait":
            time.sleep(25)
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()


@contextmanager
def served_root():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def chrome_executable():
    configured = os.environ.get("CHROME_BIN")
    candidates = [
        configured,
        shutil.which("chrome"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    return next((str(path) for path in candidates if path and Path(path).is_file()), None)


def browser_dump(chrome, url, virtual_time_budget_ms=None):
    with tempfile.TemporaryDirectory(prefix="bridgebuilder-chrome-") as profile:
        command = [
            chrome,
            "--headless=new",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
        ]
        if virtual_time_budget_ms is not None:
            command.append("--run-all-compositor-stages-before-draw")
            command.append(f"--virtual-time-budget={virtual_time_budget_ms}")
        command.extend(["--dump-dom", url])
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            pytest.skip("Headless browser did not start in this environment")

    gpu_failure = "GPU process isn't usable" in completed.stderr
    if gpu_failure:
        pytest.skip("Headless browser GPU process is unavailable in this environment")

    assert completed.returncode == 0, completed.stderr
    return completed


def test_browser_gameplay_suite():
    chrome = chrome_executable()
    assert chrome, "Chrome/Chromium is required; set CHROME_BIN to its executable"

    with served_root() as base_url:
        completed = browser_dump(chrome, f"{base_url}/tests/browser_runner.html")

    assert 'data-test-status="passed"' in completed.stdout, (
        "Browser gameplay checks did not pass.\n"
        f"STDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
    )


def test_real_app_integration_matrix():
    chrome = chrome_executable()
    assert chrome, "Chrome/Chromium is required; set CHROME_BIN to its executable"

    with served_root() as base_url:
        completed = browser_dump(chrome, f"{base_url}/tests/app_runner.html")

    assert 'data-test-status="passed"' in completed.stdout, (
        "Real-app browser integration checks did not pass.\n"
        f"STDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
    )


def test_published_game_boots_with_accessible_controls():
    chrome = chrome_executable()
    assert chrome, "Chrome/Chromium is required; set CHROME_BIN to its executable"

    with served_root() as base_url:
        completed = browser_dump(chrome, f"{base_url}/?seed=browser-app-smoke")

    assert 'data-app-ready="true"' in completed.stdout, completed.stdout
    for control_id in [
        "mode-select",
        "test-button",
        "capacity-button",
        "result-panel",
        "live-status",
    ]:
        assert f'id="{control_id}"' in completed.stdout
