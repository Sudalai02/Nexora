import { icon, fmtDate } from "../dom.js";
import { openForm, confirm } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import * as taskService from "../services/taskService.js";

const STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
const PIPELINE = ["Planning", "Active", "On Hold", "Completed"];

function slug(s) {
  return s.toLowerCase().replace(/\s+/g, "");
}

function statusBadge(status) {
  const map = {
    Planning: "neutral",
    Active: "focus",
    "On Hold": "warn",
    Completed: "good",
    Cancelled: "danger",
  };
  return `<span class="badge badge-${map[status] || "neutral"}">${status}</span>`;
}

function pipelineHTML(status) {
  const idx = PIPELINE.indexOf(status);
  if (status === "Cancelled") {
    return `<div class="pipeline">${PIPELINE.map((s) => `<div class="pipeline-step c-${slug(s)}"></div>`).join("")}<div class="pipeline-step c-cancelled done"></div></div>`;
  }
  return `<div class="pipeline">${PIPELINE.map((s, i) => `<div class="pipeline-step c-${slug(s)} ${i <= idx ? "done" : ""}"></div>`).join("")}</div>`;
}

function projectModal(goals, p = null) {
  return openForm({
    title: p ? "Edit project" : "New project",
    eyebrow: "Project",
    extraClass: "wide",
    values: p
      ? { name: p.name, description: p.description, goalId: p.goalId || "", status: p.status, deadline: p.deadline || "", color: p.color }
      : { status: "Planning", color: "#3D5A80" },
    fields: [
      { name: "name", label: "Project name", required: true, placeholder: "e.g. Mobile app v1" },
      { name: "description", label: "Description", type: "textarea", rows: 2 },
      {
        name: "goalId", label: "Linked goal",
        type: "select",
        options: [{ value: "", label: "No goal (standalone)" }, ...goals.map((g) => ({ value: g.id, label: g.title }))],
      },
      {
        name: "status", label: "Status",
        type: "select",
        options: STATUSES.map((s) => ({ value: s, label: s })),
      },
      { name: "deadline", label: "Deadline", type: "date" },
      {
        name: "color", label: "Folder color",
        type: "select",
        options: [
          { value: "#3D5A80", label: "Blue" },
          { value: "#C4622D", label: "Ember" },
          { value: "#3F7A5C", label: "Green" },
          { value: "#B8842E", label: "Amber" },
          { value: "#6B4E8E", label: "Violet" },
        ],
      },
    ],
  });
}

