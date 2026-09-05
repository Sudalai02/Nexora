// ============================================================
// MODAL SYSTEM — promise-based forms & confirms.
// Usage:
//   const values = await openForm({ title, fields:[...], submitLabel })
//   // resolves object of field values, or null when cancelled
//   const ok = await confirm({ title, message, danger })
// ============================================================

let backdropEl = null;

function ensureBackdrop() {
  if (backdropEl) return backdropEl;
  backdropEl = document.createElement("div");
  backdropEl.className = "modal-backdrop";
  backdropEl.id = "dynamic-modal";
  document.body.appendChild(backdropEl);
  backdropEl.addEventListener("click", (e) => {
    if (e.target === backdropEl) closeModal(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdropEl.classList.contains("open")) closeModal(null);
  });
  return backdropEl;
}

let resolveCurrent = null;

function closeModal(value) {
  if (!backdropEl) return;
  backdropEl.classList.remove("open");
  if (resolveCurrent) {
    resolveCurrent(value);
    resolveCurrent = null;
  }
}

function fieldHTML(f, values) {
  const v = values[f.name] ?? f.value ?? "";
  const req = f.required ? "required" : "";
  let input = "";
  switch (f.type) {
    case "textarea":
      input = `<textarea name="${f.name}" rows="${f.rows || 4}" placeholder="${f.placeholder || ""}" ${req}>${v}</textarea>`;
      break;
    case "select":
      input = `<select name="${f.name}" ${req}>
        ${(f.options || [])
          .map((o) => `<option value="${o.value}" ${String(o.value) === String(v) ? "selected" : ""}>${o.label}</option>`)
          .join("")}
      </select>`;
      break;
    case "number":
      input = `<input type="number" name="${f.name}" value="${v}" min="${f.min ?? 0}" max="${f.max ?? ""}" step="${f.step || 1}" placeholder="${f.placeholder || ""}" ${req} />`;
      break;
    case "date":
      input = `<input type="date" name="${f.name}" value="${v}" />`;
      break;
    case "time":
      input = `<input type="time" name="${f.name}" value="${v}" ${req} />`;
      break;
    case "weekdays":
      // custom weekday picker; value handled separately below
      input = `<input type="hidden" name="${f.name}" value="${v}" data-weekdays-input />
        <div class="wd-row" data-weekdays>
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            .map((d, i) => {
              const on = (Array.isArray(v) ? v : []).includes(i);
              return `<button type="button" class="wd-toggle ${on ? "on" : ""}" data-wd="${i}">${d[0]}<span>${d}</span></button>`;
            })
            .join("")}
        </div>`;
      break;
    default:
      input = `<input type="text" name="${f.name}" value="${v}" placeholder="${f.placeholder || ""}" ${req} />`;
  }
  return `<div class="form-field">
    <label>${f.label}</label>
    ${input}
    ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ""}
  </div>`;
}

export function openForm({ title, eyebrow = "", fields = [], submitLabel = "Save", cancelLabel = "Cancel", danger = false, extraClass = "", values = {} }) {
  const backdrop = ensureBackdrop();
  backdrop.innerHTML = `
    <div class="modal form-modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="form-modal-head">
        <div>
          ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}
          <h3>${title}</h3>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close"><span class="nav-icon" data-icon="x"></span></button>
      </div>
      <form class="form-body">
        ${fields.map((f) => fieldHTML(f, values)).join("")}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${cancelLabel}</button>
          <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${submitLabel}</button>
        </div>
      </form>
    </div>
  `;

  // Weekday toggle wiring
  backdrop.querySelectorAll("[data-wd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("on");
      const hidden = backdrop.querySelector("[data-weekdays-input]");
      const selected = [...backdrop.querySelectorAll(".wd-toggle.on")].map((b) => Number(b.dataset.wd));
      hidden.value = JSON.stringify(selected.sort());
    });
  });

  backdrop.querySelector("[data-close]").addEventListener("click", () => closeModal(null));
  backdrop.querySelector("[data-cancel]").addEventListener("click", () => closeModal(null));

  const form = backdrop.querySelector("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      if (f.type === "weekdays") {
        try { out[f.name] = JSON.parse(form.querySelector("[data-weekdays-input]").value || "[]"); }
        catch { out[f.name] = []; }
        continue;
      }
      const el = form.elements[f.name];
      if (!el) continue;
      out[f.name] = f.type === "number" ? Number(el.value) : el.value.trim?.() ?? el.value;
      if (f.required && (out[f.name] === "" || out[f.name] === undefined)) {
        el.focus();
        return;
      }
    }
    closeModal(out);
  });

  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    const first = form.querySelector("input, textarea, select");
    first?.focus();
  });

  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

export function confirm({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  const backdrop = ensureBackdrop();
  backdrop.innerHTML = `
    <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="confirm-body">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${cancelLabel}</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${confirmLabel}</button>
        </div>
      </div>
    </div>
  `;
  backdrop.querySelector("[data-cancel]").addEventListener("click", () => closeModal(false));
  backdrop.querySelector("[data-ok]").addEventListener("click", () => closeModal(true));
  requestAnimationFrame(() => backdrop.classList.add("open"));
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}

// ------------------------------------------------------------
// openPanel — free-form modal for AI previews & custom content.
// Resolves { action, body } where `body` is the panel element
// (read inputs from it before the DOM is discarded — the resolve
// happens in the same tick as the click, so it is still live).
// ------------------------------------------------------------
export function openPanel({ title, eyebrow = "", bodyHTML = "", actions = [], onOpen = null, extraClass = "" }) {
  const backdrop = ensureBackdrop();
  backdrop.innerHTML = `
    <div class="modal form-modal panel-modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="form-modal-head">
        <div>
          ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}
          <h3>${title}</h3>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close"><span class="nav-icon" data-icon="x"></span></button>
      </div>
      <div class="form-body panel-body">${bodyHTML}</div>
      <div class="form-actions panel-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Close</button>
        ${actions
          .map(
            (a) =>
              `<button type="button" class="btn ${a.class || "btn-primary"}" data-action="${a.id}">${a.label}</button>`
          )
          .join("")}
      </div>
    </div>
  `;
  const finish = (value) => closeModal(value);
  backdrop.querySelector("[data-close]").addEventListener("click", () => finish(null));
  backdrop.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
  backdrop.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const body = backdrop.querySelector(".panel-body");
      if (onOpen) {
        // let caller veto/close manually by returning false
        const keep = onOpen(btn.dataset.action, body, () => finish({ action: btn.dataset.action, body }));
        if (keep === false) return;
      }
      finish({ action: btn.dataset.action, body });
    })
  );
  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    onOpen?.("__mounted__", backdrop.querySelector(".panel-body"), () => finish(null));
  });
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}
