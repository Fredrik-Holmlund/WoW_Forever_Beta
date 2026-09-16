// Static interactive talent calculator. No backend, no build step: fetches
// app/data/scored.json (produced by scoring/generate_scored_data.py) and
// renders all 3 specs of the selected class side by side, like the real
// in-game / Wowhead calculator.
//
// Talent icons load from app/icons/<slug>.jpg (checked in). If new talents
// are added later and their icons are missing, re-run
// data/fetch_talent_icons.py -- any talent without a matching file just
// falls back to a monogram tile, which is why "icon-img" has an onerror
// handler below.
//
// Tree background art loads from app/backgrounds/<tree_id>.jpg (checked
// in, one per class/spec). Falls back to a flat per-class CSS gradient
// (CLASS_THEME below) if a tree_id has no matching file.

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

// class_icons/ and spec_icons/ are checked in (see README). Spec icons are
// keyed by tree_id, not name, since Wowhead's own spec names don't always
// match the ones we derive in TREE_NAME_MAP (e.g. "Elemental Combat" vs
// "Elemental") -- tree_id is the stable join key we already use elsewhere.
const CLASS_ICON = {
  Druid: "class_icons/class_druid.jpg",
  Hunter: "class_icons/class_hunter.jpg",
  Mage: "class_icons/class_mage.jpg",
  Paladin: "class_icons/class_paladin.jpg",
  Priest: "class_icons/class_priest.jpg",
  Rogue: "class_icons/class_rogue.jpg",
  Shaman: "class_icons/class_shaman.jpg",
  Warlock: "class_icons/class_warlock.jpg",
  Warrior: "class_icons/class_warrior.jpg",
};

const SPEC_ICON_BY_TREE_ID = {
  41: "spec_icons/spell_fire_firebolt02.jpg",
  61: "spec_icons/spell_frost_frostbolt02.jpg",
  81: "spec_icons/spell_holy_magicalsentry.jpg",
  161: "spec_icons/ability_rogue_eviscerate.jpg",
  163: "spec_icons/ability_warrior_defensivestance.jpg",
  164: "spec_icons/ability_warrior_innerrage.jpg",
  181: "spec_icons/ability_backstab.jpg",
  182: "spec_icons/ability_rogue_eviscerate.jpg",
  183: "spec_icons/ability_stealth.jpg",
  201: "spec_icons/spell_holy_wordfortitude.jpg",
  202: "spec_icons/spell_holy_holybolt.jpg",
  203: "spec_icons/spell_shadow_shadowwordpain.jpg",
  261: "spec_icons/spell_nature_lightning.jpg",
  262: "spec_icons/spell_nature_magicimmunity.jpg",
  263: "spec_icons/spell_nature_lightningshield.jpg",
  281: "spec_icons/ability_racial_bearform.jpg",
  282: "spec_icons/spell_nature_healingtouch.jpg",
  283: "spec_icons/spell_nature_starfall.jpg",
  301: "spec_icons/spell_shadow_rainoffire.jpg",
  302: "spec_icons/spell_shadow_deathcoil.jpg",
  303: "spec_icons/spell_shadow_metamorphosis.jpg",
  361: "spec_icons/ability_hunter_beasttaming.jpg",
  362: "spec_icons/ability_hunter_swiftstrike.jpg",
  363: "spec_icons/ability_marksmanship.jpg",
  381: "spec_icons/spell_holy_auraoflight.jpg",
  382: "spec_icons/spell_holy_holybolt.jpg",
  383: "spec_icons/spell_holy_devotionaura.jpg",
};

let DATA = null;
// { className: { talentId: rank } }
const ranksByClass = {};
// { className: [{ talentId, name, icon, rank }, ...] } -- chronological log
// of point spends, across all 3 trees of that class, for the Talent Order
// panel. Rebuilt entry-by-entry as ranks change (see logAdd/logRemoveOne/
// logClear/logReplaceTree below) rather than derived from ranksByClass,
// since a rank map alone can't tell you the order points were spent in.
const orderByClass = {};
let svgUidCounter = 0;
let currentClass = null;
let searchQuery = "";

