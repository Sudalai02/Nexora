import { icon } from "./dom.js";

const routes = {};
let currentRoute = null;
let renderSeq = 0;

export function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(name) {
  window.location.hash = `#/${name}`;
}

export function getCurrentRoute() {
  return currentRoute;
}

// Re-render the active view (used after cross-cutting data changes).
export async function rerender() {
  const route = resolveRouteFromHash();
  await renderRoute(route);
}

function resolveRouteFromHash() {
  const hash = window.location.hash.replace("#/", "").split("?")[0] || "home";
  return routes[hash] ? hash : "home";
}

function setActiveNavItem(route) {
  document.querySelectorAll(".nav-item, .bn-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
}

async function renderRoute(route) {
  const view = document.getElementById("view");
  const seq = ++renderSeq;
  try {
    // `alive` lets async pages bail out if the user navigated away mid-load
    await routes[route](view, () => seq === renderSeq);
  } catch (err) {
    console.error(`[router] failed rendering "${route}"`, err);
    if (seq !== renderSeq) return; // a newer navigation already took over
    view.innerHTML = `
      <div class="card error-card">
        ${icon("alert")}
        <h3>Something went wrong</h3>
        <p>We couldn't load this screen. Your data is safe — please retry.</p>
        <button class="btn btn-secondary btn-sm" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

export function initRouter() {
  const view = document.getElementById("view");

  async function onRouteChange() {
    const route = resolveRouteFromHash();
    currentRoute = route;
    setActiveNavItem(route);
    view.style.opacity = "0";
    setTimeout(async () => {
      view.innerHTML = "";
      await renderRoute(route);
      view.style.opacity = "1";
      view.scrollTop = 0;
      window.scrollTo(0, 0);
    }, 60);
  }

  view.style.transition = "opacity 0.12s ease";
  window.addEventListener("hashchange", onRouteChange);
  onRouteChange();
}
