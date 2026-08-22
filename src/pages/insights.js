// ============================================================
// INSIGHTS — six analytical modules, every number real.
//
// 01 Velocity       tasks completed per day/period + trend vs
//                   the previous equal-length window
// 02 Focus quality  total focus time, deep-work share, sessions
// 03 Best hours     focus minutes per start-hour heat strip
// 04 Reliability    completion rate of due tasks + estimate accuracy
// 05 Habits         consistency % per scheduled habit
// 06 Backlog & risk open load by priority, overdue count,
//                   goals/projects approaching target dates
// ============================================================

import { icon } from "../dom.js";
import { rangeStats, bestWindow, habitConsistency } from "../services/analyticsService.js";
import { minutesToHuman, todayISO, addDays, diffDays } from "../utils/dates.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as taskService from "../services/taskService.js";

const state = { range: 7 };

const RANGES = [
  { days: 7, label: "Week" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

function bucketSeries(perDay, days) {
  if (days <= 14) return perDay.map((d) => ({ label: d.date.slice(8), value: d.completed }));
  const out = [];
  const size = days === 30 ? 5 : 7;
  for (let i = 0; i < perDay.length; i += size) {
    const chunk = perDay.slice(i, i + size);
    out.push({
      label: chunk[0].date.slice(5),
      value: chunk.reduce((a, d) => a + d.completed, 0),
    });
  }
  return out;
}

function trendBadge(cur, prev) {
  if (!prev) return `<span class="trend-badge up">${icon("spark")} New activity</span>`;
  if (cur === prev) return `<span class="trend-badge flat">Even vs previous period</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return pct > 0
    ? `<span class="trend-badge up">▲ ${pct}% vs previous</span>`
    : `<span class="trend-badge down">▼ ${Math.abs(pct)}% vs previous</span>`;
}

function moduleHead(num, title, question) {
  return `
    <div class="module-head">
      <span class="module-num num">${num}</span>
      <div>
        <h3>${title}</h3>
        <div class="module-question">${question}</div>
      </div>
    </div>
  `;
}

export async function renderInsights(view, alive = () => true) {
  const [stats, prevStats, consistency, goals, projects, tasks] = await Promise.all([
    rangeStats(state.range),
    rangeStats(state.range, state.range), // previous equal window, for trend
    habitConsistency(Math.min(state.range, 90)),
    goalService.allGoals(),
    projectService.allProjects(),
    taskService.allTasks(),
  ]);
  if (!alive()) return;

  const today = todayISO();

  // ---------- module 1 data ----------
  const series = bucketSeries(stats.perDay, state.range);
  const maxBucket = Math.max(1, ...series.map((s) => s.value));

  // ---------- module 2 data ----------
  const deepShare = stats.focusMinutes ? Math.round((stats.deepMinutes / stats.focusMinutes) * 100) : 0;

  // ---------- module 3 data ----------
  const maxHourMin = Math.max(1, ...stats.hourBuckets);
  const win = bestWindow(stats.hourBuckets);
  const wh = (h) => `${((h + 11) % 12) + 1}${h >= 12 ? "PM" : "AM"}`;

  // ---------- module 6 data ----------
  const decorate = taskService.decorate(tasks);
  const openTasks = decorate.filter((t) => !["Completed", "Cancelled"].includes(t.status));
  const byPriority = ["Urgent", "High", "Medium", "Low"].map((p) => ({
    p,
    n: openTasks.filter((t) => t.priority === p).length,
  }));
  const overdueCount = openTasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const prog = await goalService.progressMap(goals, projects, tasks);
  if (!alive()) return;
  const atRiskGoals = goals
    .filter((g) => g.targetDate && g.status !== "Completed")
    .map((g) => ({ g, daysLeft: diffDays(today, g.targetDate), pct: prog[g.id]?.pct ?? 0 }))
    .filter((x) => x.daysLeft <= 14 && x.daysLeft >= -30 && x.pct < 60)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const soonProjects = projects
    .filter((p) => ["Active", "Planning"].includes(p.status) && p.deadline && diffDays(today, p.deadline) <= 14 && diffDays(today, p.deadline) >= -7)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  view.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Last ${state.range} days · computed from your real activity</div>
      <div class="page-title-row">
        <h1>Insights</h1>
        <div class="seg-control" id="range-seg">
          ${RANGES.map((r) => `<button class="seg-btn ${state.range === r.days ? "active" : ""}" data-range="${r.days}">${r.label}</button>`).join("")}
        </div>
      </div>
      <div class="sub">Six lenses on how you actually work.</div>
    </div>

    <div class="insight-modules">

      <!-- 01 VELOCITY -->
      <section class="card insight-module span-2">
        ${moduleHead("01", "Velocity", `How much are you shipping — and is it speeding up or slowing down?`)}
        <div class="module-kpis">
          <div><div class="stat-value num">${stats.tasksCompleted}</div><div class="stat-label">Completed</div></div>
          <div>${trendBadge(stats.tasksCompleted, prevStats.tasksCompleted)}</div>
        </div>
        <div class="bar-chart">
          ${series
            .map(
              (d) => `
            <div class="bar-col">
              <div class="bar-fill" style="height:${Math.max(2, Math.round((d.value / maxBucket) * 96))}px;" title="${d.value}"></div>
              <div class="bar-label">${d.label}</div>
            </div>`
            )
            .join("")}
        </div>
      </section>

      <!-- 02 FOCUS QUALITY -->
      <section class="card insight-module">
        ${moduleHead("02", "Focus quality", `How much of your focus time is real deep work?`)}
        <div class="module-kpis">
          <div><div class="stat-value num">${minutesToHuman(stats.focusMinutes)}</div><div class="stat-label">Total focus</div></div>
          <div><div class="stat-value num">${stats.sessionCount}</div><div class="stat-label">Sessions</div></div>
        </div>
        <div class="split-bar">
          <div class="split-fill deep" style="width:${deepShare}%;"></div>
          <div class="split-fill shallow" style="width:${100 - deepShare}%;"></div>
        </div>
        <div class="split-legend">
          <span>${icon("focus")} Deep work (45m+) · <strong class="num">${deepShare}%</strong></span>
          <span>Shorter blocks · <strong class="num">${100 - deepShare}%</strong></span>
        </div>
      </section>

      <!-- 03 BEST HOURS -->
      <section class="card insight-module">
        ${moduleHead("03", "Peak hours", `When does your brain actually show up?`)}
        <div class="heat-strip">
          ${stats.hourBuckets
            .map((m, h) => {
              const intensity = m / maxHourMin;
              const alpha = m ? 0.15 + intensity * 0.85 : 0;
              return `<div class="heat-cell ${win.startHour === h || win.startHour + 1 === h ? "peak" : ""}" style="${m ? `background: rgba(61,90,128,${alpha.toFixed(2)});` : ""}" title="${h}:00 · ${m} min"></div>`;
            })
            .join("")}
        </div>
        <div class="heat-axis">
          ${[0, 4, 8, 12, 16, 20].map((h) => `<span>${h}h</span>`).join("")}
          <span style="flex:0.9"></span><span style="flex:0.9"></span><span style="flex:0.9"></span>
        </div>
        ${
          win.totalMinutes > 60
            ? `<p class="module-note">Your strongest window is <strong>${wh(win.startHour)}–${wh(win.startHour + 3)}</strong> — ${minutesToHuman(win.totalMinutes)} landed there.</p>`
            : `<p class="module-note">Run more focus sessions to reveal your peak window.</p>`
        }
      </section>

      <!-- 04 RELIABILITY -->
      <section class="card insight-module">
        ${moduleHead("04", "Reliability", `Do you finish what you schedule?`)}
        <div class="module-kpis">
          <div><div class="stat-value num">${stats.completionRate === null ? "—" : `${stats.completionRate}%`}</div><div class="stat-label">Due tasks completed</div></div>
          <div><div class="stat-value num">${stats.avgTaskMinutes ? minutesToHuman(stats.avgTaskMinutes) : "—"}</div><div class="stat-label">Avg actual duration</div></div>
        </div>
        <div class="progress-track big"><div class="progress-fill" style="width:${stats.completionRate ?? 0}%"></div></div>
        <p class="module-note">${
          stats.completionRate === null
            ? "No due dates in this window yet."
            : stats.completionRate >= 75
              ? "Healthy — your planning estimates match reality."
              : "Below 75%. Try scheduling fewer, bigger blocks per day."
        }</p>
      </section>

      <!-- 05 HABITS -->
      <section class="card insight-module">
        ${moduleHead("05", "Habit engine", `Which routines are compounding?`)}
        ${
          consistency.length
            ? consistency
                .map(
                  (c) => `
          <div class="consistency-row">
            <span class="cr-name">${c.habit.title}</span>
            <div class="cr-bar-track"><div class="cr-bar-fill ${c.pct >= 70 ? "good" : c.pct >= 40 ? "" : "warn"}" style="width:${c.pct ?? 0}%;"></div></div>
            <span class="cr-pct num">${c.pct === null ? "—" : `${c.pct}%`}</span>
          </div>`
                )
                .join("")
            : `<div class="empty-state" style="padding:var(--sp-5);"><h3>No scheduled habits</h3><p>Add one to start tracking.</p></div>`
        }
      </section>

      <!-- 06 BACKLOG & RISK -->
      <section class="card insight-module span-2">
        ${moduleHead("06", "Backlog & risk", `What's stacking up — and what's about to slip?`)}
        <div class="risk-layout">
          <div class="risk-block">
            <div class="eyebrow">Open workload by priority</div>
            ${byPriority
              .map(
                (b) => `
              <div class="consistency-row">
                <span class="cr-name">${b.p}</span>
                <div class="cr-bar-track"><div class="cr-bar-fill ${b.p === "Urgent" ? "warn" : ""}" style="width:${openTasks.length ? Math.round((b.n / Math.max(...byPriority.map((x) => x.n))) * 100) : 0}%;"></div></div>
                <span class="cr-pct num">${b.n}</span>
              </div>`
              )
              .join("")}
            <p class="module-note">${overdueCount ? `<strong class="num">${overdueCount}</strong> overdue task${overdueCount === 1 ? "" : "s"} — clear these first.` : "Nothing overdue. Clean slate."}</p>
          </div>
          <div class="risk-block">
            <div class="eyebrow">Goals nearing target date</div>
            ${
              atRiskGoals.length
                ? atRiskGoals
                    .slice(0, 4)
                    .map(
                      (x) => `
              <div class="risk-item">
                <div><div class="ri-title">${x.g.title}</div>
                <div class="ri-sub">${x.daysLeft >= 0 ? `${x.daysLeft} day${x.daysLeft === 1 ? "" : "s"} left` : `${Math.abs(x.daysLeft)} days overdue`} · <span class="num">${x.pct}%</span> progress</div></div>
                <span class="badge ${x.daysLeft < 0 ? "badge-danger" : x.daysLeft <= 7 ? "badge-warn" : "badge-neutral"}">${x.daysLeft < 0 ? "Overdue" : x.daysLeft <= 7 ? "Tight" : "Watch"}</span>
              </div>`
                    )
                    .join("")
                : `<p class="module-note">No goals are close to their target dates with low progress. Steady ship.</p>`
            }
            ${
              soonProjects.length
                ? `<div class="eyebrow" style="margin-top:14px;">Projects nearing deadline</div>
                   ${soonProjects
                     .slice(0, 3)
                     .map(
                       (p) => `
              <div class="risk-item">
                <div><div class="ri-title">${p.name}</div><div class="ri-sub">Due ${p.deadline}</div></div>
                <span class="badge badge-warn">Soon</span>
              </div>`
                     )
                     .join("")}`
                : ""
            }
          </div>
        </div>
      </section>
    </div>
  `;

  view.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.range = Number(btn.dataset.range);
      renderInsights(view, alive);
    })
  );
}