const classPickerEl = document.getElementById("class-picker");
const scoreToggle = document.getElementById("score-toggle");
const searchInput = document.getElementById("search-input");
const pointsSummaryEl = document.getElementById("points-summary");
const treesEl = document.getElementById("trees");
const orderListEl = document.getElementById("talent-order-list");

let tooltipEl = null;

init();

async function init() {
  const res = await fetch(DATA_URL);
  DATA = await res.json();

  const classes = Object.keys(DATA).sort();
  for (const cls of classes) {
    const btn = document.createElement("button");
    btn.className = "class-btn";
    btn.title = cls;
    btn.dataset.class = cls;
    const img = document.createElement("img");
    img.src = CLASS_ICON[cls] || "";
    img.alt = cls;
    img.addEventListener("error", () => {
      img.style.display = "none";
      btn.textContent = cls.slice(0, 2).toUpperCase();
    });
    btn.appendChild(img);
    btn.addEventListener("click", () => {
      if (currentClass === cls) return;
      hideTooltip(); // switching class replaces every tree; don't leave a stale tooltip up
      currentClass = cls;
      render();
    });
    classPickerEl.appendChild(btn);
  }
  currentClass = classes[0];

  scoreToggle.addEventListener("change", render);
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    render();
  });

  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  render();
}

function poolUsed(cls) {
  const ranks = ranksByClass[cls] || {};
  return Object.values(ranks).reduce((a, b) => a + b, 0);
}

// --- Talent Order log --------------------------------------------------

function logAdd(cls, talent, rank) {
  orderByClass[cls] = orderByClass[cls] || [];
  orderByClass[cls].push({ talentId: talent.id, name: talent.name, icon: talent.icon, rank });
}

// Removes the most recent log entry for this talent (mirrors removeRank,
// which always removes the highest currently-held rank).
function logRemoveOne(cls, talentId) {
  const log = orderByClass[cls];
  if (!log) return;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].talentId === talentId) {
      log.splice(i, 1);
      return;
    }
  }
}

// Removes every log entry for a talent (mirrors clearTalent's cascade wipe).
function logClearTalent(cls, talentId) {
  const log = orderByClass[cls];
  if (!log) return;
  orderByClass[cls] = log.filter((e) => e.talentId !== talentId);
}

function logClearTree(cls, treeTalents) {
  const log = orderByClass[cls];
  if (!log) return;
  const ids = new Set(treeTalents.map((t) => t.id));
  orderByClass[cls] = log.filter((e) => !ids.has(e.talentId));
}

// Autofill doesn't spend points one at a time, so there's no real "order"
// to log -- approximate one deterministically (top-to-bottom, left-to-right
// through the tree) so the panel still shows something sensible.
function logReplaceTree(cls, treeTalents, ranks) {
  logClearTree(cls, treeTalents);
  const sorted = [...treeTalents].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const t of sorted) {
    const rank = ranks[t.id] || 0;
    for (let r = 1; r <= rank; r++) logAdd(cls, t, r);
  }
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

function clearTalent(talent, treeTalents, ranks, cls) {
  const cur = ranks[talent.id] || 0;
  if (cur === 0) return;
  delete ranks[talent.id];
  logClearTalent(cls, talent.id);
  for (const t2 of treeTalents) {
    for (const req of t2.requires || []) {
      if (req.id === talent.id && req.qty > 0) {
        clearTalent(t2, treeTalents, ranks, cls);
      }
    }
  }
}

function addRank(talent, treeTalents, ranks, cls) {
  const newRank = (ranks[talent.id] || 0) + 1;
  ranks[talent.id] = newRank;
  logAdd(cls, talent, newRank);
}

