#!/usr/bin/env python3
"""
Fetch and normalize WoW Forever talent tree data from Wowhead's talent-calc
backend (the endpoint behind wowhead.com/forever/talent-calc/<class>).

Source: https://nether.wowhead.com/forever/data/talents-classic?dv=<dv>&db=<db>
The `db` value is a cache/version token that changes when Wowhead refreshes
the data -- re-check it periodically (open the talent calc page, DevTools ->
Network -> XHR, find the `talents-classic` request) and update DATA_URL below.

Output: one JSON file per class under ./out/<class>.json, plus out/all.json
with everything combined, in a stable schema decoupled from Wowhead's
internal tree IDs.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

DATA_URL = "https://nether.wowhead.com/forever/data/talents-classic?dv=19&db=1789102903"
OUT_DIR = Path(__file__).parent / "out"

# tree "description" -> (class, spec) -- derived from data["trees"][id]["description"]
# Wowhead concatenates ClassSpec with no separator, so this is a manual split.
TREE_NAME_MAP = {
    "MageFire": ("Mage", "Fire"),
    "MageFrost": ("Mage", "Frost"),
    "MageArcane": ("Mage", "Arcane"),
    "WarriorArms": ("Warrior", "Arms"),
    "WarriorProtection": ("Warrior", "Protection"),
    "WarriorFury": ("Warrior", "Fury"),
    "RogueCombat": ("Rogue", "Combat"),
    "RogueAssassination": ("Rogue", "Assassination"),
    "RogueSubtlety": ("Rogue", "Subtlety"),
    "PriestDiscipline": ("Priest", "Discipline"),
    "PriestHoly": ("Priest", "Holy"),
    "PriestShadow": ("Priest", "Shadow"),
    "ShamanElementalCombat": ("Shaman", "Elemental"),
    "ShamanRestoration": ("Shaman", "Restoration"),
    "ShamanEnhancement": ("Shaman", "Enhancement"),
    "DruidFeralCombat": ("Druid", "Feral Combat"),
    "DruidRestoration": ("Druid", "Restoration"),
    "DruidBalance": ("Druid", "Balance"),
    "WarlockDestruction": ("Warlock", "Destruction"),
    "WarlockCurses": ("Warlock", "Affliction"),   # Classic-era tab name; verify vs live UI
    "WarlockSummoning": ("Warlock", "Demonology"), # Classic-era tab name; verify vs live UI
    "HunterBeastMastery": ("Hunter", "Beast Mastery"),
    "HunterSurvival": ("Hunter", "Survival"),
    "HunterMarksmanship": ("Hunter", "Marksmanship"),
    "PaladinCombat": ("Paladin", "Retribution"),  # Classic-era tab name; verify vs live UI
    "PaladinHoly": ("Paladin", "Holy"),
    "PaladinProtection": ("Paladin", "Protection"),
}


def fetch_raw(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; forever-talent-fetch/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def parse_pagedata(raw: str) -> dict:
    """Strip the WH.setPageData("key", ...); wrapper and parse the JSON body."""
    m = re.match(r'WH\.setPageData\("[^"]+",\s*(.*)\);\s*$', raw, re.S)
    if not m:
        raise ValueError("Unexpected payload shape -- Wowhead may have changed the format")
    return json.loads(m.group(1))


def normalize(data: dict) -> dict:
    """
    Returns:
    {
      "Warrior": {
        "Arms": {
          "tree_id": 161,
          "talents": [
            {
              "id": 105958,
              "name": "Improved Heroic Strike",
              "row": 0, "col": 0,
              "icon": "ability_rogue_ambush",
              "max_rank": 3,
              "descriptions": {"1": "...", "2": "...", "3": "..."},
              "requires": [{"id": 105954, "qty": 5}],
              "requires_text": null,
              "cost": null
            },
            ...
          ]
        },
        "Protection": {...},
        "Fury": {...}
      },
      ...
    }
    """
    trees_meta = data["trees"]
    talents_by_tree = data["talents"]
    out: dict = {}

    unmapped = []
    for tree_id_str, meta in trees_meta.items():
        desc = meta.get("description", "")
        mapping = TREE_NAME_MAP.get(desc)
        if not mapping:
            unmapped.append((tree_id_str, desc))
            continue
        cls, spec = mapping
        tree_talents = talents_by_tree.get(tree_id_str, {})

        talent_list = []
        for talent_id_str, t in tree_talents.items():
            ranks = t.get("ranks", [])
            talent_list.append({
                "id": t["id"],
                "name": t["name"],
                "row": t["row"],
                "col": t["col"],
                "icon": t.get("icon"),
                "max_rank": len(ranks) if ranks else 1,
                "descriptions": t.get("descriptions", {}),
                "requires": t.get("requires", []),
                "requires_text": t.get("requiresText"),
                "cost": t.get("cost"),
            })
        talent_list.sort(key=lambda x: (x["row"], x["col"]))

        out.setdefault(cls, {})[spec] = {
            "tree_id": int(tree_id_str),
            "talents": talent_list,
        }

    if unmapped:
        print(f"WARNING: {len(unmapped)} tree(s) had no name mapping, skipped: {unmapped}",
              file=sys.stderr)

    return out


def main():
    print(f"Fetching {DATA_URL} ...", file=sys.stderr)
    raw = fetch_raw(DATA_URL)
    data = parse_pagedata(raw)
    normalized = normalize(data)

    OUT_DIR.mkdir(exist_ok=True)
    for cls, specs in normalized.items():
        path = OUT_DIR / f"{cls.lower()}.json"
        path.write_text(json.dumps(specs, indent=2, ensure_ascii=False), encoding="utf-8")
        n_talents = sum(len(s["talents"]) for s in specs.values())
        print(f"  {cls}: {len(specs)} trees, {n_talents} talents -> {path}", file=sys.stderr)

    (OUT_DIR / "all.json").write_text(
        json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nDone. {len(normalized)} classes written to {OUT_DIR}/", file=sys.stderr)


if __name__ == "__main__":
    main()