export async function renderProjects(view, alive = () => true) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const detailId = params.get("id");

  const [projects, tasks, goals] = await Promise.all([
    projectService.allProjects(),
    taskService.allTasks(),
    goalService.allGoals(),
  ]);
  if (!alive()) return;
  const prog = projectService.progressMap(projects, tasks);

  // ---------------- DETAIL VIEW ----------------
  if (detailId && projects.find((p) => p.id === detailId)) {
    const p = projects.find((x) => x.id === detailId);
    const goal = goals.find((g) => g.id === p.goalId);
    const ptasks = taskService
      .decorate(tasks.filter((t) => t.projectId === p.id))
      .sort((a, b) => b._score - a._score);
    const open = ptasks.filter((t) => !["Completed", "Cancelled"].includes(t.status)).length;
    const m = prog[p.id];
    const pct = m.pct === null ? "—" : `${m.pct}%`;

    view.innerHTML = `
      <a href="#/projects" class="back-link">${icon("chevron")} All projects</a>
      <div class="page-header">
        <div class="eyebrow">Project</div>
        <div class="page-title-row">
          <h1>${p.name}</h1>
          ${statusBadge(p.status)}
        </div>
        <div class="sub">${p.description || "No description."}</div>
      </div>

      <div style="margin-bottom: var(--sp-5);">${pipelineHTML(p.status)}</div>

      <div class="detail-stats">
        <div class="stat-box"><div class="stat-value num">${pct}</div><div class="stat-label">Progress (${m.done}/${m.total} tasks)</div></div>
        <div class="stat-box"><div class="stat-value num">${open}</div><div class="stat-label">Open tasks</div></div>
        <div class="stat-box"><div class="stat-value num">${p.deadline ? fmtDate(p.deadline) : "—"}</div><div class="stat-label">Deadline</div></div>
        <div class="stat-box"><div class="stat-value num" style="font-size:14px;">${goal ? goal.title.slice(0, 22) : "None"}</div><div class="stat-label">Linked goal</div></div>
      </div>

      <div class="section-head">
        <h2>Tasks</h2>
        <button class="btn btn-secondary btn-sm" id="add-task-btn">${icon("plus")} Add task</button>
      </div>
      <div class="card card-flush">
        <div class="task-list">
          ${ptasks.length
            ? ptasks
                .map(
                  (t) => `
            <div class="task-row">
              <button class="check ${t.status === "Completed" ? "checked" : ""}" data-toggle="${t.id}">
                ${t.status === "Completed" ? icon("check") : ""}
              </button>
              <div class="task-row-body">
                <div class="task-row-title ${t.status === "Completed" ? "done" : ""}">${t.title}</div>
              </div>
              <span class="priority-dot ${["Urgent","High","Medium","Low"].includes(t.priority) ? { Urgent: "p-now", High: "p-next", Medium: "p-later", Low: "p-defer" }[t.priority] : ""}"></span>
              <span class="num" style="font-size:12px;color:var(--graphite-dim);">${t.estimatedMinutes}m</span>
            </div>`
                )
                .join("")
            : `<div class="empty-state"><h3>No tasks yet</h3><p>Add the first task to start tracking progress.</p></div>`}
        </div>
      </div>
    `;

    view.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await taskService.toggleComplete(btn.dataset.toggle);
        toast("Updated");
        renderProjects(view, alive);
      })
    );
    view.querySelector("#add-task-btn").addEventListener("click", async () => {
      const result = await openForm({
        title: "New task",
        eyebrow: `In ${p.name}`,
        values: { priority: "Medium", estimatedMinutes: 30 },
        fields: [
          { name: "title", label: "Title", required: true },
          {
            name: "priority", label: "Priority", type: "select",
            options: ["Urgent", "High", "Medium", "Low"].map((v) => ({ value: v, label: v })),
          },
          { name: "dueDate", label: "Due date", type: "date" },
          { name: "estimatedMinutes", label: "Estimated minutes", type: "number", min: 5, step: 5 },
        ],
      });
      if (!result) return;
      await taskService.createTask({ ...result, projectId: p.id });
      toast("Task added");
      renderProjects(view, alive);
    });
    return;
  }

  // ---------------- LIST VIEW ----------------
  function card(p) {
    const m = prog[p.id];
    const pct = m.pct === null ? "—" : `${m.pct}%`;
    const goal = goals.find((g) => g.id === p.goalId);
    return `
      <div class="card project-card" data-open="${p.id}">
        <div class="project-card-color" style="background:${p.color};"></div>
        <div class="project-card-top">
          <div>
            <div class="project-name">${p.name}</div>
            ${goal
              ? `<div class="project-goal-link">${icon("goals")} ${goal.title}</div>`
              : `<div class="project-goal-link">No linked goal</div>`}
          </div>
          ${statusBadge(p.status)}
        </div>
        ${pipelineHTML(p.status)}
        <div class="project-progress-row">
          <div class="progress-track"><div class="progress-fill" style="width:${m.pct ?? 0}%"></div></div>
          <div class="project-progress-pct num">${pct}</div>
        </div>
        <div class="project-card-footer">
          <span>${m.done}/${m.total} tasks</span>
          <span>${p.deadline ? `Due ${fmtDate(p.deadline)}` : "No deadline"}</span>
        </div>
        <button class="icon-btn project-card-menu" data-menu="${p.id}" aria-label="Project actions">${icon("dots")}</button>
      </div>
    `;
  }

  const linked = projects.filter((p) => p.goalId);
  const standalone = projects.filter((p) => !p.goalId);

  function draw() {
    const groups =
      linked
        .map((gGroup) => {
          const goal = goals.find((g) => g.id === gGroup.goalId);
          const list = linked.filter((p) => p.goalId === goal.id);
          return `
          <div class="project-group-head">${icon("goals")} ${goal?.title || "Goal"}</div>
          <div class="project-grid">${list.map(card).join("")}</div>`;
        })
        .join("") +
      (standalone.length
        ? `<div class="project-group-head">${icon("projects")} Standalone projects</div>
           <div class="project-grid">${standalone.map(card).join("")}</div>`
        : "") ||
      `<div class="empty-state"><h3>No projects yet</h3><p>Create your first project to organize work.</p></div>`;

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${projects.length} projects</div>
        <div class="page-title-row">
          <h1>Projects</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-project-btn">${icon("plus")} New project</button>
        </div>
        <div class="sub">Everything you're actively building — progress is real, computed from your tasks.</div>
      </div>
      ${groups}
      <button class="btn btn-primary btn-block only-mobile" id="new-project-btn-m" style="margin-top: var(--sp-5);">${icon("plus")} New project</button>
      <div class="menu-pop" id="proj-menu"></div>
    `;
    wire();
  }

  function wire() {
    view.querySelector("#new-project-btn")?.addEventListener("click", createFlow);
    view.querySelector("#new-project-btn-m")?.addEventListener("click", createFlow);

    view.querySelectorAll("[data-open]").forEach((cardEl) =>
      cardEl.addEventListener("click", () => {
        window.location.hash = `#/projects?id=${cardEl.dataset.open}`;
      })
    );

    view.querySelectorAll("[data-menu]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenu(btn.dataset.menu, e.clientX, e.clientY);
      })
    );

    function openMenu(id, x, y) {
      const menu = view.querySelector("#proj-menu");
      const p = projects.find((x2) => x2.id === id);
      menu.innerHTML = `
        <button class="menu-item" data-edit>${icon("settings")} Edit</button>
        <button class="menu-item" data-complete>${icon("check")} Mark completed</button>
        <button class="menu-item danger" data-delete>${icon("x")} Delete</button>
      `;
      menu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
      menu.style.top = `${y + 8}px`;
      menu.classList.add("open");

      const closeMenu = () => menu.classList.remove("open");
      document.addEventListener("click", closeMenu, { once: true });

      menu.querySelector("[data-edit]").addEventListener("click", async () => {
        closeMenu();
        const result = await projectModal(goals, p);
        if (!result) return;
        Object.assign(p, await projectService.updateProject(p.id, result));
        toast("Project updated");
        draw();
      });
      menu.querySelector("[data-complete]").addEventListener("click", async () => {
        closeMenu();
        Object.assign(p, await projectService.updateProject(p.id, { status: "Completed" }));
        toast("Project completed");
        draw();
      });
      menu.querySelector("[data-delete]").addEventListener("click", async () => {
        closeMenu();
        const ok = await confirm({
          title: "Delete project?",
          message: `“${p.name}” will be removed. Its tasks are kept but become unassigned.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await projectService.removeProject(p.id);
        projects.splice(projects.indexOf(p), 1);
        toast("Project deleted");
        draw();
      });
    }
  }

  async function createFlow() {
    const result = await projectModal(goals);
    if (!result) return;
    const created = await projectService.createProject(result);
    projects.push(created);
    toast("Project created");
    draw();
  }

  draw();
}
