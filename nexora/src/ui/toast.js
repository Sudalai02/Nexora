// ============================================================
// TOAST — small non-blocking feedback messages.
// ============================================================

let wrap = null;

function ensureWrap() {
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.className = "toast-wrap";
  document.body.appendChild(wrap);
  return wrap;
}

export function toast(message, type = "ok") {
  const holder = ensureWrap();
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  holder.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2800);
}
