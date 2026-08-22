import { icon, fmtDate } from "../dom.js";
import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as taskService from "../services/taskService.js";
import * as habits from "../services/habitService.js";
import { runGoalPlanner } from "../ui/goalPlanner.js";
import { addDays, todayISO, weekdayOf } from "../utils/dates.js";

const WD_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

function goalModal(g = null) {
  return openForm({
    title: g ? "Edit goal" : "New goal",
    eyebrow: "Goal",
    values: g
      ? {
          title: g.title,
          description: g.description,
          category: g.category,
          priority: g.priority,
          startDate: g.startDate,
          targetDate: g.targetDate || "",
        }
      : { category: "Personal", priority: "Medium", startDate: todayISO() },
    fields: [
      { name: "title", label: "What do you want to achieve?", required: true, placeholder: "e.g. Launch my app in 30 days" },
      { name: "description", label: "Why it matters", type: "textarea", rows: 2 },
      {
        name: "category", label: "Category", type: "select",
        options: ["Personal", "Career", "Health", "Learning", "Finance"].map((v) => ({ value: v, label: v })),
      },
      {
        name: "priority", label: "Priority", type: "select",
        options: ["Urgent", "High", "Medium", "Low"].map((v) => ({ value: v, label: v })),
      },
      { name: "startDate", label: "Start date", type: "date" },
      { name: "targetDate", label: "Target date", type: "date" },
    ],
  });
}

function habitModal(h = null) {
  return openForm({
    title: h ? "Edit habit" : "New habit",
    eyebrow: "Habit schedule",
    values: h
      ? { title: h.title, weekdays: h.weekdays, timeOfDay: h.timeOfDay, durationMinutes: h.durationMinutes }
      : { weekdays: [1, 2, 3, 4, 5], timeOfDay: "08:00", durationMinutes: 30 },
    fields: [
      { name: "title", label: "Habit", required: true, placeholder: "e.g. Morning coding session" },
      { name: "weekdays", label: "Which days?", type: "weekdays" },
      { name: "timeOfDay", label: "Time of day", type: "time" },
      { name: "durationMinutes", label: "Duration (minutes)", type: "number", min: 5, max: 240, step: 5 },
    ],
    submitLabel: h ? "Save changes" : "Create habit",
  });
}

function schedLabel(h) {
  const days = h.weekdays.map((w) => WD_SHORT[w]).join(" ");
  return `${h.timeOfDay} · ${h.durationMinutes}m · ${days}`;
}