function removeRank(talent, treeTalents, ranks, cls) {
  const cur = ranks[talent.id] || 0;
  if (cur <= 0) return;
  const newRank = cur - 1;
  for (const t2 of treeTalents) {
    for (const req of t2.requires || []) {
      if (req.id === talent.id && req.qty > newRank) {
        clearTalent(t2, treeTalents, ranks, cls);
      }
    }
  }
  if (newRank <= 0) delete ranks[talent.id];
  else ranks[talent.id] = newRank;
  logRemoveOne(cls, talent.id);
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

// The node the mouse is currently over, kept across re-renders (add/remove
// rank, autofill, reset all tear down and rebuild every node) so the
// tooltip stays open and its content updates live instead of needing a
// mouseleave+mouseenter to refresh.
let hoveredTalent = null; // { talent, treeTalents, ranks }
let lastMouseX = 0;
let lastMouseY = 0;

function showTooltipAt(html, x, y) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "wh-tooltip";
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";
  positionTooltipAt(x, y);
}

function positionTooltipAt(x, y) {
  if (!tooltipEl || tooltipEl.style.display === "none") return;
  const pad = 18;
  const rect = tooltipEl.getBoundingClientRect();
  let px = x + pad;
  let py = y + pad;
  if (px + rect.width > window.innerWidth) px = x - rect.width - pad;
  if (py + rect.height > window.innerHeight) py = y - rect.height - pad;
  tooltipEl.style.left = `${Math.max(4, px)}px`;
  tooltipEl.style.top = `${Math.max(4, py)}px`;
}

function refreshHoveredTooltip() {
  if (!hoveredTalent) return;
  const { talent, treeTalents, ranks } = hoveredTalent;
  const rank = ranks[talent.id] || 0;
  showTooltipAt(buildTooltipHTML(talent, rank, treeTalents, ranks), lastMouseX, lastMouseY);
}

function hideTooltip() {
  hoveredTalent = null;
  if (tooltipEl) tooltipEl.style.display = "none";
}

function render() {
  const cls = currentClass;
  if (!cls) return;
  const specs = DATA[cls];
  const specNames = Object.keys(specs).sort();

  for (const btn of classPickerEl.children) {
    btn.classList.toggle("selected", btn.dataset.class === cls);
  }

  const perTree = specNames.map((name) => treePoints(specs[name].talents, ranksByClass[cls] || {}));
  const remaining = TOTAL_POINTS - poolUsed(cls);
  pointsSummaryEl.innerHTML = `${perTree.join("/")} &nbsp; Points left: <b>${remaining}</b>`;

  const showScore = scoreToggle.checked;
  treesEl.innerHTML = "";
  for (const specName of specNames) {
    const { el, draw } = renderTreePanel(cls, specName, specs[specName], showScore);
    treesEl.appendChild(el);
    draw(); // must run after the panel is attached to the DOM, or offsetWidth/Height read 0
  }

  renderTalentOrder(cls);

  // Nodes were just torn down and rebuilt: if the mouse is still resting on
  // the talent it was hovering (e.g. after a click added/removed a rank),
  // re-show the tooltip immediately with fresh content instead of leaving
  // it stale or requiring a mouseleave+mouseenter to update it.
  refreshHoveredTooltip();
}

function renderTalentOrder(cls) {
  const log = orderByClass[cls] || [];
  orderListEl.innerHTML = "";
  if (log.length === 0) {
    const li = document.createElement("li");
    li.className = "to-empty";
    li.textContent = "Inga poäng spenderade än.";
    orderListEl.appendChild(li);
    return;
  }
  log.forEach((entry, i) => {
    const li = document.createElement("li");
    const idx = document.createElement("span");
    idx.className = "to-index";
    idx.textContent = String(i + 1);
    const icon = document.createElement("img");
    icon.className = "to-icon";
    icon.src = `icons/${entry.icon}.jpg`;
    icon.alt = "";
    icon.addEventListener("error", () => (icon.style.visibility = "hidden"));
    const name = document.createElement("span");
    name.className = "to-name";
    name.textContent = entry.name;
    const rank = document.createElement("span");
    rank.className = "to-rank";
    rank.textContent = `Rank ${entry.rank}`;
    li.append(idx, icon, name, rank);
    orderListEl.appendChild(li);
  });
  orderListEl.parentElement.scrollTop = orderListEl.parentElement.scrollHeight;
}

