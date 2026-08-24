// ============================================================
// INSIGHTS V2 — every number is computed from your real data.
// Six modules: Overview · Tasks · Goals & Projects · Focus &
// Time · Habits · AI Personal Insights. No fake stats, ever.
// ============================================================

import { icon } from "../dom.js";
import * as analytics from "../services/analyticsService.js";
import * as taskService from "../services/taskService.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import { minutesToHuman, todayISO, fmtDateLong } from "../utils/dates.js";

const state = { days: 7 };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

function trend(cur, prev) {
  if (prev == null || prev === 0) return cur > 0 ? { dir: "up", txt: `+${cur}` } : { dir: "", txt: "" };
  const diff = cur - prev;
  if (diff === 0) return { dir: "flat", txt: "=" };
  return diff > 0 ? { dir: "up", txt: `+${diff}` } : { dir: "down", txt: `${diff}` };
}

// ---------- productivity score ----------
// Weighted blend of: task completion (35), focus volume (25),
// habit consistency (20), overdue discipline (10), momentum (10).
function computeScore({ week, prevWeek, habitsCons, overdueCount }) {
  const focusTarget = Math.max(week.days * 45, 60); // ~45 min/day goal
  const parts = {
    tasks: week.completionRate != null ? week.completionRate : week.tasksCompleted > 0 ? 100 : null,
    focus: pct(week.focusMinutes, focusTarget),
    habits: habitsCons.length
      ? Math.round(habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length)
      : null,
    overdue:
      overdueCount === 0
        ? 100
        : Math.max(0, 100 - overdueCount * 15),
    momentum: (() => {
      if (!prevWeek.tasksCompleted && !week.tasksCompleted) return null;
      const base = Math.max(prevWeek.tasksCompleted, 1);
      return Math.min(100, Math.round((week.tasksCompleted / base) * 100));
    })(),
  };

  const weights = { tasks: 35, focus: 25, habits: 20, overdue: 10, momentum: 10 };
  let total = 0;
  let weight = 0;
  for (const k of Object.keys(weights)) {
    if (parts[k] == null) continue;
    total += parts[k] * weights[k];
    weight += weights[k];
  }
  const score = weight ? Math.round(total / weight) : 0;

  // Previous-period score for the delta chip (same recipe).
  const prevFocusTarget = Math.max(prevWeek.days * 45, 60);
  const prevParts = {
    tasks: prevWeek.completionRate,
    focus: pct(prevWeek.focusMinutes, prevFocusTarget),
    habits: null,
    overdue: null,
    momentum: null,
  };
  let pTotal = 0;
  let pW = 0;
  for (const k of ["tasks", "focus"]) {
    if (prevParts[k] == null) continue;
    pTotal += prevParts[k] * weights[k];
    pW += weights[k];
  }
  const prevScore = pW ? Math.round(pTotal / pW) : null;

  return {
    score,
    prevScore,
    delta: prevScore == null ? null : score - prevScore,
    parts,
  };
}

function scoreLabel(s) {
  if (s >= 85) return "Outstanding";
  if (s >= 70) return "Strong week";
  if (s >= 50) return "Steady";
  if (s >= 30) return "Needs push";
  return "Reset time";
}

