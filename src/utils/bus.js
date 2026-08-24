// ============================================================
// EVENT BUS — instant UI refresh.
//
// Every service mutation emits "data-changed" (debounced at the
// router), so all screens re-render with fresh data immediately
// after a create/update/delete — no navigate-away-and-back.
// ============================================================

const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  listeners.get(evt)?.delete(fn);
}

export function emit(evt, detail = null) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (err) {
      console.error(`[bus] listener for "${evt}" failed`, err);
    }
  }
}
