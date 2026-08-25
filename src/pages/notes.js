// ============================================================
// NOTES V2 — mobile reading-first.
//
// · Folder rail scrolls horizontally, left → right
// · LONG-PRESS a folder → action sheet: Rename / Save / Delete
// · Tap a note → it opens directly as the page (nothing below)
// · List rows stay light: title + date only
// ============================================================

import { icon } from "../dom.js";
import { openForm, openPanel, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as noteService from "../services/noteService.js";
import * as taskService from "../services/taskService.js";
import * as recycleService from "../services/recycleService.js";
import * as aiService from "../ai/aiService.js";

const state = {
  folderId: "all", // all | none | <folderId>
  mode: "list", // list | reader | edit
  activeId: null,
  q: "",
};

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function wordCount(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

// Minimal markdown-ish renderer: # headings, bullets, **bold**, *em*, `code`.
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

function fmtNoteDate(iso) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export async function renderNotes(view, alive = () => true) {
  const [folders, notes] = await Promise.all([noteService.allFolders(), noteService.allNotes()]);
  if (!alive()) return;

  // After navigation always come back to the list.
  if (state.mode === "edit") state.mode = state.activeId ? "reader" : "list";
  if (state.activeId && !notes.find((n) => n.id === state.activeId)) {
    state.activeId = null;
    state.mode = "list";
  }

  const matchesFolder = (n) =>
    state.folderId === "all" || (state.folderId === "none" ? !n.folderId : n.folderId === state.folderId);
  const matchesQuery = (n) =>
    !state.q || (n.title || "").toLowerCase().includes(state.q) || (n.body || "").toLowerCase().includes(state.q);

  function draw() {
    const active = notes.find((n) => n.id === state.activeId) || null;

    if (state.mode !== "list" && active) {
      view.innerHTML = state.mode === "edit" ? editorHTML(active) : readerHTML(active);
      wireReader(active);
      return;
    }

    const visible = notes.filter((n) => matchesFolder(n) && matchesQuery(n));

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">${notes.length} notes · ${folders.length} folders</div>
        <div class="page-title-row">
          <h1>Notes</h1>
          <button class="btn btn-primary btn-sm" id="new-note-btn">${icon("plus")} New note</button>
        </div>
        <div class="sub">Your second brain.</div>
      </div>

      <!-- HORIZONTAL FOLDER RAIL -->
      <div class="folder-rail" id="folder-rail">
        <button class="folder-item ${state.folderId === "all" ? "active" : ""}" data-folder="all">
          <span class="fi-label">📚 All notes</span><span class="fi-count num">${notes.length}</span>
        </button>
        <button class="folder-item ${state.folderId === "none" ? "active" : ""}" data-folder="none">
          <span class="fi-label">📥 Unfiled</span><span class="fi-count num">${notes.filter((n) => !n.folderId).length}</span>
        </button>
        ${folders
          .map(
            (f) => `
          <button class="folder-item ${state.folderId === f.id ? "active" : ""}" data-folder="${f.id}" data-longpress-folder="${f.id}">
            <span class="fi-label">📁 ${esc(f.name)}</span><span class="fi-count num">${notes.filter((n) => n.folderId === f.id).length}</span>
          </button>`
          )
          .join("")}
        <button class="folder-item folder-add" id="add-folder-btn" title="New folder">
          <span class="fi-label">${icon("plus")} New folder</span>
        </button>
      </div>

      <input type="text" class="note-search" id="note-search" placeholder="🔍 Search notes…" value="${esc(state.q)}" />

      <!-- NOTE LIST: title + date only -->
      <div class="note-list-v2" id="note-list">
        ${
          visible.length
            ? visible
                .map(
                  (n) => `
          <div class="note-row" data-note="${n.id}" role="button" tabindex="0">
            <div class="note-row-main">
              <div class="note-row-title">${esc(n.title || "Untitled")}</div>
            </div>
            <div class="note-row-date num">${fmtNoteDate(n.updatedAt)}</div>
          </div>`
                )
                .join("")
            : `<div class="empty-state"><h3>No notes here yet</h3><p>Create one to start thinking.</p></div>`
        }
      </div>
    `;
    wireList(visible);
  }

  // ---------- READER ----------
  function readerHTML(a) {
    const folderName = folders.find((f) => f.id === a.folderId)?.name || "Unfiled";
    return `
      <div class="note-reader-page">
        <div class="reader-topbar">
          <button class="icon-btn" id="back-btn" aria-label="Back">${icon("arrow-left")}</button>
          <div class="reader-actions">
            <button class="icon-btn" id="move-note-btn" title="Move to folder" aria-label="Move">${icon("inbox")}</button>
            <button class="icon-btn" id="pdf-btn" title="Export PDF" aria-label="PDF">${icon("notes")}</button>
            <button class="icon-btn" id="delete-note-btn" title="Delete" aria-label="Delete">${icon("x")}</button>
            <button class="btn btn-primary btn-sm" id="edit-note-btn">Edit</button>
          </div>
        </div>
        <article class="note-reader">
          <h1 class="reader-title">${esc(a.title || "Untitled note")}</h1>
          <div class="note-meta-row">
            <span>${fmtNoteDate(a.updatedAt)}</span>
            <span class="tag">${folderName}</span>
            <span>${wordCount(a.body)} words</span>
          </div>
          <div class="note-reader-body big">${mdLite(a.body) || `<p style="color:var(--graphite-dim)">This note is empty — press Edit to start writing.</p>`}</div>
        </article>
        <div class="ai-note-actions">
          <button class="btn btn-secondary btn-sm" data-ai="summarize">${icon("spark")} Summarize</button>
          <button class="btn btn-secondary btn-sm" data-ai="extract">${icon("check")} Extract tasks</button>
        </div>
      </div>
    `;
  }

  // ---------- EDITOR ----------
  function editorHTML(a) {
    return `
      <div class="note-editor-page card">
        <div class="reader-topbar">
          <button class="icon-btn" id="back-edit-btn" aria-label="Back">${icon("arrow-left")}</button>
          <span class="tag">Editing · saves automatically</span>
          <span style="flex:1"></span>
          <button class="btn btn-primary btn-sm" id="done-editing-btn">Done</button>
        </div>
        <input type="text" class="note-title-input" id="note-title-input" value="${esc(a.title)}" placeholder="Title" />
        <textarea class="note-textarea" id="note-body-input" placeholder="Write anything — there is no limit…">${esc(a.body)}</textarea>
        <div class="word-count" id="word-count"></div>
        <div class="ai-note-actions">
          <button class="btn btn-secondary btn-sm" data-ai="summarize">${icon("spark")} Summarize</button>
          <button class="btn btn-secondary btn-sm" data-ai="extract">${icon("check")} Extract tasks</button>
        </div>
      </div>
    `;
  }

  // ---------- LIST WIRING ----------
  function wireList(visible) {
    view.querySelector("#new-note-btn").addEventListener("click", async () => {
      const created = await noteService.createNote({
        folderId: ["all", "none"].includes(state.folderId) ? null : state.folderId,
        title: "",
        body: "",
      });
      notes.unshift(created);
      state.activeId = created.id;
      state.mode = "edit"; // brand-new note goes straight into editing
      toast("Note created");
      draw();
      setTimeout(() => view.querySelector("#note-title-input")?.focus(), 40);
    });

    view.querySelectorAll(".folder-item[data-folder]").forEach((item) => {
      item.addEventListener("click", () => {
        state.folderId = item.dataset.folder;
        draw();
      });
      if (item.dataset.longpressFolder) attachLongPress(item, item.dataset.longpressFolder);
    });

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

    view.querySelectorAll("[data-note]").forEach((row) =>
      row.addEventListener("click", () => {
        state.activeId = row.dataset.note;
        state.mode = "reader"; // tap → note IS the page now
        window.scrollTo({ top: 0 });
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
  }

  // ---------- LONG-PRESS → folder action sheet ----------
  function attachLongPress(el, folderId) {
    let timer = null;
    let fired = false;
    const start = () => {
      fired = false;
      timer = setTimeout(() => {
        fired = true;
        navigator.vibrate?.(15);
        folderActions(folderId);
      }, 500);
    };
    const cancel = () => timer && clearTimeout(timer);
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", cancel);
    el.addEventListener("touchmove", cancel);
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      folderActions(folderId);
    });
    // Suppress the click that follows a long-press.
    el.addEventListener(
      "click",
      (e) => {
        if (fired) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true
    );
  }

  async function folderActions(folderId) {
    const f = folders.find((x) => x.id === folderId);
    if (!f) return;
    const res = await openPanel({
      title: f.name,
      eyebrow: `📁 Folder · ${notes.filter((n) => n.folderId === f.id).length} notes`,
      actions: [
        { id: "rename", label: "✏️ Rename folder", class: "btn-secondary" },
        { id: "save", label: "💾 Save (export all notes)", class: "btn-secondary" },
        { id: "delete", label: "🗑️ Delete folder", class: "btn-danger" },
      ],
    });
    if (!res) return;

    if (res.action === "rename") {
      const r = await openForm({
        title: "Rename folder",
        fields: [{ name: "name", label: "Folder name", required: true, value: f.name }],
      });
      if (!r?.name) return;
      await noteService.renameFolder(f.id, r.name);
      f.name = r.name;
      toast("Folder renamed");
    } else if (res.action === "save") {
      exportFolder(f);
    } else if (res.action === "delete") {
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
    }
    draw();
  }

  async function exportFolder(f) {
    const inFolder = notes.filter((n) => n.folderId === f.id);
    if (!inFolder.length) {
      toast("This folder is empty");
      return;
    }
    const md = inFolder.map((n) => `# ${n.title || "Untitled"}\n\n${n.body}`).join("\n\n---\n\n");
    download(`${f.name.replace(/[^\w-]+/g, "_")}.md`, md, "text/markdown");
    toast(`Exported ${inFolder.length} note${inFolder.length > 1 ? "s" : ""}`);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- READER / EDITOR WIRING ----------
  function wireReader(active) {
    const backToList = () => {
      state.mode = "list";
      state.activeId = null;
      draw();
    };

    if (state.mode === "edit") {
      const bodyEl = view.querySelector("#note-body-input");
      const countEl = view.querySelector("#word-count");
      const updateCount = () =>
        (countEl.textContent = `${wordCount(bodyEl.value)} words · ${bodyEl.value.length} chars`);
      updateCount();

      const persist = debounce(async () => {
        const patch = {
          title: view.querySelector("#note-title-input").value.trim() || "Untitled note",
          body: bodyEl.value,
        };
        await noteService.updateNote(active.id, patch);
        Object.assign(active, patch, { updatedAt: new Date().toISOString() });
      }, 450);

      bodyEl.addEventListener("input", () => {
        updateCount();
        persist();
      });
      view.querySelector("#note-title-input").addEventListener("input", persist);

      view.querySelector("#done-editing-btn").addEventListener("click", () => {
        state.mode = "reader";
        draw();
      });
      view.querySelector("#back-edit-btn").addEventListener("click", () => {
        state.mode = "reader";
        draw();
      });
      wireAI(active);
      return;
    }

    // ---- reader mode ----
    view.querySelector("#back-btn").addEventListener("click", backToList);

    view.querySelector("#edit-note-btn").addEventListener("click", () => {
      state.mode = "edit";
      draw();
      setTimeout(() => view.querySelector("#note-title-input")?.focus(), 40);
    });

    view.querySelector("#move-note-btn").addEventListener("click", () => moveFlow(active));

    view.querySelector("#pdf-btn").addEventListener("click", () => exportPDF(active));

    view.querySelector("#delete-note-btn").addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Delete note?",
        message: `“${active.title}” moves to the Recycle Bin and can be restored for 15 days.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await recycleService.softDelete("notes", active.id);
      notes.splice(notes.findIndex((n) => n.id === active.id), 1);
      backToList();
      toast("Moved to Recycle Bin");
    });

    wireAI(active);
  }

  function wireAI(active) {
    view.querySelector('[data-ai="summarize"]')?.addEventListener("click", () => summarizeFlow(active));
    view.querySelector('[data-ai="extract"]')?.addEventListener("click", () => extractFlow(active));
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

  // ---------- PDF export ----------
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
<div class="brand">TaskTrack Notes</div>
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
      bodyHTML: `<div class="ai-result-text">${esc(text).replace(/\n/g, "<br/>")}</div>`,
      actions: [
        { id: "append", label: "Append to note", class: "btn-primary" },
        { id: "newnote", label: "Save as new note", class: "btn-secondary" },
      ],
    });
    if (res?.action === "append") {
      await noteService.updateNote(a.id, { body: `${(a.body || "").trim() ? `${a.body}\n\n` : ""}— Summary —\n${text}` });
      a.body = `${a.body.trim() ? `${a.body}\n\n` : ""}— Summary —\n${text}`;
      toast("Summary appended");
      if (state.mode !== "list") draw();
    } else if (res?.action === "newnote") {
      const created = await noteService.createNote({ title: `Summary — ${a.title}`, body: text, folderId: a.folderId });
      notes.unshift(created);
      state.activeId = created.id;
      state.mode = "reader";
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
            <input type="checkbox" checked data-x-task="${esc(t).replace(/"/g, "&quot;")}" />
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
