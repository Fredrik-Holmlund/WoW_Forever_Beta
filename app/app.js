// Static interactive talent calculator. No backend, no build step: fetches
// app/data/scored.json (produced by scoring/generate_scored_data.py) and
// renders all 3 specs of the selected class side by side, like the real
// in-game / Wowhead calculator.
//
// Talent icons load from app/icons/<slug>.jpg. That folder is NOT checked
// in (this sandbox's network policy blocks wowhead.com/zamimg.com, so the
// icons couldn't be fetched here) -- run data/fetch_talent_icons.py
// locally to populate it. Until then every talent falls back to a
// monogram tile, which is why "icon-img" has an onerror handler below.

const DATA_URL = "data/scored.json";
const TOTAL_POINTS = 51;
const ROW_UNLOCK_STEP = 5;

const CLASS_THEME = {
  Druid: "linear-gradient(160deg, #1b3b2a, #2d5a3d)",
  Warrior: "linear-gradient(160deg, #3b2a1b, #5a4a2d)",
  Mage: "linear-gradient(160deg, #1b2a3b, #2d3d5a)",
  Priest: "linear-gradient(160deg, #3b1b3b, #5a2d5a)",
  Rogue: "linear-gradient(160deg, #2a2a2a, #4a4a4a)",
  Shaman: "linear-gradient(160deg, #1b2a4a, #2d4a6a)",
  Warlock: "linear-gradient(160deg, #2a1b3b, #4a2d5a)",
  Hunter: "linear-gradient(160deg, #2a3b1b, #4a5a2d)",
  Paladin: "linear-gradient(160deg, #3b3b1b, #5a5a2d)",
};

let DATA = null;
// { className: { talentId: rank } }
const ranksByClass = {};
let svgUidCounter = 0;

const classSelect = document.getElementById("class-select");
const scoreToggle = document.getElementById("score-toggle");
const poolUsedEl = document.getElementById("pool-used");
const treesEl = document.getElementById("trees");

let tooltipEl = null;

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

  classSelect.addEventListener("change", render);
  scoreToggle.addEventListener("change", render);

  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  render();
}

function poolUsed(cls) {
  const ranks = ranksByClass[cls] || {};
  return Object.values(ranks).reduce((a, b) => a + b, 0);
}

function pointsInTreeBelowRow(treeTalents, ranks, row) {
  let sum = 0;
  for (const t of treeTalents) {
    if (t.row < row) sum += ranks[t.id] || 0;
  }
  return sum;
}

function canAdd(talent, treeTalents, ranks, poolRemaining) {
  const cur = ranks[talent.id] || 0;
  if (cur >= talent.max_rank) return false;
  if (poolRemaining <= 0) return false;
  if (pointsInTreeBelowRow(treeTalents, ranks, talent.row) < ROW_UNLOCK_STEP * talent.row) {
    return false;
  }
  for (const req of talent.requires || []) {
    if ((ranks[req.id] || 0) < req.qty) return false;
  }
  return true;
}

function clearTalent(talent, treeTalents, ranks) {
  const cur = ranks[talent.id] || 0;
  if (cur === 0) return;
  delete ranks[talent.id];
  for (const t2 of treeTalents) {
    for (const req of t2.requires || []) {
      if (req.id === talent.id && req.qty > 0) {
        clearTalent(t2, treeTalents, ranks);
      }
    }
  }
}

function addRank(talent, treeTalents, ranks) {
  ranks[talent.id] = (ranks[talent.id] || 0) + 1;
}

function removeRank(talent, treeTalents, ranks) {
  const cur = ranks[talent.id] || 0;
  if (cur <= 0) return;
  const newRank = cur - 1;
  for (const t2 of treeTalents) {
    for (const req of t2.requires || []) {
      if (req.id === talent.id && req.qty > newRank) {
        clearTalent(t2, treeTalents, ranks);
      }
    }
  }
  if (newRank <= 0) delete ranks[talent.id];
  else ranks[talent.id] = newRank;
}

function isRowLocked(treeTalents, ranks, row) {
  return pointsInTreeBelowRow(treeTalents, ranks, row) < ROW_UNLOCK_STEP * row;
}

function monogramFor(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : s;
  return div.innerHTML;
}

