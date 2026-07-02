#!/usr/bin/env python3
"""
Minimal App Store Connect API client for the Sharm Eats Restaurant app.

Auth: ES256 JWT signed with the team's ASC API key (never printed/logged).
Used for the one thing the browser session cannot do headlessly: uploading
screenshot assets. Everything else (metadata text, privacy, submission) is
done in the ASC web UI.

Usage:
  python3 asc_api.py versions                # list app store versions
  python3 asc_api.py localizations <verId>   # list localizations for a version
  python3 asc_api.py upload <locId> <displayType> <file1> [file2 ...]
"""
import base64
import hashlib
import json
import sys
import time
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

HERE = Path(__file__).resolve().parent
KEY_PATH = HERE.parent / "credentials" / "AuthKey_C4TFQQ5AAD.p8"
KEY_ID = "C4TFQQ5AAD"
ISSUER_ID = "d19fd03e-1f5b-44b1-a3e9-519b25a39274"
APP_ID = "6786450108"  # Sharm Eats Restaurant
API = "https://api.appstoreconnect.apple.com"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token() -> str:
    with open(KEY_PATH, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    header = {"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}
    now = int(time.time())
    payload = {"iss": ISSUER_ID, "iat": now, "exp": now + 19 * 60, "aud": "appstoreconnect-v1"}
    signing_input = b64url(json.dumps(header, separators=(",", ":")).encode()) + "." + \
        b64url(json.dumps(payload, separators=(",", ":")).encode())
    der_sig = key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    # convert DER signature to raw r||s (each 32 bytes) as required by JWS
    r, s = decode_dss_signature(der_sig)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return signing_input + "." + b64url(raw)


def req(method: str, path: str, tok: str, **kw):
    headers = kw.pop("headers", {})
    headers["Authorization"] = f"Bearer {tok}"
    if "json" in kw:
        headers["Content-Type"] = "application/json"
    r = requests.request(method, API + path if path.startswith("/") else path,
                         headers=headers, timeout=60, **kw)
    if r.status_code >= 400:
        print(f"HTTP {r.status_code} {method} {path}\n{r.text[:2000]}", file=sys.stderr)
        sys.exit(1)
    return r.json() if r.text else {}


def cmd_versions(tok):
    data = req("GET", f"/v1/apps/{APP_ID}/appStoreVersions?limit=10", tok)
    for v in data.get("data", []):
        a = v["attributes"]
        print(f"  {v['id']}  v{a['versionString']}  {a['appStoreState']}  platform={a['platform']}")
    if not data.get("data"):
        print("  (no app store versions)")


def cmd_localizations(tok, ver_id):
    data = req("GET", f"/v1/appStoreVersions/{ver_id}/appStoreVersionLocalizations", tok)
    for l in data.get("data", []):
        print(f"  {l['id']}  locale={l['attributes']['locale']}")


def cmd_upload(tok, loc_id, display_type, files):
    # 1. find-or-create the screenshot set for this display type
    sets = req("GET", f"/v1/appStoreVersionLocalizations/{loc_id}/appScreenshotSets", tok)
    set_id = None
    for s in sets.get("data", []):
        if s["attributes"]["screenshotDisplayType"] == display_type:
            set_id = s["id"]
            break
    if not set_id:
        created = req("POST", "/v1/appScreenshotSets", tok, json={
            "data": {
                "type": "appScreenshotSets",
                "attributes": {"screenshotDisplayType": display_type},
                "relationships": {"appStoreVersionLocalization": {
                    "data": {"type": "appStoreVersionLocalizations", "id": loc_id}}},
            }
        })
        set_id = created["data"]["id"]
        print(f"  created set {set_id} ({display_type})")
    else:
        print(f"  using existing set {set_id} ({display_type})")

    for fp in files:
        p = Path(fp)
        size = p.stat().st_size
        # 2. reserve
        res = req("POST", "/v1/appScreenshots", tok, json={
            "data": {
                "type": "appScreenshots",
                "attributes": {"fileName": p.name, "fileSize": size},
                "relationships": {"appScreenshotSet": {
                    "data": {"type": "appScreenshotSets", "id": set_id}}},
            }
        })
        shot_id = res["data"]["id"]
        ops = res["data"]["attributes"]["uploadOperations"]
        blob = p.read_bytes()
        # 3. upload parts
        for op in ops:
            start, length = op["offset"], op["length"]
            part = blob[start:start + length]
            hdrs = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
            ur = requests.request(op["method"], op["url"], headers=hdrs, data=part, timeout=120)
            if ur.status_code >= 400:
                print(f"  upload part failed {ur.status_code}: {ur.text[:300]}", file=sys.stderr)
                sys.exit(1)
        # 4. commit
        md5 = hashlib.md5(blob).hexdigest()
        req("PATCH", f"/v1/appScreenshots/{shot_id}", tok, json={
            "data": {"type": "appScreenshots", "id": shot_id,
                     "attributes": {"uploaded": True, "sourceFileChecksum": md5}}
        })
        print(f"  uploaded {p.name} -> {shot_id}")


def main():
    tok = make_token()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "versions"
    if cmd == "versions":
        cmd_versions(tok)
    elif cmd == "localizations":
        cmd_localizations(tok, sys.argv[2])
    elif cmd == "upload":
        cmd_upload(tok, sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        print("unknown command", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
