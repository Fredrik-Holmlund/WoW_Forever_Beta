// Static UI for the (precomputed) scored talent trees. No backend, no
// build step: fetches app/data/scored.json (produced by
// scoring/generate_scored_data.py) and renders it.

const DATA_URL = "data/scored.json";
const MAX_POINTS = 51;
const ROW_UNLOCK_STEP = 5;

let DATA = null;

const classSelect = document.getElementById("class-select");
const specSelect = document.getElementById("spec-select");
const pointsSlider = document.getElementById("points-slider");
const pointsNumber = document.getElementById("points-number");
const highlightToggle = document.getElementById("highlight-toggle");
const summaryEl = document.getElementById("summary");
const treeEl = document.getElementById("tree");

init();

async function init() {
  const res = await fetch(DATA_URL);
  DATA = await res.json();

  for (const cls of Object.keys(DATA).sort()) {
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls;
    classSelect.appendChild(opt);
  }

  classSelect.addEventListener("change", () => {
    populateSpecs();
    render();
  });
  specSelect.addEventListener("change", render);
  pointsSlider.addEventListener("input", () => {
    pointsNumber.value = pointsSlider.value;
    render();
  });
  pointsNumber.addEventListener("input", () => {
    const v = clamp(parseInt(pointsNumber.value || "0", 10), 0, MAX_POINTS);
    pointsSlider.value = v;
    render();
  });
  highlightToggle.addEventListener("change", render);

  populateSpecs();
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  render();
}

function populateSpecs() {
  specSelect.innerHTML = "";
  const cls = classSelect.value;
  for (const spec of Object.keys(DATA[cls])) {
    const opt = document.createElement("option");
    opt.value = spec;
    opt.textContent = spec;
    specSelect.appendChild(opt);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function valueColor(value, min, max) {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  // interpolate blue-ish (low) -> orange (high), matching --low/--high in CSS
  const low = [59, 91, 122];
  const high = [217, 102, 47];
  const rgb = low.map((c, i) => Math.round(c + (high[i] - c) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function render() {
  const cls = classSelect.value;
  const spec = specSelect.value;
  if (!cls || !spec) return;
  const tree = DATA[cls][spec];
  const budget = clamp(parseInt(pointsNumber.value || "0", 10), 0, MAX_POINTS);
  const build = tree.best_builds[budget];
  const highlight = highlightToggle.checked;

  summaryEl.innerHTML = `
    <span><b>${tree.talents.length}</b> talanger</span>
    <span>Föreslagen build vid ${budget}p: <b>${build.points_used}</b> poäng spenderade,
      totalt heuristiskt värde <b>${build.total_value}</b></span>
  `;

  const values = tree.talents.map((t) => t.score.total_value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);

  const maxRow = Math.max(...tree.talents.map((t) => t.row));
  const maxCol = Math.max(...tree.talents.map((t) => t.col));

  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `repeat(${maxCol + 1}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${maxRow + 1}, auto)`;

  const byPos = {};
  for (const t of tree.talents) byPos[`${t.row},${t.col}`] = t;

  for (let r = 0; r <= maxRow; r++) {
    const rowLocked = budget < ROW_UNLOCK_STEP * r;
    for (let c = 0; c <= maxCol; c++) {
      const t = byPos[`${r},${c}`];
      const cell = document.createElement("div");
      cell.style.gridColumn = c + 1;
      cell.style.gridRow = r + 1;

      if (!t) {
        cell.className = "node empty";
        grid.appendChild(cell);
        continue;
      }

      const suggestedRank = highlight ? (build.ranks[String(t.id)] || 0) : 0;
      cell.className = "node" + (suggestedRank > 0 ? " suggested" : "") +
        (rowLocked ? " locked-row" : "");
      cell.style.background = valueColor(t.score.total_value, minV, maxV);

      const rankLabel = highlight
        ? `${suggestedRank}/${t.max_rank}`
        : `max ${t.max_rank}`;

      cell.innerHTML = `
        <div class="name">${t.name}</div>
        <div class="meta"><span>${rankLabel}</span><span>${t.score.total_value}</span></div>
      `;
      cell.title = buildTooltip(t, suggestedRank);
      grid.appendChild(cell);
    }
  }

  treeEl.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "spec-tree";
  const heading = document.createElement("h2");
  heading.textContent = `${cls} — ${spec}`;
  wrapper.appendChild(heading);
  wrapper.appendChild(grid);
  treeEl.appendChild(wrapper);
}

function buildTooltip(talent, suggestedRank) {
  const rankToShow = suggestedRank > 0 ? suggestedRank : talent.max_rank;
  const desc = talent.descriptions[String(rankToShow)] || "";
  const req = (talent.requires || [])
    .map((r) => `#${r.id} (rank ${r.qty})`)
    .join(", ");
  return [
    `${talent.name} (rank ${rankToShow}/${talent.max_rank})`,
    desc,
    `Heuristiskt värde (max rank): ${talent.score.total_value}`,
    talent.score.rationale,
    req ? `Kräver: ${req}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
