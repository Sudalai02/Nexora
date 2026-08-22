// ============================================================
// FOCUS — pomodoro engine.
//
// Timing is wall-clock based: instead of decrementing a counter,
// we store an absolute `endsAt` timestamp and derive the remaining
// time from Date.now(). Background tabs, laptop sleep, and page
// navigation can no longer make the timer drift or silently stall.
//
// After a focus session ends, the user lands on an offer screen
// with explicit [Start Break] and [Skip] actions — nothing starts
// without consent.
// ============================================================

import { icon } from "../dom.js";
import { secondsToClock, todayISO } from "../utils/dates.js";
import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as focusService from "../services/focusService.js";
import * as taskService from "../services/taskService.js";
import { getSettings } from "../services/settingsService.js";
import { showNative } from "../services/notificationService.js";

const OUTCOMES = ["Completed", "Partial", "Distracted", "Blocked"];

const T = {
  phase: "idle", // idle | focus | offer | break
  breakKind: null, // short | long
  running: false,
  endsAt: null, // absolute ms timestamp while running
  secondsLeft: 0, // frozen remainder while paused
  totalSeconds: 0,
  taskId: null,
  taskTitle: "",
  plannedMinutes: 45,
  sessionsDone: 0, // consecutive completions since app load
  startedAt: null,
  handle: null,
};

function remainingSeconds() {
  if (T.running && T.endsAt) return Math.max(0, Math.ceil((T.endsAt - Date.now()) / 1000));
  return Math.max(0, T.secondsLeft);
}

function ringProgress() {
  if (!T.totalSeconds) return 0;
  return Math.round(((T.totalSeconds - remainingSeconds()) / T.totalSeconds) * 360);
}

