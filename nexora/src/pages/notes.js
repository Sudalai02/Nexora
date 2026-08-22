import { icon } from "../dom.js";
import { openForm, openPanel, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as noteService from "../services/noteService.js";
import * as taskService from "../services/taskService.js";
import * as aiService from "../ai/aiService.js";

const state = {
  folderId: "all", // all | none | <folderId>
  activeId: null,
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function renderNotes(view, alive = () => true) {
  const [folders, notes] = await Promise.all([noteService.allFolders(), noteService.allNotes()]);
  if (!alive()) return;

  if (!state.activeId && notes.length) state.activeId = notes[0].id;

  const matchesFolder = (n) =>
    state.folderId === "all" ||
    (state.folderId === "none" ? !n.folderId : n.folderId === state.folderId);

  function draw() {
    const visible = notes.filter(matchesFolder);
    if (state.activeId && !notes.find((n) => n.id === state.activeId)) state.activeId = null;
    const active = notes.find((n) => n.id === state.activeId) || null;

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${notes.length} notes · ${folders.length} folders</div>
        <div class="page-title-row">
          <h1>Notes</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-note-btn">${icon("plus")} New note</button>
        </div>
        <div class="sub">Your second brain — organized in folders, always editable.</div>
      </div>

      <div class="notes-layout-v2">
        <!-- FOLDER RAIL -->
        <aside class="folder-rail">
          <div class="rail-head">Folders
            <button id="add-folder-btn" aria-label="New folder">${icon("plus")}</button>
          </div>
          <button class="folder-item ${state.folderId === "all" ? "active" : ""}" data-folder="all">
            <span class="fi-label">${icon("notes")} All notes</span>
          </button>
          <button class="folder-item ${state.folderId === "none" ? "active" : ""}" data-folder="none">
            <span class="fi-label">${icon("inbox")} Unfiled</span>
          </button>
          ${folders
            .map(
              (f) => `
            <button class="folder-item ${state.folderId === f.id ? "active" : ""}" data-folder="${f.id}">
              <span class="fi-label">${icon("projects")} ${f.name}</span>
              <span class="fi-actions">
                <button data-rename="${f.id}" aria-label="Rename folder">${icon("settings")}</button>
                <button data-delfolder="${f.id}" aria-label="Delete folder">${icon("x")}</button>
              </span>
            </button>`
            )
            .join("")}
        </aside>

        <!-- NOTE LIST -->
        <div>
          <input type="text" class="note-search" id="note-search" placeholder="Search notes…" value="" />
          <div class="note-list-scroll" id="note-list">
            ${visible.length
              ? visible
                  .map(
                    (n) => `
              <div class="note-list-item ${n.id === state.activeId ? "active" : ""}" data-note="${n.id}" role="button" tabindex="0">
                <div class="note-item-title">${n.title || "Untitled"}</div>
                <div class="note-item-preview">${(n.body || "").slice(0, 60).replace(/\n/g, " ")}</div>
                <div class="note-item-date">${(n.updatedAt || "").slice(0, 10)}</div>
              </div>`
                  )
                  .join("")
              : `<div class="empty-state"><h3>No notes here</h3><p>Create one to start thinking.</p></div>`}
          </div>
        </div>

        <!-- EDITOR -->
        <div class="card note-editor-v2">
          ${
            active
              ? `
            <div style="display:flex; justify-content:flex-end; gap:6px;">
              <button class="btn btn-danger btn-sm" id="delete-note-btn">Delete</button>
            </div>
            <input type="text" class="note-title-input" id="note-title-input" value="${active.title.replace(/"/g, "&quot;")}" placeholder="Title" />
            <div class="note-meta-row">
              <span>Edited ${(active.updatedAt || "").slice(0, 10)}</span>
              <span class="tag">${folders.find((f) => f.id === active.folderId)?.name || "Unfiled"}</span>
              <span id="save-indicator"></span>
            </div>
            <textarea class="note-textarea" id="note-body-input" placeholder="Write anything — there is no limit…">${active.body}</textarea>
            <div class="word-count" id="word-count"></div>
            <div class="ai-note-actions">
              <button class="btn btn-secondary btn-sm" data-ai="summarize">${icon("spark")} Summarize</button>
              <button class="btn btn-secondary btn-sm" data-ai="extract">${icon("check")} Extract tasks</button>
              <button class="btn btn-secondary btn-sm" data-soon>${icon("link")} Find related</button>
            </div>`
              : `<div class="empty-state" style="margin:auto;"><h3>No note selected</h3><p>Pick a note or create a new one.</p></div>`
          }
        </div>
      </div>
    `;
    wire(visible, active);
  }

  function wire(visible, active) {
    view.querySelector("#new-note-btn").addEventListener("click", async () => {
      const created = await noteService.createNote({
        folderId: ["all", "none"].includes(state.folderId) ? null : state.folderId,
        title: "",
        body: "",
      });
      notes.unshift(created);
      state.activeId = created.id;
      toast("Note created");
      draw();
      setTimeout(() => view.querySelector("#note-title-input")?.focus(), 40);
    });

    // Folder rail
    view.querySelectorAll(".folder-item[data-folder]").forEach((item) =>
      item.addEventListener("click", () => {
        state.folderId = item.dataset.folder;
        state.activeId = null;
        draw();
      })
    );

    view.querySelector("#add-folder-btn").addEventListener("click", async () => {
      const res = await openForm({
        title: "New folder",
        eyebrow: "Notes",
        fields: [{ name: "name", label: "Folder name", required: true }],
        submitLabel: "Create",
      });
      if (!res?.name) return;
      folders.push(await noteService.createFolder(res.name));
      toast("Folder created");
      draw();
    });

    view.querySelectorAll("[data-rename]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const f = folders.find((x) => x.id === btn.dataset.rename);
        const res = await openForm({
          title: "Rename folder",
          fields: [{ name: "name", label: "Folder name", required: true, value: f.name }],
        });
        if (!res?.name) return;
        await noteService.renameFolder(f.id, res.name);
        f.name = res.name;
        toast("Folder renamed");
        draw();
      })
    );

    view.querySelectorAll("[data-delfolder]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const f = folders.find((x) => x.id === btn.dataset.delfolder);
        const ok = await confirmModal({
          title: "Delete folder?",
          message: `“${f.name}” will be deleted. Its notes move to Unfiled.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await noteService.removeFolder(f.id);
        folders.splice(folders.indexOf(f), 1);
        if (state.folderId === f.id) state.folderId = "all";
        toast("Folder deleted");
        draw();
      })
    );

    // Note list selection + live search filter
    view.querySelectorAll("[data-note]").forEach((item) =>
      item.addEventListener("click", () => {
        state.activeId = item.dataset.note;
        draw();
      })
    );

    view.querySelector("#note-search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      view.querySelectorAll("[data-note]").forEach((el) => {
        const n = notes.find((x) => x.id === el.dataset.note);
        el.style.display =
          !q || (n.title || "").toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q)
            ? ""
            : "none";
      });
    });

    // Editor bindings
    if (active) {
      const bodyEl = view.querySelector("#note-body-input");
      const countEl = view.querySelector("#word-count");
      const saveIndicator = view.querySelector("#save-indicator");

      function updateCount() {
        const text = bodyEl.value.trim();
        const words = text ? text.split(/\s+/).length : 0;
        countEl.textContent = `${words} words · ${bodyEl.value.length} chars`;
      }
      updateCount();

      const persist = debounce(async () => {
        saveIndicator.textContent = "Saving…";
        await noteService.updateNote(active.id, {
          title: view.querySelector("#note-title-input").value.trim() || "Untitled note",
          body: bodyEl.value,
        });
        active.updatedAt = new Date().toISOString();
        active.title = view.querySelector("#note-title-input").value.trim() || "Untitled note";
        active.body = bodyEl.value;
        saveIndicator.textContent = "Saved";
        setTimeout(() => (saveIndicator.textContent = ""), 1200);
        // refresh preview row
        const row = view.querySelector(`[data-note="${active.id}"]`);
        if (row) {
          row.querySelector(".note-item-title").textContent = active.title;
          row.querySelector(".note-item-preview").textContent = active.body.slice(0, 60).replace(/\n/g, " ");
          row.querySelector(".note-item-date").textContent = active.updatedAt.slice(0, 10);
        }
      }, 450);

      bodyEl.addEventListener("input", () => {
        updateCount();
        persist();
      });
      view.querySelector("#note-title-input").addEventListener("input", persist);

      view.querySelector("#delete-note-btn").addEventListener("click", async () => {
        const ok = await confirmModal({
          title: "Delete note?",
          message: `“${active.title}” will be permanently removed.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await noteService.removeNote(active.id);
        notes.splice(notes.findIndex((n) => n.id === active.id), 1);
        state.activeId = null;
        toast("Note deleted");
        draw();
      });

      view.querySelectorAll("[data-soon]").forEach((b) =>
        b.addEventListener("click", () => toast("Find-related arrives with the embeddings phase"))
      );

      // ----- AI: Summarize -----
      view.querySelector('[data-ai="summarize"]').addEventListener("click", async () => {
        const btn = view.querySelector('[data-ai="summarize"]');
        btn.disabled = true;
        btn.textContent = "Thinking…";
        const { text, engine } = await aiService.summarizeNote(active.title, active.body);
        if (!alive()) return;
        btn.disabled = false;
        draw();
        const res = await openPanel({
          title: "Summary",
          eyebrow: `${icon("spark")} ${engine === "ollama" ? "Local AI" : "Smart rules"}`,
          bodyHTML: `<div class="ai-result-text">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</div>`,
          actions: [{ id: "append", label: "Append to note", class: "btn-primary" }],
        });
        if (res?.action === "append") {
          const bodyEl = view.querySelector("#note-body-input");
          if (bodyEl && state.activeId === active.id) {
            bodyEl.value += `${bodyEl.value.trim() ? "\n\n" : ""}— Summary —\n${text}`;
            bodyEl.dispatchEvent(new Event("input"));
            toast("Summary appended");
          }
        }
      });

      // ----- AI: Extract tasks -----
      view.querySelector('[data-ai="extract"]').addEventListener("click", async () => {
        const btn = view.querySelector('[data-ai="extract"]');
        btn.disabled = true;
        btn.textContent = "Reading…";
        const { tasks: found, engine } = await aiService.extractTasksFromNote(active.body);
        if (!alive()) return;
        btn.disabled = false;
        draw();
        if (!found.length) {
          toast(engine === "ollama" ? "No actionable tasks found in this note" : "No list-style lines found — connect a local model for deeper extraction");
          return;
        }
        const res = await openPanel({
          title: "Extract tasks",
          eyebrow: `${icon("spark")} ${engine === "ollama" ? "Local AI" : "Smart rules"} · ${found.length} found`,
          bodyHTML: `
            ${found
              .map(
                (t) => `
              <label class="pp-task">
                <input type="checkbox" checked data-x-task="${t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}" />
                <span>${t.replace(/</g, "&lt;")}</span>
              </label>`
              )
              .join("")}
            <div class="form-hint" style="margin-top:10px;">Checked tasks will be added to your task list.</div>
          `,
          actions: [{ id: "create", label: "Add to tasks", class: "btn-primary" }],
        });
        if (res?.action === "create") {
          const picked = [...res.body.querySelectorAll("[data-x-task]:checked")].map((c) => c.dataset.xTask);
          for (const t of picked) {
            await taskService.createTask({ title: t, projectId: null, priority: "Medium", estimatedMinutes: 30, notes: `From note: ${active.title}` });
          }
          toast(`${picked.length} task${picked.length === 1 ? "" : "s"} added`);
          if (picked.length) window.location.hash = "#/tasks";
        }
      });
    }
  }

  draw();
}
