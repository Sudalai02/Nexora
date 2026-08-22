export function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function icon(name, extraClass = "") {
  return `<span class="nav-icon ${extraClass}" data-icon="${name}"></span>`;
}

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isOverdue(iso) {
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${iso}T00:00:00`) < today;
}

// Priority labels — Urgent/High/Medium/Low with action-oriented wording.
export function priorityLabel(p) {
  return { Urgent: "Do now", High: "High", Medium: "Medium", Low: "Low" }[p] || p;
}

// Dot color class shared across pages.
export function priorityDotClass(p) {
  return { Urgent: "p-now", High: "p-next", Medium: "p-later", Low: "p-defer" }[p] || "p-defer";
}
