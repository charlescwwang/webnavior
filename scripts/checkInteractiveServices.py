#!/usr/bin/env python3
"""Inspect real third-party iframe traffic without submitting orders or changing sites.

Uses the installed agent-browser CLI and Python's standard library. A fresh,
headed browser is the default because some services reject HeadlessChrome.
Raw HAR files stay in a private temporary directory; reports omit credentials,
cookies, bodies, query strings, and console messages.
"""

import argparse
import functools
import html
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


DEFAULT_URLS = [
    "https://imenu.com.tw/damai/Derek1/menu",
    "https://maifood.tw/damai/Derek1/menu?table=12641",
]
IFRAME_ALLOW = "tools; geolocation; camera 'none'; microphone 'none'; display-capture 'none'"


def public_url(url):
    """Keep endpoint identity while excluding query parameters and URL credentials."""
    parsed = urlsplit(url)
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{parsed.hostname}{port}{parsed.path}"


def summarize_har(entries):
    """Classify observed transport failures, preserving only non-secret metadata.

    A loaded document does not prove its API calls succeeded. Browser preflights
    and failed fetches therefore remain findings even when the menu is visible.
    This is traffic evidence, not an assertion that ordering or payment works.
    """
    requests = []
    for entry in entries:
        request, response = entry["request"], entry["response"]
        headers = {item["name"].lower(): item["value"] for item in response.get("headers", [])}
        status = response.get("status", 0)
        # This CLI's HAR format uses status 0 for both unfinished requests and
        # transport failures and omits loadingFailed details. Do not turn an
        # in-progress image/font into a confirmed failure or a clean pass.
        failed = status >= 400
        requests.append({
            "url": public_url(request["url"]),
            "method": request["method"],
            "status": status,
            "failed": failed,
            "responseNotObserved": status == 0,
            "resourceType": entry.get("_resourceType"),
            "kind": "preflight" if request["method"] == "OPTIONS" else "request",
            "allowsOrigin": bool(headers.get("access-control-allow-origin")),
            "cloudFrontRejected": failed and "cloudfront" in headers.get("server", "").lower(),
        })
    return requests


def result_for(requests, expected_visible):
    """A visual match cannot hide network failures; absent content remains inconclusive."""
    if any(request["failed"] for request in requests):
        return "network-failure"
    if not expected_visible:
        return "expected-content-not-observed"
    if not requests or any(request["responseNotObserved"] for request in requests):
        return "network-evidence-incomplete"
    return "content-and-recorded-network-passed"


class FixtureHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        # Fixture URLs are known locally; avoid collecting unrelated browser logs.
        pass