function renderTreePanel(cls, specName, tree, showScore) {
  ranksByClass[cls] = ranksByClass[cls] || {};
  const ranks = ranksByClass[cls];
  const treeTalents = tree.talents;

  const panel = document.createElement("div");
  panel.className = "tree-panel";

  const header = document.createElement("div");
  header.className = "tree-header";
  const treeIcon = document.createElement("div");
  treeIcon.className = "tree-icon";
  const specIconPath = SPEC_ICON_BY_TREE_ID[tree.tree_id];
  if (specIconPath) {
    const specImg = document.createElement("img");
    specImg.src = specIconPath;
    specImg.alt = specName;
    specImg.addEventListener("error", () => {
      specImg.remove();
      treeIcon.textContent = monogramFor(specName);
    });
    treeIcon.appendChild(specImg);
  } else {
    treeIcon.textContent = monogramFor(specName);
  }
  const nameEl = document.createElement("div");
  nameEl.className = "tree-name";
  nameEl.textContent = specName;
  const pointsEl = document.createElement("div");
  pointsEl.className = "tree-points";
  pointsEl.textContent = `${treePoints(treeTalents, ranks)} / ${TOTAL_POINTS}`;
  header.append(treeIcon, nameEl, pointsEl);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "tree-body";
  const fallbackGradient = CLASS_THEME[cls] || "linear-gradient(160deg, #222, #333)";
  body.style.setProperty("--tree-bg", `url('backgrounds/${tree.tree_id}.jpg'), ${fallbackGradient}`);

  const gridWrap = document.createElement("div");
  gridWrap.className = "grid-wrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "connectors");
  gridWrap.appendChild(svg);

  const grid = document.createElement("div");
  grid.className = "grid";
  const maxRow = Math.max(...treeTalents.map((t) => t.row));
  const maxCol = Math.max(...treeTalents.map((t) => t.col));
  grid.style.gridTemplateColumns = `repeat(${maxCol + 1}, 40px)`;
  grid.style.gridTemplateRows = `repeat(${maxRow + 1}, 40px)`;

  const nodeEls = {};

  for (const t of treeTalents) {
    const rank = ranks[t.id] || 0;
    const locked = isRowLocked(treeTalents, ranks, t.row) && rank === 0;

    let searchClass = "";
    if (searchQuery) {
      searchClass = t.name.toLowerCase().includes(searchQuery) ? " search-match" : " search-dim";
    }
    const node = document.createElement("div");
    node.className =
      "node" + (rank > 0 ? " has-rank" : " rank-zero") + (locked ? " locked" : "") + searchClass;
    node.style.gridColumn = t.col + 1;
    node.style.gridRow = t.row + 1;
    node.addEventListener("mouseenter", (e) => {
      hoveredTalent = { talent: t, treeTalents, ranks };
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      showTooltipAt(buildTooltipHTML(t, ranks[t.id] || 0, treeTalents, ranks), e.clientX, e.clientY);
    });
    node.addEventListener("mousemove", (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      positionTooltipAt(e.clientX, e.clientY);
    });
    node.addEventListener("mouseleave", () => {
      if (hoveredTalent && hoveredTalent.talent.id === t.id) hideTooltip();
    });

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
        addRank(t, treeTalents, ranks, cls);
        render();
      }
    });
    node.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (rank > 0) {
        removeRank(t, treeTalents, ranks, cls);
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
    logClearTree(cls, treeTalents);
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
    logReplaceTree(cls, treeTalents, ranks);
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
