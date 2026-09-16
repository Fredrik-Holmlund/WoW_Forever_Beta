"""
Talent scoring.

This module is deliberately split from everything else: `Scorer` is a
`Protocol` (structural interface), and `HeuristicScorer` is *one*
implementation of it. `scoring/builder.py` and the UI only ever talk to
the `Scorer` interface, never to `HeuristicScorer` directly, so a future
implementation (for example `SimcScorer`, reading real DPS/HPS deltas out
of SimulationCraft results once the game is out) can be dropped in without
touching the DP or the frontend -- just point `generate_scored_data.py` at
the new scorer and regenerate `app/data/scored.json`.

`HeuristicScorer` IS A ROUGH APPROXIMATION, NOT A SIMULATION. It reads the
tooltip text per rank, pulls out numbers, and weights them by category
(damage/heal % hits hardest, flat stats weakest, etc). It knows nothing
about base cooldowns, cast times, stat budgets, or how talents interact
with each other -- it is meant to give a rough "which talents look like
they matter" signal until real sim data exists, not a min-max answer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ScoreComponent:
    """One matched piece of a talent's tooltip text that contributed to its score."""

    label: str  # human-readable category, e.g. "Skada/heal %"
    matched_text: str  # the substring that matched (or a snippet, for baseline fallbacks)
    value: float  # the raw parsed number (or 1 for a flat baseline)
    weight: float  # weight applied to `value`
    contribution: float  # value * weight, rounded


@dataclass(frozen=True)
class TalentScore:
    """Score for one talent, valid at every point between rank 0 and max_rank."""

    talent_id: int
    max_rank: int
    # value gained by taking rank i (1-indexed): per_rank_values[0] is the
    # marginal value of the FIRST point spent, etc. len() == max_rank.
    per_rank_values: list[float]
    # value of the talent fully maxed (== sum(per_rank_values)), handy for display.
    total_value: float
    # short human-readable explanation of how the score was derived.
    rationale: str
    # WHY total_value is what it is: every matched component of the max-rank
    # tooltip text, so the UI can show its work instead of just a number.
    breakdown: list[ScoreComponent]


class Scorer(Protocol):
    """Anything that can turn a talent dict (see data/out schema) into a TalentScore."""

    def score_talent(self, talent: dict) -> TalentScore:
        ...


# --- HeuristicScorer -------------------------------------------------------
#
# Weight per unit of the matched quantity (e.g. WEIGHT_DAMAGE_PCT * 5 for a
# rank description reading "...by 5%"). These are hand-picked, not derived
# from any data, and exist purely to bias the ordering roughly toward
# "modifies your main damage/healing numbers" > "procs/chances" >
# "utility/mitigation" > "flat secondary stats". Tune freely.
WEIGHT_DAMAGE_OR_HEAL_PCT = 1.6
WEIGHT_CRIT_PCT = 1.3
WEIGHT_PROC_CHANCE_PCT = 1.0
WEIGHT_GENERIC_PCT = 1.0
WEIGHT_COST_REDUCTION_PCT = 0.8
WEIGHT_THREAT_PCT = 0.5
WEIGHT_COOLDOWN_SEC = 2.0
WEIGHT_CAST_TIME_SEC = 1.5
WEIGHT_RANGE_YARDS = 0.3
WEIGHT_FLAT_STAT = 0.15
WEIGHT_RESISTANCE = 0.1
WEIGHT_UNMATCHED_FLAT_NUMBER = 0.05

# Baseline value assigned when a rank's text has no parseable number at all
# (pure qualitative effect, e.g. "can no longer be dispelled").
BASELINE_QUALITATIVE = 4.0
# Talents with a single rank sitting in the last row of the tree are almost
# always build-defining capstone abilities; bump their baseline up.
BASELINE_CAPSTONE = 8.0
CAPSTONE_ROW = 6

_STAT_NAMES = r"(?:Strength|Agility|Intellect|Spirit|Stamina|Attack Power|Spell Power|Armor)"

