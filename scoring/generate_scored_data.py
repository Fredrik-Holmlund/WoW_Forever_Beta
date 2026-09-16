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

# name in the output JSON -> which TalentScore field the DP should optimize.
# "general" (the blended score) is what the plain "best_builds" table and
# the "Visa heuristiskt värde" overlay use; the other three back the
# DPS/Survival/Healing autofill buttons in the UI.
BUILD_VARIANTS = {
    "best_builds": lambda s: s.per_rank_values,
    "best_builds_dps": lambda s: s.dps_per_rank_values,
    "best_builds_survival": lambda s: s.survival_per_rank_values,
    "best_builds_healing": lambda s: s.healing_per_rank_values,
}


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
                            "dps_total_value": score.dps_total_value,
                            "survival_total_value": score.survival_total_value,
                            "healing_total_value": score.healing_total_value,
                        },
                    }
                )

            output[cls][spec] = {"tree_id": tree["tree_id"], "talents": scored_talents}
            for key, value_selector in BUILD_VARIANTS.items():
                builds = best_builds_for_all_budgets(
                    talents, SCORER, max_points=MAX_POINTS, value_selector=value_selector
                )
                output[cls][spec][key] = [
                    {
                        "points_used": builds[n].points_used,
                        "total_value": builds[n].total_value,
                        "ranks": {str(k): v for k, v in builds[n].ranks.items()},
                    }
                    for n in range(0, MAX_POINTS + 1)
                ]

            n_talents = len(talents)
            print(
                f"  {cls}/{spec}: {n_talents} talents scored, "
                f"51pt best values: general={output[cls][spec]['best_builds'][MAX_POINTS]['total_value']} "
                f"dps={output[cls][spec]['best_builds_dps'][MAX_POINTS]['total_value']} "
                f"survival={output[cls][spec]['best_builds_survival'][MAX_POINTS]['total_value']} "
                f"healing={output[cls][spec]['best_builds_healing'][MAX_POINTS]['total_value']}",
                file=sys.stderr,
            )

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {DEST}", file=sys.stderr)


if __name__ == "__main__":
    main()
