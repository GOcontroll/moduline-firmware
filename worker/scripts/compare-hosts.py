"""Check that firmware.gocontroll.com and firmware.gocontroll.tech serve the same firmware.

Walks modules/manifest.json, every per-module manifest and every release file in it, and
brcm/manifest.json with every file it lists. For each object it compares status, SHA-256, size,
ETag, Content-Type and Last-Modified on both hosts, and checks each .srec against the sha256 in its
manifest. Exit code 0 when everything matches, 1 otherwise.

    python -I scripts/compare-hosts.py
"""
import hashlib
import json
import sys
import urllib.parse
import urllib.request

HOSTS = ["https://firmware.gocontroll.com", "https://firmware.gocontroll.tech"]
UA = {"User-Agent": "gocontroll-firmware-compare/1.0"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}


def keys():
    """(key, expected sha256 or None) for every object the manifests reference, in order."""
    out = [("modules/manifest.json", None)]
    _, body, _ = fetch(HOSTS[0] + "/modules/manifest.json")
    for module in json.loads(body)["modules"]:
        out.append((module["manifest"], None))
        _, sub, _ = fetch(HOSTS[0] + "/" + module["manifest"])
        for release in json.loads(sub)["releases"]:
            out.append((release["file"], release["sha256"]))
    out.append(("brcm/manifest.json", None))
    _, body, _ = fetch(HOSTS[0] + "/brcm/manifest.json")
    for name in json.loads(body)["files"]:
        out.append(("brcm/" + name, None))
    seen = set()
    return [k for k in out if not (k[0] in seen or seen.add(k[0]))]


def main():
    rows = keys()
    failures = 0
    for key, expected in rows:
        path = "/" + urllib.parse.quote(key)
        results = []
        for host in HOSTS:
            status, body, headers = fetch(host + path)
            results.append((status, hashlib.sha256(body).hexdigest(), len(body),
                            headers.get("etag"), headers.get("content-type"), headers.get("last-modified")))
        same = results[0] == results[1]
        matches_manifest = expected is None or results[0][1] == expected
        ok = same and matches_manifest
        failures += 0 if ok else 1
        line = f"{'OK ' if ok else 'BAD'} {results[0][0]}/{results[1][0]} {results[0][1]} {results[0][2]:>7}B {key}"
        if expected is not None:
            line += " sha=manifest" if matches_manifest else " SHA!=MANIFEST"
        if results[0][3:] != results[1][3:]:
            line += f"  headers differ: com={results[0][3:]} tech={results[1][3:]}"
        print(line)
    print(f"{len(rows)} objects, {failures} differences")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