# Ordered (most specific first) so a "damage by X%" match isn't also double
# counted by the generic percent fallback. Each entry is (pattern, weight,
# human-readable label) -- the label is only for the breakdown/explanation,
# it doesn't affect scoring.
_PATTERNS: list[tuple[re.Pattern[str], float, str]] = [
    (re.compile(r"(?:damage|healing)[^.%]*?by (\d+(?:\.\d+)?)%", re.I), WEIGHT_DAMAGE_OR_HEAL_PCT, "Skada/heal %"),
    (re.compile(r"critical strike chance[^.%]*?by (\d+(?:\.\d+)?)%", re.I), WEIGHT_CRIT_PCT, "Kritisk träffchans %"),
    (re.compile(r"(\d+(?:\.\d+)?)% chance", re.I), WEIGHT_PROC_CHANCE_PCT, "Procchans %"),
    (re.compile(r"(?:reduces?|decreases?)[^.%]*?cost[^.%]*?by (\d+(?:\.\d+)?)%", re.I), WEIGHT_COST_REDUCTION_PCT, "Resurskostnad -%"),
    (re.compile(r"threat[^.%]*?by (\d+(?:\.\d+)?)%", re.I), WEIGHT_THREAT_PCT, "Threat %"),
    (re.compile(r"cooldown[^.]*?by (\d+(?:\.\d+)?) sec", re.I), WEIGHT_COOLDOWN_SEC, "Cooldown-reduktion (sek)"),
    (re.compile(r"cast(?:ing)? time[^.]*?by (\d+(?:\.\d+)?) sec", re.I), WEIGHT_CAST_TIME_SEC, "Casttid-reduktion (sek)"),
    (re.compile(r"range[^.]*?by (\d+(?:\.\d+)?) yard", re.I), WEIGHT_RANGE_YARDS, "Räckvidd (yards)"),
    (re.compile(rf"by (\d+(?:\.\d+)?) {_STAT_NAMES}", re.I), WEIGHT_FLAT_STAT, "Flat statökning"),
    (re.compile(r"resistance[^.]*?by (\d+(?:\.\d+)?)", re.I), WEIGHT_RESISTANCE, "Resistance"),
    (re.compile(r"by (\d+(?:\.\d+)?)%", re.I), WEIGHT_GENERIC_PCT, "Övrig procentsats"),
]
_ANY_NUMBER = re.compile(r"(\d+(?:\.\d+)?)")


def _magnitude_breakdown(text: str, *, row: int, max_rank: int) -> tuple[float, list[ScoreComponent]]:
    """
    Rough "how much does this tooltip text matter" score, plus the list of
    matched components that produced it -- this IS the "why" the UI shows.
    """
    if not text:
        return 0.0, []

    matched_spans: list[tuple[int, int]] = []
    components: list[ScoreComponent] = []
    for pattern, weight, label in _PATTERNS:
        for m in pattern.finditer(text):
            span = m.span(1)
            if any(a < span[1] and span[0] < b for a, b in matched_spans):
                continue  # already counted by a more specific pattern
            matched_spans.append(span)
            value = float(m.group(1))
            components.append(
                ScoreComponent(
                    label=label,
                    matched_text=m.group(0),
                    value=value,
                    weight=weight,
                    contribution=round(value * weight, 3),
                )
            )

    total = round(sum(c.contribution for c in components), 3)
    if total > 0:
        return total, components

    # No categorized number matched -- fall back to any bare number (e.g. a
    # flat damage value like "155 to 185 Fire damage") at low weight, or a
    # flat qualitative baseline if there's no number at all.
    any_numbers = _ANY_NUMBER.findall(text)
    if any_numbers:
        raw = sum(float(n) for n in any_numbers)
        contribution = round(raw * WEIGHT_UNMATCHED_FLAT_NUMBER, 3)
        component = ScoreComponent(
            label="Otolkad siffra (låg vikt)",
            matched_text=text,
            value=raw,
            weight=WEIGHT_UNMATCHED_FLAT_NUMBER,
            contribution=contribution,
        )
        return contribution, [component]

    if row >= CAPSTONE_ROW and max_rank == 1:
        component = ScoreComponent(
            label="Baseline: kapstensförmåga (sista raden, 1 rank)",
            matched_text=text,
            value=1.0,
            weight=BASELINE_CAPSTONE,
            contribution=BASELINE_CAPSTONE,
        )
        return BASELINE_CAPSTONE, [component]

    component = ScoreComponent(
        label="Baseline: kvalitativ effekt (ingen tolkningsbar siffra hittad)",
        matched_text=text,
        value=1.0,
        weight=BASELINE_QUALITATIVE,
        contribution=BASELINE_QUALITATIVE,
    )
    return BASELINE_QUALITATIVE, [component]


@dataclass
class HeuristicScorer:
    """The only Scorer implementation today. See module docstring."""

    def score_talent(self, talent: dict) -> TalentScore:
        max_rank = talent["max_rank"]
        descriptions: dict = talent.get("descriptions") or {}
        row = talent["row"]

        magnitudes = [0.0]  # magnitude(rank=0) == 0
        max_rank_breakdown: list[ScoreComponent] = []
        for rank in range(1, max_rank + 1):
            text = descriptions.get(str(rank), "")
            value, breakdown = _magnitude_breakdown(text, row=row, max_rank=max_rank)
            magnitudes.append(value)
            if rank == max_rank:
                max_rank_breakdown = breakdown

        per_rank_values = []
        for rank in range(1, max_rank + 1):
            marginal = magnitudes[rank] - magnitudes[rank - 1]
            # Ranks should never look "free" or actively harmful under this
            # heuristic -- clamp so the DP always has a reason to consider
            # spending the point.
            per_rank_values.append(round(max(marginal, 0.1), 3))

        total_value = round(sum(per_rank_values), 3)
        rationale = (
            f"parsed magnitude at max rank = {magnitudes[-1]:.2f}, "
            f"distributed over {max_rank} rank(s)"
        )
        return TalentScore(
            talent_id=talent["id"],
            max_rank=max_rank,
            per_rank_values=per_rank_values,
            total_value=total_value,
            rationale=rationale,
            breakdown=max_rank_breakdown,
        )