// Rich mouseover panel: current rank's effect, a preview of the next rank,
// which prerequisites are/aren't met yet, and the heuristic score.
function buildTooltipHTML(talent, rank, treeTalents, ranks) {
  const byId = {};
  for (const t of treeTalents) byId[t.id] = t;

  const parts = [];
  parts.push(
    `<div class="tt-name">${escapeHtml(talent.name)} <span class="tt-rank">${rank}/${talent.max_rank}</span></div>`
  );

  if (rank > 0) {
    parts.push(`<div class="tt-desc">${escapeHtml(talent.descriptions[String(rank)] || "")}</div>`);
  }
  if (rank < talent.max_rank) {
    const nextRank = rank + 1;
    parts.push(`<div class="tt-next-label">Nästa rank (${nextRank}/${talent.max_rank}):</div>`);
    parts.push(
      `<div class="tt-desc tt-dim">${escapeHtml(talent.descriptions[String(nextRank)] || "")}</div>`
    );
  }

  if (talent.requires && talent.requires.length) {
    const items = talent.requires.map((r) => {
      const reqTalent = byId[r.id];
      const name = reqTalent ? reqTalent.name : `#${r.id}`;
      const have = ranks[r.id] || 0;
      const met = have >= r.qty;
      return `<span class="${met ? "tt-met" : "tt-unmet"}">${escapeHtml(name)} (${have}/${r.qty})</span>`;
    });
    parts.push(`<div class="tt-requires">Kräver: ${items.join(", ")}</div>`);
  }

  parts.push(`<div class="tt-score">Heuristiskt värde (max rank): ${talent.score.total_value}</div>`);

  return parts.join("");
}

function showTooltip(evt, html) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "wh-tooltip";
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";
  positionTooltip(evt);
}

