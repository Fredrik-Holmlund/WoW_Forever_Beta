#!/usr/bin/env python3
"""
Run the Scorer + best-build solver over data/out/all.json and write a
single combined app/data/scored.json for the static UI to fetch().

Swapping the scoring approach later (e.g. to real SimC results) means
writing a new Scorer implementation and changing SCORER below -- nothing
else in this script, or in the UI, needs to change.
"""
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scoring import HeuristicScorer, best_builds_for_all_budgets

ROOT = Path(__file__).parent.parent
SOURCE = ROOT / "data" / "out" / "all.json"
DEST = ROOT / "app" / "data" / "scored.json"
MAX_POINTS = 51

SCORER = HeuristicScorer()


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    output: dict = {}

    for cls, specs in source.items():
        output[cls] = {}
        for spec, tree in specs.items():
            talents = tree["talents"]
            scored_talents = []
            for t in talents:
                score = SCORER.score_talent(t)
                scored_talents.append(
                    {
                        **t,
                        "score": {
                            "per_rank_values": score.per_rank_values,
                            "total_value": score.total_value,
                            "rationale": score.rationale,
                            "breakdown": [asdict(c) for c in score.breakdown],
                        },
                    }
                )

            builds = best_builds_for_all_budgets(talents, SCORER, max_points=MAX_POINTS)
            best_builds = [
                {
                    "points_used": builds[n].points_used,
                    "total_value": builds[n].total_value,
                    "ranks": {str(k): v for k, v in builds[n].ranks.items()},
                }
                for n in range(0, MAX_POINTS + 1)
            ]

            output[cls][spec] = {
                "tree_id": tree["tree_id"],
                "talents": scored_talents,
                "best_builds": best_builds,
            }
            n_talents = len(talents)
            print(f"  {cls}/{spec}: {n_talents} talents scored, "
                  f"51pt best value = {builds[MAX_POINTS].total_value}", file=sys.stderr)

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {DEST}", file=sys.stderr)


if __name__ == "__main__":
    main()
