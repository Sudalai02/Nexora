import { icon, fmtDate } from "../dom.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as habitsSvc from "../services/habitService.js";
import * as focusService from "../services/focusService.js";
import * as eventService from "../services/eventService.js";
import { getProfile } from "../services/settingsService.js";
import { reasonsFor } from "../ai/prioritizer.js";
import * as aiService from "../ai/aiService.js";
import { fmtHour, minutesToHuman, fmtDateLong, todayISO } from "../utils/dates.js";

let dismissIds = []; // "Not now" rotations within this visit

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export async function renderHome(view, alive = () => true) {
  const today = todayISO();
  const [profile, tasks, projects, goals, habitList, sessions, todayEvents] = await Promise.all([
    getProfile(),
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    habitsSvc.allHabits(),
    focusService.allSessions(),
    eventService.eventsInRange(today, today),
  ]);
  if (!alive()) return;

  const name = profile?.name?.split(" ")[0] || "there";
  const gProg = await goalService.progressMap(goals, projects, tasks);

  // ----- recommendation ("What should I do now") -----
  let ranked = taskService.decorate(
    tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status))
  );
  ranked.sort((a, b) => b._score - a._score);
  const pool = ranked.filter((t) => !dismissIds.includes(t.id));
  const rec = pool[0] || null;
  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;
  const reasons = rec ? reasonsFor(rec, projectNameOf(rec.projectId)) : [];

  const top3 = pool.filter((t) => t.id !== rec?.id).slice(0, 3);
  const atRisk = ranked.filter((t) => {
    if (!t.dueDate) return false;
    const d = new Date(`${t.dueDate}T00:00:00`) < new Date(`${today}T00:00:00`);
    return d && !["Completed", "Cancelled"].includes(t.status);
  });

  // ----- today's progress -----
  const dueToday = tasks.filter((t) => t.dueDate === today && !["Cancelled"].includes(t.status));
  const doneToday = dueToday.filter((t) => t.status === "Completed").length +
    tasks.filter((t) => t.completedAt?.slice(0, 10) === today && (!t.dueDate || t.dueDate !== today)).length;
  const focusToday = sessions
    .filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) === today)
    .reduce((a, s) => a + Math.round((s.durationSeconds || 0) / 60), 0);

  // ----- habits scheduled today -----
  const streaks = await Promise.all(
    habitList.map(async (hb) => ({
      hb,
      scheduled: habitsSvc.scheduledOn(hb, today),
      streak: await habitsSvc.streak(hb),
      done: (await habitsSvc.logsForDate(today)).has(hb.id),
    }))
  );

  view.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">${fmtDateLong(today)}</div>
      <div class="page-title-row">
        <h1>${greeting()}, ${name}.</h1>
      </div>
      <div class="sub">Here's what matters most today.</div>
    </div>

    <div class="home-grid">
      <div class="home-main">

        ${
          rec
            ? `
        <div class="now-card" id="now-card">
          <div class="now-eyebrow">${icon("spark")} What should I do now
            <span class="engine-pill" id="engine-pill">checking…</span>
          </div>
          <div class="now-task" id="now-task-title">${rec.title}</div>
          <div class="now-meta-row" id="now-meta-row">
            <span>Estimated time: <span class="num">${rec.estimatedMinutes} min</span></span>
            ${rec.priority ? `<span>Priority: <span class="num">${rec.priority}</span></span>` : ""}
          </div>
          <div class="now-why">
            <div class="now-why-label">Why this task</div>
            <ul id="now-reasons">
              ${reasons.map((r) => `<li>${r}</li>`).join("")}
            </ul>
          </div>
          <div class="now-actions">
            <button class="btn btn-primary" id="start-focus-btn">${icon("play")} Start focus</button>
            <button class="btn btn-secondary" id="schedule-btn">${icon("calendar")} Schedule</button>
            <button class="btn btn-ghost" id="not-now-btn">Not now</button>
          </div>
        </div>`
            : `
        <div class="card" style="margin-bottom: var(--sp-6); text-align:center; padding: var(--sp-10);">
          ${icon("check")}
          <h3 style="font-size:16px;">You're all caught up.</h3>
          <p style="font-size:13px;color:var(--graphite);margin-top:6px;">No open tasks right now — add one or start a habit.</p>
          <a href="#/tasks" class="btn btn-primary btn-sm" style="margin-top:14px;">Open tasks</a>
        </div>`
        }

        <div class="card" style="margin-bottom: var(--sp-6);">
          <div class="section-head">
            <h2>Top priorities</h2>
            <a href="#/tasks" class="link">View all tasks</a>
          </div>
          <div class="priority-list">
            ${top3.length
              ? top3
                  .map(
                    (t, i) => `
              <div class="priority-row">
                <span class="priority-rank num">${String(i + 1).padStart(2, "0")}</span>
                <span class="priority-dot ${t._tier === "now" ? "p-now" : t._tier === "next" ? "p-next" : "p-later"}"></span>
                <div class="priority-row-body">
                  <div class="priority-row-title">${t.title}</div>
                  <div class="priority-row-meta">
                    <span>${projectNameOf(t.projectId) || "No project"}</span>
                    ${t.dueDate && new Date(`${t.dueDate}T00:00:00`) < new Date(`${today}T00:00:00`) ? `<span class="badge badge-danger">Overdue</span>` : ""}
                  </div>
                </div>
                <span class="priority-row-time num">${t.estimatedMinutes}m</span>
              </div>`
                  )
                  .join("")
              : `<div class="empty-state" style="padding:20px;"><p>Nothing queued.</p></div>`}
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <h2>Active goals</h2>
            <a href="#/goals" class="link">View all</a>
          </div>
          ${goals.filter((g) => g.status !== "Completed").length
            ? goals
                .filter((g) => g.status !== "Completed")
                .map((g) => {
                  const pct = gProg[g.id]?.pct ?? 0;
                  return `
            <div style="margin-bottom: 16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:13.5px; font-weight:600;">${g.title}</span>
                <span class="num" style="font-size:12px; color:var(--graphite-dim);">${pct}%</span>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>`;
                })
                .join("")
            : `<div class="empty-state" style="padding:20px;"><p>No active goals yet.</p></div>`}
        </div>

      </div>

      <div class="side-stack">

        <div class="card">
          <div class="eyebrow" style="margin-bottom:12px;">Today's progress</div>
          <div class="stat-row">
            <div class="stat-box">
              <div class="stat-value num">${doneToday}/${Math.max(1, dueToday.length)}</div>
              <div class="stat-label">Tasks done</div>
            </div>
            <div class="stat-box">
              <div class="stat-value num">${minutesToHuman(focusToday)}</div>
              <div class="stat-label">Focus time</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="section-head" style="margin-bottom:8px;">
            <h2 style="font-size:14px;">Upcoming today</h2>
          </div>
          ${todayEvents.length
            ? todayEvents
                .map(
                  (e) => `
            <div class="event-row">
              <span class="event-time num">${fmtHour(e.startHour)}</span>
              <span class="event-title">${e.title}</span>
            </div>`
                )
                .join("")
            : `<div class="empty-state" style="padding: 24px 8px;"><p>Nothing scheduled. Open slots today.</p></div>`}
        </div>

        ${atRisk.length
          ? `
        <div class="card">
          <div class="section-head" style="margin-bottom:8px;">
            <h2 style="font-size:14px; color:var(--danger);">At risk</h2>
          </div>
          ${atRisk.slice(0, 4).map(
            (t) => `
          <div class="risk-row">
            ${icon("alert")}
            <div>
              <div class="risk-title">${t.title}</div>
              <div class="risk-sub">Overdue · ${fmtDate(t.dueDate)}</div>
            </div>
          </div>`
          ).join("")}
        </div>`
          : ""}

        <div class="card">
          <div class="section-head" style="margin-bottom:8px;">
            <h2 style="font-size:14px;">Habits today</h2>
          </div>
          ${streaks.length
            ? streaks
                .filter((s) => s.scheduled)
                .map(
                  (s) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding: 9px 0; border-bottom: 1px solid var(--hairline);">
              <div>
                <div style="font-size:12.5px; font-weight:500;">${s.hb.title}</div>
                <div style="font-size:11px; color:var(--graphite-dim); margin-top:2px;">${s.hb.timeOfDay} · ${s.hb.durationMinutes}m</div>
              </div>
              ${s.done
                ? `<span class="badge badge-good">Done</span>`
                : `<span class="badge badge-warn">🔥 ${s.streak}</span>`}
            </div>`
                )
                .join("") || `<div class="empty-state" style="padding:18px 8px;"><p>Rest day — no habits scheduled.</p></div>`
            : `<div class="empty-state" style="padding:18px 8px;"><p>No habits yet. Create some on the Goals page.</p></div>`}
        </div>

      </div>
    </div>
  `;

  document.getElementById("start-focus-btn")?.addEventListener("click", () => {
    window.location.hash = "#/focus";
  });
  document.getElementById("not-now-btn")?.addEventListener("click", () => {
    if (rec) dismissIds.push(rec.id);
    renderHome(view, alive);
  });
  document.getElementById("schedule-btn")?.addEventListener("click", () => {
    window.location.hash = "#/calendar";
  });

  // ----- background AI refinement of the recommendation -----
  // The card renders instantly with smart rules; if a local model is
  // running, its pick replaces the content a moment later.
  (async () => {
    const r = await aiService.recommendNextAction();
    if (!alive()) return;
    const card = view.querySelector("#now-card");
    const pill = () => view.querySelector("#engine-pill");
    if (!r.task) {
      pill()?.remove();
      return;
    }
    if (!card || dismissIds.includes(r.task.id)) {
      const p = pill();
      if (p) p.textContent = r.engine === "ollama" ? "local AI" : "smart rules";
      return;
    }
    view.querySelector("#now-task-title").textContent = r.task.title;
    view.querySelector("#now-meta-row").innerHTML = `
      <span>Estimated time: <span class="num">${r.task.estimatedMinutes} min</span></span>
      ${r.task.priority ? `<span>Priority: <span class="num">${r.task.priority}</span></span>` : ""}
    `;
    view.querySelector("#now-reasons").innerHTML = r.reasons.map((x) => `<li>${x}</li>`).join("");
    const p = pill();
    if (p) p.textContent = r.engine === "ollama" ? `local AI · ${(await aiService.getEngine()).model.split(":")[0]}` : "smart rules";
  })();
}
