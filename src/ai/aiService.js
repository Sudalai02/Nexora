// ============================================================
// AI SERVICE — provider abstraction for TaskTrack's intelligence.
//
// Two engines behind one API:
//   • "ollama"    — a local model via Ollama (free, private)
//   • "heuristic" — built-in rules (always available fallback)
//
// Every high-level call resolves with useful output even when
// no model is running: callers never need to handle failure.
// ============================================================

import { getSettings, DEFAULT_SETTINGS } from "../services/settingsService.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import * as habitsSvc from "../services/habitService.js";
import * as focusSvc from "../services/focusService.js";
import { todayISO, addDays, diffDays } from "../utils/dates.js";

const PROBE_TTL_MS = 30_000;
let probeCache = { at: 0, url: null, result: null };
let probeInflight = null; // dedupe concurrent probes across page renders

// ---------- low-level plumbing ----------

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error("timeout"));
    }, ms);
    promise(ctrl.signal)
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function fetchJSON(url, opts = {}, timeoutMs = 4000) {
  return withTimeout(
    (signal) => fetch(url, { ...opts, signal }),
    timeoutMs
  );
}

export async function probe(url, fresh = false) {
  const now = Date.now();
  if (!fresh && probeCache.result && probeCache.url === url && now - probeCache.at < PROBE_TTL_MS) {
    return probeCache.result;
  }
  if (probeInflight) return probeInflight;

  probeInflight = (async () => {
    let result;
    try {
      const res = await fetchJSON(`${url.replace(/\/$/, "")}/api/tags`, {}, 2500);
      const data = await res.json();
      result = { available: true, models: (data.models || []).map((m) => m.name) };
    } catch {
      result = { available: false, models: [] };
    }
    probeCache = { at: Date.now(), url, result };
    return result;
  })().finally(() => {
    probeInflight = null;
  });

  return probeInflight;
}

export async function getEngine() {
  const settings = await getSettings();
  const ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) };
  if (ai.provider === "heuristic") return { engine: "heuristic" };
  const p = await probe(ai.ollamaUrl);
  if (!p.available || !p.models.length) return { engine: "heuristic", offline: true };
  const model = ai.model && p.models.includes(ai.model) ? ai.model : p.models[0];
  return { engine: "ollama", url: ai.ollamaUrl.replace(/\/$/, ""), model };
}

export async function engineLabel() {
  const e = await getEngine();
  return e.engine === "ollama" ? `Local AI · ${e.model.split(":")[0]}` : "Smart rules";
}