export async function renderGoals(view, alive = () => true) {
  const [goals, projects, tasks, habitList] = await Promise.all([
    goalService.allGoals(),
    projectService.allProjects(),
    taskService.allTasks(),
    habits.allHabits(),
  ]);
  if (!alive()) return;
  const prog = await goalService.progressMap(goals, projects, tasks);
  const today = todayISO();
  const todayDoneSet = await habits.logsForDate(today);

  function goalCard(g) {
    const p = prog[g.id];
    const pct = p?.pct ?? 0;
    return `
      <div class="card goal-card">
        <div class="goal-card-top">
          <div>
            <div class="goal-title">${g.title}</div>
            <div class="goal-desc">${g.description}</div>
            <div class="goal-target">${icon("flag", "")} Target: ${g.targetDate ? fmtDate(g.targetDate) : "no date"} · ${g.category} · ${g.priority}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge badge-focus">${g.status}</span>
            <button class="icon-btn" data-edit-goal="${g.id}" aria-label="Edit goal">${icon("dots")}</button>
          </div>
        </div>
        <div class="project-progress-row">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="project-progress-pct num">${pct}%</div>
        </div>
        <div class="goal-plan-chain">
          ${(g.milestones || [])
            .map(
              (step, i) => `
            <button class="chain-step ${step.done ? "done" : ""}" data-ms="${g.id}:${i}" style="cursor:pointer;">${step.done ? "✓ " : ""}${step.label}</button>
            ${i < g.milestones.length - 1 ? `<span class="chain-arrow">→</span>` : ""}`
            )
            .join("")}
        </div>
      </div>`;
  }

  async function habitCard(h) {
    const streakCount = await habits.streak(h);
    const scheduledToday = habits.scheduledOn(h, today);
    const doneToday = todayDoneSet.has(h.id);

    // last-7-days strip
    const days = [];
    for (let d = 6; d >= 0; d--) {
      const iso = addDays(today, -d);
      const on = habits.scheduledOn(h, iso);
      const done = await habits.isDone(h.id, iso);
      days.push({ iso, wd: weekdayOf(iso), on, done, isToday: iso === today });
    }

    return `
      <div class="card habit-card">
        <div class="habit-top">
          <div class="habit-name"><span class="habit-dot" style="background:${h.color};"></span>${h.title}</div>
          <button class="icon-btn" data-edit-habit="${h.id}" aria-label="Edit habit">${icon("dots")}</button>
        </div>
        <div class="habit-sched">${icon("clock")} <span class="num">${schedLabel(h)}</span></div>
        <div class="habit-weekstrip">
          ${days
            .map(
              (d) =>
                `<div class="ws-day ${d.on ? "scheduled" : ""} ${d.done ? "done" : ""} ${d.isToday ? "today" : ""}" title="${d.iso}">${WD_SHORT[d.wd]}</div>`
            )
            .join("")}
        </div>
        <div class="habit-foot">
          <span class="streak-badge">🔥 <span class="num">${streakCount}</span> day${streakCount === 1 ? "" : "s"} streak</span>
          ${
            scheduledToday
              ? `<button class="habit-check-btn ${doneToday ? "done" : ""}" data-check="${h.id}">
                   ${doneToday ? `${icon("check")} Done` : "Mark done"}
                 </button>`
              : `<span class="tag">Rest day</span>`
          }
        </div>
      </div>`;
  }

  function draw() {
    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${goals.filter((g) => g.status === "Active").length} active goals</div>
        <div class="page-title-row">
          <h1>Goals</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-goal-btn">${icon("plus")} New goal</button>
        </div>
        <div class="sub">Tell the AI a goal — it plans the path down to tasks.</div>
      </div>

      ${goals.length ? goals.map(goalCard).join("") : `<div class="empty-state"><h3>No goals yet</h3><p>Define what you're working toward.</p></div>`}

      <button class="btn btn-primary btn-block only-mobile" id="new-goal-btn-m" style="margin-bottom: var(--sp-4);">${icon("plus")} New goal</button>

      <section class="habit-section">
        <div class="section-head">
          <h2>Habits</h2>
          <button class="btn btn-secondary btn-sm" id="new-habit-btn">${icon("plus")} New habit</button>
        </div>
        <div class="habit-grid" id="habit-grid"></div>
      </section>

      <div class="card" style="text-align:center; padding: var(--sp-8) var(--sp-6); border-style: dashed; margin-top: var(--sp-8);">
        <div class="eyebrow" style="margin-bottom: 8px;">${icon("spark")} AI goal planning</div>
        <p style="font-size: 13px; color: var(--graphite); max-width: 420px; margin: 0 auto 16px;">Describe an outcome in plain language and the AI will draft milestones and a first batch of tasks for your review.</p>
        <button class="btn btn-secondary btn-sm" id="ai-plan-btn">Plan a new goal</button>
      </div>
    `;

    wire();
    renderHabits();
  }

  async function renderHabits() {
    const grid = view.querySelector("#habit-grid");
    grid.innerHTML = (await Promise.all(habitList.map(habitCard))).join("") ||
      `<div class="empty-state" style="padding:var(--sp-6);"><h3>No habits yet</h3><p>Build routines that compound toward your goals.</p></div>`;

    grid.querySelectorAll("[data-check]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await habits.toggleLog(btn.dataset.check);
        toast("Nice — habit logged");
        renderGoals(view, alive);
      })
    );

    grid.querySelectorAll("[data-edit-habit]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const h = habitList.find((x) => x.id === btn.dataset.editHabit);
        const res = await habitModal(h);
        if (!res) return;
        Object.assign(h, await habits.updateHabit(h.id, res));
        toast("Habit updated");
        renderGoals(view, alive);
      })
    );
  }

  function wire() {
    view.querySelector("#new-goal-btn").addEventListener("click", createGoalFlow);
    view.querySelector("#new-goal-btn-m")?.addEventListener("click", createGoalFlow);
    view.querySelector("#new-habit-btn").addEventListener("click", createHabitFlow);
    view.querySelector("#ai-plan-btn").addEventListener("click", async () => {
      const created = await runGoalPlanner();
      if (created) renderGoals(view, alive);
    });

    view.querySelectorAll("[data-edit-goal]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const g = goals.find((x) => x.id === btn.dataset.editGoal);
        const res = await openForm({
          title: "Goal actions",
          eyebrow: g.title,
          values: { action: "edit" },
          fields: [
            {
              name: "action", label: "Choose action", type: "select",
              options: [
                { value: "edit", label: "Edit details" },
                { value: "add-milestone", label: "Add milestone step" },
                { value: "complete", label: "Mark completed" },
                { value: "pause", label: "Pause" },
                { value: "delete", label: "Delete goal" },
              ],
            },
            { name: "milestoneLabel", label: "New milestone text (only for adding)", placeholder: "e.g. Ship beta", value: "" },
          ],
          submitLabel: "Apply",
        });
        if (!res) return;
        if (res.action === "edit") {
          const upd = await goalModal(g);
          if (!upd) return;
          Object.assign(g, await goalService.updateGoal(g.id, upd));
          toast("Goal updated");
        } else if (res.action === "add-milestone") {
          if (!res.milestoneLabel.trim()) return;
          const ms = [...(g.milestones || []), { label: res.milestoneLabel.trim(), done: false }];
          Object.assign(g, await goalService.updateGoal(g.id, { milestones: ms }));
          toast("Milestone added");
        } else if (res.action === "complete") {
          Object.assign(g, await goalService.updateGoal(g.id, { status: "Completed" }));
          toast("Goal completed");
        } else if (res.action === "pause") {
          Object.assign(g, await goalService.updateGoal(g.id, { status: "Paused" }));
          toast("Goal paused");
        } else if (res.action === "delete") {
          const ok = await confirmModal({
            title: "Delete goal?",
            message: `“${g.title}” will be removed. Projects stay but become standalone.`,
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await goalService.removeGoal(g.id);
          goals.splice(goals.indexOf(g), 1);
          toast("Goal deleted");
        }
        draw();
      })
    );

    view.querySelectorAll("[data-ms]").forEach((el) =>
      el.addEventListener("click", async () => {
        const [gid, idx] = el.dataset.ms.split(":");
        const g = goals.find((x) => x.id === gid);
        g.milestones[Number(idx)].done = !g.milestones[Number(idx)].done;
        await goalService.updateGoal(gid, { milestones: g.milestones });
        draw();
      })
    );
  }

  async function createGoalFlow() {
    const res = await goalModal();
    if (!res) return;
    goals.push(await goalService.createGoal(res));
    toast("Goal created");
    draw();
  }

  async function createHabitFlow() {
    const res = await habitModal();
    if (!res) return;
    habitList.push(await habits.createHabit(res));
    toast("Habit created");
    draw();
  }

  draw();
}
