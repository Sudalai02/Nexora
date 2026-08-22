// ============================================================
// NOTES — reading-first.
//
// Notes open in a clean, read-only reading view. Editing is an
// explicit action ("Edit" → autosaving form → "Done"). Extras:
// full-screen reading mode, move-to-folder, and one-click PDF
// export via the browser print pipeline.
// ============================================================

import { icon } from "../dom.js";
import { openForm, openPanel, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as noteService from "../services/noteService.js";
import * as taskService from "../services/taskService.js";
import * as aiService from "../ai/aiService.js";

const state = {
  folderId: "all", // all | none | <folderId>
  activeId: null,
  editing: false, // notes open as read-only by default
  q: "", // list filter text
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal markdown-ish renderer for pleasant reading: #/##/###
// headings, -/* bullets, numbered lists, **bold**, *em*, `code`.
function mdLite(raw) {
  const lines = String(raw || "").split("\n");
  const out = [];
  let inList = false;
  const inline = (t) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(t)) {
      closeList();
      out.push(`<h4>${inline(t.replace(/^###\s+/, ""))}</h4>`);
    } else if (/^##\s+/.test(t)) {
      closeList();
      out.push(`<h3>${inline(t.replace(/^##\s+/, ""))}</h3>`);
    } else if (/^#\s+/.test(t)) {
      closeList();
      out.push(`<h2>${inline(t.replace(/^#\s+/, ""))}</h2>`);
    } else if (/^[-*]\s+/.test(t)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(t.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^\d+\.\s+/.test(t)) {
      if (!inList) {
        out.push('<ul class="ol">');
        inList = true;
      }
      out.push(`<li>${inline(t.replace(/^\d+\.\s+/, ""))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(t)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

function wordCount(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

export async function renderNotes(view, alive = () => true) {
  const [folders, notes] = await Promise.all([noteService.allFolders(), noteService.allNotes()]);
  if (!alive()) return;

  if (!state.activeId && notes.length) state.activeId = notes[0].id;
  // Notes always re-open in reading mode after navigation.
  state.editing = false;

  const matchesFolder = (n) =>
    state.folderId === "all" ||
    (state.folderId === "none" ? !n.folderId : n.folderId === state.folderId);

  const matchesQuery = (n) =>
    !state.q ||
    (n.title || "").toLowerCase().includes(state.q) ||
    (n.body || "").toLowerCase().includes(state.q);

  function draw() {
    const visible = notes.filter((n) => matchesFolder(n) && matchesQuery(n));
    if (state.activeId && !notes.find((n) => n.id === state.activeId)) state.activeId = null;
    const active = notes.find((n) => n.id === state.activeId) || null;

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${notes.length} notes · ${folders.length} folders</div>
        <div class="page-title-row">
          <h1>Notes</h1>
          <button class="btn btn-primary btn-sm only-desktop" id="new-note-btn">${icon("plus")} New note</button>
        </div>
        <div class="sub">Your second brain — organized in folders, comfortable to read.</div>
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
          <input type="text" class="note-search" id="note-search" placeholder="Search notes…" value="${esc(state.q)}" />
          <div class="note-list-scroll" id="note-list">
            ${visible.length
              ? visible
                  .map(
                    (n) => `
              <div class="note-list-item ${n.id === state.activeId ? "active" : ""}" data-note="${n.id}" role="button" tabindex="0">
                <div class="note-item-title">${esc(n.title || "Untitled")}</div>
                <div class="note-item-preview">${esc((n.body || "").slice(0, 60).replace(/\n/g, " "))}</div>
                <div class="note-item-date">${(n.updatedAt || "").slice(0, 10)}</div>
              </div>`
                  )
                  .join("")
              : `<div class="empty-state"><h3>No notes here</h3><p>Create one to start thinking.</p></div>`}
          </div>
        </div>

        <!-- READER / EDITOR PANE -->
        <div class="card note-editor-v2">${editorHTML(active)}</div>
      </div>
    `;
    wire(visible, active);
  }

  function editorHTML(active) {
    if (!active) return `<div class="empty-state" style="margin:auto;"><h3>No note selected</h3><p>Pick a note or create a new one.</p></div>`;
    const folderName = folders.find((f) => f.id === active.folderId)?.name || "Unfiled";

    if (!state.editing) {
      return `
        <div class="note-toolbar">
          <button class="btn btn-secondary btn-sm" id="edit-note-btn">Edit</button>
          <button class="btn btn-ghost btn-sm" id="fullscreen-btn" title="Full-screen reading">${icon("focus")} Read</button>
          <button class="btn btn-ghost btn-sm" id="move-note-btn" title="Move to folder">${icon("inbox")} Move</button>
          <button class="btn btn-ghost btn-sm" id="pdf-btn" title="Export as PDF">${icon("notes")} PDF</button>
          <span style="flex:1"></span>
          <button class="btn btn-danger btn-sm" id="delete-note-btn">Delete</button>
        </div>
        <article class="note-reader">
          <h1 class="reader-title">${esc(active.title || "Untitled note")}</h1>
          <div class="note-meta-row">
            <span>Edited ${(active.updatedAt || "").slice(0, 10)}</span>
            <span class="tag">${folderName}</span>
            <span>${wordCount(active.body)} words</span>
          </div>
          <div class="note-reader-body">${mdLite(active.body) || `<p style="color:var(--graphite-dim)">This note is empty — press Edit to start writing.</p>`}</div>
        </article>
        <div class="ai-note-actions">
          <button class="btn btn-secondary btn-sm" data-ai="summarize">${icon("spark")} Summarize</button>
          <button class="btn btn-secondary btn-sm" data-ai="extract">${icon("check")} Extract tasks</button>
        </div>
      `;
    }

    return `
      <div class="note-toolbar">
        <button class="btn btn-primary btn-sm" id="done-editing-btn">Done</button>
        <span class="tag">Editing · saves automatically</span>
        <span style="flex:1"></span>
        <button class="btn btn-danger btn-sm" id="delete-note-btn">Delete</button>
      </div>
      <input type="text" class="note-title-input" id="note-title-input" value="${esc(active.title)}" placeholder="Title" />
      <textarea class="note-textarea" id="note-body-input" placeholder="Write anything — there is no limit…">${esc(active.body)}</textarea>
      <div class="word-count" id="word-count"></div>
      <div class="ai-note-actions">
        <button class="btn btn-secondary btn-sm" data-ai="summarize">${icon("spark")} Summarize</button>
        <button class="btn btn-secondary btn-sm" data-ai="extract">${icon("check")} Extract tasks</button>
      </div>
    `;
  }

  async function saveActive(active, patch) {
    await noteService.updateNote(active.id, patch);
    Object.assign(active, { ...patch }, { updatedAt: new Date().toISOString() });
    draw();
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
      state.editing = true; // brand-new note goes straight into the editor
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
          message: `“${f.name}” moves to the Recycle Bin for 15 days. Its notes become Unfiled.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await noteService.removeFolder(f.id);
        folders.splice(folders.indexOf(f), 1);
        if (state.folderId === f.id) state.folderId = "all";
        toast("Moved to Recycle Bin");
        draw();
      })
    );

    // Note list selection + live search filter
    view.querySelectorAll("[data-note]").forEach((item) =>
      item.addEventListener("click", () => {
        state.activeId = item.dataset.note;
        state.editing = false;
        draw();
      })
    );

    view.querySelector("#note-search").addEventListener("input", (e) => {
      state.q = e.target.value.toLowerCase();
      const filtered = notes.filter((n) => matchesFolder(n) && matchesQuery(n));
      view.querySelectorAll("[data-note]").forEach((el) => {
        el.style.display = filtered.some((n) => n.id === el.dataset.note) ? "" : "none";
      });
    });

    if (!active) return;

    // ---- delete (recycle bin) ----
    view.querySelector("#delete-note-btn").addEventListener("click", async () => {
      if (state.editing) {
        const titleEl = view.querySelector("#note-title-input");
        const bodyEl = view.querySelector("#note-body-input");
        if (titleEl && bodyEl) {
          const patch = { title: titleEl.value.trim() || "Untitled note", body: bodyEl.value };
          await noteService.updateNote(active.id, patch);
          Object.assign(active, patch, { updatedAt: new Date().toISOString() });
        }
      }
      const ok = await confirmModal({
        title: "Delete note?",
        message: `“${active.title}” moves to the Recycle Bin and can be restored for 15 days.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await noteService.removeNote(active.id);
      notes.splice(notes.findIndex((n) => n.id === active.id), 1);
      state.activeId = null;
      toast("Moved to Recycle Bin");
      draw();
    });

    // ---- AI actions (available in both modes) ----
    view.querySelectorAll("[data-soon]").forEach((b) =>
      b.addEventListener("click", () => toast("Find-related arrives with the embeddings phase"))
    );
    view.querySelector('[data-ai="summarize"]').addEventListener("click", () => summarizeFlow(active));
    view.querySelector('[data-ai="extract"]').addEventListener("click", () => extractFlow(active));

    if (state.editing) wireEditing(active);
    else wireReading(active);

    function wireReading(a) {
      view.querySelector("#edit-note-btn").addEventListener("click", () => {
        state.editing = true;
        draw();
        setTimeout(() => view.querySelector("#note-title-input")?.focus(), 40);
      });
      view.querySelector("#fullscreen-btn").addEventListener("click", () => openReaderOverlay(a));
      view.querySelector("#move-note-btn").addEventListener("click", () => moveFlow(a));
      view.querySelector("#pdf-btn").addEventListener("click", () => exportPDF(a));
    }

    function wireEditing(a) {
      const bodyEl = view.querySelector("#note-body-input");
      const countEl = view.querySelector("#word-count");

      function updateCount() {
        countEl.textContent = `${wordCount(bodyEl.value)} words · ${bodyEl.value.length} chars`;
      }
      updateCount();

      const persist = debounce(async () => {
        const patch = {
          title: view.querySelector("#note-title-input").value.trim() || "Untitled note",
          body: bodyEl.value,
        };
        await noteService.updateNote(a.id, patch);
        Object.assign(a, patch, { updatedAt: new Date().toISOString() });
        const row = view.querySelector(`[data-note="${a.id}"]`);
        if (row) {
          row.querySelector(".note-item-title").textContent = a.title;
          row.querySelector(".note-item-preview").textContent = a.body.slice(0, 60).replace(/\n/g, " ");
          row.querySelector(".note-item-date").textContent = a.updatedAt.slice(0, 10);
        }
      }, 450);

      bodyEl.addEventListener("input", () => {
        updateCount();
        persist();
      });
      view.querySelector("#note-title-input").addEventListener("input", persist);

      view.querySelector("#done-editing-btn").addEventListener("click", () => {
        state.editing = false;
        draw();
      });
    }
  }

  // ---------- move to folder ----------
  async function moveFlow(a) {
    const res = await openForm({
      title: "Move to folder",
      eyebrow: a.title || "Untitled note",
      values: { folderId: a.folderId || "" },
      fields: [
        {
          name: "folderId",
          label: "Folder",
          type: "select",
          options: [{ value: "", label: "Unfiled" }, ...folders.map((f) => ({ value: f.id, label: f.name }))],
        },
      ],
      submitLabel: "Move",
    });
    if (!res) return;
    await noteService.updateNote(a.id, { folderId: res.folderId || null });
    a.folderId = res.folderId || null;
    toast(res.folderId ? `Moved to ${folders.find((f) => f.id === res.folderId)?.name}` : "Moved to Unfiled");
    draw();
  }

  // ---------- full-screen reader overlay ----------
  function openReaderOverlay(a) {
    const ov = document.createElement("div");
    ov.className = "reader-overlay";
    ov.innerHTML = `
      <div class="reader-topbar">
        <span class="eyebrow">Reading mode · Esc closes</span>
        <div class="reader-actions">
          <button class="btn btn-ghost btn-sm" id="ro-pdf">${icon("notes")} Export PDF</button>
          <button class="btn btn-secondary btn-sm" id="ro-edit">Edit</button>
          <button class="icon-btn" id="ro-close" aria-label="Close">${icon("x")}</button>
        </div>
      </div>
      <article class="reader-article">
        <h1 class="reader-title">${esc(a.title || "Untitled note")}</h1>
        <div class="note-meta-row">
          <span>Edited ${(a.updatedAt || "").slice(0, 10)}</span>
          <span class="tag">${folders.find((f) => f.id === a.folderId)?.name || "Unfiled"}</span>
          <span>${wordCount(a.body)} words</span>
        </div>
        <div class="note-reader-body big">${mdLite(a.body)}</div>
      </article>
    `;
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => ov.classList.add("open"));

    const close = () => {
      ov.classList.remove("open");
      setTimeout(() => ov.remove(), 170);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    ov.querySelector("#ro-close").addEventListener("click", close);
    ov.querySelector("#ro-pdf").addEventListener("click", () => exportPDF(a));
    ov.querySelector("#ro-edit").addEventListener("click", () => {
      state.editing = true;
      close();
      draw();
      setTimeout(() => view.querySelector("#note-title-input")?.focus(), 40);
    });
  }

  // ---------- PDF export (browser print pipeline) ----------
  function exportPDF(a) {
    const w = window.open("", "_blank", "width=820,height=940");
    if (!w) {
      toast("Allow pop-ups to export PDF", "err");
      return;
    }
    const dateStr = new Date(a.updatedAt || Date.now()).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.title || "Untitled note")}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1c1c1c;max-width:680px;margin:48px auto;padding:0 24px;line-height:1.7;}
  .brand{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:28px;}
  h1{font-size:27px;margin:0 0 4px;}
  .meta{color:#777;font-size:12px;border-bottom:1px solid #ddd;padding-bottom:14px;margin-bottom:30px;}
  h2{font-size:19px;margin-top:26px;} h3{font-size:16px;} h4{font-size:14px;}
  ul{padding-left:22px;} li{margin:4px 0;} p{margin:10px 0;}
  code{background:#f2f0ec;padding:1px 5px;border-radius:3px;font-size:.9em;}
</style></head><body>
<div class="brand">Nexora Notes</div>
<h1>${esc(a.title || "Untitled note")}</h1>
<div class="meta">${dateStr}</div>
${mdLite(a.body)}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)});<\/script>
</body></html>`);
    w.document.close();
  }

  // ---------- AI flows ----------
  async function summarizeFlow(a) {
    const { text, engine } = await aiService.summarizeNote(a.title, a.body);
    if (!alive()) return;
    const res = await openPanel({
      title: "Summary",
      eyebrow: `${icon("spark")} ${engine === "ollama" ? "Local AI" : "Smart rules"}`,
      bodyHTML: `<div class="ai-result-text">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</div>`,
      actions: [
        { id: "append", label: "Append to note", class: "btn-primary" },
        { id: "newnote", label: "Save as new note", class: "btn-secondary" },
      ],
    });
    if (res?.action === "append") {
      const bodyEl = view.querySelector("#note-body-input");
      if (bodyEl && state.editing && state.activeId === a.id) {
        bodyEl.value += `${bodyEl.value.trim() ? "\n\n" : ""}— Summary —\n${text}`;
        bodyEl.dispatchEvent(new Event("input"));
      } else {
        await saveActive(a, { body: `${a.body.trim() ? `${a.body}\n\n` : ""}— Summary —\n${text}` });
      }
      toast("Summary appended");
    } else if (res?.action === "newnote") {
      const created = await noteService.createNote({ title: `Summary — ${a.title}`, body: text, folderId: a.folderId });
      notes.unshift(created);
      state.activeId = created.id;
      state.editing = false;
      toast("Saved as new note");
      draw();
    }
  }

  async function extractFlow(a) {
    const { tasks: found, engine } = await aiService.extractTasksFromNote(a.body);
    if (!alive()) return;
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
            <span>${esc(t)}</span>
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
        await taskService.createTask({ title: t, projectId: null, priority: "Medium", estimatedMinutes: 30, notes: `From note: ${a.title}` });
      }
      toast(`${picked.length} task${picked.length === 1 ? "" : "s"} added`);
      if (picked.length) window.location.hash = "#/tasks";
    }
  }

  draw();
}
