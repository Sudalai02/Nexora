import { icon, isOverdue, priorityLabel, priorityDotClass } from "../dom.js";
import { fmtDue } from "../utils/dates.js";
import { openForm } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";

// Filter state survives navigation within the session.
const state = {
  status: "open", // open | completed | all
  projectId: "all", // all | none | <projectId>
  priority: "all", // all | Urgent | High | Medium | Low
  sort: "priority", // priority | due | created | az | effort
};

const SORTERS = {
  priority: (a, b) => b._score - a._score,
  due: (a, b) => (a.dueDate || "9999") .localeCompare(b.dueDate || "9999"),
  created: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  az: (a, b) => a.title.localeCompare(b.title),
  effort: (a, b) => (a.estimatedMinutes || 0) - (b.estimatedMinutes || 0),
};

function taskRow(t, projectName) {
  const done = t.status === "Completed";
  return `
    <div class="task-row" data-edit="${t.id}" role="button" tabindex="0">
      <button class="check ${done ? "checked" : ""}" data-toggle="${t.id}" aria-label="${done ? "Reopen" : "Complete"} task">
        ${done ? icon("check") : ""}
      </button>
      <span class="priority-dot ${priorityDotClass(t.priority)}"></span>
      <div class="task-row-body">
        <div class="task-row-title ${done ? "done" : ""}">${t.title}</div>
        <div class="task-row-meta">
          ${projectName ? `<span class="tag">${projectName}</span>` : ""}
          ${t.dueDate ? `<span class="task-row-due ${isOverdue(t.dueDate) && !done ? "overdue" : ""}">${fmtDue(t.dueDate)}</span>` : ""}
          ${t.status === "Blocked" ? `<span class="badge badge-danger">Blocked</span>` : ""}
          ${t.status === "In Progress" ? `<span class="badge badge-focus">In progress</span>` : ""}
        </div>
      </div>
      <div class="task-row-right">
        <span class="badge badge-${t.priority === "Urgent" ? "ember" : t.priority === "High" ? "warn" : "neutral"}">${priorityLabel(t.priority)}</span>
        <span class="num" style="font-size:12px; color:var(--graphite-dim);">${t.estimatedMinutes}m</span>
      </div>
    </div>
  `;
}

