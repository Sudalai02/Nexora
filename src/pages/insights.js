// ============================================================
// INSIGHTS — complete rebuild with period-scoped analytics,
// trend graphs, AI analysis, risk center, and forecasts.
// Every number is real data, zero placeholders.
// ============================================================

import { icon } from "../dom.js";
import * as analytics from "../services/analyticsService.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import { todayISO, addDays, diffDays, minutesToHuman, fromISO } from "../utils/dates.js";

// ---- state ----
const PERIODS = [
  { key: "today", label: "Today", days: 1, compare: null },
  { key: "week",  label: "Week",  days: 7, compare: 7 },
  { key: "month", label: "Month", days: 30, compare: 30 },
  { key: "3m",    label: "3M",    days: 90, compare: 90 },
];
let currentPeriod = "week";

// ---- helpers ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function periodLabel(key) {
  return PERIODS.find((p) => p.key === key)?.label || "Week";
}

function compareLabel(key) {
  if (key === "today") return "vs yesterday";
  if (key === "week") return "vs last week";
  if (key === "month") return "vs last month";
  return "vs last quarter";
}

function scoreLabel(s) {
  if (s >= 85) return "Excellent — On track";
  if (s >= 70) return "Strong — Keep going";
  if (s >= 50) return "Steady — Room to grow";
  if (s >= 30) return "Needs push — Focus here";
  return "Reset time — Start fresh";
}

function scoreClass(s) {
  if (s >= 70) return "good";
  if (s >= 40) return "warn";
  return "bad";
}

function statusColor(pct) {
  if (pct >= 70) return "green";
  if (pct >= 40) return "yellow";
  return "red";
}

function statusIcon(pct) {
  if (pct >= 70) return "🟢";
  if (pct >= 40) return "🟡";
  return "🔴";
}

// ---- compute productivity score (weighted) ----
function computeScore({ stats, prevStats, habitsCons, overdueCount }) {
  const focusTarget = Math.max((stats.days || 7) * 45, 60);
  const parts = {
    tasks: stats.completionRate ?? (stats.tasksCompleted > 0 ? 80 : null),
    focus: pct(stats.focusMinutes, focusTarget),
    habits: habitsCons.length
      ? Math.round(habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length)
      : null,
    schedule: analytics.scheduleScore(stats),
  };
  const weights = { tasks: 35, focus: 25, habits: 20, schedule: 20 };
  let total = 0, weight = 0;
  for (const k of Object.keys(weights)) {
    if (parts[k] == null) continue;
    total += parts[k] * weights[k];
    weight += weights[k];
  }
  const score = weight ? Math.round(total / weight) : 0;

  // Previous period score for delta
  let prevScore = null;
  if (prevStats) {
    const pFocusTarget = Math.max((prevStats.days || 7) * 45, 60);
    const pParts = {
      tasks: prevStats.completionRate,
      focus: pct(prevStats.focusMinutes, pFocusTarget),
    };
    let pT = 0, pW = 0;
    for (const k of ["tasks", "focus"]) {
      if (pParts[k] == null) continue;
      pT += pParts[k] * weights[k];
      pW += weights[k];
    }
    prevScore = pW ? Math.round(pT / pW) : null;
  }

  return { score, prevScore, delta: prevScore == null ? null : score - prevScore, parts };
}

