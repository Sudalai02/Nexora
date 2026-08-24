import { icon } from "../dom.js";
import { openForm, openPanel, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as eventService from "../services/eventService.js";
import { EVENT_TYPE_OPTIONS, typeMeta } from "../config/eventTypes.js";
import {
  todayISO,
  addDays,
  startOfWeekISO,
  fromISO,
  fmtHour,
} from "../utils/dates.js";

const state = {
  view: "week", // day | week | month
  anchor: null, // ISO date the view is centered on
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const HOURS_DAY = Array.from({ length: 24 }, (_, i) => i);

function anchorISO() {
  return state.anchor || todayISO();
}

function weekDays(iso) {
  const monday = startOfWeekISO(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function eventModal(dateISO, ev = null) {
  const toHHMM = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  return openForm({
    title: ev ? "Edit event" : "New event",
    eyebrow: "Calendar",
    values: ev
      ? { title: ev.title, type: ev.type, date: ev.date, startHour: toHHMM(ev.startHour), endHour: toHHMM(ev.endHour) }
      : { date: dateISO || todayISO(), type: "meeting", startHour: "10:00", endHour: "11:00" },
    fields: [
      { name: "title", label: "Event title", required: true, placeholder: "Dentist appointment" },
      { name: "type", label: "Type", type: "select", options: EVENT_TYPE_OPTIONS },
      { name: "date", label: "Date", type: "date" },
      { name: "startHour", label: "Starts", type: "time" },
      { name: "endHour", label: "Ends", type: "time" },
    ],
    submitLabel: ev ? "Save changes" : "Add to calendar",
  });
}

function toFloat(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h + (m || 0) / 60;
}

export async function renderCalendar(view, alive = () => true) {
  const iso = anchorISO();
  const range =
    state.view === "day"
      ? [iso, iso]
      : state.view === "week"
        ? [startOfWeekISO(iso), addDays(startOfWeekISO(iso), 6)]
        : monthRange(iso);
  const events = await eventService.eventsInRange(range[0], range[1]);
  if (!alive()) return;

  const byDate = {};
  for (const e of events) (byDate[e.date] ||= []).push(e);

  const label =
    state.view === "month"
      ? fromISO(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : state.view === "day"
        ? fromISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
        : `${range[0]} – ${range[1]}`;

  function shift(dir) {
    if (state.view === "month") {
      // Jump exactly one calendar month — never skip a month.
      const d = fromISO(anchorISO());
      const nd = new Date(d.getFullYear(), d.getMonth() + dir, 1);
      state.anchor = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-01`;
    } else {
      state.anchor = addDays(anchorISO(), dir * (state.view === "day" ? 1 : 7));
    }
    renderCalendar(view, alive);
  }

  function gridHTML() {
    if (state.view === "day") {
      return `<div class="cal-week" style="grid-template-columns:56px 1fr;">
        <div class="cal-corner"></div>
        <div class="cal-day-head"><div class="dow">${fromISO(iso).toLocaleDateString(undefined, { weekday: "long" })}</div><div class="dom num">${iso.slice(8)}</div></div>
        ${HOURS_DAY.map(
          (h) => `
          <div class="cal-hour-label">${fmtHour(h).replace(":00", "")}</div>
          <div class="cal-cell">
            ${(byDate[iso] || [])
              .filter((e) => Math.floor(e.startHour) === h)
              .map((e) => `<div class="cal-block ${e.type}" data-ev="${e.id}">${e.title} <span class="num">${fmtHour(e.startHour)}</span></div>`)
              .join("")}
          </div>`
        ).join("")}
      </div>`;
    }
    if (state.view === "week") {
      const days = weekDays(iso);
      return `<div class="cal-week">
        <div class="cal-corner"></div>
        ${days.map((d) => `
          <div class="cal-day-head ${d === todayISO() ? "today" : ""}">
            <div class="dow">${DOW[(weekdayIdx(d))]}</div>
            <div class="dom num">${Number(d.slice(8))}</div>
          </div>`).join("")}
        ${HOURS.map(
          (h) => `
          <div class="cal-hour-label">${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}</div>
          ${days.map((d) => {
            const evs = (byDate[d] || []).filter((e) => Math.floor(e.startHour) === h);
            return `<div class="cal-cell">${
              evs.map((e) => `<div class="cal-block ${e.type}" data-ev="${e.id}">${e.title}</div>`).join("")
            }</div>`;
          }).join("")}`
        ).join("")}
      </div>`;
    }
    // month — compact dots grid
    const first = `${iso.slice(0, 7)}-01`;
    const lead = (weekdayIdx(first) + 6) % 7;
    const dim = new Date(fromISO(first).getFullYear(), fromISO(first).getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(`${first.slice(0, 8)}${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);

    return `<div class="cal-week" style="grid-template-columns:repeat(7,1fr);">
      ${DOW.map((d) => `<div class="cal-day-head"><div class="dow">${d}</div></div>`).join("")}
      ${cells
        .map((c) => {
          if (!c) return `<div style="border-top:1px solid var(--hairline); border-left:1px solid var(--hairline); min-height:64px;"></div>`;
          const evs = byDate[c] || [];
          return `
          <div style="border-top:1px solid var(--hairline); border-left:1px solid var(--hairline); min-height:64px; padding:4px; cursor:pointer;" data-month-day="${c}">
            <div class="num" style="font-size:11px; color:${c === todayISO() ? "var(--focus)" : "var(--graphite)"}; font-weight:600;">${Number(c.slice(8))}</div>
            ${evs.slice(0, 3).map((e) => `<div class="cal-block ${e.type}" style="margin-top:2px; font-size:9.5px; padding:1px 4px;">${e.title}</div>`).join("")}
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function weekdayIdx(d) {
    return (fromISO(d).getDay() + 6) % 7; // Mon=0 for header labels
  }

  function monthRange(mid) {
    const d = fromISO(mid);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const f = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;
    const l = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
    return [f, l];
  }

  view.innerHTML = `
    <div class="page-header">
      <div class="eyebrow">Calendar</div>
      <div class="page-title-row">
        <h1>${label}</h1>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" id="plan-week-btn">${icon("spark")} Plan my week</button>
          <button class="btn btn-primary btn-sm only-desktop" id="new-event-btn">${icon("plus")} New event</button>
        </div>
      </div>
      <div class="sub">Time blocks protect your highest-value work.</div>
    </div>

    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="icon-btn" id="prev-btn" aria-label="Previous">${icon("chevron", "rot180")}</button>
        <span style="font-size:13px; font-weight:600;">${label}</span>
        <button class="icon-btn" id="next-btn" aria-label="Next">${icon("chevron")}</button>
        <button class="btn btn-ghost btn-sm" id="today-btn">Today</button>
      </div>
      <div class="seg-control">
        <button class="seg-btn ${state.view === "day" ? "active" : ""}" data-view="day">Day</button>
        <button class="seg-btn ${state.view === "week" ? "active" : ""}" data-view="week">Week</button>
        <button class="seg-btn ${state.view === "month" ? "active" : ""}" data-view="month">Month</button>
      </div>
    </div>

    ${gridHTML()}
  `;

  view.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      renderCalendar(view, alive);
    })
  );
  view.querySelector("#prev-btn").addEventListener("click", () => shift(-1));
  view.querySelector("#next-btn").addEventListener("click", () => shift(1));
  view.querySelector("#today-btn").addEventListener("click", () => {
    state.anchor = todayISO();
    renderCalendar(view, alive);
  });
  view.querySelector("#new-event-btn").addEventListener("click", async () => {
    const res = await eventModal(iso);
    if (!res?.title) return;
    let end = toFloat(res.endHour);
    let start = toFloat(res.startHour);
    if (end <= start) end = start + 1;
    await eventService.createEvent({ title: res.title, type: res.type, date: res.date, startHour: start, endHour: end });
    toast("Event added");
    renderCalendar(view, alive);
  });
  view.querySelector("#plan-week-btn").addEventListener("click", () =>
    toast("AI weekly planning arrives with the AI integration step")
  );

  // Tap an event → action sheet: details + Edit + Delete
  view.querySelectorAll("[data-ev]").forEach((el) =>
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ev = events.find((x) => x.id === el.dataset.ev);
      if (!ev) return;
      const tm = typeMeta(ev.type);
      const res = await openPanel({
        title: ev.title,
        eyebrow: `${tm.emoji} ${tm.label} · ${ev.date}`,
        bodyHTML: `
          <div class="event-detail-rows">
            <div class="meter-row"><span>Time</span><b>${fmtHour(ev.startHour)}${ev.endHour ? ` – ${fmtHour(ev.endHour)}` : ""}</b></div>
            ${ev.notes ? `<div class="meter-row"><span>Notes</span><b>${ev.notes}</b></div>` : ""}
          </div>
        `,
        actions: [
          { id: "edit", label: "✏️ Edit event", class: "btn-secondary" },
          { id: "delete", label: "🗑️ Delete event", class: "btn-danger" },
        ],
      });
      if (!res) return;

      if (res.action === "edit") {
        const patch = await eventModal(ev.date, ev);
        if (!patch?.title) return;
        let end = toFloat(patch.endHour);
        const start = toFloat(patch.startHour);
        if (end <= start) end = start + 1;
        await eventService.updateEvent(ev.id, {
          title: patch.title,
          type: patch.type,
          date: patch.date,
          startHour: start,
          endHour: end,
        });
        toast("Event updated");
      } else if (res.action === "delete") {
        const ok = await confirmModal({
          title: "Remove event?",
          message: `“${ev.title}” will be removed from your calendar.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        await eventService.removeEvent(ev.id);
        toast("Event removed");
      }
      renderCalendar(view, alive);
    })
  );

  view.querySelectorAll("[data-month-day]").forEach((el) =>
    el.addEventListener("click", () => {
      state.anchor = el.dataset.monthDay;
      state.view = "day";
      renderCalendar(view, alive);
    })
  );
}
