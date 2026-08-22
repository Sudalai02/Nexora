import { icon } from "../dom.js";
import { secondsToClock } from "../utils/dates.js";
import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as focusService from "../services/focusService.js";
import * as taskService from "../services/taskService.js";
import { getSettings } from "../services/settingsService.js";

// ---- module-level timer state (survives page navigation) ----
const T = {
  phase: "idle", // idle | focus | break
  breakKind: null, // short | long
  running: false,
  secondsLeft: 0,
  totalSeconds: 0,
  taskId: null,
  taskTitle: "",
  plannedMinutes: 45,
  sessionsDone: 0, // consecutive focus completions since long break
  startedAt: null, // ISO of current focus session start
  handle: null,
};

const OUTCOMES = ["Completed", "Partial", "Distracted", "Blocked"];

function ringProgress() {
  if (!T.totalSeconds) return 0;
  return Math.round(((T.totalSeconds - T.secondsLeft) / T.totalSeconds) * 360);
}

  async function persistSession(outcomeLabel, note = "") {
    const focusedSeconds = T.totalSeconds - Math.max(0, T.secondsLeft);
    if (focusedSeconds < 5) return; // discard accidental ultra-short sessions
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

  function stopTimer() {
    if (T.handle) clearInterval(T.handle);
    T.handle = null;
    T.running = false;
  }

  function beginPhase(kind /* "focus" | "short" | "long" */, minutes) {
    stopTimer();
    T.phase = kind === "focus" ? "focus" : "break";
    T.breakKind = kind === "focus" ? null : kind;
    T.plannedMinutes = minutes;
    T.totalSeconds = minutes * 60;
    T.secondsLeft = minutes * 60;
    if (kind === "focus") {
      T.startedAt = new Date().toISOString();
      if (!T.taskTitle) T.taskTitle = tasks[0]?.title || "";
      if (!T.taskId && tasks[0]) T.taskId = tasks[0].id;
    }
  }

  async function completeFocus(auto = false) {
    stopTimer();
    let outcome = auto ? "Completed" : null;
    if (!auto) {
      const res = await openForm({
        title: "How did it go?",
        eyebrow: "Session review",
        values: { outcome: "Completed", note: "" },
        fields: [
          {
            name: "outcome", label: "Result",
            type: "select",
            options: OUTCOMES.map((o) => ({ value: o.toLowerCase(), label: o })),
          },
          { name: "note", label: "Note (optional)", placeholder: "What happened?" },
        ],
        submitLabel: "Save session",
      });
      if (!res) {
        // treat cancel as partial-save anyway so time isn't lost silently
        await persistSession("Partial");
      } else {
        outcome = res.outcome;
        await persistSession(res.outcome, res.note);
      }
    } else {
      await persistSession(outcome);
    }

    T.sessionsDone += 1;
    if (T.taskId) {
      // mark In Progress if still open
      const t = tasks.find((x) => x.id === T.taskId);
      if (t && t.status === "Todo") {
        await taskService.updateTask(T.taskId, { status: "In Progress" });
      }
    }
    const kind = nextBreakKind(settings);
    beginPhase(kind, kind === "long" ? pomo.longBreakMinutes : pomo.shortBreakMinutes);
    draw();
  }

  async function abandon() {
    stopTimer();
    const ok = await confirmModal({
      title: "Abandon session?",
      message: "The minutes you focused will still be saved.",
      confirmLabel: "Abandon",
      danger: true,
    });
    if (!ok) {
      draw();
      resume();
      return;
    }
    await persistSession("Distracted");
    T.phase = "idle";
    draw();
  }

  function resume() {
    if (T.running || !T.secondsLeft) return;
    T.running = true;
    T.handle = setInterval(() => {
      T.secondsLeft -= 1;
      updateDisplay();
      if (T.secondsLeft <= 0) {
        if (T.phase === "focus") {
          completeFocus(true);
        } else {
          stopTimer();
          beginPhase("focus", pomo.focusMinutes);
          draw();
          resume();
          toast("Break over — back to work");
        }
      }
    }, 1000);
  }

  function updateDisplay() {
    const disp = view.querySelector("#timer-display");
    if (!disp) return;
    disp.textContent = secondsToClock(Math.max(0, T.secondsLeft));
    const ring = view.querySelector(".focus-ring");
    if (ring) ring.style.background = `conic-gradient(var(--${T.phase === "focus" ? "focus" : "good"}) ${ringProgress()}deg, var(--hairline) ${ringProgress()}deg 360deg)`;
  }

  // ---------------- RENDER ----------------
  async function draw() {
    const sessions = (await focusService.allSessions()).slice(0, 10);

    if (T.phase === "break") {
      view.innerHTML = `
        <div class="page-header" style="text-align:center;">
          <div class="eyebrow">Session ${T.sessionsDone} done</div>
          <h1>${T.breakKind === "long" ? "Long break" : "Short break"}</h1>
        </div>
        <div class="break-banner">
          <div class="focus-ring" style="margin-bottom: var(--sp-6);">
            <div style="position:relative; text-align:center;">
              <div class="focus-time num" id="timer-display">${secondsToClock(T.secondsLeft)}</div>
              <div class="focus-session-label">Recharge</div>
            </div>
          </div>
          <p style="font-size:13px;color:var(--graphite);margin-bottom:var(--sp-5);">
            Next up: ${T.taskTitle || "your next task"}
          </p>
          <div class="now-actions" style="justify-content:center;">
            <button class="btn btn-secondary" id="skip-break-btn">Skip break</button>
          </div>
        </div>
      `;
      wireTimerControls();
      view.querySelector("#skip-break-btn").addEventListener("click", () => {
        stopTimer();
        beginPhase("focus", pomo.focusMinutes);
        draw();
        resume();
      });
      return;
    }

    if (T.phase === "idle") {
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
              <div class="focus-time num" id="timer-display">45:00</div>
              <div class="focus-session-label">Ready</div>
            </div>
          </div>

          <div class="now-actions" style="justify-content:center; margin-bottom: var(--sp-8);">
            <button class="btn btn-secondary btn-sm" id="pick-task-btn">${icon("tasks")} Choose task</button>
          </div>

          <div class="eyebrow" style="margin-bottom:12px;">Duration</div>
          <div class="focus-dur-row" id="dur-row">
            <button class="dur-chip" data-min="25">25m</button>
            <button class="dur-chip active" data-min="${pomo.focusMinutes}">${pomo.focusMinutes}m</button>
            <button class="dur-chip" data-min="60">60m</button>
            <button class="dur-chip" data-min="90">Deep (90m)</button>
            <input type="number" min="5" max="180" step="5" class="custom-dur-input" placeholder="min" aria-label="Custom minutes" />
          </div>

          <section class="focus-history">
            <div class="section-head"><h3>Recent sessions</h3></div>
            ${sessions.length
              ? sessions.map(sessionRow).join("")
              : `<div class="empty-state" style="padding:var(--sp-6);"><h3>No sessions yet</h3><p>Pick a duration and press start.</p></div>`}
          </section>
        </div>
      `;
      wireIdle();
      return;
    }

    // phase === focus (running or paused mid-session)
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
            <div class="focus-time num" id="timer-display">${secondsToClock(Math.max(0, T.secondsLeft))}</div>
            <div class="focus-session-label">Pomodoro · ${T.plannedMinutes}m</div>
          </div>
        </div>

        <div class="focus-controls">
          <button class="btn btn-secondary" id="abandon-btn">Abandon</button>
          <button class="focus-btn-main" id="toggle-btn">${icon(T.running ? "pause" : "play")}</button>
          <button class="btn btn-primary" id="complete-btn">Complete</button>
        </div>
        <p style="font-size:11.5px;color:var(--graphite-dim);">The timer keeps running while you visit other pages.</p>
      </div>
    `;
    wireTimerControls();
    view.querySelector("#complete-btn").addEventListener("click", () => completeFocus(false));
    view.querySelector("#abandon-btn").addEventListener("click", abandon);
    updateDisplay();
  }

  function sessionRow(s) {
    const d = new Date(s.startedAt);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `
      <div class="session-row">
        <span class="session-date">${dateStr}</span>
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

    // main start button injected under ring
    const startRow = document.createElement("div");
    startRow.className = "focus-controls";
    startRow.innerHTML = `<button class="focus-btn-main" id="start-btn">${icon("play")}</button>`;
    view.querySelector(".focus-ring").after(startRow);

    view.querySelector("#start-btn").addEventListener("click", () => {
      beginPhase("focus", Math.round(idleSeconds / 60));
      draw();
      resume();
    });

    view.querySelector("#pick-task-btn").addEventListener("click", pickTask);

    view.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => {
        focusService.removeSession(btn.dataset.del).then(() => {
          toast("Session removed");
          draw();
        });
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
          name: "taskId", label: "Open tasks (sorted by priority)",
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
    view.querySelector("#task-title-display").textContent = T.taskTitle;
  }

  function wireTimerControls() {
    const toggleBtn = view.querySelector("#toggle-btn");
    toggleBtn?.addEventListener("click", () => {
      if (T.running) {
        stopTimer();
        toggleBtn.innerHTML = icon("play");
      } else {
        resume();
        toggleBtn.innerHTML = icon("pause");
      }
    });
  }

  // If a timer is running when the page opens again, keep it ticking visually.
  if (T.running) {
    // restart the interval bound to this fresh DOM
    stopTimer();
    resume();
  }

  draw();
}
