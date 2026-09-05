// ============================================================
// GLOBAL SEARCH — accurate, filterable search across every module.
//
// • Searches real stored data: tasks, projects, goals, habits,
//   notes and calendar events (title + description/body).
// • Module chips narrow the search to a single module.
// • Sorting: relevance score, recently updated, or A→Z.
// • Results carry exact details (status, dates, parent names)
//   so the answer is always grounded in the user's actual data.
// ============================================================

import { icon } from "../dom.js";
import * as db from "../store/db.js";
import { fmtDue } from "../utils/dates.js";

const MODULE_DEFS = [
  { id: "tasks", label: "Tasks", iconId: "tasks" },
  { id: "projects", label: "Projects", iconId: "projects" },
  { id: "goals", label: "Goals", iconId: "goals" },
  { id: "habits", label: "Habits", iconId: "clock" },
  { id: "notes", label: "Notes", iconId: "notes" },
  { id: "events", label: "Events", iconId: "calendar" },
];

const st = {
  open: false,
  query: "",
  module: "all",
  sort: "relevance",
  selected: 0,
  openedAt: 0,
};

let backdropEl = null;
let teardownKeys = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const idx = safe.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return safe;
  return `${safe.slice(0, idx)}<mark>${safe.slice(idx, idx + q.length)}</mark>${safe.slice(idx + q.length)}`;
}

// ---------- scoring ----------
// Higher is better. Returns null when the item does not match.
function scoreItem(fields, q) {
  const query = q.trim().toLowerCase();
  if (!query) return null;
  const words = query.split(/\s+/).filter(Boolean);
  const title = (fields.title || "").toLowerCase();
  const body = (fields.body || "").toLowerCase();

  if (!title.includes(query) && !body.includes(query) && !words.every((w) => `${title} ${body}`.includes(w))) {
    return null;
  }

  let s = 0;
  if (title.startsWith(query)) s += 60;
  else if (title.includes(query)) s += 40;
  else if (body.includes(query)) s += 18;
  for (const w of words) {
    if (title.startsWith(w)) s += 8;
    else if (title.includes(w)) s += 5;
    else if (body.includes(w)) s += 2;
  }
  return s;
}

// ---------- collectors ----------

async function collectAll() {
  const [tasks, projects, goals, habits, notes, events, folders] = await Promise.all([
    db.getAll("tasks"),
    db.getAll("projects"),
    db.getAll("goals"),
    db.getAll("habits"),
    db.getAll("notes"),
    db.getAll("events"),
    db.getAll("folders"),
  ]);
  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;
  const folderNameOf = (id) => folders.find((f) => f.id === id)?.name || null;
  const goalNameOf = (id) => goals.find((g) => g.id === id)?.title || null;
  return { tasks, projects, goals, habits, notes, events, projectNameOf, folderNameOf, goalNameOf };
}