export async function renderInsights(view, alive = () => true) {
  view.innerHTML = `<div class="page-loading">${icon("clock")} Crunching your numbers…</div>`;

  const days = state.days;
  const [week, prevWeek, habitsCons, tasksRaw, projects, goals] = await Promise.all([
    analytics.rangeStats(days),
    analytics.rangeStats(days, days),
    analytics.habitConsistency(days),
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;

  const gProg = await goalService.progressMap(goals, projects, tasksRaw);
  const pProg = projectService.progressMap(projects, tasksRaw);

  const today = todayISO();
  const OPEN = ["Completed", "Cancelled"];
  const overdueTasks = tasksRaw.filter((t) => t.dueDate && t.dueDate < today && !OPEN.includes(t.status));
  const score = computeScore({ week, prevWeek, habitsCons, overdueCount: overdueTasks.length });

  // ----- Task performance -----
  const completedInWindow = week.tasksCompleted;
  const urgentDone = tasksRaw.filter(
    (t) => t.status === "Completed" && t.priority === "Urgent" && t.completedAt?.slice(0, 10) >= week.start
  ).length;
  const onTime = tasksRaw.filter(
    (t) => t.status === "Completed" && t.completedAt && t.dueDate && t.completedAt.slice(0, 10) <= t.dueDate && t.completedAt.slice(0, 10) >= week.start
  ).length;
  const doneWithDue = tasksRaw.filter(
    (t) => t.status === "Completed" && t.completedAt && t.dueDate && t.completedAt.slice(0, 10) >= week.start
  ).length;

  // ----- Goals & projects -----
  const activeGoals = goals.filter((g) => !["Completed", "On Hold", "Cancelled"].includes(g.status));
  const completedGoals = goals.filter((g) => g.status === "Completed");
  const avgGoalPct = activeGoals.length
    ? Math.round(activeGoals.reduce((a, g) => a + (gProg[g.id]?.pct ?? 0), 0) / activeGoals.length)
    : null;
  const activeProjects = projects.filter((p) => !["Completed", "Cancelled"].includes(p.status));
  const avgProjPct = activeProjects.length
    ? Math.round(activeProjects.reduce((a, p) => a + (pProg[p.id]?.pct ?? 0), 0) / activeProjects.length)
    : null;
  const atRiskGoals = activeGoals.filter((g) => (gProg[g.id]?.pct ?? 0) < 25);

  // ----- Focus -----
  const bestWin = analytics.bestWindow(week.hourBuckets);
  const maxHeat = Math.max(...week.hourBuckets, 1);
  const deepShare = pct(week.deepMinutes, week.focusMinutes);

  // ----- Achievements -----
  const achievements = [];
  if (score.score >= 80) achievements.push("🏆 Elite week — score above 80");
  if (week.tasksCompleted >= 10) achievements.push(`⚡ ${week.tasksCompleted} tasks crushed this period`);
  if (deepShare != null && deepShare >= 50) achievements.push("🧠 Deep-work champion — most focus was deep work");
  if (habitsCons.some((h) => h.pct >= 80)) achievements.push(`🔥 Habit master — ${habitsCons.find((h) => h.pct >= 80)?.habit.title} ≥80% consistent`);
  if (overdueTasks.length === 0 && tasksRaw.some((t) => t.dueDate)) achievements.push("🎯 Zero overdue — inbox and deadlines under control");

  // ----- Recommendations -----
  const recos = buildRecos({ week, score, overdueTasks, atRiskGoals, habitsCons, bestWin });

  view.innerHTML = `
    <!-- ================= HERO ================= -->
    <div class="insights-hero">
      <div class="eyebrow">Insights</div>
      <h1 class="page-title">Your performance,<br />in real numbers</h1>
      <p class="muted">Last ${days} days · ${fmtDateLong(week.start)} → ${fmtDateLong(week.end)}</p>
      <div class="period-tabs">
        ${[7, 30, 90]
          .map((d) => `<button class="period-tab ${d === days ? "active" : ""}" data-days="${d}">${d === 7 ? "This week" : d === 30 ? "This month" : "This quarter"}</button>`)
          .join("")}
      </div>
    </div>

    <!-- ================= PRODUCTIVITY SCORE ================= -->
    <div class="score-hero card">
      <div class="score-ring-wrap"><div class="score-ring num" style="--p:${score.score};">${score.score}</div></div>
      <div class="score-meta">
        <div class="score-label">${scoreLabel(score.score)}</div>
        ${
          score.delta != null && score.delta !== 0
            ? `<span class="score-delta ${score.delta > 0 ? "up" : "down"}">${score.delta > 0 ? "↑" : "↓"} ${Math.abs(score.delta)} vs previous period</span>`
            : `<span class="score-delta flat">— same as before</span>`
        }
        <div class="score-parts">
          ${[
            ["Tasks", score.parts.tasks],
            ["Focus", score.parts.focus],
            ["Habits", score.parts.habits],
            ["Discipline", score.parts.overdue],
          ]
            .filter(([, v]) => v != null)
            .map(([k, v]) => `<span class="chip">${k} ${v}%</span>`)
            .join("")}
        </div>
      </div>
    </div>

    <!-- ================= WEEK SUMMARY CHIPS ================= -->
    <div class="summary-chips">
      <div class="chip-stat"><b>${week.tasksCompleted}</b><span>tasks done</span><i class="${trend(week.tasksCompleted, prevWeek.tasksCompleted).dir}">${trend(week.tasksCompleted, prevWeek.tasksCompleted).txt}</i></div>
      <div class="chip-stat"><b>${Math.round(week.focusMinutes / 60)}h</b><span>${week.focusMinutes % 60 ? `${week.focusMinutes % 60}m extra` : "focus"}</span><i class="${trend(week.focusMinutes, prevWeek.focusMinutes).dir}">${trend(week.focusMinutes, prevWeek.focusMinutes).txt}</i></div>
      <div class="chip-stat"><b>${week.sessionCount}</b><span>sessions</span></div>
      <div class="chip-stat"><b>${week.completionRate != null ? week.completionRate + "%" : "—"}</b><span>on-time rate</span></div>
    </div>

    <div class="home-grid-v2 insights-grid">
      <div class="home-col-main">

        <!-- ===== 1 · PRODUCTIVITY OVERVIEW ===== -->
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">📊</span><div><h2>Productivity overview</h2><p>Daily output across the period</p></div></div>
          ${barsHTML(week.perDay, days)}
          <div class="module-foot muted">Peak day: ${peakDay(week.perDay)}</div>
        </section>

        <!-- ===== 2 · TASK PERFORMANCE ===== -->
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">✅</span><div><h2>Task performance</h2><p>How work moves through your system</p></div></div>
          <div class="stat-grid">
            <div class="stat-box"><b class="num">${completedInWindow}</b><span>Completed</span></div>
            <div class="stat-box"><b class="num">${urgentDone}</b><span>Urgent done</span></div>
            <div class="stat-box"><b class="num">${doneWithDue ? `${onTime}/${doneWithDue}` : "—"}</b><span>On time</span></div>
            <div class="stat-box"><b class="num">${overdueTasks.length}</b><span>Overdue now</span></div>
          </div>
          <div class="meter-row">
            <span>Avg estimate accuracy</span>
            <b>${week.avgTaskMinutes != null ? `${week.avgTaskMinutes} min/task` : "Not enough data yet"}</b>
          </div>
          <div class="meter-row">
            <span>Completion rate (due in window)</span>
            <b>${week.completionRate != null ? `${week.completionRate}%` : "No deadlines in window"}</b>
          </div>
        </section>

        <!-- ===== 3 · GOALS & PROJECTS ===== -->
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">🎯</span><div><h2>Goals &amp; projects</h2><p>Long-range progress health</p></div></div>
          <div class="stat-grid">
            <div class="stat-box"><b class="num">${activeGoals.length}</b><span>Active goals</span></div>
            <div class="stat-box"><b class="num">${completedGoals.length}</b><span>Completed goals</span></div>
            <div class="stat-box"><b class="num">${avgGoalPct == null ? "—" : avgGoalPct + "%"}</b><span>Avg goal progress</span></div>
            <div class="stat-box"><b class="num">${avgProjPct == null ? "—" : avgProjPct + "%"}</b><span>Avg project progress</span></div>
          </div>
          ${
            atRiskGoals.length
              ? atRiskGoals
                  .slice(0, 3)
                  .map(
                    (g) => `
            <div class="risk-row">
              <span class="attention-sev orange"></span>
              <span class="risk-name">${esc(g.title)}</span>
              <b class="num">${gProg[g.id]?.pct ?? 0}%</b>
            </div>`
                  )
                  .join("")
              : `<div class="allclear-line">🟢 Every active goal has meaningful traction.</div>`
          }
        </section>
      </div>

      <div class="side-stack">

        <!-- ===== 4 · FOCUS & TIME ===== -->
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">⏱</span><div><h2>Focus &amp; time</h2><p>Where your attention actually went</p></div></div>
          <div class="focus-hours-row">
            <div><b class="num">${minutesToHuman(week.focusMinutes)}</b><span>focused</span></div>
            <div><b class="num">${minutesToHuman(week.deepMinutes)}</b><span>deep work</span></div>
            <div><b class="num">${deepShare == null ? "—" : deepShare + "%"}</b><span>deep share</span></div>
          </div>
          <div class="heat-scroller" id="heat-scroller">
            <div class="hour-heat">
              ${Array.from({ length: 24 }, (_, h) => {
                const inten = week.hourBuckets[h] / maxHeat;
                return `<div class="heat-cell" style="opacity:${week.hourBuckets[h] ? 0.25 + inten * 0.75 : 0.08};" title="${String(h).padStart(2, "0")}:00 — ${week.hourBuckets[h]}m"></div>`;
              }).join("")}
            </div>
          </div>
          <div class="heat-scale muted"><span>Drag ↔ to explore</span><span>5am → 11pm</span></div>
          <div class="module-foot muted">Golden window: <b class="num">${String(bestWin.startHour).padStart(2, "0")}:00–${String(bestWin.startHour + 3).padStart(2, "0")}:00</b> — guard it fiercely.</div>
        </section>

        <!-- ===== 5 · HABITS & CONSISTENCY ===== -->
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">🔄</span><div><h2>Habits &amp; consistency</h2><p>Scheduled vs actually logged</p></div></div>
          ${
            habitsCons.length
              ? habitsCons
                  .sort((a, b) => b.pct - a.pct)
                  .map(
                    (h) => `
            <div class="habit-cons-row">
              <div class="habit-cons-top"><span>${esc(h.habit.title)}</span><b class="num">${h.pct}%</b></div>
              <div class="progress-track"><div class="progress-fill ${h.pct >= 70 ? "" : h.pct >= 40 ? "warn" : "bad"}" style="width:${h.pct}%"></div></div>
              <div class="habit-cons-sub muted">${h.done}/${h.scheduled} scheduled days kept</div>
            </div>`
                  )
                  .join("")
              : `<div class="empty-state" style="padding:16px;"><p>No scheduled habits in this window.</p></div>`
          }
        </section>

        <!-- ===== ACHIEVEMENTS ===== -->
        ${
          achievements.length
            ? `
        <section class="card insight-module">
          <div class="module-head"><span class="module-emoji">🏅</span><div><h2>Achievements unlocked</h2></div></div>
          ${achievements.map((a) => `<div class="achieve-line">${a}</div>`).join("")}
        </section>`
            : ""
        }

        <!-- ===== AT RISK ===== -->
        ${
          overdueTasks.length || atRiskGoals.length
            ? `
        <section class="card insight-module risk-module">
          <div class="module-head"><span class="module-emoji">⚠️</span><div><h2>At risk right now</h2></div></div>
          ${overdueTasks.slice(0, 4).map((t) => `<div class="risk-row"><span class="attention-sev red"></span><span class="risk-name">${esc(t.title)}</span><b class="num">${t.dueDate}</b></div>`).join("")}
          ${atRiskGoals.slice(0, 3).map((g) => `<div class="risk-row"><span class="attention-sev orange"></span><span class="risk-name">${esc(g.title)}</span><b class="num">${gProg[g.id]?.pct ?? 0}%</b></div>`).join("")}
        </section>`
            : ""
        }

        <!-- ===== 6 · AI PERSONAL INSIGHTS ===== -->
        <section class="ai-insight-banner insight-module">
          <div class="ai-insight-head">${icon("spark")} AI personal insights 💡</div>
          ${recos.map((r) => `<div class="ai-line"><span class="ai-line-icon">${r.icon}</span><div class="ai-line-text">${r.text}</div></div>`).join("")}
          <div class="ai-insight-actions">
            <a href="#/assistant" class="btn btn-sm btn-primary">Ask my assistant</a>
            <a href="#/focus" class="btn btn-sm btn-secondary">Bank a session</a>
          </div>
        </section>

        <!-- ===== WHAT SHOULD I CHANGE ===== -->
        <section class="card insight-module change-module">
          <div class="module-head"><span class="module-emoji">🔮</span><div><h2>"What should I change?"</h2></div></div>
          ${changeAdvice({ score, week, habitsCons, bestWin, overdueTasks })}
        </section>

      </div>
    </div>
  `;

  view.querySelectorAll(".period-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      state.days = Number(tab.dataset.days);
      renderInsights(view, alive);
    })
  );

  // ---- drag-to-scroll for the 24h heatmap (touch works natively) ----
  const scroller = view.querySelector("#heat-scroller");
  if (scroller) {
    let down = false;
    let startX = 0;
    let startLeft = 0;
    scroller.addEventListener("pointerdown", (e) => {
      down = true;
      startX = e.clientX;
      startLeft = scroller.scrollLeft;
      scroller.classList.add("dragging");
    });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      scroller.scrollLeft = startLeft - (e.clientX - startX);
    });
    window.addEventListener("pointerup", () => {
      down = false;
      scroller?.classList.remove("dragging");
    });
  }
}