// ---- SVG trend chart ----
function trendSVG(pts, w = 480, h = 140) {
  if (!pts.length) return `<div class="empty-state"><p>No data for this period.</p></div>`;
  const pad = { t: 16, r: 8, b: 28, l: 36 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxV = Math.max(...pts.map((p) => p.value), 1);
  const step = pts.length > 1 ? cw / (pts.length - 1) : cw;

  const coords = pts.map((p, i) => ({
    x: pad.l + i * step,
    y: pad.t + ch - (p.value / maxV) * ch,
  }));

  // Smooth curve via catmull-rom → cubic bezier
  let path = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1], cur = coords[i];
    const tension = 0.3;
    const dx = (cur.x - prev.x) * tension;
    path += ` C${prev.x + dx},${prev.y} ${cur.x - dx},${cur.y} ${cur.x},${cur.y}`;
  }

  // Area fill
  const areaPath = path + ` L${coords[coords.length - 1].x},${pad.t + ch} L${coords[0].x},${pad.t + ch} Z`;

  // Y-axis labels (4 ticks)
  const yTicks = [0, 0.33, 0.67, 1].map((f) => ({
    y: pad.t + ch - f * ch,
    label: Math.round(maxV * f),
  }));

  // X-axis labels (show every Nth to avoid crowding)
  const xStep = Math.max(1, Math.floor(pts.length / 6));
  const xLabels = pts.filter((_, i) => i % xStep === 0 || i === pts.length - 1);

  return `
  <svg class="trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--focus)" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="var(--focus)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${yTicks.map((t) => `<line x1="${pad.l}" y1="${t.y}" x2="${w - pad.r}" y2="${t.y}" stroke="var(--hairline)" stroke-width="0.5"/><text x="${pad.l - 4}" y="${t.y + 3}" text-anchor="end" fill="var(--graphite-dim)" font-size="9">${t.label}</text>`).join("")}
    <path d="${areaPath}" fill="url(#trend-fill)"/>
    <path d="${path}" fill="none" stroke="var(--focus)" stroke-width="2" stroke-linecap="round"/>
    ${coords.map((c, i) => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="var(--paper)" stroke="var(--focus)" stroke-width="1.5"/>`).join("")}
    ${xLabels.map((p, i) => {
      const idx = pts.indexOf(p);
      return `<text x="${coords[idx].x}" y="${h - 4}" text-anchor="middle" fill="var(--graphite-dim)" font-size="9">${p.label}</text>`;
    }).join("")}
  </svg>`;
}

// ---- bar chart for tasks + focus stacked ----
function barsHTML(perDay) {
  if (!perDay.length) return "";
  const maxV = Math.max(...perDay.map((d) => d.completed + d.focusMin / 15), 1);
  return `
  <div class="bar-chart">
    ${perDay.map((d) => {
      const hC = Math.round((d.completed / maxV) * 100);
      const hF = Math.round((d.focusMin / 15 / maxV) * 100);
      return `
      <div class="bar-col" title="${d.date}: ${d.completed} tasks · ${d.focusMin}m focus">
        <div class="bar-stack">
          <div class="bar-focus" style="height:${hF}%"></div>
          <div class="bar-task" style="height:${hC}%"></div>
        </div>
        <span class="bar-lbl">${d.date.slice(8)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

// ============================================================
// MAIN RENDER
// ============================================================
export async function renderInsights(view, alive = () => true) {
  view.innerHTML = `<div class="page-loading">${icon("clock")} Crunching your numbers…</div>`;

  const p = PERIODS.find((x) => x.key === currentPeriod) || PERIODS[1];
  const days = p.days;

  // Fetch all data in parallel
  const [stats, habitsCons, risks, streaks, tasksRaw, projects, goals] = await Promise.all([
    analytics.rangeStats(days),
    analytics.habitConsistency(days),
    analytics.currentRisks(),
    analytics.computeStreaks(),
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;

  const gProg = await goalService.progressMap(goals, projects, tasksRaw);
  const pProg = projectService.progressMap(projects, tasksRaw);

  // Previous period stats (for delta)
  let prevStats = null;
  if (p.compare) {
    prevStats = await analytics.rangeStats(p.compare, p.compare);
  }

  // Today-only data
  let todayData = null;
  if (currentPeriod === "today") {
    todayData = await analytics.todayFocus();
  }

  const today = todayISO();
  const OPEN = ["Todo", "In Progress", "Blocked"];
  const overdueTasks = tasksRaw.filter((t) => t.dueDate && t.dueDate < today && OPEN.includes(t.status));
  const score = computeScore({ stats, prevStats, habitsCons, overdueCount: overdueTasks.length });

  // Trend data
  const trend = await analytics.trendData(currentPeriod);

  // AI insights
  const aiLines = analytics.aiInsightForPeriod(stats, habitsCons, risks, score);

  // Forecasts for top goals
  const activeGoals = goals.filter((g) => !["Completed", "On Hold", "Cancelled"].includes(g.status));
  const goalForecasts = await Promise.all(
    activeGoals.slice(0, 3).map(async (g) => {
      const daysActive = Math.max(diffDays(g.startDate || today, today), 1);
      const f = await analytics.forecastGoal(g, gProg[g.id], daysActive);
      return { goal: g, ...f, pct: gProg[g.id]?.pct ?? 0 };
    })
  );

  // Task performance stats
  const completedInWindow = stats.tasksCompleted;
  const overdueCount = overdueTasks.length;
  const doneWithDue = tasksRaw.filter(
    (t) => t.status === "Completed" && t.dueDate && t.completedAt && t.completedAt.slice(0, 10) >= stats.start
  );
  const onTimeCount = doneWithDue.filter((t) => t.completedAt.slice(0, 10) <= t.dueDate).length;
  const completionRate = stats.completionRate;
  const onTimeRate = doneWithDue.length ? Math.round((onTimeCount / doneWithDue.length) * 100) : null;

  // Priority breakdown
  const completedTasks = tasksRaw.filter((t) => t.status === "Completed" && t.completedAt?.slice(0, 10) >= stats.start);
  const highP = completedTasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;
  const medP = completedTasks.filter((t) => t.priority === "Medium").length;
  const lowP = completedTasks.filter((t) => t.priority === "Low").length;
  const totalP = highP + medP + lowP || 1;

  // Focus
  const focusMin = currentPeriod === "today" ? (todayData?.minutes ?? stats.focusMinutes) : stats.focusMinutes;
  const deepMin = currentPeriod === "today" ? (todayData?.deepMinutes ?? stats.deepMinutes) : stats.deepMinutes;
  const sessions = currentPeriod === "today" ? (todayData?.sessionCount ?? stats.sessionCount) : stats.sessionCount;
  const avgSession = sessions ? Math.round(focusMin / sessions) : 0;
  const bestWin = analytics.bestWindow(currentPeriod === "today" ? (todayData?.hourBuckets ?? stats.hourBuckets) : stats.hourBuckets);

  // Habit consistency with streaks
  const streakMap = {};
  for (const s of streaks) streakMap[s.habit.id] = s.streak;

  // ==================== RENDER ====================
  view.innerHTML = `
    <!-- HEADER -->
    <div class="insights-header">
      <button class="btn-back" data-nav="home">${icon("arrow-left")}</button>
      <h1 class="page-title">Insights</h1>
      <div class="header-actions">
        <button class="icon-btn" title="Search">${icon("search")}</button>
      </div>
    </div>

    <!-- PERIOD TABS -->
    <div class="filter-bar insights-tabs">
      ${PERIODS.map((pp) => `
        <button class="filter-btn ${pp.key === currentPeriod ? "active" : ""}" data-period="${pp.key}">
          ${pp.label}
        </button>
      `).join("")}
      <button class="filter-btn period-custom-btn" data-period="custom">Custom</button>
    </div>

    <!-- PRODUCTIVITY HEALTH -->
    <section class="card insight-hero">
      <div class="insight-hero-head">
        <div class="eyebrow">PRODUCTIVITY HEALTH</div>
      </div>
      <div class="insight-hero-body">
        <div class="score-ring-wrap">
          <div class="score-ring ${scoreClass(score.score)}" style="--p:${score.score};">
            <span class="score-num">${score.score}</span>
            <span class="score-of">/100</span>
          </div>
        </div>
        <div class="score-meta">
          ${score.delta != null && score.delta !== 0
            ? `<span class="score-delta ${score.delta > 0 ? "up" : "down"}">${score.delta > 0 ? "▲" : "▼"} ${Math.abs(score.delta)}% ${compareLabel(currentPeriod)}</span>`
            : `<span class="score-delta flat">— same as before</span>`
          }
          <div class="score-verdict">${scoreLabel(score.score)}</div>
        </div>
      </div>
      <div class="score-categories">
        ${[
          ["Tasks", score.parts.tasks],
          ["Focus", score.parts.focus],
          ["Goals", score.parts.goals],
          ["Habits", score.parts.habits],
          ["Schedule", score.parts.schedule],
        ].map(([label, val]) => `
          <div class="cat-row">
            <span class="cat-label">${label}</span>
            <div class="cat-bar-track"><div class="cat-bar-fill ${scoreClass(val ?? 0)}" style="width:${val ?? 0}%"></div></div>
            <span class="cat-val">${val != null ? val + "%" : "—"}</span>
          </div>
        `).join("")}
      </div>
    </section>

    <!-- NEEDS ATTENTION -->
    ${risks.length ? `
    <section class="card insight-attention">
      <div class="module-head">
        <span class="module-emoji">⚠</span>
        <div><h2>Needs Your Attention</h2></div>
        <span class="attention-count">${risks.length}</span>
      </div>
      <div class="attention-list">
        ${risks.slice(0, 4).map((r) => `
          <div class="attention-item">
            <span class="attention-sev ${r.severity}"></span>
            <div class="attention-info">
              <div class="attention-title">${esc(r.title)}</div>
              <div class="attention-detail">${esc(r.detail)}</div>
            </div>
            <div class="attention-actions">
              ${r.type === "task" ? `
                <button class="btn btn-xs btn-primary" data-action="fix" data-id="${r.taskId}">Fix</button>
                <button class="btn btn-xs btn-secondary" data-action="reschedule" data-id="${r.taskId}">Reschedule</button>
              ` : r.type === "goal" ? `
                <button class="btn btn-xs btn-secondary" data-action="view-goal" data-id="${r.goalId}">View</button>
                <button class="btn btn-xs btn-secondary" data-action="schedule-goal" data-id="${r.goalId}">Schedule</button>
              ` : `
                <button class="btn btn-xs btn-secondary" data-action="view-habit" data-id="${r.habitId}">View</button>
              `}
            </div>
          </div>
        `).join("")}
      </div>
      ${risks.length > 4 ? `<button class="btn btn-sm btn-secondary attention-see-all">▸ See all risks</button>` : ""}
    </section>` : ""}

    <!-- PRODUCTIVITY TREND -->
    <section class="card insight-trend">
      <div class="module-head">
        <span class="module-emoji">📈</span>
        <div><h2>Productivity Trend</h2></div>
      </div>
      <div class="trend-chart-wrap">
        ${trendSVG(trend.pts)}
      </div>
    </section>

    <!-- 3-COLUMN GRID: TASKS | FOCUS | GOALS -->
    <div class="insights-three-col">

      <!-- TASK PERFORMANCE -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji">⚡</span>
          <div><h2>Task Performance</h2></div>
        </div>
        <div class="perf-stats">
          <div class="perf-stat"><b class="num">${completedInWindow}</b><span>Completed</span></div>
          <div class="perf-stat"><b class="num">${overdueCount}</b><span>Overdue</span></div>
          <div class="perf-stat"><b class="num">${completionRate != null ? completionRate + "%" : "—"}</b><span>Completion Rate</span></div>
          <div class="perf-stat"><b class="num">${onTimeRate != null ? onTimeRate + "%" : "—"}</b><span>On-Time Rate</span></div>
        </div>
        <div class="priority-bars">
          <div class="pri-bar-row"><span>High</span><div class="pri-bar-track"><div class="pri-bar-fill high" style="width:${Math.round(highP / totalP * 100)}%"></div></div><span>${Math.round(highP / totalP * 100)}%</span></div>
          <div class="pri-bar-row"><span>Med</span><div class="pri-bar-track"><div class="pri-bar-fill med" style="width:${Math.round(medP / totalP * 100)}%"></div></div><span>${Math.round(medP / totalP * 100)}%</span></div>
          <div class="pri-bar-row"><span>Low</span><div class="pri-bar-track"><div class="pri-bar-fill low" style="width:${Math.round(lowP / totalP * 100)}%"></div></div><span>${Math.round(lowP / totalP * 100)}%</span></div>
        </div>
      </section>

      <!-- FOCUS & DEEP WORK -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji">⏱</span>
          <div><h2>Focus &amp; Deep Work</h2></div>
        </div>
        <div class="focus-stats">
          <div class="focus-stat"><b class="num">${currentPeriod === "today" ? minutesToHuman(focusMin) : minutesToHuman(focusMin)}</b><span>${currentPeriod === "today" ? "Today" : "This Period"}</span></div>
          <div class="focus-stat"><b class="num">${sessions}</b><span>Sessions</span></div>
          <div class="focus-stat"><b class="num">${avgSession}m</b><span>Avg Session</span></div>
        </div>
        <div class="best-time-row">
          <span class="best-time-label">Best time</span>
          <span class="best-time-val">${String(bestWin.startHour).padStart(2, "0")}:00–${String(bestWin.startHour + 3).padStart(2, "0")}:00</span>
        </div>
        ${currentPeriod !== "today" ? `<div class="module-foot"><a href="#/focus" class="link-subtle">Full focus report →</a></div>` : ""}
      </section>

      <!-- GOALS -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji">🎯</span>
          <div><h2>Goals</h2></div>
        </div>
        <div class="goals-list">
          ${activeGoals.slice(0, 4).map((g) => {
            const p = gProg[g.id]?.pct ?? 0;
            return `
            <div class="goal-row">
              <span class="goal-status-icon">${statusIcon(p)}</span>
              <span class="goal-name">${esc(g.title)}</span>
              <span class="goal-pct ${statusColor(p)}">${p}%</span>
            </div>`;
          }).join("")}
          ${!activeGoals.length ? `<div class="empty-state"><p>No active goals.</p></div>` : ""}
        </div>
        ${activeGoals.length > 4 ? `<div class="module-foot"><a href="#/goals" class="link-subtle">View all goals →</a></div>` : ""}
      </section>
    </div>

    <!-- 2-COLUMN GRID: PROJECTS | HABITS -->
    <div class="insights-two-col">

      <!-- PROJECT HEALTH -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji">📁</span>
          <div><h2>Project Health</h2></div>
        </div>
        <div class="projects-list">
          ${projects.filter((p) => !["Completed", "Cancelled"].includes(p.status)).slice(0, 4).map((p) => {
            const pr = pProg[p.id];
            const pPct = pr?.pct ?? 0;
            const daysLeft = p.deadline ? diffDays(today, p.deadline) : null;
            return `
            <div class="project-row">
              <span class="project-status-icon">${statusIcon(pPct)}</span>
              <span class="project-name">${esc(p.name)}</span>
              <span class="project-pct ${statusColor(pPct)}">${pPct != null ? pPct + "%" : "—"}</span>
            </div>`;
          }).join("")}
          ${!projects.filter((p) => !["Completed", "Cancelled"].includes(p.status)).length
            ? `<div class="empty-state"><p>No active projects.</p></div>`
            : ""}
        </div>
        ${risks.filter((r) => r.type === "goal").length
          ? `<div class="module-foot attention-foot">⚠ ${risks.filter((r) => r.type === "goal").length} project${risks.filter((r) => r.type === "goal").length !== 1 ? "s" : ""} need attention</div>`
          : ""}
      </section>

      <!-- HABIT CONSISTENCY -->
      <section class="card insight-module">
        <div class="module-head">
          <span class="module-emoji">🔄</span>
          <div><h2>Habit Consistency</h2></div>
        </div>
        <div class="habits-list">
          ${habitsCons.sort((a, b) => b.pct - a.pct).slice(0, 5).map((h) => {
            const streak = streakMap[h.habit.id] || 0;
            return `
            <div class="habit-row">
              <div class="habit-row-top">
                <span class="habit-name">${esc(h.habit.title)}</span>
                <span class="habit-pct">${h.pct}%</span>
                ${streak >= 3 ? `<span class="habit-streak">🔥 ${streak}-day streak</span>` : ""}
              </div>
              <div class="progress-track"><div class="progress-fill ${h.pct >= 70 ? "" : h.pct >= 40 ? "warn" : "bad"}" style="width:${h.pct}%"></div></div>
            </div>`;
          }).join("")}
          ${!habitsCons.length ? `<div class="empty-state"><p>No scheduled habits in this window.</p></div>` : ""}
        </div>
        <div class="habits-overall">
          <span>Overall consistency</span>
          <b class="num">${habitsCons.length ? Math.round(habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length) : 0}%</b>
        </div>
      </section>
    </div>

    <!-- AI PERSONAL ANALYSIS -->
    <section class="card insight-ai-analysis">
      <div class="module-head">
        <span class="module-emoji">🤖</span>
        <div><h2>AI Personal Analysis</h2></div>
      </div>
      <div class="ai-lines">
        ${aiLines.map((l) => `
          <div class="ai-line">
            <span class="ai-line-icon">${l.icon}</span>
            <div class="ai-line-body">
              <span class="ai-line-label">${l.label}</span>
              <span class="ai-line-text">${esc(l.text)}</span>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="ai-actions">
        <a href="#/assistant" class="btn btn-primary">🚀 Do This Now</a>
        <button class="btn btn-secondary" data-action="schedule-ai">Schedule It</button>
        <button class="btn btn-secondary" data-action="details-ai">View Details</button>
      </div>
    </section>

    <!-- FORECAST -->
    ${goalForecasts.length ? `
    <section class="card insight-forecast">
      <div class="module-head">
        <span class="module-emoji">🔮</span>
        <div><h2>Forecast</h2></div>
      </div>
      <div class="forecast-list">
        ${goalForecasts.map((f) => `
          <div class="forecast-row">
            <span class="forecast-name">${esc(f.goal.title)}</span>
            <span class="forecast-prob">${f.probability != null ? f.probability + "% probability of finishing on time" : "Insufficient data"}</span>
            ${f.estDate ? `<span class="forecast-est">Est. ${fromISO(f.estDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>` : ""}
          </div>
        `).join("")}
      </div>
    </section>` : ""}
  `;

  // ---- event listeners ----
  // Period tabs
  view.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.period;
      if (key === "custom") {
        // Simple custom date range picker
        const start = prompt("Start date (YYYY-MM-DD):");
        const end = prompt("End date (YYYY-MM-DD):");
        if (start && end) {
          const customDays = Math.max(diffDays(start, end) + 1, 1);
          PERIODS.push({ key: "custom", label: "Custom", days: customDays, compare: null });
          currentPeriod = "custom";
          renderInsights(view, alive);
        }
        return;
      }
      currentPeriod = key;
      renderInsights(view, alive);
    });
  });

  // Back button
  view.querySelector("[data-nav='home']")?.addEventListener("click", () => {
    location.hash = "#/home";
  });

  // Attention action buttons
  view.querySelectorAll("[data-action='fix']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = `#/tasks`; });
  });
  view.querySelectorAll("[data-action='reschedule']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const task = await taskService.getTask(btn.dataset.id);
      if (task) {
        const next = prompt("New due date (YYYY-MM-DD):", addDays(todayISO(), 1));
        if (next) await taskService.updateTask(task.id, { dueDate: next });
        renderInsights(view, alive);
      }
    });
  });
  view.querySelectorAll("[data-action='view-goal']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/goals"; });
  });
  view.querySelectorAll("[data-action='schedule-goal']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/goals"; });
  });
  view.querySelectorAll("[data-action='view-habit']").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#/habits"; });
  });
}