def inspect_service(args, fixture_origin, index, raw_dir, output_dir):
    session = f"airi-compat-{uuid.uuid4().hex[:12]}"
    command = [args.browser_bin, "--session", session]
    if not args.headless:
        command.append("--headed")
    if args.chrome:
        command += ["--executable-path", args.chrome]

    def run(*parts):
        # CLI output may contain page-authored data or secrets. It stays local
        # and is never echoed into the public report or an exception message.
        completed = subprocess.run(command + list(parts), capture_output=True, text=True, timeout=45)
        if completed.returncode:
            raise RuntimeError(f"agent-browser {parts[0]} failed; inspect the local browser")
        return completed.stdout

    raw_har = raw_dir / f"{index}.har"
    expected_visible = False
    recording = False
    try:
        run("open", f"{fixture_origin}/start.html")
        run("network", "har", "start")
        recording = True
        run("open", f"{fixture_origin}/{index}.html")
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            snapshot = run("snapshot", "-i")
            if args.expect_text in snapshot:
                expected_visible = True
                break
            time.sleep(1)

        # Content can precede fonts, images and API responses. Wait for actual
        # network quiet, while allowing sites with continuous polling to yield
        # an explicitly incomplete observation instead of hiding that limit.
        network_idle = True
        try:
            run("wait", "--load", "networkidle")
        except (RuntimeError, subprocess.TimeoutExpired):
            network_idle = False
        run("screenshot", str(output_dir / f"service-{index}.png"))
        run("network", "har", "stop", str(raw_har))
        recording = False
        entries = json.loads(raw_har.read_text())["log"]["entries"]
        requests = summarize_har(entries)
        return {
            "url": public_url(args.urls[index]),
            "expectedText": args.expect_text,
            "expectedTextVisible": expected_visible,
            "networkIdleObserved": network_idle,
            "result": result_for(requests, expected_visible),
            "requests": requests,
            "screenshot": f"service-{index}.png",
        }
    finally:
        # Preserve lifecycle ownership even when navigation or capture fails.
        # Only this run's isolated browser is closed, never user-owned tabs.
        if recording:
            try:
                run("network", "har", "stop", str(raw_har))
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
        try:
            run("close")
        except (RuntimeError, subprocess.TimeoutExpired):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-bin", default=os.environ.get("AGENT_BROWSER_BIN") or shutil.which("agent-browser"))
    parser.add_argument("--chrome", help="Installed Chrome executable; no security flags are changed")
    parser.add_argument("--url", action="append", dest="urls", help="Explicit service URL; repeat for multiple services")
    parser.add_argument("--expect-text", required=True, help="Visible menu content, not only a site title or shell")
    parser.add_argument("--timeout", type=int, default=25)
    parser.add_argument("--headless", action="store_true", help="Diagnostic control only; may trigger vendor bot blocking")
    parser.add_argument("--output", type=Path, help="New directory for redacted report and screenshots")
    parser.add_argument("--retain-raw-har", action="store_true", help="Keep private raw HARs locally; they may contain secrets")
    args = parser.parse_args()
    if not args.browser_bin:
        parser.error("Set AGENT_BROWSER_BIN or install agent-browser, then load its core skill")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    args.urls = args.urls or DEFAULT_URLS
    for url in args.urls:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            parser.error("Service URLs must be HTTP(S) URLs without credentials")

    # New directories avoid overwriting evidence. Private permissions matter
    # because even a fresh anonymous session can receive server-issued tokens.
    output_dir = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix="airi-compat-report-"))
    if args.output:
        output_dir.mkdir(mode=0o700)
    output_dir.chmod(0o700)
    with tempfile.TemporaryDirectory(prefix="airi-compat-private-") as temporary:
        private_dir = Path(temporary)
        fixtures = private_dir / "fixtures"
        fixtures.mkdir()
        (fixtures / "start.html").write_text("<!doctype html><title>AIRI compatibility check</title>")
        for index, url in enumerate(args.urls):
            (fixtures / f"{index}.html").write_text(
                '<!doctype html><meta charset="utf-8"><title>AIRI compatibility check</title>'
                '<style>body{margin:0}iframe{width:100%;height:95vh;border:0}</style>'
                '<h3>AIRI cross-origin iframe check</h3>'
                f'<iframe title="Interactive service" src="{html.escape(url, quote=True)}" allow="{IFRAME_ALLOW}"></iframe>'
            )
        handler = functools.partial(FixtureHandler, directory=str(fixtures))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        results = []
        try:
            origin = f"http://localhost:{server.server_port}"
            for index in range(len(args.urls)):
                try:
                    results.append(inspect_service(args, origin, index, private_dir, output_dir))
                except (RuntimeError, subprocess.TimeoutExpired) as error:
                    results.append({"url": public_url(args.urls[index]), "result": "inspection-failed", "reason": str(error) if isinstance(error, RuntimeError) else "browser command timed out"})
                print(f"{index + 1}: {results[-1]['result']}", flush=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        report = {
            "browserMode": "headless" if args.headless else "headed",
            "iframeAllow": IFRAME_ALLOW,
            "scope": "Local cross-origin loading only; no location consent, login, cart changes, table start, orders or payments. Not a production-origin, WebMCP or checkout acceptance test.",
            "services": results,
        }
        (output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        if args.retain_raw_har:
            raw_output = output_dir / "private-har"
            raw_output.mkdir(mode=0o700)
            for har in private_dir.glob("*.har"):
                shutil.copy(har, raw_output / har.name)
                (raw_output / har.name).chmod(0o600)
        print(f"Report: {output_dir / 'report.json'}")
        return 0 if all(item["result"] == "content-and-recorded-network-passed" for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
