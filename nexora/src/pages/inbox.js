import { icon } from "../dom.js";
import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as inboxService from "../services/inboxService.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";

const typeIcon = { text: "notes", voice: "mic", idea: "spark" };

export async function renderInbox(view, alive = () => true) {
  const [items, projects] = await Promise.all([inboxService.allItems(), projectService.allProjects()]);
  if (!alive()) return;
  const pending = items.filter((i) => !i.processed);

  function draw() {
    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${pending.length} items to process</div>
        <div class="page-title-row">
          <h1>Inbox</h1>
        </div>
        <div class="sub">Everything captured lands here first. Confirm before it becomes a task.</div>
      </div>

      <div class="quick-add-input-row card" style="margin-bottom: 24px;">
        ${icon("plus")}
        <input type="text" id="inbox-capture" placeholder="Capture anything — a task, idea, or reminder…" style="border:none; outline:none; background:none; flex:1; font-size:14px;" />
      </div>

      ${
        pending.length
          ? pending
              .map(
                (item) => `
        <div class="inbox-row" data-item="${item.id}">
          <div class="inbox-icon">${icon(typeIcon[item.type] || "notes")}</div>
          <div class="inbox-content">
            <div class="inbox-text">${item.content}</div>
            <div class="inbox-suggestion">${icon("spark")} Turn this into a task — review details on confirm</div>
            <div class="inbox-actions">
              <button class="btn btn-primary btn-sm" data-confirm="${item.id}">Confirm</button>
              <button class="btn btn-secondary btn-sm" data-edit="${item.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-dismiss="${item.id}">Dismiss</button>
            </div>
          </div>
        </div>`
              )
              .join("")
          : `<div class="empty-state">${icon("inbox")}<h3>Inbox zero</h3><p>Nothing waiting to be processed.</p></div>`
      }
    `;

    view.querySelector("#inbox-capture").addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        await inboxService.addItem("text", e.target.value.trim());
        e.target.value = "";
        toast("Captured");
        renderInbox(view, alive);
      }
    });

    view.querySelectorAll("[data-dismiss]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const item = items.find((x) => x.id === btn.dataset.dismiss);
        confirmModal({
          title: "Dismiss item?",
          message: `“${item.content.slice(0, 60)}” will be removed without creating anything.`,
          confirmLabel: "Dismiss",
          danger: true,
        }).then(async (ok) => {
          if (!ok) return;
          await inboxService.removeItem(item.id);
          toast("Dismissed");
          renderInbox(view, alive);
        });
      })
    );

    view.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const item = items.find((x) => x.id === btn.dataset.edit);
        const res = await openForm({
          title: "Edit capture",
          eyebrow: "Inbox",
          values: { content: item.content, type: item.type },
          fields: [
            { name: "content", label: "Content", type: "textarea", rows: 3, required: true },
            {
              name: "type", label: "Type", type: "select",
              options: [
                { value: "text", label: "Text" },
                { value: "voice", label: "Voice note" },
                { value: "idea", label: "Idea" },
              ],
            },
          ],
        });
        if (!res) return;
        Object.assign(item, await inboxService.updateItem(item.id, { content: res.content, type: res.type }));
        toast("Updated — confirm when ready");
        draw();
      })
    );

    view.querySelectorAll("[data-confirm]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const item = items.find((x) => x.id === btn.dataset.confirm);
        const projectsOpts = [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
        const res = await openForm({
          title: "Create task from capture",
          eyebrow: "Confirm",
          values: { title: item.content, projectId: "", priority: "Medium" },
          fields: [
            { name: "title", label: "Task title", required: true },
            { name: "projectId", label: "Project", type: "select", options: projectsOpts },
            {
              name: "priority", label: "Priority", type: "select",
              options: ["Urgent", "High", "Medium", "Low"].map((v) => ({ value: v, label: v })),
            },
            { name: "dueDate", label: "Due date", type: "date" },
          ],
          submitLabel: "Create task",
        });
        if (!res) return;
        await taskService.createTask(res);
        await inboxService.markProcessed(item.id);
        toast("Task created from inbox");
        renderInbox(view, alive);
      })
    );
  }

  draw();
}