function taskModal(projects, task = null) {
  return openForm({
    title: task ? "Edit task" : "New task",
    eyebrow: "Task",
    values: task
      ? {
          title: task.title,
          description: task.description,
          projectId: task.projectId || "",
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate || "",
          estimatedMinutes: task.estimatedMinutes,
        }
      : { priority: "Medium", status: "Todo", estimatedMinutes: 30 },
    fields: [
      { name: "title", label: "Title", required: true, placeholder: "What needs to happen?" },
      { name: "description", label: "Description", type: "textarea", rows: 3, placeholder: "Optional details…" },
      {
        name: "projectId", label: "Project",
        type: "select",
        options: [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
      },
      {
        name: "status", label: "Status",
        type: "select",
        options: ["Todo", "In Progress", "Blocked", "Completed", "Cancelled"].map((s) => ({ value: s, label: s })),
      },
      {
        name: "priority", label: "Priority",
        type: "select",
        options: ["Urgent", "High", "Medium", "Low"].map((p) => ({ value: p, label: p })),
      },
      { name: "dueDate", label: "Due date", type: "date" },
      { name: "estimatedMinutes", label: "Estimated minutes", type: "number", min: 5, max: 600, step: 5 },
    ],
    submitLabel: task ? "Save changes" : "Create task",
  });
}

export async function renderTasks(view, alive = () => true) {
  const [tasks, projects] = await Promise.all([taskService.allTasks(), projectService.allProjects()]);
  if (!alive()) return;
  const projectNameOf = (id) => projects.find((p) => p.id === id)?.name || null;

  function filtered() {
    let list = taskService.decorate(tasks);
    if (state.status === "open") list = list.filter((t) => !["Completed", "Cancelled"].includes(t.status));
    else if (state.status === "completed") list = list.filter((t) => t.status === "Completed");

    if (state.projectId === "none") list = list.filter((t) => !t.projectId);
    else if (state.projectId !== "all") list = list.filter((t) => t.projectId === state.projectId);

    if (state.priority !== "all") list = list.filter((t) => t.priority === state.priority);

    return [...list].sort(SORTERS[state.sort]);
  }

  function draw() {
    const list = filtered();
    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">Tasks</div>
        <div class="page-title-row">
          <h1>Tasks</h1>
          <button class="btn btn-primary btn-sm" id="new-task-btn">${icon("plus")} New task</button>
        </div>
        <div class="sub">Filter, sort, and work through what matters.</div>
      </div>

      <div class="task-toolbar">
        <div class="seg-control" id="status-seg">
          <button class="seg-btn ${state.status === "open" ? "active" : ""}" data-status="open">Open</button>
          <button class="seg-btn ${state.status === "completed" ? "active" : ""}" data-status="completed">Completed</button>
          <button class="seg-btn ${state.status === "all" ? "active" : ""}" data-status="all">All</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <label>Project</label>
          <select class="filter-select" id="filter-project">
            <option value="all" ${state.projectId === "all" ? "selected" : ""}>All projects</option>
            ${projects.map((p) => `<option value="${p.id}" ${state.projectId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
            <option value="none" ${state.projectId === "none" ? "selected" : ""}>No project</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Priority</label>
          <select class="filter-select" id="filter-priority">
            <option value="all" ${state.priority === "all" ? "selected" : ""}>All priorities</option>
            ${["Urgent", "High", "Medium", "Low"].map((p) => `<option value="${p}" ${state.priority === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Sort by</label>
          <select class="filter-select" id="sort-by">
            ${[
              ["priority", "Priority score"],
              ["due", "Due date"],
              ["created", "Recently added"],
              ["az", "A → Z"],
              ["effort", "Effort (short first)"],
            ].map(([v, l]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <span class="filter-count">${list.length} task${list.length === 1 ? "" : "s"}</span>
      </div>

      <div class="card card-flush">
        <div class="task-list">
          ${list.length
            ? list.map((t) => taskRow(t, projectNameOf(t.projectId))).join("")
            : `<div class="empty-state"><h3>Nothing here</h3><p>No tasks match these filters.</p></div>`}
        </div>
      </div>
    `;

    // ---- wiring ----
    view.querySelectorAll("[data-status]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.status = btn.dataset.status;
        draw();
      })
    );
    view.querySelector("#filter-project").addEventListener("change", (e) => {
      state.projectId = e.target.value;
      draw();
    });
    view.querySelector("#filter-priority").addEventListener("change", (e) => {
      state.priority = e.target.value;
      draw();
    });
    view.querySelector("#sort-by").addEventListener("change", (e) => {
      state.sort = e.target.value;
      draw();
    });

    view.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await taskService.toggleComplete(btn.dataset.toggle);
        const idx = tasks.findIndex((t) => t.id === btn.dataset.toggle);
        tasks[idx] = await taskService.getTask(btn.dataset.toggle);
        toast(tasks[idx].status === "Completed" ? "Task completed" : "Task reopened");
        draw();
      })
    );

    async function openEditor(id) {
      const task = tasks.find((t) => t.id === id);
      const result = await taskModal(projects, task);
      if (!result) return;
      Object.assign(task, await taskService.updateTask(id, result));
      toast("Task updated");
      draw();
    }

    view.querySelectorAll("[data-edit]").forEach((row) =>
      row.addEventListener("click", () => openEditor(row.dataset.edit))
    );

    view.querySelector("#new-task-btn").addEventListener("click", async () => {
      const result = await taskModal(projects);
      if (!result) return;
      const created = await taskService.createTask(result);
      tasks.push(created);
      toast("Task created");
      draw();
    });
  }

  draw();
}