function buildResults(data, q, moduleFilter) {
  const out = [];

  const push = (moduleId, item, title, body, metaHTML, route, updatedAt) => {
    const s = scoreItem({ title, body }, q);
    if (s === null) return;
    out.push({
      moduleId,
      id: item.id,
      title,
      snippetHTML: body && !title.toLowerCase().includes(q.trim().toLowerCase()) ? highlight(body.slice(0, 90), q) : "",
      metaHTML,
      route,
      updatedAt,
      score: s,
    });
  };

  if (moduleFilter === "all" || moduleFilter === "tasks") {
    for (const t of data.tasks) {
      push(
        "tasks",
        t,
        t.title,
        t.description || "",
        `
        <span class="badge ${t.status === "Completed" ? "badge-good" : t.status === "Blocked" ? "badge-danger" : "badge-focus"}">${esc(t.status)}</span>
        <span>${esc(t.priority)}</span>
        ${t.dueDate ? `<span>Due ${esc(fmtDue(t.dueDate))}</span>` : ""}
        ${t.projectId ? `<span class="tag">${esc(data.projectNameOf(t.projectId) || "")}</span>` : ""}
        ${t.goalId ? `<span>${icon("flag")} ${esc(data.goalNameOf(t.goalId) || "")}</span>` : ""}
      `,
        `#/tasks?id=${t.id}`,
        t.updatedAt
      );
    }
  }

  if (moduleFilter === "all" || moduleFilter === "projects") {
    for (const p of data.projects) {
      push(
        "projects",
        p,
        p.name,
        p.description || "",
        `
        <span class="badge badge-neutral">${esc(p.status)}</span>
        ${p.deadline ? `<span>Deadline ${esc(p.deadline)}</span>` : "<span>No deadline</span>"}
        ${p.goalId ? `<span>${icon("goals")} ${esc(data.goalNameOf(p.goalId) || "")}</span>` : ""}
      `,
        `#/projects?id=${p.id}`,
        p.createdAt
      );
    }
  }

  if (moduleFilter === "all" || moduleFilter === "goals") {
    for (const g of data.goals) {
      push(
        "goals",
        g,
        g.title,
        g.description || "",
        `
        <span class="badge badge-focus">${esc(g.status)}</span>
        <span>${esc(g.category)}</span>
        <span>${esc(g.priority)}</span>
        ${g.targetDate ? `<span>Target ${esc(g.targetDate)}</span>` : "<span>No target date</span>"}
      `,
        `#/goals?id=${g.id}`,
        g.createdAt
      );
    }
  }

  if (moduleFilter === "all" || moduleFilter === "habits") {
    const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const h of data.habits.filter((x) => !x.archived)) {
      push(
        "habits",
        h,
        h.title,
        "",
        `
        <span>${esc((h.weekdays || []).map((w) => WD[w]).join(" "))}</span>
        <span>${esc(h.timeOfDay)}</span>
        <span>${esc(h.durationMinutes)} min</span>
      `,
        `#/goals?habit=${h.id}`,
        h.createdAt
      );
    }
  }

  if (moduleFilter === "all" || moduleFilter === "notes") {
    for (const n of data.notes) {
      push(
        "notes",
        n,
        n.title || "Untitled note",
        (n.body || "").slice(0, 140),
        `
        <span class="tag">${esc(data.folderNameOf(n.folderId) || "Unfiled")}</span>
        <span>Edited ${(n.updatedAt || "").slice(0, 10)}</span>
      `,
        "#/notes",
        n.updatedAt
      );
    }
  }

  if (moduleFilter === "all" || moduleFilter === "events") {
    const TYPE_LABEL = { meeting: "Meeting", focus: "Focus block", deadline: "Deadline" };
    for (const e of data.events) {
      const hh = Math.floor(e.startHour);
      const mm = Math.round((e.startHour - hh) * 60);
      const ampm = hh >= 12 ? "PM" : "AM";
      const disp = hh % 12 === 0 ? 12 : hh % 12;
      push(
        "events",
        e,
        e.title,
        TYPE_LABEL[e.type] || e.type,
        `
        <span class="badge badge-${e.type === "deadline" ? "ember" : e.type === "focus" ? "focus" : "neutral"}">${esc(TYPE_LABEL[e.type] || e.type)}</span>
        <span>${esc(e.date)} · ${disp}:${String(mm).padStart(2, "0")} ${ampm}</span>
      `,
        `#/calendar?event=${e.id}`,
        e.date
      );
    }
  }

  return out;
}

function sortResults(results, sort) {
  if (sort === "updated") {
    return results.sort((a, b) => ((a.updatedAt || "") < (b.updatedAt || "") ? 1 : -1));
  }
  if (sort === "az") {
    return results.sort((a, b) => a.title.localeCompare(b.title));
  }
  return results.sort((a, b) => b.score - a.score);
}

// ---------- rendering ----------

