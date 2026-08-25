// ============================================================
// GOALS + HABITS
//
// Goals: full filter system (Status / Category / Priority / Sort)
// with working pagination. Statuses are Active, In Progress,
// Completed, On Hold. Progress % is computed from milestones +
// linked work and updates automatically as tasks complete.
//
// Habits: filter (All / Scheduled today / Archived), sort, and
// pagination of their own.
// ============================================================

import { icon, fmtDate } from "../dom.js";
import { openForm, openPanel, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as goalService from "../services/goalService.js";
import * as projectService from "../services/projectService.js";
import * as taskService from "../services/taskService.js";
import * as habits from "../services/habitService.js";
import * as db from "../store/db.js";
import * as recycleService from "../services/recycleService.js";
import { runGoalPlanner } from "../ui/goalPlanner.js";
import { addDays, todayISO, weekdayOf } from "../utils/dates.js";

const WD_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const GOAL_PAGE_SIZE = 6;
const HABIT_PAGE_SIZE = 8;

const gState = {
  status: "all",
  category: "all",
  priority: "all",
  sort: "priority", // priority | progress | target | newest
  page: 1,
};

const hState = {
  filter: "all", // all | today | archived
  sort: "time", // time | name | streak
  page: 1,
};

function goalModal(g = null) {
  return openForm({
    title: g ? "Edit goal" : "New goal",
    eyebrow: "Goal",
    extraClass: "wide",
    values: g
      ? {
          title: g.title,
          description: g.description,
          status: g.status,
          category: g.category,
          priority: g.priority,
          startDate: g.startDate,
          targetDate: g.targetDate || "",
        }
      : { status: "Active", category: "Personal", priority: "Medium", startDate: todayISO() },
    fields: [
      { name: "title", label: "What do you want to achieve?", required: true, placeholder: "e.g. Launch my app in 30 days" },
      { name: "description", label: "Why it matters", type: "textarea", rows: 2 },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: goalService.GOAL_STATUSES.map((s) => ({ value: s, label: s })),
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: ["Personal", "Career", "Health", "Learning", "Finance"].map((v) => ({ value: v, label: v })),
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
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
    db.getAll("habits"),
  ]);
  if (!alive()) return;
  const prog = await goalService.progressMap(goals, projects, tasks);
  const today = todayISO();

  // ---------- goal card ----------
  function goalCard(g) {
    const p = prog[g.id];
    const pct = p?.pct ?? 0;
    const badge =
      g.status === "Completed"
        ? "good"
        : g.status === "On Hold"
          ? "warn"
          : g.status === "In Progress"
            ? "focus"
            : "neutral";
    return `
      <div class="card goal-card">
        <div class="goal-card-top">
          <div>
            <div class="goal-title">${g.title}</div>
            <div class="goal-desc">${g.description}</div>
            <div class="goal-target">${icon("flag", "")} Target: ${g.targetDate ? fmtDate(g.targetDate) : "no date"} · ${g.category} · ${g.priority}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge badge-${badge}">${g.status}</span>
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

  function filteredSortedGoals() {
    let list = [...goals];
    if (gState.status !== "all") list = list.filter((g) => g.status === gState.status);
    if (gState.category !== "all") list = list.filter((g) => g.category === gState.category);
    if (gState.priority !== "all") list = list.filter((g) => g.priority === gState.priority);

    switch (gState.sort) {
      case "progress":
        list.sort((a, b) => (prog[b.id]?.pct ?? 0) - (prog[a.id]?.pct ?? 0));
        break;
      case "target":
        list.sort((a, b) => (a.targetDate || "9999").localeCompare(b.targetDate || "9999"));
        break;
      case "newest":
        list.sort((a, b) => ((a.startDate || "") < (b.startDate || "") ? 1 : -1));
        break;
      default: {
        const rank = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
        list.sort((a, b) => rank[a.priority] - rank[b.priority]);
      }
    }
    return list;
  }

  function draw() {
    const filteredG = filteredSortedGoals();
    const totalPages = Math.max(1, Math.ceil(filteredG.length / GOAL_PAGE_SIZE));
    gState.page = Math.min(gState.page, totalPages);
    const pageGoals = filteredG.slice((gState.page - 1) * GOAL_PAGE_SIZE, gState.page * GOAL_PAGE_SIZE);
    const activeCount = goals.filter((g) => ["Active", "In Progress"].includes(g.status)).length;

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${activeCount} active goals</div>
        <div class="page-title-row">
          <h1>Goals</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-goal-btn">${icon("plus")} New goal</button>
        </div>
        <div class="sub">Tell the AI a goal — it plans the path down to tasks.</div>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <label>Status</label>
          <select class="filter-select" id="g-filter-status">
            <option value="all" ${gState.status === "all" ? "selected" : ""}>All statuses</option>
            ${goalService.GOAL_STATUSES.map((s) => `<option value="${s}" ${gState.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Category</label>
          <select class="filter-select" id="g-filter-category">
            <option value="all" ${gState.category === "all" ? "selected" : ""}>All categories</option>
            ${["Personal", "Career", "Health", "Learning", "Finance"].map((c) => `<option value="${c}" ${gState.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Priority</label>
          <select class="filter-select" id="g-filter-priority">
            <option value="all" ${gState.priority === "all" ? "selected" : ""}>All priorities</option>
            ${["Urgent", "High", "Medium", "Low"].map((p) => `<option value="${p}" ${gState.priority === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Sort by</label>
          <select class="filter-select" id="g-sort">
            ${[
              ["priority", "Priority"],
              ["progress", "Progress (high first)"],
              ["target", "Target date"],
              ["newest", "Newest first"],
            ].map(([v, l]) => `<option value="${v}" ${gState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <span class="filter-count">${filteredG.length} goal${filteredG.length === 1 ? "" : "s"}</span>
      </div>

      ${
        filteredG.length
          ? pageGoals.map(goalCard).join("")
          : goals.length
            ? `<div class="empty-state"><h3>No matches</h3><p>No goals fit these filters.</p></div>`
            : `<div class="empty-state"><h3>No goals yet</h3><p>Define what you're working toward.</p></div>`
      }

      ${filteredG.length > GOAL_PAGE_SIZE ? goalPaginationHTML(totalPages) : ""}

      <button class="btn btn-primary btn-block only-mobile" id="new-goal-btn-m" style="margin-bottom: var(--sp-4);">${icon("plus")} New goal</button>

      <section class="habit-section">
        <div class="section-head">
          <h2>Habits</h2>
          <button class="btn btn-secondary btn-sm" id="new-habit-btn">${icon("plus")} New habit</button>
        </div>
        <div class="filter-bar compact">
          <div class="seg-control" id="habit-seg">
            <button class="seg-btn ${hState.filter === "all" ? "active" : ""}" data-hf="all">All</button>
            <button class="seg-btn ${hState.filter === "today" ? "active" : ""}" data-hf="today">Scheduled today</button>
            <button class="seg-btn ${hState.filter === "archived" ? "active" : ""}" data-hf="archived">Archived</button>
          </div>
          <div class="filter-group">
            <label>Sort by</label>
            <select class="filter-select" id="h-sort">
              ${[
                ["time", "Time of day"],
                ["name", "Name A → Z"],
                ["streak", "Streak (longest)"],
              ].map(([v, l]) => `<option value="${v}" ${hState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="habit-wrap"></div>
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

  function goalPaginationHTML(totalPages) {
    return `
      <div class="pagination">
        <button class="page-btn" id="gp-prev" ${gState.page <= 1 ? "disabled" : ""}>Prev</button>
        <span class="page-info num">Page ${gState.page} of ${totalPages}</span>
        <button class="page-btn" id="gp-next" ${gState.page >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;
  }

  async function renderHabits() {
    const wrap = view.querySelector("#habit-wrap");
    let list = [...habitList];
    if (hState.filter === "today") list = list.filter((h) => !h.archived && habits.scheduledOn(h, today));
    else if (hState.filter === "archived") list = list.filter((h) => h.archived);
    else list = list.filter((h) => !h.archived);

    const streakMap = {};
    await Promise.all(list.map(async (h) => (streakMap[h.id] = await habits.streak(h))));

    if (hState.sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (hState.sort === "streak") list.sort((a, b) => streakMap[b.id] - streakMap[a.id]);
    else list.sort((a, b) => (a.timeOfDay || "").localeCompare(b.timeOfDay || ""));

    const totalPages = Math.max(1, Math.ceil(list.length / HABIT_PAGE_SIZE));
    hState.page = Math.min(hState.page, totalPages);
    const pageItems = list.slice((hState.page - 1) * HABIT_PAGE_SIZE, hState.page * HABIT_PAGE_SIZE);

    wrap.innerHTML =
      (pageItems.length
        ? `<div class="habit-grid">${(await Promise.all(pageItems.map(habitCard))).join("")}</div>`
        : `<div class="empty-state" style="padding:var(--sp-6);"><h3>No habits here</h3><p>${hState.filter === "archived" ? "Nothing archived." : "Build routines that compound toward your goals."}</p></div>`) +
      (list.length > HABIT_PAGE_SIZE
        ? `
        <div class="pagination">
          <button class="page-btn" id="hp-prev" ${hState.page <= 1 ? "disabled" : ""}>Prev</button>
          <span class="page-info num">Page ${hState.page} of ${totalPages}</span>
          <button class="page-btn" id="hp-next" ${hState.page >= totalPages ? "disabled" : ""}>Next</button>
        </div>`
        : "");

    wrap.querySelectorAll("[data-check]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await habits.toggleLog(btn.dataset.check);
        toast("Nice — habit logged");
        renderGoals(view, alive);
      })
    );
    wrap.querySelectorAll("[data-edit-habit]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const h = habitList.find((x) => x.id === btn.dataset.editHabit);
        if (!h) return;
        const res = await openPanel({
          title: h.title,
          eyebrow: `🔄 ${schedLabel(h)}`,
          actions: [
            { id: "edit", label: "✏️ Edit habit", class: "btn-secondary" },
            {
              id: "archive",
              label: h.archived ? "📤 Unarchive habit" : "📦 Archive habit",
              class: "btn-secondary",
            },
            { id: "delete", label: "🗑️ Delete habit", class: "btn-danger" },
          ],
        });
        if (!res) return;

        if (res.action === "edit") {
          const upd = await habitModal(h);
          if (!upd) return;
          Object.assign(h, await habits.updateHabit(h.id, upd));
          toast("Habit updated");
        } else if (res.action === "archive") {
          Object.assign(h, await habits.updateHabit(h.id, { archived: !h.archived }));
          toast(h.archived ? "Habit archived" : "Habit restored");
        } else if (res.action === "delete") {
          const ok = await confirmModal({
            title: "Delete habit?",
            message: `“${h.title}” and its history move to the Recycle Bin for 15 days.`,
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await recycleService.softDelete("habits", h.id);
          habitList.splice(habitList.indexOf(h), 1);
          toast("Moved to Recycle Bin");
        }
        renderGoals(view, alive);
      })
    );

    wrap.querySelector("#hp-prev")?.addEventListener("click", () => {
      if (hState.page > 1) {
        hState.page -= 1;
        renderHabits();
      }
    });
    wrap.querySelector("#hp-next")?.addEventListener("click", () => {
      hState.page += 1;
      renderHabits();
    });
  }

  async function habitCard(h) {
    const streakCount = await habits.streak(h);
    const scheduledToday = habits.scheduledOn(h, today);
    const doneToday = await habits.isDone(h.id, today);

    const days = [];
    for (let d = 6; d >= 0; d--) {
      const iso = addDays(today, -d);
      days.push({ iso, wd: weekdayOf(iso), on: habits.scheduledOn(h, iso), done: await habits.isDone(h.id, iso), isToday: iso === today });
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
            scheduledToday && !h.archived
              ? `<button class="habit-check-btn ${doneToday ? "done" : ""}" data-check="${h.id}">
                   ${doneToday ? `${icon("check")} Done` : "Mark done"}
                 </button>`
              : h.archived
                ? `<span class="tag">Archived</span>`
                : `<span class="tag">Rest day</span>`
          }
        </div>
      </div>`;
  }

  function wire() {
    view.querySelector("#new-goal-btn").addEventListener("click", createGoalFlow);
    view.querySelector("#new-goal-btn-m")?.addEventListener("click", createGoalFlow);
    view.querySelector("#new-habit-btn").addEventListener("click", createHabitFlow);
    view.querySelector("#ai-plan-btn").addEventListener("click", async () => {
      const created = await runGoalPlanner();
      if (created) renderGoals(view, alive);
    });

    view.querySelector("#g-filter-status").addEventListener("change", (e) => {
      gState.status = e.target.value;
      gState.page = 1;
      draw();
    });
    view.querySelector("#g-filter-category").addEventListener("change", (e) => {
      gState.category = e.target.value;
      gState.page = 1;
      draw();
    });
    view.querySelector("#g-filter-priority").addEventListener("change", (e) => {
      gState.priority = e.target.value;
      gState.page = 1;
      draw();
    });
    view.querySelector("#g-sort").addEventListener("change", (e) => {
      gState.sort = e.target.value;
      gState.page = 1;
      draw();
    });

    view.querySelector("#gp-prev")?.addEventListener("click", () => {
      if (gState.page > 1) {
        gState.page -= 1;
        draw();
      }
    });
    view.querySelector("#gp-next")?.addEventListener("click", () => {
      gState.page += 1;
      draw();
    });

    view.querySelectorAll("[data-hf]").forEach((btn) =>
      btn.addEventListener("click", () => {
        hState.filter = btn.dataset.hf;
        hState.page = 1;
        view.querySelectorAll("[data-hf]").forEach((b) => b.classList.toggle("active", b === btn));
        renderHabits();
      })
    );
    view.querySelector("#h-sort").addEventListener("change", (e) => {
      hState.sort = e.target.value;
      hState.page = 1;
      renderHabits();
    });

    view.querySelectorAll("[data-edit-goal]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const g = goals.find((x) => x.id === btn.dataset.editGoal);
        if (!g) return;
        const res = await openPanel({
          title: g.title,
          eyebrow: `🎯 ${g.category} · ${g.priority} · ${prog[g.id]?.pct ?? 0}%`,
          actions: [
            { id: "edit", label: "✏️ Edit details", class: "btn-secondary" },
            { id: "milestone", label: "＋ Add milestone step", class: "btn-secondary" },
            ...(g.status !== "Completed"
              ? [{ id: "complete", label: "🏁 Mark as Completed", class: "btn-secondary" }]
              : []),
            { id: "hold", label: "⏸️ Put On Hold", class: "btn-ghost" },
            { id: "delete", label: "🗑️ Delete goal", class: "btn-danger" },
          ],
        });
        if (!res) return;

        if (res.action === "edit") {
          const upd = await goalModal(g);
          if (!upd) return;
          Object.assign(g, await goalService.updateGoal(g.id, upd));
          toast("Goal updated");
        } else if (res.action === "milestone") {
          const m = await openForm({
            title: "Add milestone",
            eyebrow: g.title,
            fields: [{ name: "label", label: "Milestone", required: true, placeholder: "e.g. Ship beta" }],
            submitLabel: "Add",
          });
          if (!m?.label?.trim()) return;
          const ms = [...(g.milestones || []), { label: m.label.trim(), done: false }];
          Object.assign(g, await goalService.updateGoal(g.id, { milestones: ms }));
          toast("Milestone added");
        } else if (res.action === "complete") {
          Object.assign(g, await goalService.updateGoal(g.id, { status: "Completed" }));
          toast("Goal completed 🎉");
        } else if (res.action === "hold") {
          Object.assign(g, await goalService.updateGoal(g.id, { status: "On Hold" }));
          toast("Goal on hold");
        } else if (res.action === "delete") {
          const ok = await confirmModal({
            title: "Delete goal?",
            message: `“${g.title}” moves to the Recycle Bin for 15 days. Linked projects become standalone but nothing is lost.`,
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await goalService.removeGoal(g.id);
          goals.splice(goals.indexOf(g), 1);
          toast("Moved to Recycle Bin");
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
    const created = await goalService.createGoal(res);
    goals.push(created);
    toast("Goal created");
    draw();
    await linkWorkFlow(created);
  }

  // After creating a goal: optionally link existing projects & tasks to it.
  async function linkWorkFlow(goal) {
    const freeProjects = projects.filter(
      (p) => !p.goalId && !["Completed", "Cancelled"].includes(p.status)
    );
    const freeTasks = tasks.filter((t) => !t.goalId && !["Completed", "Cancelled"].includes(t.status));
    if (!freeProjects.length && !freeTasks.length) return;

    const escA = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const res = await openPanel({
      title: "Link work to this goal",
      eyebrow: `🎯 ${goal.title}`,
      bodyHTML: `
        ${freeProjects.length ? `<div class="form-label">Projects</div>
        ${freeProjects
          .map((p) => `<label class="pp-task"><input type="checkbox" data-link-project="${p.id}" /><span>${escA(p.name)}</span></label>`)
          .join("")}` : ""}
        ${freeTasks.length ? `<div class="form-label" style="margin-top:${freeProjects.length ? "12px" : "0"};">Tasks</div>
        ${freeTasks
          .slice(0, 12)
          .map((t) => `<label class="pp-task"><input type="checkbox" data-link-task="${t.id}" /><span>${escA(t.title)}</span></label>`)
          .join("")}` : ""}
        <div class="form-hint" style="margin-top:10px;">Linked work rolls up into this goal's progress automatically.</div>
      `,
      actions: [{ id: "link", label: "Link selected", class: "btn-primary" }],
    });
    if (res?.action !== "link") return;

    const projectIds = [...res.body.querySelectorAll("[data-link-project]:checked")].map((c) => c.dataset.linkProject);
    const taskIds = [...res.body.querySelectorAll("[data-link-task]:checked")].map((c) => c.dataset.linkTask);
    for (const pid of projectIds) {
      await projectService.updateProject(pid, { goalId: goal.id });
    }
    for (const tid of taskIds) {
      await taskService.updateTask(tid, { goalId: goal.id });
    }
    if (projectIds.length + taskIds.length)
      toast(`Linked ${projectIds.length} project${projectIds.length === 1 ? "" : "s"}, ${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`);
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