async function ollamaChat(engine, messages, opts = {}) {
  const res = await fetchJSON(
    `${engine.url}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: engine.model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.4 },
      }),
    },
    opts.timeoutMs ?? 90_000
  );
  const data = await res.json();
  return data?.message?.content?.trim() || "";
}

function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
const strList = (x, cap = 12) =>
  arr(x)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, cap);

// ---------- shared live-data context ----------

export async function buildContextSummary() {
  const today = todayISO();
  const [tasks, projects, goals, habitList, sessions] = await Promise.all([
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    habitsSvc.allHabits(),
    focusSvc.allSessions(),
  ]);
  const open = taskService.decorate(
    tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status))
  );
  open.sort((a, b) => b._score - a._score);
  const prog = projectService.progressMap(projects, tasks);
  const weekAgo = addDays(today, -6);
  const focusWeekMin = sessions
    .filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) >= weekAgo)
    .reduce((a, s) => a + Math.round((s.durationSeconds || 0) / 60), 0);
  const gProg = await goalService.progressMap(goals, projects, tasks);

  return {
    today,
    openCount: open.length,
    topTasks: open.slice(0, 8).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.dueDate,
      est: t.estimatedMinutes,
      score: t._score,
      project: projects.find((p) => p.id === t.projectId)?.name || null,
    })),
    overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
    projects: projects
      .filter((p) => !["Completed", "Cancelled"].includes(p.status))
      .map((p) => ({ name: p.name, status: p.status, pct: prog[p.id]?.pct ?? null })),
    goals: goals
      .filter((g) => g.status !== "Completed")
      .map((g) => ({ title: g.title, pct: gProg[g.id]?.pct ?? 0, target: g.targetDate })),
    habits: habitList.map((h) => ({
      title: h.title,
      weekdays: h.weekdays,
      timeOfDay: h.timeOfDay,
    })),
    focusMinutesThisWeek: focusWeekMin,
  };
}

function ctxToPrompt(ctx) {
  return [
    `Today is ${ctx.today}.`,
    `Open tasks: ${ctx.openCount}${ctx.overdue ? ` (${ctx.overdue} overdue)` : ""}.`,
    ctx.topTasks.length
      ? `Top tasks by priority score:\n${ctx.topTasks
          .map(
            (t) =>
              `- [${t.id}] ${t.title} | ${t.priority}${t.due ? ` | due ${t.due}` : ""} | ~${t.est}min${t.project ? ` | project: ${t.project}` : ""}`
          )
          .join("\n")}`
      : "No open tasks.",
    ctx.projects.length
      ? `Active projects:\n${ctx.projects.map((p) => `- ${p.name} (${p.status}${p.pct !== null ? `, ${p.pct}%` : ""})`).join("\n")}`
      : "",
    ctx.goals.length
      ? `Goals:\n${ctx.goals.map((g) => `- ${g.title} (${g.pct}%${g.target ? `, target ${g.target}` : ""})`).join("\n")}`
      : "",
    `Focus time last 7 days: ${ctx.focusMinutesThisWeek} min.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ============================================================
// HIGH-LEVEL OPERATIONS
// ============================================================

// ----- What should I do now -----
export async function recommendNextAction() {
  const ranked = taskService.decorate(
    (await taskService.allTasks()).filter((t) => !["Completed", "Cancelled"].includes(t.status))
  );
  ranked.sort((a, b) => b._score - a._score);
  const ctx = await buildContextSummary();

  try {
    const engine = await getEngine();
    if (engine.engine === "ollama" && ranked.length) {
      const reply = await ollamaChat(
        engine,
        [
          {
            role: "system",
            content:
              "You are TaskTrack's planning engine. Pick the single best task for the user to do RIGHT NOW given deadlines, priorities, effort and momentum. Reply ONLY with JSON: {\"taskId\": \"<id from list>\", \"reason\": \"one short sentence\"}",
          },
          { role: "user", content: ctxToPrompt(ctx) },
        ],
        { timeoutMs: 45_000 }
      );
      const parsed = extractJSON(reply);
      const task = ranked.find((t) => t.id === parsed?.taskId);
      if (task) {
        return {
          task,
          reasons: [parsed.reason || "Best balance of urgency, impact and effort right now."],
          engine: "ollama",
        };
      }
    }
  } catch {
    /* fall through to heuristics */
  }

  // Heuristic fallback
  if (!ranked.length) return { task: null, reasons: [], engine: "heuristic" };
  const { reasonsFor } = await import("./prioritizer.js");
  const projects = await projectService.allProjects();
  const task = ranked[0];
  const pname = projects.find((p) => p.id === task.projectId)?.name || null;
  return { task, reasons: reasonsFor(task, pname), engine: "heuristic" };
}

// ----- Goal breakdown (goal → milestones + first tasks) -----
export async function breakDownGoal({ title, description = "", targetDate = "" }) {
  const today = todayISO();
  const horizon = targetDate ? Math.max(7, diffDays(today, targetDate)) : 30;

  const heuristicPlan = () => ({
    milestones: [
      { label: "Clarify scope & success criteria", tasks: [`Write a one-page brief for “${title}”`, "List what “done” looks like"] },
      { label: "Set up the foundation", tasks: ["Gather tools/materials needed", "Block recurring work sessions on the calendar"] },
      { label: `First visible push (week 1–2)`, tasks: ["Complete the smallest end-to-end version", "Review progress and adjust plan"] },
      { label: `Momentum phase (week 3+)`, tasks: ["Execute the core work in focused blocks", "Weekly review against the target date"] },
      { label: "Finish & lock it in", tasks: ["Final quality pass", "Reflect: document lessons learned"] },
    ],
  });

  try {
    const engine = await getEngine();
    if (engine.engine === "ollama") {
      const reply = await ollamaChat(
        engine,
        [
          {
            role: "system",
            content:
              'You are TaskTrack\'s goal planner. Break the user\'s goal into 3-5 sequential milestones. For each milestone give 2-3 concrete first-batch tasks. Reply ONLY with JSON: {"milestones":[{"label":"Milestone name","tasks":["Task one","Task two"]}]}',
          },
          {
            role: "user",
            content: `Goal: ${title}\nWhy it matters: ${description || "—"}\nToday: ${today}\nTarget date: ${targetDate || `about ${horizon} days out`}\nHorizon: ${horizon} days.`,
          },
        ],
        { timeoutMs: 60_000 }
      );
      const parsed = extractJSON(reply);
      const ms = arr(parsed?.milestones)
        .map((m) => ({
          label: String(m?.label || "").slice(0, 80),
          tasks: strList(m?.tasks, 4),
        }))
        .filter((m) => m.label && m.tasks.length);
      if (ms.length >= 2) return { milestones: ms, engine: "ollama" };
    }
  } catch {
    /* fall through */
  }
  return { ...heuristicPlan(), engine: "heuristic" };
}

// ----- Note summarization -----
export async function summarizeNote(title, body) {
  try {
    const engine = await getEngine();
    if (engine.engine === "ollama") {
      const reply = await ollamaChat(
        engine,
        [
          {
            role: "system",
            content:
              "Summarize the note in 2-3 crisp sentences, preserving any commitments, numbers or dates. Plain text only.",
          },
          { role: "user", content: `Title: ${title || "Untitled"}\n\n${body.slice(0, 6000)}` },
        ],
        { timeoutMs: 60_000 }
      );
      if (reply) return { text: reply, engine: "ollama" };
    }
  } catch {
    /* fall through */
  }
  // Heuristic: leading sentences + any lines containing dates/amounts
  const sentences = body.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(Boolean);
  const keyLines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\d/.test(l) && l.length > 8)
    .slice(0, 2);
  const lead = sentences.slice(0, 2).join(" ");
  const text = [lead, ...keyLines].filter(Boolean).join("\n");
  return { text: text.slice(0, 500) || "Nothing substantial to summarize yet.", engine: "heuristic" };
}

// ----- Extract actionable tasks from note text -----
export async function extractTasksFromNote(body) {
  try {
    const engine = await getEngine();
    if (engine.engine === "ollama") {
      const reply = await ollamaChat(
        engine,
        [
          {
            role: "system",
            content:
              'Extract concrete, actionable tasks implied by this note. Short imperative phrasing ("Call the dentist"). Reply ONLY with JSON: {"tasks":["...","..."]}. Empty array if none.',
          },
          { role: "user", content: body.slice(0, 6000) },
        ],
        { timeoutMs: 60_000 }
      );
      const parsed = extractJSON(reply);
      const tasks = strList(parsed?.tasks, 10);
      if (tasks.length) return { tasks, engine: "ollama" };
      return { tasks: [], engine: "ollama" };
    }
  } catch {
    /* fall through */
  }
  const lines = body.split("\n").map((l) => l.trim());
  const picked = lines
    .filter((l) => /^([-*•]|\d+[.)]|\[\s?\]\s?)/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)]|\[\s?\]\s?)\s*/, "").replace(/\[x\]\s*/i, ""))
    .filter((l) => l.length > 3 && l.length < 120)
    .slice(0, 10);
  return { tasks: picked, engine: "heuristic" };
}

// ----- Conversational assistant -----
// Returns a string, or throws NO_MODEL so the caller can use its
// own heuristic responder.
export async function chatReply(history, userText) {
  const engine = await getEngine();
  if (engine.engine !== "ollama") throw new Error("NO_MODEL");
  const ctx = await buildContextSummary();
  const msgs = [
    {
      role: "system",
      content:
        "You are TaskTrack, a calm, sharp productivity copilot embedded in the user's personal OS. You KNOW their live data (given below). Be concise and concrete — reference real task/project/goal names. Use markdown bold sparingly. Never invent tasks that are not in the data. If asked to change something, describe exactly what you would change.\n\n--- LIVE USER DATA ---\n" +
        ctxToPrompt(ctx),
    },
    ...history.slice(-8).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text })),
    { role: "user", content: userText },
  ];
  const reply = await ollamaChat(engine, msgs, { temperature: 0.5 });
  if (!reply) throw new Error("EMPTY");
  return reply;
}
