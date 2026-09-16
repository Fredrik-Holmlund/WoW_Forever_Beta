"""
"Best build for N points" solver.

Rules enforced (per the Classic-style talent tree structure WoW Forever
uses): a tree has 7 rows (0-indexed) and up to 51 points total. Row `r`
only accepts points once at least `5 * r` points have already been spent
*somewhere else in the same tree* -- and each talent's own `requires` list
(`[{"id": ..., "qty": ...}]`) must be satisfied by the referenced talent's
chosen rank, wherever in the tree it sits.

Since you control the *order* you spend points in, both constraints only
depend on the final rank assignment, not a specific sequence: a row `r`
with any points in it is valid exactly when the ranks in earlier rows sum
to >= 5r (you can always spend those first), and a talent with rank > 0 is
valid exactly when each of its prerequisites already has the required rank
(same reasoning). That turns this into a grouped knapsack: process rows in
order, and DP over (points spent so far, ranks of every prerequisite
target seen so far). Trees are tiny (<= ~24 talents, <= 4 per row), so
enumerating every rank combination within a row and doing a straightforward
forward DP is plenty fast -- no need for anything cleverer.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

from .scorer import Scorer

ROW_UNLOCK_STEP = 5


@dataclass(frozen=True)
class BuildResult:
    points_used: int
    total_value: float
    ranks: dict[int, int]  # talent_id -> chosen rank, only entries with rank > 0


def _row_combos(row_talents: list[dict], scores: dict, budget_cap: int):
    """
    Every valid (added_points, added_value, ranks) combo for one row,
    filtered only by *same-row* requires -- cross-row requires are checked
    later by the caller, against the DP state's carried-forward ranks.
    """
    ids = [t["id"] for t in row_talents]
    by_id = {t["id"]: t for t in row_talents}
    rank_ranges = [range(0, t["max_rank"] + 1) for t in row_talents]

    combos = []
    for ranks_tuple in product(*rank_ranges):
        added_points = sum(ranks_tuple)
        if added_points > budget_cap:
            continue
        ranks = {tid: r for tid, r in zip(ids, ranks_tuple) if r > 0}

        valid = True
        for tid, rank in ranks.items():
            for req in by_id[tid].get("requires", []):
                rid = req["id"]
                if rid in ids and ranks.get(rid, 0) < req["qty"]:
                    valid = False
                    break
            if not valid:
                break
        if not valid:
            continue

        added_value = sum(sum(scores[tid].per_rank_values[:r]) for tid, r in ranks.items())
        combos.append((added_points, round(added_value, 3), ranks))
    return combos


def best_builds_for_all_budgets(
    talents: list[dict], scorer: Scorer, max_points: int = 51
) -> dict[int, BuildResult]:
    """Best achievable build for every point budget 0..max_points, in one pass."""
    scores = {t["id"]: scorer.score_talent(t) for t in talents}
    watched_ids = sorted({req["id"] for t in talents for req in t.get("requires", [])})

    rows: dict[int, list[dict]] = {}
    for t in talents:
        rows.setdefault(t["row"], []).append(t)
    row_order = sorted(rows)

    def watched_key(ranks: dict[int, int]) -> tuple[int, ...]:
        return tuple(ranks.get(wid, 0) for wid in watched_ids)

    start_key = (0, watched_key({}))
    states: dict[tuple[int, tuple[int, ...]], tuple[float, tuple | None]] = {
        start_key: (0.0, None)
    }
    history: list[dict] = []

    for row_idx in row_order:
        row_talents = rows[row_idx]
        combos = _row_combos(row_talents, scores, max_points)
        by_id = {t["id"]: t for t in row_talents}
        new_states: dict[tuple, tuple[float, tuple | None]] = {}

        for (points, watched), (value, _bp) in states.items():
            row_unlocked = points >= ROW_UNLOCK_STEP * row_idx
            current_watched = dict(zip(watched_ids, watched))

            for added_points, added_value, ranks in combos:
                if added_points > 0 and not row_unlocked:
                    continue
                new_points = points + added_points
                if new_points > max_points:
                    continue

                ok = True
                for tid, rank in ranks.items():
                    for req in by_id[tid].get("requires", []):
                        rid = req["id"]
                        if rid in ranks:
                            continue  # same-row, already checked in _row_combos
                        if current_watched.get(rid, 0) < req["qty"]:
                            ok = False
                            break
                    if not ok:
                        break
                if not ok:
                    continue

                if watched_ids:
                    merged = dict(current_watched)
                    merged.update(ranks)
                    new_watched = watched_key(merged)
                else:
                    new_watched = ()

                new_value = value + added_value
                key = (new_points, new_watched)
                best = new_states.get(key)
                if best is None or new_value > best[0]:
                    new_states[key] = (new_value, ((points, watched), ranks))

        states = new_states
        history.append(states)

    def reconstruct(final_key) -> dict[int, int]:
        ranks_total: dict[int, int] = {}
        key = final_key
        for idx in range(len(row_order) - 1, -1, -1):
            _value, bp = history[idx][key]
            prev_key, ranks_this_row = bp
            ranks_total.update(ranks_this_row)
            key = prev_key
        return ranks_total

    results: dict[int, BuildResult] = {}
    for n in range(0, max_points + 1):
        candidates = [(v, key) for key, (v, _bp) in states.items() if key[0] <= n]
        if not candidates:
            results[n] = BuildResult(points_used=0, total_value=0.0, ranks={})
            continue
        best_value, best_key = max(candidates, key=lambda vk: vk[0])
        results[n] = BuildResult(
            points_used=best_key[0],
            total_value=round(best_value, 3),
            ranks=reconstruct(best_key),
        )
    return results


def best_build(talents: list[dict], scorer: Scorer, points: int) -> BuildResult:
    """Convenience wrapper for a single point budget."""
    return best_builds_for_all_budgets(talents, scorer, max_points=points)[points]