// ---------- chart helpers ----------

function barsHTML(perDay, days) {
  // Daily bars for the week view; weekly buckets for 30/90 days so
  // the chart stays readable instead of 90 cramped slivers.
  let buckets;
  if (days <= 7) {
    buckets = perDay.map((d) => ({
      label: d.date.slice(8),
      completed: d.completed,
      focusMin: d.focusMin,
    }));
  } else {
    buckets = [];
    for (let i = 0; i < perDay.length; i += 7) {
      const chunk = perDay.slice(i, i + 7);
      if (!chunk.length) break;
      buckets.push({
        label: `${Number(chunk[0].date.slice(8))}/${chunk[0].date.slice(5, 7)}`,
        completed: chunk.reduce((a, d) => a + d.completed, 0),
        focusMin: chunk.reduce((a, d) => a + d.focusMin, 0),
      });
    }
  }
  const maxV = Math.max(...buckets.map((d) => d.completed + d.focusMin / 15), 1);
  return `
  <div class="bar-chart ${days > 7 ? "bar-chart-wide" : ""}">
    ${buckets
      .map((d) => {
        const hC = Math.round((d.completed / maxV) * 100);
        const hF = Math.round((d.focusMin / 15 / maxV) * 100);
        return `
      <div class="bar-col" title="${days > 7 ? `Week of ${d.label}` : d.date}: ${d.completed} tasks · ${d.focusMin}m focus">
        <div class="bar-stack">
          <div class="bar-focus" style="height:${hF}%"></div>
          <div class="bar-task" style="height:${hC}%"></div>
        </div>
        <span class="bar-lbl">${d.label}</span>
      </div>`;
      })
      .join("")}
  </div>
  ${days > 7 ? `<div class="module-foot muted">Bars = weeks (start date labeled)</div>` : ""}
  `;
}