async function refresh() {
  if (!st.open || !backdropEl) return;
  const listEl = backdropEl.querySelector("#search-results");
  const infoEl = backdropEl.querySelector("#search-info");

  if (!st.query.trim()) {
    listEl.innerHTML = `
      <div class="search-empty">
        ${icon("search")}
        <p>Type to search across all your data.<br/>Use the module chips below to narrow the scope.</p>
      </div>`;
    infoEl.textContent = "";
    return;
  }

  const data = await collectAll();
  let results = buildResults(data, st.query, st.module);
  const totalFound = results.length;
  results = sortResults(results, st.sort);
  st.selected = Math.min(st.selected, Math.max(0, results.length - 1));

  infoEl.textContent = `${totalFound} result${totalFound === 1 ? "" : "s"}`;

  if (!results.length) {
    listEl.innerHTML = `
      <div class="search-empty">
        ${icon("alert")}
        <p>No matches for “${esc(st.query)}”${st.module !== "all" ? ` in ${esc(st.module)}` : ""}.<br/>Try another term or switch the module filter.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = results
    .map(
      (r, i) => `
      <button class="search-result ${i === st.selected ? "active" : ""}" data-idx="${i}" data-route="${r.route}">
        <span class="sr-icon"><span class="nav-icon" data-icon="${MODULE_DEFS.find((m) => m.id === r.moduleId)?.iconId || "notes"}"></span></span>
        <span class="sr-body">
          <span class="sr-title">${highlight(r.title, st.query)}</span>
          ${r.snippetHTML ? `<span class="sr-snippet">…${r.snippetHTML}…</span>` : ""}
          <span class="sr-meta">${r.metaHTML}</span>
        </span>
        <span class="sr-module">${esc(MODULE_DEFS.find((m) => m.id === r.moduleId)?.label || "")}</span>
      </button>`
    )
    .join("");

  listEl.querySelectorAll(".search-result").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeSearch();
      window.location.hash = btn.dataset.route;
    });
    btn.addEventListener("mousemove", () => {
      if (st.selected !== Number(btn.dataset.idx)) {
        st.selected = Number(btn.dataset.idx);
        listEl.querySelectorAll(".search-result").forEach((b) => b.classList.toggle("active", Number(b.dataset.idx) === st.selected));
      }
    });
  });

  listEl.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
}

export function openSearch() {
  if (st.open) return;
  st.open = true;
  st.openedAt = Date.now();
  st.query = "";
  st.module = "all";
  st.sort = "relevance";
  st.selected = 0;

  backdropEl = document.createElement("div");
  backdropEl.className = "search-backdrop";
  backdropEl.innerHTML = `
    <div class="search-modal" role="dialog" aria-modal="true" aria-label="Search">
      <div class="search-input-row">
        <span class="nav-icon" data-icon="search"></span>
        <input type="text" id="search-overlay-input" placeholder="Search tasks, projects, goals, habits, notes, events…" autocomplete="off" />
        <button class="icon-btn" id="search-close" aria-label="Close search"><span class="nav-icon" data-icon="x"></span></button>
      </div>
      <div class="search-toolbar">
        <div class="search-chips" id="search-chips">
          <button class="chip ${st.module === "all" ? "active" : ""}" data-mod="all">All</button>
          ${MODULE_DEFS.map((m) => `<button class="chip ${st.module === m.id ? "active" : ""}" data-mod="${m.id}">${m.label}</button>`).join("")}
        </div>
        <div class="search-sort">
          <select id="search-sort">
            <option value="relevance">Relevance</option>
            <option value="updated">Recently updated</option>
            <option value="az">A → Z</option>
          </select>
        </div>
      </div>
      <div class="search-count" id="search-info"></div>
      <div class="search-results" id="search-results"></div>
      <div class="search-footer">↑↓ navigate · ↵ open · esc close</div>
    </div>
  `;
  document.body.appendChild(backdropEl);

  const input = backdropEl.querySelector("#search-overlay-input");
  requestAnimationFrame(() => {
    backdropEl.classList.add("open");
    input.focus();
  });

  let deb;
  input.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      st.query = input.value;
      st.selected = 0;
      refresh();
    }, 110);
  });

  backdropEl.querySelector("#search-close").addEventListener("click", closeSearch);
  backdropEl.addEventListener("click", (e) => {
    if (e.target === backdropEl && Date.now() - st.openedAt > 350) closeSearch();
  });

  backdropEl.querySelectorAll("[data-mod]").forEach((chip) =>
    chip.addEventListener("click", () => {
      st.module = chip.dataset.mod;
      st.selected = 0;
      backdropEl.querySelectorAll("[data-mod]").forEach((c) => c.classList.toggle("active", c.dataset.mod === st.module));
      refresh();
    })
  );

  backdropEl.querySelector("#search-sort").addEventListener("change", (e) => {
    st.sort = e.target.value;
    refresh();
  });

  const onKey = (e) => {
    if (!st.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const results = backdropEl.querySelectorAll(".search-result");
      if (!results.length) return;
      e.preventDefault();
      st.selected = (st.selected + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      results.forEach((b) => b.classList.toggle("active", Number(b.dataset.idx) === st.selected));
      results[st.selected].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const target = backdropEl.querySelector(`.search-result[data-idx="${st.selected}"]`);
      if (target) {
        closeSearch();
        window.location.hash = target.dataset.route;
      }
    }
  };
  document.addEventListener("keydown", onKey);
  teardownKeys = () => document.removeEventListener("keydown", onKey);
}

export function closeSearch() {
  if (!st.open) return;
  st.open = false;
  teardownKeys?.();
  teardownKeys = null;
  backdropEl?.classList.remove("open");
  const el = backdropEl;
  setTimeout(() => el?.remove(), 160);
  backdropEl = null;
}