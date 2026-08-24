// ============================================================
// AI ASSISTANT
//
// A prompt library of 20 default questions, every one answered
// dynamically from live data — never canned text. When a local
// Ollama model is available it handles conversation with full
// context; otherwise the rule-based engine below computes honest,
// data-grounded answers (same numbers as Insights).
// ============================================================

import { icon } from "../dom.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import * as habitsSvc from "../services/habitService.js";
import * as eventService from "../services/eventService.js";
import * as focusSvc from "../services/focusService.js";
import * as analyticsSvc from "../services/analyticsService.js";
import { getProfile } from "../services/settingsService.js";
import * as aiService from "../ai/aiService.js";
import { reasonsFor } from "../ai/prioritizer.js";
import { runGoalPlanner } from "../ui/goalPlanner.js";
import {
  todayISO,
  addDays,
  diffDays,
  weekdayOf,
  fmtHour,
  minutesToHuman,
} from "../utils/dates.js";
import * as db from "../store/db.js";

// ---------- the 20 default prompts ----------
const PROMPTS = [
  "What should I focus on right now?",
  "Plan my day",
  "Plan my week",
  "What's due today?",
  "Preview tomorrow",
  "What's overdue?",
  "Quick wins under 20 minutes",
  "Estimate my remaining workload",
  "How are my projects going?",
  "Which project needs attention?",
  "How are my goals tracking?",
  "Are any goals at risk?",
  "Show blocked tasks",
  "Which tasks have no project?",
  "What habits did I miss this week?",
  "How consistent are my habits?",
  "How much have I focused lately?",
  "When am I most productive?",
  "Where is my time going?",
  "Recap my week",
];

let messages = null; // lazy init so the seed reflects live data

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function loadCore() {
  const [tasks, projects, goals, profile] = await Promise.all([
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    getProfile(),
  ]);
  return {
    tasks,
    projects,
    goals,
    profile,
    name: profile?.name?.split(" ")[0] || "there",
    open: taskService
      .decorate(tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status)))
      .sort((a, b) => b._score - a._score),
    prog: projectService.progressMap(projects, tasks),
  };
}

function bullets(list) {
  return list.map((l) => `• ${l}`).join("\n");
}

// ============================================================
// DYNAMIC RESPONDERS — each computes its answer from live data
// ============================================================