function positionTooltip(evt) {
  if (!tooltipEl || tooltipEl.style.display === "none") return;
  const pad = 18;
  const rect = tooltipEl.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = evt.clientY - rect.height - pad;
  tooltipEl.style.left = `${Math.max(4, x)}px`;
  tooltipEl.style.top = `${Math.max(4, y)}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = "none";
}

function render() {
  hideTooltip(); // nodes are about to be torn down and rebuilt below
  const cls = classSelect.value;
  if (!cls) return;
  const specs = DATA[cls];
  poolUsedEl.textContent = poolUsed(cls);
  const showScore = scoreToggle.checked;

  treesEl.innerHTML = "";
  for (const specName of Object.keys(specs)) {
    const { el, draw } = renderTreePanel(cls, specName, specs[specName], showScore);
    treesEl.appendChild(el);
    draw(); // must run after the panel is attached to the DOM, or offsetWidth/Height read 0
  }
}

function renderTreePanel(cls, specName, tree, showScore) {
  ranksByClass[cls] = ranksByClass[cls] || {};
  const ranks = ranksByClass[cls];
  const treeTalents = tree.talents;

  const panel = document.createElement("div");
  panel.className = "tree-panel";

  const header = document.createElement("div");
  header.className = "tree-header";
  header.innerHTML = `
    <div class="tree-icon">${monogramFor(specName)}</div>
    <div class="tree-name">${specName}</div>
    <div class="tree-points">${treePoints(treeTalents, ranks)} / ${TOTAL_POINTS}</div>
  `;
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "tree-body";
  body.style.setProperty("--tree-bg", CLASS_THEME[cls] || "linear-gradient(160deg, #222, #333)");

  const gridWrap = document.createElement("div");
  gridWrap.className = "grid-wrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "connectors");
  gridWrap.appendChild(svg);

  const grid = document.createElement("div");
  grid.className = "grid";
  const maxRow = Math.max(...treeTalents.map((t) => t.row));
  const maxCol = Math.max(...treeTalents.map((t) => t.col));
  grid.style.gridTemplateColumns = `repeat(${maxCol + 1}, 56px)`;
  grid.style.gridTemplateRows = `repeat(${maxRow + 1}, 56px)`;

  const nodeEls = {};

  for (const t of treeTalents) {
    const rank = ranks[t.id] || 0;
    const locked = isRowLocked(treeTalents, ranks, t.row) && rank === 0;

    const node = document.createElement("div");
    node.className = "node" + (rank > 0 ? " has-rank" : " rank-zero") + (locked ? " locked" : "");
    node.style.gridColumn = t.col + 1;
    node.style.gridRow = t.row + 1;
    node.addEventListener("mouseenter", (e) =>
      showTooltip(e, buildTooltipHTML(t, rank, treeTalents, ranks))
    );
    node.addEventListener("mousemove", positionTooltip);
    node.addEventListener("mouseleave", hideTooltip);

    const img = document.createElement("img");
    img.className = "icon-img";
    img.src = `icons/${t.icon}.jpg`;
    img.alt = t.name;
    const mono = document.createElement("div");
    mono.className = "monogram";
    mono.style.display = "none";
    mono.textContent = monogramFor(t.name);
    img.addEventListener("error", () => {
      img.style.display = "none";
      mono.style.display = "flex";
    });
    node.appendChild(img);
    node.appendChild(mono);

    const rankBadge = document.createElement("div");
    rankBadge.className = "rank-badge";
    rankBadge.textContent = `${rank}/${t.max_rank}`;
    node.appendChild(rankBadge);

    if (showScore) {
      const scoreBadge = document.createElement("div");
      scoreBadge.className = "score-badge";
      scoreBadge.textContent = t.score.total_value;
      node.appendChild(scoreBadge);
    }

    node.addEventListener("click", () => {
      const remaining = TOTAL_POINTS - poolUsed(cls);
      if (!locked && canAdd(t, treeTalents, ranks, remaining)) {
        addRank(t, treeTalents, ranks);
        render();
      }
    });
    node.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (rank > 0) {
        removeRank(t, treeTalents, ranks);
        render();
      }
    });

    nodeEls[t.id] = node;
    grid.appendChild(node);
  }

  gridWrap.appendChild(grid);
  body.appendChild(gridWrap);
  panel.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "tree-footer";

  const resetBtn = document.createElement("button");
  resetBtn.className = "reset-btn";
  resetBtn.textContent = "✕ Reset";
  resetBtn.addEventListener("click", () => {
    for (const t of treeTalents) delete ranks[t.id];
    render();
  });

  const autofill = document.createElement("div");
  autofill.className = "autofill";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = String(TOTAL_POINTS);
  input.value = "20";
  const btn = document.createElement("button");
  btn.textContent = "Fyll automatiskt";
  btn.title = "Använd scoring-modulens föreslagna build för detta träd, upp till N poäng";
  btn.addEventListener("click", () => {
    const otherTreesUsed = poolUsed(cls) - treePoints(treeTalents, ranks);
    const maxAllowed = TOTAL_POINTS - otherTreesUsed;
    const desired = Math.max(0, Math.min(parseInt(input.value || "0", 10), maxAllowed));
    const build = tree.best_builds[desired];
    for (const t of treeTalents) delete ranks[t.id];
    for (const [tid, r] of Object.entries(build.ranks)) ranks[Number(tid)] = r;
    render();
  });
  autofill.appendChild(input);
  autofill.appendChild(btn);

  footer.appendChild(resetBtn);
  footer.appendChild(autofill);
  panel.appendChild(footer);

  return { el: panel, draw: () => drawConnectors(treeTalents, nodeEls, ranks, svg, grid) };
}

function treePoints(treeTalents, ranks) {
  return treeTalents.reduce((sum, t) => sum + (ranks[t.id] || 0), 0);
}

function drawConnectors(treeTalents, nodeEls, ranks, svg, grid) {
  const w = grid.offsetWidth;
  const h = grid.offsetHeight;
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const uid = svgUidCounter++;
  const markerLit = `arrow-lit-${uid}`;
  const markerDim = `arrow-dim-${uid}`;
  let defs = `
    <defs>
      <marker id="${markerLit}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#d9b45c" />
      </marker>
      <marker id="${markerDim}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#555" />
      </marker>
    </defs>
  `;
  let lines = "";

  for (const t of treeTalents) {
    for (const req of t.requires || []) {
      const elA = nodeEls[req.id];
      const elB = nodeEls[t.id];
      if (!elA || !elB) continue;

      const ax = elA.offsetLeft, ay = elA.offsetTop, aw = elA.offsetWidth, ah = elA.offsetHeight;
      const bx = elB.offsetLeft, by = elB.offsetTop, bw = elB.offsetWidth, bh = elB.offsetHeight;

      let x1, y1, x2, y2;
      if (ay < by) {
        x1 = ax + aw / 2; y1 = ay + ah;
        x2 = bx + bw / 2; y2 = by;
      } else if (ay === by) {
        if (ax < bx) {
          x1 = ax + aw; y1 = ay + ah / 2;
          x2 = bx; y2 = by + bh / 2;
        } else {
          x1 = ax; y1 = ay + ah / 2;
          x2 = bx + bw; y2 = by + bh / 2;
        }
      } else {
        x1 = ax + aw / 2; y1 = ay;
        x2 = bx + bw / 2; y2 = by + bh;
      }

      const lit = (ranks[req.id] || 0) >= req.qty;
      const stroke = lit ? "#d9b45c" : "#555";
      const marker = lit ? markerLit : markerDim;
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2" marker-end="url(#${marker})" />`;
    }
  }

  svg.innerHTML = defs + lines;
}