function peakDay(perDay) {
  const best = [...perDay].sort((a, b) => b.completed - a.completed || b.focusMin - a.focusMin)[0];
  if (!best || (!best.completed && !best.focusMin)) return "quiet period";
  return `${best.date} (${best.completed} tasks, ${best.focusMin}m)`;
}

// ---------- narrative helpers ----------

function buildRecos({ week, score, overdueTasks, atRiskGoals, habitsCons, bestWin }) {
  const out = [];
  if (week.focusMinutes < week.days * 30)
    out.push({ icon: "⏱", text: `You averaged only ${Math.round(week.focusMinutes / Math.max(days1(week), 1))} min of focus per day. Book one <b>${bestWin.startHour}:00</b> block tomorrow — that's your proven golden window.` });
  else out.push({ icon: "⏱", text: `Solid focus volume (${minutesToHuman(week.focusMinutes)}). Protect it by batching shallow tasks away from <b>${bestWin.startHour}:00–${bestWin.startHour + 3}:00</b>.` });

  if (overdueTasks.length >= 3)
    out.push({ icon: "⚠️", text: `<b>${overdueTasks.length}</b> overdue tasks are compounding stress. Reschedule or delete half of them right now — a shorter honest list beats a long guilty one.` });
  else if (overdueTasks.length) out.push({ icon: "⚠️", text: `One overdue task left behind: "${esc(overdueTasks[0].title)}". Do it first thing tomorrow.` });

  const weakest = habitsCons.sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0];
  if (weakest && weakest.pct < 50)
    out.push({ icon: "🔄", text: `"${esc(weakest.habit.title)}" held only ${weakest.pct}% of scheduled days. Shrink it — a two-minute version keeps identity alive until capacity returns.` });

  if (atRiskGoals.length >= 2)
    out.push({ icon: "🎯", text: `<b>${atRiskGoals.length} goals</b> sit below 25%. Pick ONE to advance this month; park the rest explicitly instead of letting them drain you.` });

  if (out.length < 3)
    out.push({ icon: "📈", text: `Your completion rate ${week.completionRate != null ? `is ${week.completionRate}%` : "has no deadline data yet"} — adding due dates to key tasks makes future scores sharper.` });
  return out.slice(0, 4);
}