const responders = [
  // 1 — what should I focus on right now?
  {
    match: (t) => t.includes("focus") || t.includes("right now") || t.includes("should i do"),
    fn: async () => {
      const { open, name, projects } = await loadCore();
      if (!open.length) return `${name}, your task list is clear. Capture something new or enjoy the whitespace.`;
      const top = open[0];
      const pname = projects.find((p) => p.id === top.projectId)?.name || null;
      const rs = reasonsFor(top, pname);
      return [
        `Start with **${top.title}** — ${top.priority} priority, ~${top.estimatedMinutes} min${top.dueDate ? `, due ${top.dueDate}` : ""}. Priority score ${top._score}/100.`,
        "",
        "Why this one:",
        bullets(rs.slice(0, 3)),
        "",
        open[1] ? `Runner-up: ${open[1].title}.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  // 2 — plan my day
  {
    match: (t) => t.includes("plan my day") || (t.includes("plan") && t.includes("day")),
    fn: async () => {
      const today = todayISO();
      const [{ open }, events, habitList, logsToday] = await Promise.all([
        loadCore(),
        eventService.eventsInRange(today, today),
        habitsSvc.allHabits(),
        db.getAll("habitLogs"),
      ]);
      const doneHabitIds = new Set(logsToday.filter((l) => l.done && l.date === today).map((l) => l.habitId));
      const timedTasks = open.filter((x) => x.dueDate === today && x.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const untimed = open.filter((x) => x.dueDate === today && !x.startTime).slice(0, 4);
      const habitsToday = habitList.filter((h) => !h.archived && habitsSvc.scheduledOn(h, today) && !doneHabitIds.has(h.id));

      const morning = [];
      const afternoon = [];
      for (const e of events) (e.startHour < 12 ? morning : afternoon).push(`${fmtHour(e.startHour)} ${e.title}`);
      for (const x of timedTasks) (Number(x.startTime.split(":")[0]) < 12 ? morning : afternoon).push(`${fmtHour(Number(x.startTime.split(":")[0]))} ${x.title}`);
      for (const x of untimed) afternoon.push(x.title);
      for (const h of habitsToday) morning.push(`${h.timeOfDay} · ${h.title}`);

      if (!morning.length && !afternoon.length)
        return "Nothing is due today and no habits are pending. Perfect day for the highest-scored backlog item: **" + ((await loadCore()).open[0]?.title ?? "—") + "**.";

      return [
        `Here's today shaped into blocks:`,
        "",
        "**Morning**",
        bullets(morning.length ? morning : ["Free — good slot for deep work"]),
        "",
        "**Afternoon**",
        bullets(afternoon.length ? afternoon : ["Open — batch small tasks here"]),
      ].join("\n");
    },
  },

  // 3 — plan my week
  {
    match: (t) => t.includes("week") && !t.includes("recap") && !t.includes("missed"),
    fn: async () => {
      const { open } = await loadCore();
      if (!open.length) return "No open tasks to plan — your week is a blank page.";
      const today = todayISO();
      const perDayCap = 3;
      let idx = 0;
      const lines = [];
      let planned = 0;
      for (let d = 0; d < 10 && planned < Math.min(open.length, 15); d++) {
        const iso = addDays(today, d);
        const wd = weekdayOf(iso);
        if (wd === 0 || wd === 6) continue;
        const slice = open.slice(idx, idx + perDayCap);
        idx += perDayCap;
        planned += slice.length;
        lines.push(`**${WD[wd]} (${iso.slice(5)})** — ${slice.map((s) => s.title).join(", ") || "light day"}`);
      }
      const rest = open.length - planned;
      return [
        "Draft distribution, priority-first:",
        "",
        ...lines,
        rest > 0 ? `\nPlus ${rest} more queued — pull them in as days free up.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  // 4 — due today
  {
    match: (t) => t.includes("due today") || t.includes("today's tasks") || t.includes("whats due"),
    fn: async () => {
      const today = todayISO();
      const [{ tasks }, events] = await Promise.all([loadCore(), eventService.eventsInRange(today, today)]);
      const due = tasks.filter((x) => x.dueDate === today);
      const openDue = due.filter((x) => !["Completed", "Cancelled"].includes(x.status));
      if (!openDue.length && !events.length)
        return due.length
          ? `Everything due today is already done (${due.length} task${due.length === 1 ? "" : "s"} ✓). Clean slate.`
          : "Nothing due today and no events. Pull something forward from the backlog?";
      const todayLines = [
        ...events.map((e) => `${e.title} · ${fmtHour(e.startHour)}`),
        ...openDue.map((x) => `${x.title}${x.startTime ? ` · ${x.startTime}` : ""} · ${x.priority}`),
      ];
      return [
        `**Due today:**`,
        bullets(todayLines.length ? todayLines : ["Nothing open"]),
        due.some((x) => x.status === "Completed") ? `\n✓ ${due.filter((x) => x.status === "Completed").length} already completed today.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  // 5 — preview tomorrow
  {
    match: (t) => t.includes("tomorrow"),
    fn: async () => {
      const tmr = addDays(todayISO(), 1);
      const [{ tasks }, events, habitList] = await Promise.all([
        loadCore(),
        eventService.eventsInRange(tmr, tmr),
        habitsSvc.allHabits(),
      ]);
      const dueTmr = tasks.filter((x) => x.dueDate === tmr && !["Completed", "Cancelled"].includes(x.status));
      const habitsTmr = habitList.filter((h) => !h.archived && habitsSvc.scheduledOn(h, tmr));
      if (!dueTmr.length && !events.length && !habitsTmr.length) return "Tomorrow looks wide open — a good day to schedule deep work.";
      return [
        "**Tomorrow:**",
        bullets([
          ...events.map((e) => `${e.title} · ${fmtHour(e.startHour)}`),
          ...dueTmr.map((x) => `${x.title} · ${x.priority}`),
          ...habitsTmr.map((h) => `${h.timeOfDay} · ${h.title}`),
        ]),
      ].join("\n");
    },
  },

  // 6 — overdue
  {
    match: (t) => t.includes("overdue") || t.includes("late"),
    fn: async () => {
      const { open } = await loadCore();
      const today = todayISO();
      const od = open.filter((x) => x.dueDate && x.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      if (!od.length) return "Nothing overdue — you're running clean.";
      return [`**${od.length} overdue task${od.length === 1 ? "" : "s"}:**`, bullets(od.map((x) => `${x.title} — ${diffDays(x.dueDate, today)}d late · ${x.priority}`)), "", "Suggestion: reschedule or shrink the oldest two today."].join("\n");
    },
  },

  // 7 — quick wins
  {
    match: (t) => t.includes("quick win"),
    fn: async () => {
      const { open } = await loadCore();
      const wins = open.filter((x) => (x.estimatedMinutes || 0) <= 20).slice(0, 5);
      if (!wins.length) return "No short tasks left — everything open needs 20+ minutes. That's a deep-work kind of day.";
      return [`Knock these out back-to-back:`, bullets(wins.map((x) => `${x.title} · ${x.estimatedMinutes}m`)), "", `Total: ${minutesToHuman(wins.reduce((a, x) => a + (x.estimatedMinutes || 0), 0))} — clears real mental space.`].join("\n");
    },
  },

  // 8 — workload estimate
  {
    match: (t) => t.includes("workload") || t.includes("how much") || t.includes("remaining work"),
    fn: async () => {
      const { open } = await loadCore();
      if (!open.length) return "Zero open tasks — workload fully drained.";
      const mins = open.reduce((a, x) => a + (x.estimatedMinutes || 0), 0);
      const days = Math.ceil(mins / (4 * 60)); // 4 focused hours/day
      const urgent = open.filter((x) => x.priority === "Urgent").length;
      return `**${open.length} open tasks ≈ ${minutesToHuman(mins)}** of estimated work. At a sustainable 4 focused hours a day that's about **${days} working day${days === 1 ? "" : "s"}**.${urgent ? ` ${urgent} are marked Urgent — front-load those.` : ""}`;
    },
  },

  // 9 — projects status
  {
    match: (t) => t.includes("project") && !t.includes("attention"),
    fn: async () => {
      const { projects, prog, tasks } = await loadCore();
      const active = projects.filter((p) => !["Completed", "Cancelled"].includes(p.status));
      if (!active.length) return "No active projects right now.";
      return [
        "**Project status:**",
        bullets(
          active.map((p) => {
            const m = prog[p.id];
            return `${p.name} — ${m.pct === null ? "no tasks yet" : `${m.pct}% (${m.done}/${m.total})`}${p.deadline ? ` · due ${p.deadline}` : ""}`;
          })
        ),
      ].join("\n");
    },
  },

  // 10 — which project needs attention
  {
    match: (t) => t.includes("attention") || t.includes("stuck") || t.includes("slipping"),
    fn: async () => {
      const { projects, prog } = await loadCore();
      const today = todayISO();
      const candidates = projects
        .filter((p) => ["Active", "On Hold", "Planning"].includes(p.status))
        .map((p) => {
          const m = prog[p.id];
          const dl = p.deadline ? diffDays(today, p.deadline) : Infinity;
          const risk = (dl !== Infinity ? Math.max(0, 50 - dl) : 0) + (100 - (m.pct ?? 60)) - (m.done ? m.pct : 40);
          return { p, m, dl, risk };
        })
        .sort((a, b) => b.risk - a.risk);
      if (!candidates.length) return "No active projects to worry about.";
      const c = candidates[0];
      return `**${c.p.name}** needs the most attention — ${c.m.pct === null ? "it has no tasks yet" : `${c.m.pct}% done (${c.m.done}/${c.m.total})`}${c.p.deadline ? ` with the deadline ${c.dl >= 0 ? `${c.dl} days out` : `${Math.abs(c.dl)} days past`}` : " and no deadline set"}. Break its next step into a task today.`;
    },
  },

  // 11 — goals tracking
  {
    match: (t) => (t.includes("goal") && (t.includes("track") || t.includes("going"))) || t === "goals",
    fn: async () => {
      const { goals, projects, tasks } = await loadCore();
      const gProg = await goalService.progressMap(goals, projects, tasks);
      const active = goals.filter((g) => g.status !== "Completed");
      if (!active.length) return "No open goals — set one and I'll break it into milestones.";
      return [
        "**Goal progress:**",
        bullets(active.map((g) => `${g.title} — ${gProg[g.id]?.pct ?? 0}%${g.targetDate ? ` · target ${g.targetDate}` : ""}`)),
      ].join("\n");
    },
  },

  // 12 — goals at risk
  {
    match: (t) => t.includes("risk") || (t.includes("goal") && t.includes("behind")),
    fn: async () => {
      const { goals, projects, tasks } = await loadCore();
      const gProg = await goalService.progressMap(goals, projects, tasks);
      const today = todayISO();
      const risky = goals
        .filter((g) => g.targetDate && g.status !== "Completed")
        .map((g) => ({ g, d: diffDays(today, g.targetDate), pct: gProg[g.id]?.pct ?? 0 }))
        .filter((x) => x.d <= 14 && x.pct < 60)
        .sort((a, b) => a.d - b.d);
      if (!risky.length) return "No goals are close to their target with low progress. Steady ship.";
      return [
        "**Goals that could slip:**",
        bullets(risky.map((x) => `${x.g.title} — ${x.d >= 0 ? `${x.d}d to target` : `${Math.abs(x.d)}d overdue`} but only ${x.pct}% done`)),
        "",
        "Pick the closest one and complete its smallest milestone task this week.",
      ].join("\n");
    },
  },

  // 13 — blocked tasks
  {
    match: (t) => t.includes("block"),
    fn: async () => {
      const { tasks } = await loadCore();
      const blocked = tasks.filter((x) => x.status === "Blocked");
      if (!blocked.length) return "No blocked tasks — nothing is waiting on anyone.";
      return [`**Blocked (${blocked.length}):**`, bullets(blocked.map((x) => `${x.title}${x.projectId ? "" : ""}`)), "", "Unblock or park these so they stop draining attention."].join("\n");
    },
  },

  // 14 — tasks without project
  {
    match: (t) => t.includes("no project") || t.includes("unfiled") || t.includes("standalone"),
    fn: async () => {
      const { open } = await loadCore();
      const orphans = open.filter((x) => !x.projectId);
      if (!orphans.length) return "Every open task belongs to a project. Tidy.";
      return [`**${orphans.length} task${orphans.length === 1 ? "" : "s"} without a project:**`, bullets(orphans.slice(0, 6).map((x) => x.title)), orphans.length > 6 ? `…and ${orphans.length - 6} more.` : "", "", "File them under a project (or leave them as standalone work)."].join("\n");
    },
  },

  // 15 — habits missed this week
  {
    match: (t) => t.includes("habit") && (t.includes("miss") || t.includes("skip")),
    fn: async () => {
      const today = todayISO();
      const [habitList, logs] = await Promise.all([habitsSvc.allHabits(), db.getAll("habitLogs")]);
      const active = habitList.filter((h) => !h.archived);
      const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
      const report = [];
      for (const h of active) {
        let sched = 0;
        let done = 0;
        for (let d = 1; d <= 7; d++) {
          const iso = addDays(today, -d);
          if (!habitsSvc.scheduledOn(h, iso)) continue;
          sched++;
          if (doneSet.has(`${h.id}:${iso}`)) done++;
        }
        if (sched - done > 0) report.push(`${h.title} — missed ${sched - done} of ${sched}`);
      }
      return report.length
        ? [`**This week's gaps:**`, bullets(report)].join("\n")
        : "Full attendance this week across every habit. Impressive discipline.";
    },
  },

  // 16 — habit consistency
  {
    match: (t) => t.includes("habit") && (t.includes("consistent") || t.includes("consistency")),
    fn: async () => {
      const rows = await analyticsSvc.habitConsistency(30);
      if (!rows.length) return "No scheduled habits yet — create one on the Goals page.";
      return [
        "**Consistency over the last 30 days:**",
        bullets(rows.map((r) => `${r.habit.title} — ${r.pct}% (${r.done}/${r.scheduled} scheduled days)`)),
      ].join("\n");
    },
  },

  // 17 — focus time lately
  {
    match: (t) => t.includes("focused") || t.includes("focus time") || t.includes("pomodor"),
    fn: async () => {
      const s = await analyticsSvc.rangeStats(7);
      const deep = s.focusMinutes ? Math.round((s.deepMinutes / s.focusMinutes) * 100) : 0;
      if (!s.sessionCount) return "No focus sessions in the last 7 days. Start a 25-minute timer on the Focus page — momentum follows motion.";
      return `Last 7 days: **${minutesToHuman(s.focusMinutes)}** across **${s.sessionCount} sessions**, ${deep}% of it in deep 45m+ blocks.${deep < 40 ? " Try merging short bursts into one long block." : " Strong ratio."}`;
    },
  },

  // 18 — productive hours
  {
    match: (t) => t.includes("productive") || t.includes("best hour") || t.includes("peak"),
    fn: async () => {
      const s = await analyticsSvc.rangeStats(30);
      const win = analyticsSvc.bestWindow(s.hourBuckets);
      const wh = (h) => `${((h + 11) % 12) + 1}${h >= 12 ? "PM" : "AM"}`;
      if (win.totalMinutes <= 60) return "Not enough session data yet — run a few focus timers and I'll map your peak hours.";
      return `Your strongest window is **${wh(win.startHour)}–${wh(win.startHour + 3)}**: ${minutesToHuman(win.totalMinutes)} of focus landed there over the past month. Guard it for hard tasks; push meetings elsewhere.`;
    },
  },

  // 19 — where is time going
  {
    match: (t) => t.includes("time going") || t.includes("time sink") || t.includes("where does my time"),
    fn: async () => {
      const { open } = await loadCore();
      const s = await analyticsSvc.rangeStats(7);
      const heavy = [...open].sort((a, b) => (b.estimatedMinutes || 0) - (a.estimatedMinutes || 0)).slice(0, 3);
      const heavySum = heavy.reduce((a, x) => a + (x.estimatedMinutes || 0), 0);
      return [
        "**Where your time is pointed:**",
        `• Focus logged (7d): ${minutesToHuman(s.focusMinutes)}`,
        `• Remaining estimates: ${minutesToHuman(open.reduce((a, x) => a + (x.estimatedMinutes || 0), 0))} of open work`,
        `• Biggest commitments: ${heavy.map((x) => `${x.title} (${x.estimatedMinutes}m)`).join(", ") || "—"}`,
        heavySum ? `\nThose three alone are ${minutesToHuman(heavySum)} — protect them with calendar blocks.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  // 20 — weekly recap
  {
    match: (t) => t.includes("recap") || t.includes("review my week") || t.includes("summary of my week"),
    fn: async () => {
      const s = await analyticsSvc.rangeStats(7);
      const today = todayISO();
      const [logs, sessions] = await Promise.all([db.getAll("habitLogs"), focusSvc.allSessions()]);
      const habitDone7 = logs.filter((l) => l.done && l.date >= addDays(today, -6)).length;
      const sess7 = sessions.filter((x) => x.type === "focus" && x.startedAt.slice(0, 10) >= addDays(today, -6)).length;
      return [
        "**Your week in numbers:**",
        `• Tasks completed: ${s.tasksCompleted}`,
        `• Completion rate on due tasks: ${s.completionRate === null ? "—" : `${s.completionRate}%`}`,
        `• Focus: ${minutesToHuman(s.focusMinutes)} over ${sess7} sessions`,
        `• Habit checkmarks: ${habitDone7}`,
        "",
        s.tasksCompleted >= 10 ? "High-output week — recover well." : "Solid base; one extra deep block next week moves the needle.",
      ].join("\n");
    },
  },
];

// Router: try local model first (full conversation), else dynamic rules.
async function respond(userText) {
  const t = userText.toLowerCase();
  for (const r of responders) {
    if (r.match(t)) {
      try {
        return await r.fn(t);
      } catch (err) {
        console.error("[assistant] responder failed", err);
        break;
      }
    }
  }
  const { name } = await loadCore();
  return `I can analyze tasks, projects, goals, habits, focus time, and planning — try a prompt below, ${name}. For free-form chat, connect a local model in Settings → AI provider.`;
}

export async function renderAssistant(view, alive = () => true) {
  if (!messages) {
    const profile = await getProfile();
    const name = profile?.name?.split(" ")[0] || "there";
    messages = [{ role: "ai", text: `Hi ${name}. I read your live tasks, projects, goals, habits and focus history — ask me anything below.` }];
  }

  function bubble(msg, typing = false) {
    const isAi = msg.role === "ai";
    const text = String(msg.text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\n/g, "<br/>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (typing) {
      return `
        <div class="chat-msg ai" id="chat-typing">
          <div class="chat-avatar ai">${icon("spark")}</div>
          <div class="chat-bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div>
        </div>`;
    }
    return `
      <div class="chat-msg ${isAi ? "ai" : "user"}">
        <div class="chat-avatar ${isAi ? "ai" : "user"}">${isAi ? icon("spark") : "Y"}</div>
        <div class="chat-bubble">${text}</div>
      </div>
    `;
  }

  function draw(typing = false) {
    view.innerHTML = `
      <div class="page-header">
        <div class="eyebrow">AI Assistant · <span id="engine-label">checking…</span></div>
        <h1>Ask anything about your work</h1>
        <div class="sub">Every answer is grounded in your live data.</div>
      </div>

      <div class="chat-shell">
        <details class="prompt-library" id="prompt-library">
          <summary>${icon("spark")} Prompt library · search &amp; pick</summary>
          <div class="prompt-picker">
            <input type="text" id="prompt-search" placeholder="🔍 Type to filter prompts…" autocomplete="off" />
            <div id="prompt-list" class="prompt-list"></div>
          </div>
        </details>
        <div class="chat-scroll" id="chat-scroll">
          ${messages.map((m) => bubble(m)).join("")}
          ${typing ? bubble({ role: "ai" }, true) : ""}
        </div>
        <div class="chat-input-row">
          <input type="text" id="chat-input" placeholder="Message the assistant…" />
          <button class="btn btn-primary btn-sm" id="chat-send">Send</button>
        </div>
      </div>
    `;

    document.getElementById("chat-scroll").scrollTop = document.getElementById("chat-scroll").scrollHeight;

    aiService.engineLabel().then((l) => {
      const el = document.getElementById("engine-label");
      if (el) el.textContent = l;
    });

    let busy = false;
    async function send(text) {
      if (!text.trim() || busy) return;
      busy = true;
      messages.push({ role: "user", text });
      draw(true);
      let reply;
      try {
        reply = await aiService.chatReply(messages.slice(-9), text);
      } catch {
        reply = await respond(text);
      }
      if (!alive()) return;
      messages.push({ role: "ai", text: reply });
      busy = false;
      draw();
    }

    document.getElementById("chat-send").addEventListener("click", () => {
      const input = document.getElementById("chat-input");
      send(input.value);
      input.value = "";
    });

    document.getElementById("chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        send(e.target.value);
        e.target.value = "";
      }
    });

    view.querySelectorAll("[data-suggest]").forEach((chip) => chip.addEventListener("click", () => send(chip.dataset.suggest)));

    // ---- Prompt library: dropdown + search filter, click fills the
    // ---- composer; the user presses Send themselves.
    const lib = view.querySelector("#prompt-library");
    const searchEl = view.querySelector("#prompt-search");
    const listEl = view.querySelector("#prompt-list");
    const input = view.querySelector("#chat-input");

    function renderPromptList() {
      const q = (searchEl?.value || "").toLowerCase().trim();
      // sort: startsWith matches first, then alphabetical
      const matches = PROMPTS
        .filter((p) => !q || p.toLowerCase().includes(q))
        .sort((a, b) => {
          const aw = a.toLowerCase().startsWith(q) ? 0 : 1;
          const bw = b.toLowerCase().startsWith(q) ? 0 : 1;
          return aw - bw || a.localeCompare(b);
        })
        .slice(0, 8);
      listEl.innerHTML = matches.length
        ? matches.map((p) => `<button type="button" class="prompt-option" data-prompt="${p.replace(/"/g, "&quot;")}">${p}</button>`).join("")
        : `<div class="prompt-empty">No prompts match “${q}” — just send your own question.</div>`;
      listEl.querySelectorAll("[data-prompt]").forEach((btn) =>
        btn.addEventListener("click", () => {
          input.value = btn.dataset.prompt;
          input.focus();
          lib.removeAttribute("open"); // collapse after picking
        })
      );
    }
    renderPromptList();
    searchEl.addEventListener("input", renderPromptList);

    view.querySelector("[data-plan-goal]")?.addEventListener("click", async () => {
      const created = await runGoalPlanner();
      if (created && alive()) window.location.hash = "#/goals";
    });
  }

  draw();
}