async function persistSession(outcomeLabel, note = "") {
  const focusedSeconds = T.totalSeconds - remainingSeconds();
  if (focusedSeconds < 5) return;
  await focusService.saveSession({
    taskId: T.taskId,
    taskTitle: T.taskTitle || "Unassigned session",
    type: "focus",
    plannedMinutes: T.plannedMinutes,
    durationSeconds: focusedSeconds,
    outcome: outcomeLabel.toLowerCase(),
    note,
    startedAt: T.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
}

function nextBreakKind(settings) {
  const n = settings.pomodoro.sessionsBeforeLongBreak;
  return T.sessionsDone % n === 0 ? "long" : "short";
}

export async function renderFocus(view, alive = () => true) {
  const [settings, tasks] = await Promise.all([getSettings(), taskService.openTasks()]);
  if (!alive()) return;
  const pomo = settings.pomodoro;

  function stopTicker() {
    if (T.handle) clearInterval(T.handle);
    T.handle = null;
  }

  function pause() {
    if (!T.running) return;
    T.secondsLeft = remainingSeconds();
    T.running = false;
    T.endsAt = null;
    stopTicker();
  }

  function arm(seconds) {
    T.secondsLeft = seconds;
    T.endsAt = Date.now() + seconds * 1000;
    T.running = true;
    stopTicker();
    T.handle = setInterval(tick, 500);
  }

  function tick() {
    const left = remainingSeconds();
    T.secondsLeft = left;
    updateDisplay();
    if (left <= 0) {
      stopTicker();
      T.running = false;
      T.endsAt = null;
      if (T.phase === "focus") completeFocus(true);
      else finishBreak();
    }
  }

  async function completeFocus(auto = false) {
    let outcome = auto ? "Completed" : null;
    if (!auto) {
      const res = await openForm({
        title: "How did it go?",
        eyebrow: "Session review",
        values: { outcome: "Completed", note: "" },
        fields: [
          { name: "outcome", label: "Result", type: "select", options: OUTCOMES.map((o) => ({ value: o.toLowerCase(), label: o })) },
          { name: "note", label: "Note (optional)", placeholder: "What happened?" },
        ],
        submitLabel: "Save session",
      });
      if (!res) await persistSession("Partial");
      else {
        outcome = res.outcome;
        await persistSession(res.outcome, res.note);
      }
    } else {
      await persistSession(outcome);
      showNative("Focus complete", `Nice work on “${T.taskTitle || "your session"}”. Time for a break.`);
    }

    T.sessionsDone += 1;
    if (T.taskId) {
      const t = tasks.find((x) => x.id === T.taskId);
      if (t && t.status === "Todo") await taskService.updateTask(T.taskId, { status: "In Progress" });
    }
    T.breakKind = nextBreakKind(settings);
    T.phase = "offer"; // wait for explicit user choice
    draw();
  }

  function startBreak() {
    T.plannedMinutes = T.breakKind === "long" ? pomo.longBreakMinutes : pomo.shortBreakMinutes;
    T.phase = "break";
    T.totalSeconds = T.plannedMinutes * 60;
    arm(T.totalSeconds);
    draw();
  }

  function skipToIdle(message) {
    T.phase = "idle";
    T.totalSeconds = 0;
    T.secondsLeft = 0;
    draw();
    if (message) toast(message);
  }

  function finishBreak() {
    showNative("Break over", "Ready for another round of deep work?");
    skipToIdle("Break over — ready when you are");
  }

  async function abandon() {
    pause();
    const ok = await confirmModal({
      title: "Abandon session?",
      message: "The minutes you focused will still be saved.",
      confirmLabel: "Abandon",
      danger: true,
    });
    if (!ok) {
      arm(T.secondsLeft);
      updateToggle();
      return;
    }
    await persistSession("Distracted");
    T.phase = "idle";
    T.totalSeconds = 0;
    draw();
  }

  function updateDisplay() {
    const disp = view.querySelector("#timer-display");
    if (!disp) return;
    disp.textContent = secondsToClock(remainingSeconds());
    const ring = view.querySelector(".focus-ring");
    if (ring)
      ring.style.background = `conic-gradient(var(--${T.phase === "focus" ? "focus" : "good"}) ${ringProgress()}deg, var(--hairline) ${ringProgress()}deg 360deg)`;
  }

  function updateToggle() {
    const btn = view.querySelector("#toggle-btn");
    if (btn) btn.innerHTML = icon(T.running ? "pause" : "play");
  }

  // ---------------- RENDER ----------------
  async function draw() {
    if (T.phase === "offer") {
      renderOffer();
      return;
    }
    if (T.phase === "break") {
      renderBreak();
      return;
    }

    const sessions = await focusService.allSessions();
    if (!alive()) return;

    if (T.phase === "idle") renderIdle(sessions);
    else renderRunning();
  }

  // ---- break OFFER screen: Start Break / Skip ----
  function renderOffer() {
    const mins = T.breakKind === "long" ? pomo.longBreakMinutes : pomo.shortBreakMinutes;
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">Session ${T.sessionsDone} done</div>
        <h1>Take ${mins} minutes?</h1>
      </div>
      <div class="break-banner">
        <div class="focus-ring">
          <div style="position:relative; text-align:center;">
            <div class="focus-time num">${String(mins).padStart(2, "0")}:00</div>
            <div class="focus-session-label">${T.breakKind === "long" ? "Long break earned" : "Short break"}</div>
          </div>
        </div>
        <p style="font-size:13px;color:var(--graphite);margin-bottom:var(--sp-5);">
          Next up: ${T.taskTitle || "your next task"}
        </p>
        <div class="now-actions" style="justify-content:center;">
          <button class="btn btn-primary" id="start-break-btn">Start Break</button>
          <button class="btn btn-secondary" id="skip-break-btn">Skip</button>
        </div>
      </div>
    `;
    view.querySelector("#start-break-btn").addEventListener("click", startBreak);
    view.querySelector("#skip-break-btn").addEventListener("click", () => skipToIdle("Skipped — jump back in anytime"));
  }

  // ---- active break ----
  function renderBreak() {
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">${T.breakKind === "long" ? "Long break" : "Short break"} · in progress</div>
        <h1>Recharge</h1>
      </div>
      <div class="break-banner">
        <div class="focus-ring">
          <div style="position:relative; text-align:center;">
            <div class="focus-time num" id="timer-display">${secondsToClock(remainingSeconds())}</div>
            <div class="focus-session-label">${T.plannedMinutes}m break</div>
          </div>
        </div>
        <div class="now-actions" style="justify-content:center;">
          <button class="btn btn-secondary" id="break-pause-btn">${icon(T.running ? "pause" : "play")}<span>${T.running ? "Pause" : "Resume"}</span></button>
          <button class="btn btn-primary" id="end-break-btn">End break</button>
        </div>
      </div>
    `;
    view.querySelector("#break-pause-btn").addEventListener("click", (e) => {
      if (T.running) pause();
      else arm(T.secondsLeft);
      e.currentTarget.innerHTML = `${icon(T.running ? "pause" : "play")}<span>${T.running ? "Pause" : "Resume"}</span>`;
    });
    view.querySelector("#end-break-btn").addEventListener("click", () => {
      stopTicker();
      T.running = false;
      T.endsAt = null;
      skipToIdle();
    });
  }

  // ---- idle picker ----
  function renderIdle(sessions) {
    const groups = groupSessions(sessions);
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">Focus</div>
        <h1>Deep work</h1>
      </div>
      <div class="focus-shell">
        <div class="focus-task-label">Working on</div>
        <div class="focus-task-title" id="task-title-display">${T.taskTitle || (tasks[0]?.title ?? "No open tasks")}</div>

        <div class="focus-ring">
          <div style="position:relative; text-align:center;">
            <div class="focus-time num" id="timer-display">${secondsToClock(pomo.focusMinutes * 60)}</div>
            <div class="focus-session-label">Ready</div>
          </div>
        </div>

        <div class="focus-controls">
          <button class="btn btn-secondary btn-sm" id="pick-task-btn">${icon("tasks")} Choose task</button>
          <button class="focus-btn-main" id="start-btn">${icon("play")}</button>
        </div>

        <div class="eyebrow" style="margin-bottom:12px;">Duration</div>
        <div class="focus-dur-row" id="dur-row">
          <button class="dur-chip" data-min="25">25m</button>
          <button class="dur-chip active" data-min="${pomo.focusMinutes}">${pomo.focusMinutes}m</button>
          <button class="dur-chip" data-min="60">60m</button>
          <button class="dur-chip" data-min="90">Deep (90m)</button>
          <input type="number" min="5" max="180" step="5" class="custom-dur-input" placeholder="min" aria-label="Custom minutes" />
        </div>

        ${historyHTML(groups)}
      </div>
    `;
    wireIdle();
  }

  function groupSessions(sessions) {
    const today = todayISO();
    const dayOf = (s) => (s.startedAt || "").slice(0, 10);
    const sorted = [...sessions].sort((a, b) => ((a.startedAt || "") < (b.startedAt || "") ? 1 : -1));
    return {
      today: sorted.filter((s) => dayOf(s) === today),
      recent: sorted.filter((s) => {
        const d = dayOf(s);
        return d && d !== today && d >= addDaysISO(today, -6);
      }),
      older: sorted.filter((s) => {
        const d = dayOf(s);
        return d && d < addDaysISO(today, -6);
      }),
    };
  }

  function addDaysISO(iso, n) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function historyHTML(groups) {
    if (!groups.today.length && !groups.recent.length && !groups.older.length) {
      return `<section class="focus-history"><div class="empty-state" style="padding:var(--sp-6);"><h3>No sessions yet</h3><p>Pick a duration and press play.</p></div></section>`;
    }
    const section = (title, list, open = true) =>
      list.length
        ? `
        <details class="session-group" ${open ? "open" : ""}>
          <summary>${title} <span class="num">${list.length}</span></summary>
          <div class="session-group-body">${list.map(sessionRow).join("")}</div>
        </details>`
        : "";
    return `
      <section class="focus-history">
        <div class="section-head"><h3>History</h3></div>
        ${section("Today", groups.today)}
        ${section("Last 7 days", groups.recent)}
        ${section("Full history", groups.older.slice(0, 50), false)}
      </section>
    `;
  }

  // ---- running focus ----
  function renderRunning() {
    view.innerHTML = `
      <div class="page-header" style="text-align:center;">
        <div class="eyebrow">Focus · session in progress</div>
        <h1>Deep work</h1>
      </div>
      <div class="focus-shell">
        <div class="focus-task-label">Working on</div>
        <div class="focus-task-title">${T.taskTitle}</div>

        <div class="focus-ring">
          <div style="position:relative; text-align:center;">
            <div class="focus-time num" id="timer-display">${secondsToClock(remainingSeconds())}</div>
            <div class="focus-session-label">Pomodoro · ${T.plannedMinutes}m</div>
          </div>
        </div>

        <div class="focus-controls">
          <button class="btn btn-secondary" id="abandon-btn">Abandon</button>
          <button class="focus-btn-main" id="toggle-btn">${icon(T.running ? "pause" : "play")}</button>
          <button class="btn btn-primary" id="complete-btn">Complete</button>
        </div>
        <p style="font-size:11.5px;color:var(--graphite-dim);">The timer keeps counting real time even in a background tab.</p>
      </div>
    `;
    wireTimerControls();
    view.querySelector("#complete-btn").addEventListener("click", () => {
      pause();
      completeFocus(false);
    });
    view.querySelector("#abandon-btn").addEventListener("click", abandon);
    updateDisplay();
  }

  function sessionRow(s) {
    const d = new Date(s.startedAt);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `
      <div class="session-row">
        <span class="session-date">${dateStr}<br /><small>${timeStr}</small></span>
        <span class="session-title">${s.taskTitle}</span>
        <span class="badge badge-${s.outcome === "completed" ? "good" : s.outcome === "partial" ? "warn" : "neutral"}">${s.outcome}</span>
        <span class="session-mins">${Math.round((s.durationSeconds || 0) / 60)}m</span>
        <button class="session-del" data-del="${s.id}" aria-label="Delete session">${icon("x")}</button>
      </div>
    `;
  }

  function wireIdle() {
    const display = view.querySelector("#timer-display");
    let idleSeconds = pomo.focusMinutes * 60;
    display.textContent = secondsToClock(idleSeconds);

    view.querySelectorAll(".dur-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        view.querySelectorAll(".dur-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        view.querySelector(".custom-dur-input").value = "";
        idleSeconds = parseInt(chip.dataset.min, 10) * 60;
        display.textContent = secondsToClock(idleSeconds);
      })
    );

    view.querySelector(".custom-dur-input").addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 180) {
        view.querySelectorAll(".dur-chip").forEach((c) => c.classList.remove("active"));
        idleSeconds = v * 60;
        display.textContent = secondsToClock(idleSeconds);
      }
    });

    view.querySelector("#start-btn").addEventListener("click", () => {
      T.plannedMinutes = Math.round(idleSeconds / 60);
      T.phase = "focus";
      T.totalSeconds = idleSeconds;
      T.startedAt = new Date().toISOString();
      if (!T.taskTitle) {
        T.taskTitle = tasks[0]?.title || "";
        T.taskId = tasks[0]?.id || null;
      }
      arm(idleSeconds);
      draw();
    });

    view.querySelector("#pick-task-btn").addEventListener("click", pickTask);

    view.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await focusService.removeSession(btn.dataset.del);
        toast("Session removed");
        draw();
      })
    );
  }

  async function pickTask() {
    if (!tasks.length) {
      toast("No open tasks — create one first");
      return;
    }
    const res = await openForm({
      title: "Choose a task",
      eyebrow: "Focus target",
      values: { taskId: T.taskId || tasks[0].id },
      fields: [
        {
          name: "taskId",
          label: "Open tasks (sorted by priority)",
          type: "select",
          options: tasks.slice(0, 25).map((t) => ({ value: t.id, label: `${t.title} · ${t.priority}` })),
        },
      ],
      submitLabel: "Set task",
    });
    if (!res) return;
    const t = tasks.find((x) => x.id === res.taskId);
    T.taskId = t?.id || null;
    T.taskTitle = t?.title || "";
    const el = view.querySelector("#task-title-display");
    if (el) el.textContent = T.taskTitle;
  }

  function wireTimerControls() {
    view.querySelector("#toggle-btn").addEventListener("click", () => {
      if (T.running) {
        pause();
        updateToggle();
      } else {
        arm(T.secondsLeft);
        updateToggle();
      }
    });
  }

  // A running timer survives navigation: the old ticker's closure
  // points at a detached DOM, so always re-arm it against this view.
  if (T.running && (T.phase === "focus" || T.phase === "break")) {
    T.secondsLeft = remainingSeconds();
    arm(T.secondsLeft);
  }

  draw();
}
