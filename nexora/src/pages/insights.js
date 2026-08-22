import { icon } from "../dom.js";
import { rangeStats, bestWindow, habitConsistency } from "../services/analyticsService.js";
import { minutesToHuman } from "../utils/dates.js";

const state = { range: 7 };

const RANGES = [
  { days: 7, label: "Week" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

function bucketSeries(perDay, days) {
  if (days <= 14) return perDay.map((d) => ({ label: d.date.slice(8), value: d.completed }));
  // bucket into weeks for longer ranges so bars stay readable
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

export async function renderInsights(view, alive = () => true) {
  const stats = await rangeStats(state.range);
  const consistency = await habitConsistency(Math.min(state.range, 90));
  if (!alive()) return;

  const maxCompleted = Math.max(1, ...stats.perDay.map((d) => d.completed));
  const series = bucketSeries(stats.perDay, state.range);
  const maxBucket = Math.max(1, ...series.map((s) => s.value));
  const maxHourMin = Math.max(1, ...stats.hourBuckets);

  const win = bestWindow(stats.hourBuckets);
  const wh = (h) => ((h + 11) % 12) + 1 + (h >= 12 ? "PM" : "AM");

  // Rule-based patterns (honest computations from your real data)
  const patterns = [];
  if (win.totalMinutes > 60) {
    patterns.push(
      `You focus most between ${wh(win.startHour)} and ${wh(win.startHour + 2)} — ${minutesToHuman(win.totalMinutes)} of deep work landed in that window. Protect it for your hardest tasks.`
    );
  } else {
    patterns.push("No strong focus window yet — complete more focus sessions to reveal your most productive hours.");
  }
  const deepShare = stats.focusMinutes ? Math.round((stats.deepMinutes / stats.focusMinutes) * 100) : 0;
  if (stats.sessionCount > 0) {
    patterns.push(
      `${deepShare}% of your focus time was deep work (45m+ blocks). ${deepShare >= 50 ? "Strong ratio." : "Try converting a few short sessions into one long block."}`
    );
  }
  const topHabit = [...consistency].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  if (topHabit?.pct !== null && topHabit) {
    patterns.push(`“${topHabit.habit.title}” is your most consistent habit at ${topHabit.pct}% over the last ${Math.min(state.range, 90)} days.`);
  }
  if (stats.completionRate !== null) {
    patterns.push(
      stats.completionRate >= 75
        ? `Completion rate is healthy (${stats.completionRate}% of due tasks done) — your planning estimates are realistic.`
        : `Only ${stats.completionRate}% of tasks due in this window were completed — try scheduling fewer, bigger blocks.`
    );
  }

  view.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Last ${state.range} days</div>
      <div class="page-title-row">
        <h1>Insights</h1>
        <div class="seg-control" id="range-seg">
          ${RANGES.map((r) => `<button class="seg-btn ${state.range === r.days ? "active" : ""}" data-range="${r.days}">${r.label}</button>`).join("")}
        </div>
      </div>
      <div class="sub">Every number here is computed from your real activity.</div>
    </div>

    <div class="insight-grid">
      <div class="card"><div class="stat-value num">${stats.tasksCompleted}</div><div class="stat-label">Tasks completed</div></div>
      <div class="card"><div class="stat-value num">${minutesToHuman(stats.focusMinutes)}</div><div class="stat-label">Focus time</div></div>
      <div class="card"><div class="stat-value num">${stats.completionRate === null ? "—" : `${stats.completionRate}%`}</div><div class="stat-label">Completion rate</div></div>
      <div class="card"><div class="stat-value num">${minutesToHuman(stats.deepMinutes)}</div><div class="stat-label">Deep work</div></div>
      <div class="card"><div class="stat-value num">${stats.avgTaskMinutes ? minutesToHuman(stats.avgTaskMinutes) : "—"}</div><div class="stat-label">Avg task duration</div></div>
      <div class="card"><div class="stat-value num">${stats.sessionCount}</div><div class="stat-label">Focus sessions</div></div>
    </div>

    <div class="card chart-card" style="margin-bottom: var(--sp-5);">
      <h3>Tasks completed ${state.range <= 14 ? "per day" : "per period"}</h3>
      <div class="bar-chart">
        ${series
          .map(
            (d) => `
          <div class="bar-col">
            <div class="bar-fill" style="height:${Math.round((d.value / maxBucket) * 100)}px;" title="${d.value}"></div>
            <div class="bar-label">${d.label}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>

    <div class="card chart-card" style="margin-bottom: var(--sp-5);">
      <h3>Most productive hours — focus minutes by start hour</h3>
      <div class="heat-strip">
        ${stats.hourBuckets
          .map((m, h) => {
            const intensity = m / maxHourMin;
            const alpha = m ? 0.15 + intensity * 0.85 : 0;
            return `<div class="heat-cell" style="${m ? `background: rgba(61,90,128,${alpha.toFixed(2)});` : ""}" title="${h}:00 · ${m} min"></div>`;
          })
          .join("")}
      </div>
      <div class="heat-axis">
        ${[0, 4, 8, 12, 16, 20].map((h) => `<span>${h}h</span>`).join("")}
        <span style="flex:0.9"></span><span style="flex:0.9"></span><span style="flex:0.9"></span>
      </div>
    </div>

    <div class="card chart-card" style="margin-bottom: var(--sp-6);">
      <h3>Habit consistency</h3>
      ${
        consistency.length
          ? consistency
              .map(
                (c) => `
        <div class="consistency-row">
          <span class="cr-name">${c.habit.title}</span>
          <div class="cr-bar-track"><div class="cr-bar-fill" style="width:${c.pct ?? 0}%;"></div></div>
          <span class="cr-pct">${c.pct === null ? "—" : `${c.pct}%`}</span>
        </div>`
              )
              .join("")
          : `<div class="empty-state"><h3>No scheduled habits</h3></div>`
      }
    </div>

    <div class="section-head"><h2>Patterns detected in your data</h2></div>
    ${patterns.map((text) => `<div class="ai-insight-card">${icon("spark")}<div class="ai-insight-text">${text}</div></div>`).join("")}
  `;

  view.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.range = Number(btn.dataset.range);
      renderInsights(view, alive);
    })
  );
}