function changeAdvice({ score, week, habitsCons, bestWin, overdueTasks }) {
  const advice = [];
  if (score.parts.focus == null || score.parts.focus < 50)
    advice.push(`<b>Time-blocking:</b> schedule focus like meetings. Your data says ${bestWin.startHour}:00 works best — put the hardest task there.`);
  if (score.parts.tasks != null && score.parts.tasks < 60)
    advice.push(`<b>Smaller tasks:</b> break items over 60 minutes into 25-minute slices; completion rate climbs when finishes come faster.`);
  if (habitsCons.length && habitsCons.reduce((a, h) => a + (h.pct ?? 0), 0) / habitsCons.length < 60)
    advice.push(`<b>Habit stacking:</b> attach weak habits to strong ones ("after coffee → stretch"). Context beats willpower.`);
  if (overdueTasks.length)
    advice.push(`<b>Weekly reset:</b> every Friday, reschedule or delete every overdue item. Start Monday at zero guilt.`);
  if (!advice.length)
    advice.push(`<b>You're in flow.</b> The next lever: raise your weekly focus target by 10% and keep everything else stable.`);
  return advice.map((a) => `<div class="ai-line"><span class="ai-line-icon">→</span><div class="ai-line-text">${a}</div></div>`).join("");
}

function days1(w) {
  return w.days || 7;
}
