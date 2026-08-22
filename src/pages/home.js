// ============================================================
// HOME — a dynamic "today flow".
//
// Everything that needs attention TODAY (overdue tasks, tasks due
// today, calendar events, scheduled habits) is presented one item
// at a time like a slider. Completing or skipping an item advances
// automatically to the next one, so the screen always shows exactly
// what is actionable right now.
// ============================================================

import { icon, fmtDate } from "../dom.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as habitsSvc from "../services/habitService.js";
import * as focusService from "../services/focusService.js";
import * as eventService from "../services/eventService.js";
import * as db from "../store/db.js";
import { getProfile } from "../services/settingsService.js";
import { reasonsFor } from "../ai/prioritizer.js";
import { fmtHour, minutesToHuman, fmtDateLong, todayISO } from "../utils/dates.js";
import { toast } from "../ui/toast.js";

// Session-scoped slider state: persists across redraws during this
// visit but resets when a new day begins.
const slider = {
  day: null,
  index: 0,
  dismissed: [], // items skipped with Next during this visit
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function flowId(item) {
  return `${item.kind}:${item.ref.id}`;
}

async function buildTodayFlow({ tasks, habitList, todayEvents, logsToday }) {
  const today = todayISO();
  const doneHabitIds = new Set(logsToday.filter((l) => l.done && l.date === today).map((l) => l.habitId));
  const items = [];

  // 1. Open tasks due earlier than today — overdue, most urgent first.
  const overdue = taskService
    .decorate(tasks.filter((t) => t.dueDate && t.dueDate < today && !["Completed", "Cancelled"].includes(t.status)))
    .sort((a, b) => b._score - a._score);
  for (const t of overdue) items.push({ kind: "task", overdue: true, ref: t });

  // 2. Timed items for today in clock order.
  const timed = [];
  for (const e of todayEvents) timed.push({ kind: "event", minute: Math.round(e.startHour * 60), ref: e });
  for (const t of tasks) {
    if (t.dueDate !== today || ["Completed", "Cancelled"].includes(t.status)) continue;
    timed.push({ kind: "task", minute: t.startTime ? minutesOf(t.startTime) : null, ref: t });
  }
  for (const h of habitList) {
    if (h.archived || !(h.weekdays || []).includes(new Date(`${today}T00:00:00`).getDay())) continue;
    if (doneHabitIds.has(h.id)) continue;
    timed.push({ kind: "habit", minute: minutesOf(h.timeOfDay), ref: h });
  }
  timed.filter((x) => x.minute !== null).sort((a, b) => a.minute - b.minute).forEach((x) => items.push(x));

  // 3. Untimed tasks due today by priority score.
  taskService
    .decorate(timed.filter((x) => x.minute === null && x.kind === "task").map((x) => x.ref))
    .sort((a, b) => b._score - a._score)
    .forEach((t) => items.push({ kind: "task", overdue: false, ref: t }));

  return items.filter((i) => !slider.dismissed.includes(flowId(i)));
}

export async function renderHome(view, alive = () => true) {
  const today = todayISO();
  if (slider.day !== today) {
    slider.day = today;
    slider.index = 0;
    slider.dismissed = [];
  }

  const [profile, tasks, projects, goals, habitList, sessions, todayEvents, logsToday] = await Promise.all([
    getProfile(),
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    habitsSvc.allHabits(),
    focusService.allSessions(),
    eventService.eventsInRange(today, today),
    db.getAll("habitLogs"),
  ]);
  if (!alive()) return;

  const name = profile?.name?.split(" ")[0] || "there";
  const gProg = await goalService.progressMap(goals, projects, tasks);
  const flow = await buildTodayFlow({ tasks, habitList, todayEvents, logsToday });

  slider.index = Math.min(slider.index, Math.max(0, flow.length - 1));
  const current = flow[slider.index] || null;

  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;
  const goalNameOf = (id) => goals.find((g) => g.id === id)?.title || null;

  // ----- today's progress -----
  const dueToday = tasks.filter((t) => t.dueDate === today && t.status !== "Cancelled");
  const doneToday =
    dueToday.filter((t) => t.status === "Completed").length +
    tasks.filter((t) => t.completedAt?.slice(0, 10) === today && (!t.dueDate || t.dueDate !== today)).length;
  const focusToday = sessions
    .filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) === today)
    .reduce((a, s) => a + Math.round((s.durationSeconds || 0) / 60), 0);

  // ----- side column data -----
  const streaks = await Promise.all(
    habitList.map(async (hb) => ({
      hb,
      scheduled: habitsSvc.scheduledOn(hb, today),
      streak: await habitsSvc.streak(hb),
      done: await habitsSvc.isDone(hb.id, today),
    }))
  );

  const top3 = taskService
    .decorate(tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status)))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  view.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">${fmtDateLong(today)}</div>
      <div class="page-title-row">
        <h1>${greeting()}, ${name}.</h1>
      </div>
      <div class="sub">Here's what needs you today — one thing at a time.</div>
    </div>

    <div class="home-grid">
      <div class="home-main">

        <!-- ================= TODAY FLOW SLIDER ================= -->
        ${
          current
            ? `
        <div class="now-card" id="flow-card">
          <div class="flow-topline">
            <span class="flow-type-badge">${flowBadge(current)}</span>
            <span class="flow-counter num">${slider.index + 1} / ${flow.length}</span>
          </div>

          <div id="flow-stage">${flowBody(current, { projectNameOf, goalNameOf, today })}</div>

          <div class="flow-nav">
            <button class="icon-btn flow-arrow" id="flow-prev" aria-label="Previous item" ${slider.index === 0 ? "disabled" : ""}>
              <span class="nav-icon rot180" data-icon="chevron"></span>
            </button>
            <div class="flow-dots">
              ${flow
                .slice(0, 14)
                .map(
                  (_, i) =>
                    `<span class="flow-dot ${i === slider.index ? "active" : ""} ${i < slider.index ? "passed" : ""}"></span>`
                )
                .join("")}
            </div>
            <button class="icon-btn flow-arrow" id="flow-next-arrow" aria-label="Next item" ${slider.index >= flow.length - 1 ? "disabled" : ""}>
              <span class="nav-icon" data-icon="chevron"></span>
            </button>
          </div>

          <div class="now-actions">
            ${
              current.kind === "task"
                ? `<button class="btn btn-primary" id="flow-complete-btn">${icon("check")} Complete</button>
                   <button class="btn btn-secondary" id="start-focus-btn">${icon("play")} Start focus</button>`
                : current.kind === "habit"
                  ? `<button class="btn btn-primary" id="flow-complete-btn">${icon("check")} Mark done</button>`
                  : `<a class="btn btn-secondary" href="#/calendar">${icon("calendar")} Open calendar</a>`
            }
            <button class="btn btn-ghost" id="flow-next-btn">Next ${icon("chevron")}</button>
          </div>
        </div>`
            : `
        <div class="card allcaught-card" style="margin-bottom: var(--sp-6); text-align:center; padding: var(--sp-10);">
          ${icon("check")}
          <h3 style="font-size:16px;">You're all caught up.</h3>
          <p style="font-size:13px;color:var(--graphite);margin-top:6px;">Nothing left for today — add a task or bank an early win.</p>
          <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
            <a href="#/tasks" class="btn btn-secondary btn-sm">Open tasks</a>
            <a href="#/focus" class="btn btn-primary btn-sm">Start a focus session</a>
          </div>
        </div>`
        }

        <div class="card" style="margin-bottom: var(--sp-6);">
          <div class="section-head">
            <h2>Top priorities</h2>
            <a href="#/tasks" class="link">View all tasks</a>
          </div>
          <div class="priority-list">
            ${
              top3.length
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
                    ${t.dueDate && t.dueDate < today ? `<span class="badge badge-danger">Overdue</span>` : ""}
                  </div>
                </div>
                <span class="priority-row-time num">${t.estimatedMinutes}m</span>
              </div>`
                    )
                    .join("")
                : `<div class="empty-state" style="padding:20px;"><p>Nothing queued.</p></div>`
            }
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <h2>Active goals</h2>
            <a href="#/goals" class="link">View all</a>
          </div>
          ${
            goals.filter((g) => g.status !== "Completed").length
              ? goals
                  .filter((g) => g.status !== "Completed")
                  .slice(0, 5)
                  .map((g) => {
                    const pct = gProg[g.id]?.pct ?? 0;
                    return `
            <div style="margin-bottom: 16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:13.5px; font-weight:600;">${g.title} <span class="tag" style="margin-left:4px;">${g.status}</span></span>
                <span class="num" style="font-size:12px; color:var(--graphite-dim);">${pct}%</span>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>`;
                  })
                  .join("")
              : `<div class="empty-state" style="padding:20px;"><p>No active goals yet.</p></div>`
          }
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
          ${
            todayEvents.length
              ? todayEvents
                  .map(
                    (e) => `
            <div class="event-row">
              <span class="event-time num">${fmtHour(e.startHour)}</span>
              <span class="event-title">${e.title}</span>
            </div>`
                  )
                  .join("")
              : `<div class="empty-state" style="padding: 24px 8px;"><p>Nothing scheduled. Open slots today.</p></div>`
          }
        </div>

        <div class="card">
          <div class="section-head" style="margin-bottom:8px;">
            <h2 style="font-size:14px;">Habits today</h2>
          </div>
          ${
            streaks.some((s) => s.scheduled)
              ? streaks
                  .filter((s) => s.scheduled)
                  .map(
                    (s) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding: 9px 0; border-bottom: 1px solid var(--hairline);">
              <div>
                <div style="font-size:12.5px; font-weight:500;">${s.hb.title}</div>
                <div style="font-size:11px; color:var(--graphite-dim); margin-top:2px;">${s.hb.timeOfDay} · ${s.hb.durationMinutes}m</div>
              </div>
              ${s.done ? `<span class="badge badge-good">Done</span>` : `<span class="badge badge-warn">🔥 ${s.streak}</span>`}
            </div>`
                  )
                  .join("")
              : `<div class="empty-state" style="padding:18px 8px;"><p>No habits scheduled today.</p></div>`
          }
        </div>

      </div>
    </div>
  `;

  // ---------- wiring ----------
  const advance = () => {
    slider.index += 1;
    renderHome(view, alive);
  };

  view.querySelector("#flow-complete-btn")?.addEventListener("click", async () => {
    try {
      if (current.kind === "task") {
        await taskService.toggleComplete(current.ref.id);
        toast("Task completed");
      } else {
        await habitsSvc.toggleLog(current.ref.id);
        toast("Habit logged");
      }
    } catch (err) {
      console.error("[home] complete failed", err);
      toast("Something went wrong", "err");
      return;
    }
    advance();
  });

  view.querySelector("#flow-next-btn")?.addEventListener("click", () => {
    // Skip keeps the item out of this visit's rotation.
    if (current) slider.dismissed.push(flowId(current));
    advance();
  });
  view.querySelector("#flow-prev")?.addEventListener("click", () => {
    if (slider.index > 0) {
      slider.index -= 1;
      renderHome(view, alive);
    }
  });
  view.querySelector("#flow-next-arrow")?.addEventListener("click", () => {
    if (slider.index < flow.length - 1) advance();
  });
  view.querySelector("#start-focus-btn")?.addEventListener("click", () => {
    window.location.hash = "#/focus";
  });
}

// ---------- flow item rendering helpers ----------

function flowBadge(item) {
  if (item.kind === "task") return item.overdue ? "Overdue · Task" : "Task";
  if (item.kind === "event") return "Event";
  return "Habit";
}

function fmtEventRange(startH, endH) {
  return `${fmtHour(startH)}${endH ? ` – ${fmtHour(endH)}` : ""}`;
}

function flowBody(item, ctx) {
  const { projectNameOf, goalNameOf, today } = ctx;

  if (item.kind === "task") {
    const t = taskService.decorate([item.ref])[0];
    const reasons = reasonsFor(t, projectNameOf(t.projectId));
    return `
      <div class="flow-eyebrow">${icon("spark")} What should I do now</div>
      <div class="now-task">${t.title}</div>
      <div class="now-meta-row">
        <span>Estimated: <span class="num">${t.estimatedMinutes} min</span></span>
        ${t.priority ? `<span>Priority: <span class="num">${t.priority}</span></span>` : ""}
        ${t.startTime ? `<span>Scheduled: <span class="num">${t.startTime}${t.endTime ? `–${t.endTime}` : ""}</span></span>` : ""}
        ${t.projectId && projectNameOf(t.projectId) ? `<span class="tag">${projectNameOf(t.projectId)}</span>` : ""}
        ${t.goalId && goalNameOf(t.goalId) ? `<span>${icon("flag")} ${goalNameOf(t.goalId)}</span>` : ""}
      </div>
      <div class="now-why">
        <div class="now-why-label">Why this now</div>
        <ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>`;
  }

  if (item.kind === "event") {
    const e = item.ref;
    return `
      <div class="flow-eyebrow">${icon("calendar")} Scheduled for you</div>
      <div class="now-task">${e.title}</div>
      <div class="now-meta-row">
        <span>Time: <span class="num">${fmtEventRange(e.startHour, e.endHour)}</span></span>
        <span>Type: <span class="num">${e.type}</span></span>
        ${e.date === today ? "<span>Today</span>" : `<span>${fmtDate(e.date)}</span>`}
      </div>
      <div class="now-why">
        <div class="now-why-label">Heads-up</div>
        <ul><li>This event is on your calendar${e.date === today ? " for today" : ""} — be ready before it starts.</li></ul>
      </div>`;
  }

  const h = item.ref;
  return `
    <div class="flow-eyebrow">${icon("clock")} Keep the streak alive</div>
    <div class="now-task">${h.title}</div>
    <div class="now-meta-row">
      <span>Time: <span class="num">${h.timeOfDay}</span></span>
      <span>Duration: <span class="num">${h.durationMinutes} min</span></span>
    </div>
    <div class="now-why">
      <div class="now-why-label">Why this now</div>
      <ul><li>Scheduled for today and not logged yet — small steps compound.</li></ul>
    </div>`;
}
