#!/usr/bin/env python3
"""
Download every talent icon referenced in data/out/all.json into app/icons/,
so the UI (app/app.js) can show real artwork instead of its monogram
fallback.

Wowhead serves icons from a fixed CDN pattern that's been stable for years:

    https://wow.zamimg.com/images/wow/icons/large/<slug>.jpg

`<slug>` is exactly the `icon` field already present on each talent in
data/out/*.json (e.g. "spell_nature_starfall").

This could not be run inside the sandboxed environment this project was
built in -- its egress policy blocks both wowhead.com and wow.zamimg.com
(confirmed with a direct connection test, not just assumed). Run it
yourself, locally, where you have normal internet access:

    python3 data/fetch_talent_icons.py

It's safe to re-run: existing files are skipped unless --force is passed.
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ICON_URL = "https://wow.zamimg.com/images/wow/icons/large/{slug}.jpg"
ROOT = Path(__file__).parent.parent
SOURCE = ROOT / "data" / "out" / "all.json"
DEST_DIR = ROOT / "app" / "icons"


def collect_slugs() -> set[str]:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    slugs = set()
    for specs in data.values():
        for tree in specs.values():
            for t in tree["talents"]:
                if t.get("icon"):
                    slugs.add(t["icon"])
    return slugs


def download(slug: str, force: bool) -> str:
    dest = DEST_DIR / f"{slug}.jpg"
    if dest.exists() and not force:
        return "skip"
    req = urllib.request.Request(
        ICON_URL.format(slug=slug),
        headers={"User-Agent": "Mozilla/5.0 (compatible; forever-talent-icons/1.0)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            dest.write_bytes(resp.read())
        return "ok"
    except Exception as e:  # noqa: BLE001 -- report and move on, one bad icon shouldn't stop the run
        print(f"  FAILED {slug}: {e}", file=sys.stderr)
        return "fail"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="re-download icons that already exist")
    parser.add_argument("--delay", type=float, default=0.1, help="seconds to sleep between requests")
    args = parser.parse_args()

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    slugs = sorted(collect_slugs())
    print(f"{len(slugs)} unique icons to fetch", file=sys.stderr)

    counts = {"ok": 0, "skip": 0, "fail": 0}
    for i, slug in enumerate(slugs, 1):
        result = download(slug, args.force)
        counts[result] += 1
        if result == "ok":
            time.sleep(args.delay)
        if i % 25 == 0:
            print(f"  ...{i}/{len(slugs)}", file=sys.stderr)

    print(
        f"\nDone: {counts['ok']} downloaded, {counts['skip']} already present, "
        f"{counts['fail']} failed. Icons in {DEST_DIR}/",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
