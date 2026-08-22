// ============================================================
// RECYCLE BIN — every deletion in Nexora lands here first.
//
// Items are kept for 15 days (countdown shown per row), then
// permanently purged with automatic relationship repair.
// Supports: select one/many/all → Restore, or permanent delete,
// plus Empty Bin. Restoring "Restore all from this module" works
// via the module filter chips.
// ============================================================

import { icon } from "../dom.js";
import { confirm } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as recycleSvc from "../services/recycleService.js";
import { RETENTION_DAYS } from "../services/recycleService.js";

const state = {
  module: "all", // all | <storeName>
  selected: new Set(),
};

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export async function renderRecycleBin(view, alive = () => true) {
  let entries = await recycleSvc.allEntries(); // oldest-deleted first by default
  if (!alive()) return;
  state.selected.clear();

  function visible() {
    return entries.filter((e) => state.module === "all" || e.originalStore === state.module);
  }

  function summaryLine() {
    const v = visible();
    if (!v.length) return "";
    const soonest = Math.min(...v.map((e) => recycleSvc.daysLeft(e)));
    return `${v.length} item${v.length === 1 ? "" : "s"} · auto-purge in ${Math.max(1, soonest)} day${soonest === 1 ? "" : "s"}`;
  }

  function draw() {
    const list = [...visible()].sort((a, b) => ((a.deletedAt || "") < (b.deletedAt || "") ? 1 : -1)); // newest first
    const modules = ["all", ...new Set(entries.map((e) => e.originalStore))];

    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">Kept ${RETENTION_DAYS} days · then permanently removed</div>
        <div class="page-title-row">
          <h1>Recycle Bin</h1>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary btn-sm" id="restore-selected-btn" ${state.selected.size ? "" : "disabled"}>
              ${icon("check")} Restore ${state.selected.size ? `(${state.selected.size})` : ""}
            </button>
            <button class="btn btn-secondary btn-sm only-desktop" id="restore-all-btn" ${entries.length ? "" : "disabled"}>Restore all</button>
            <button class="btn btn-danger btn-sm" id="empty-btn" ${entries.length ? "" : "disabled"}>Empty bin</button>
          </div>
        </div>
        <div class="sub">${entries.length ? summaryLine() : "Deleted tasks, projects, goals, habits, notes and events wait here for 15 days."}</div>
      </div>

      ${
        modules.length > 1
          ? `<div class="date-chip-row">
              ${modules
                .map(
                  (m) =>
                    `<button class="chip ${state.module === m ? "active" : ""}" data-module="${m}">${m === "all" ? "Everything" : recycleSvc.moduleLabel(m)}</button>`
                )
                .join("")}
             </div>`
          : ""
      }

      ${
        list.length
          ? `
        <div class="card card-flush bin-list">
          <label class="bin-row bin-headrow">
            <input type="checkbox" id="bin-select-all" />
            <span>Select all shown</span>
            <span class="bin-perm-note">Restores are instant and undo nothing else.</span>
          </label>
          ${list
            .map((e) => {
              const left = recycleSvc.daysLeft(e);
              return `
              <div class="bin-row" data-id="${e.id}">
                <input type="checkbox" class="bin-check" data-check="${e.id}" ${state.selected.has(e.id) ? "checked" : ""} />
                <span class="bin-icon">${icon(recycleSvc.moduleIcon(e.originalStore))}</span>
                <div class="bin-body">
                  <div class="bin-title">${e.label}</div>
                  <div class="bin-meta">
                    <span class="tag">${recycleSvc.moduleLabel(e.originalStore)}</span>
                    Deleted ${fmtWhen(e.deletedAt)}
                  </div>
                </div>
                <span class="bin-days num">${left}d left</span>
                <div class="bin-actions">
                  <button class="btn btn-secondary btn-sm" data-restore="${e.id}">Restore</button>
                  <button class="icon-btn danger" data-kill="${e.id}" aria-label="Delete forever">${icon("x")}</button>
                </div>
              </div>`;
            })
            .join("")}
        </div>`
          : `<div class="empty-state"><h3>The bin is empty</h3><p>Anything you delete will rest here for 15 days before being removed for good.</p></div>`
      }
    `;
    wire();
  }

  async function refresh() {
    entries = await recycleSvc.allEntries();
    if (!alive()) return;
    state.selected.clear();
    draw();
  }

  function wire() {
    view.querySelector("#bin-select-all")?.addEventListener("change", (e) => {
      const on = e.target.checked;
      view.querySelectorAll(".bin-check").forEach((c) => {
        c.checked = on;
        on ? state.selected.add(c.dataset.check) : state.selected.delete(c.dataset.check);
      });
      updateBtn();
    });

    view.querySelectorAll(".bin-check").forEach((c) =>
      c.addEventListener("change", () => {
        c.checked ? state.selected.add(c.dataset.check) : state.selected.delete(c.dataset.check);
        updateBtn();
      })
    );

    function updateBtn() {
      const btn = view.querySelector("#restore-selected-btn");
      if (btn) {
        btn.disabled = !state.selected.size;
        btn.innerHTML = `${icon("check")} Restore${state.selected.size ? ` (${state.selected.size})` : ""}`;
      }
    }

    view.querySelectorAll("[data-module]").forEach((chip) =>
      chip.addEventListener("click", () => {
        state.module = chip.dataset.module;
        state.selected.clear();
        draw();
      })
    );

    view.querySelector("#restore-selected-btn").addEventListener("click", async () => {
      const ids = [...state.selected];
      for (const id of ids) await recycleSvc.restore(id);
      toast(`Restored ${ids.length} item${ids.length === 1 ? "" : "s"}`);
      refresh();
    });

    view.querySelector("#restore-all-btn").addEventListener("click", async () => {
      const n = entries.length;
      for (const e of entries) await recycleSvc.restore(e.id);
      toast(`Restored all ${n} item${n === 1 ? "" : "s"}`);
      refresh();
    });

    view.querySelector("#empty-btn").addEventListener("click", async () => {
      const ok = await confirm({
        title: "Empty the Recycle Bin?",
        message: "All items will be permanently deleted. Relationships are cleaned up automatically (tasks detached from purged projects, notes unfiled from purged folders).",
        confirmLabel: "Delete everything",
        danger: true,
      });
      if (!ok) return;
      await recycleSvc.emptyBin();
      toast("Recycle Bin emptied");
      refresh();
    });

    view.querySelectorAll("[data-restore]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await recycleSvc.restore(btn.dataset.restore);
        toast("Restored");
        refresh();
      })
    );

    view.querySelectorAll("[data-kill]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const entry = entries.find((x) => x.id === btn.dataset.kill);
        const ok = await confirm({
          title: "Delete permanently?",
          message: `“${entry.label}” will be gone for good. This cannot be undone.`,
          confirmLabel: "Delete forever",
          danger: true,
        });
        if (!ok) return;
        await recycleSvc.permanentlyDelete(btn.dataset.kill);
        toast("Permanently deleted");
        refresh();
      })
    );
  }

  draw();
}
