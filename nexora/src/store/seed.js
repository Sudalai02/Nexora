// ============================================================
// SEED DATA — first-run demo dataset stored in IndexedDB.
// Dates are generated relative to *today* so every screen
// (insights ranges, streaks, calendar week) feels alive.
// ============================================================

import { bulkPut, getMeta, setMeta } from "./db.js";
import { todayISO, addDays, weekdayOf } from "../utils/dates.js";
import { DEFAULT_SETTINGS } from "../config/appConfig.js";

function rnd(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const TASK_TITLES = [
  "Review pull requests",
  "Write release notes",
  "Fix reported sync bug",
  "Update design tokens",
  "Refactor scheduler module",
  "Draft weekly update",
  "Clean up backlog",
  "Pair review on auth flow",
  "Optimize list rendering",
  "Prepare demo script",
  "Triage support inbox",
  "Update onboarding copy",
];

export async function seedIfNeeded() {
  const seeded = await getMeta("seeded");
  if (seeded) return false;

  const today = todayISO();
  const rand = rnd(20260822);

  await bulkPut("profile", [
    {
      id: "profile",
      name: "Alex Rivera",
      email: "alex@nexora.local",
      workspace: "Personal workspace",
    },
  ]);

  await bulkPut("settings", [{ id: "settings", ...DEFAULT_SETTINGS }]);

  // ---------- GOALS ----------
  await bulkPut("goals", [
    {
      id: "g1",
      title: "Launch the productivity app",
      description:
        "Ship a usable MVP of Nexora to first users within 30 days, focused on the core planning loop.",
      category: "Career",
      status: "Active",
      priority: "High",
      startDate: addDays(today, -12),
      targetDate: addDays(today, 29),
      milestones: [
        { label: "Define MVP", done: true },
        { label: "Design UI", done: true },
        { label: "Build auth", done: false },
        { label: "Build database", done: false },
        { label: "Task system", done: false },
        { label: "AI planner", done: false },
        { label: "Testing", done: false },
        { label: "Launch", done: false },
      ],
      createdAt: addDays(today, -12),
    },
    {
      id: "g2",
      title: "Get to 5K running pace under 24 minutes",
      description:
        "Build a consistent training habit and improve 5K time ahead of the fall race.",
      category: "Health",
      status: "Active",
      priority: "Medium",
      startDate: addDays(today, -40),
      targetDate: addDays(today, 44),
      milestones: [
        { label: "Build base mileage", done: true },
        { label: "Add interval training", done: true },
        { label: "Tempo runs", done: false },
        { label: "Taper", done: false },
        { label: "Race day", done: false },
      ],
      createdAt: addDays(today, -40),
    },
  ]);

  // ---------- PROJECTS ----------
  await bulkPut("projects", [
    {
      id: "p1",
      name: "Core planning loop",
      description: "Goals → projects → tasks → focus → progress.",
      goalId: "g1",
      status: "Active",
      deadline: addDays(today, 10),
      color: "#3D5A80",
      createdAt: addDays(today, -12),
    },
    {
      id: "p2",
      name: "AI assistant integration",
      description: "Local-first AI service abstraction and tools.",
      goalId: "g1",
      status: "Planning",
      deadline: addDays(today, 24),
      color: "#C4622D",
      createdAt: addDays(today, -6),
    },
    {
      id: "p3",
      name: "Fall race training block",
      description: "Structured 10-week training plan.",
      goalId: "g2",
      status: "Active",
      deadline: addDays(today, 44),
      color: "#3F7A5C",
      createdAt: addDays(today, -40),
    },
    {
      id: "p4",
      name: "Website redesign",
      description: "New marketing site — paused until MVP ships.",
      goalId: null,
      status: "On Hold",
      deadline: addDays(today, 60),
      color: "#B8842E",
      createdAt: addDays(today, -30),
    },
  ]);

  // ---------- CURRENT TASKS ----------
  const nowTasks = [
    { id: "t1", title: "Finish authentication flow", projectId: "p1", status: "Todo", priority: "Urgent", estimatedMinutes: 45, dueDate: addDays(today, 0), energy: "High" },
    { id: "t2", title: "Design priority scoring algorithm", projectId: "p1", status: "In Progress", priority: "High", estimatedMinutes: 90, dueDate: addDays(today, 1), energy: "High" },
    { id: "t3", title: "Write onboarding copy for empty states", projectId: "p1", status: "Todo", priority: "Medium", estimatedMinutes: 30, dueDate: addDays(today, 2), energy: "Low" },
    { id: "t4", title: "Research Ollama local model integration", projectId: "p2", status: "Todo", priority: "Medium", estimatedMinutes: 60, dueDate: addDays(today, 5), energy: "Medium" },
    { id: "t5", title: "6x800m interval session", projectId: "p3", status: "Todo", priority: "High", estimatedMinutes: 50, dueDate: addDays(today, 0), energy: "High" },
    { id: "t6", title: "Order new running shoes", projectId: "p3", status: "Todo", priority: "Low", estimatedMinutes: 10, dueDate: addDays(today, 12), energy: "Low" },
    { id: "t7", title: "Draft homepage hero copy", projectId: "p4", status: "Blocked", priority: "Low", estimatedMinutes: 40, dueDate: addDays(today, -1), energy: "Medium" },
    { id: "t8", title: "Set up Firestore schema indexes", projectId: "p1", status: "Todo", priority: "Urgent", estimatedMinutes: 35, dueDate: addDays(today, 1), energy: "Medium" },
    { id: "t9", title: "Plan weekly review checklist", projectId: null, status: "Todo", priority: "Medium", estimatedMinutes: 20, dueDate: addDays(today, 3), energy: "Low" },
  ].map((t) => ({
    tags: [],
    description: "",
    createdAt: addDays(today, -5),
    updatedAt: addDays(today, -5),
    ...t,
  }));

  // ---------- HISTORICAL COMPLETED TASKS (90 days) ----------
  const hist = [];
  let k = 0;
  for (let d = 89; d >= 0; d--) {
    const iso = addDays(today, -d);
    const wd = weekdayOf(iso);
    if (wd === 0 || wd === 6) continue; // weekends off
    const count = 1 + Math.floor(rand() * 4); // 1–4 per workday
    for (let i = 0; i < count; i++) {
      k++;
      const done = addDays(today, -d);
      hist.push({
        id: `ht${k}`,
        title: TASK_TITLES[k % TASK_TITLES.length],
        description: "",
        projectId: [null, "p1", "p1", "p2", "p3", "p4"][k % 6],
        status: "Completed",
        priority: ["Urgent", "High", "Medium", "Low"][k % 4],
        estimatedMinutes: [25, 30, 45, 50, 60, 90][k % 6],
        actualMinutes: [20, 35, 45, 55, 70, 95][k % 6],
        dueDate: done,
        completedAt: done,
        tags: [],
        energy: "Medium",
        createdAt: addDays(done, -2),
        updatedAt: done,
      });
    }
  }

  await bulkPut("tasks", [...nowTasks, ...hist]);

  // ---------- HABITS + LOGS ----------
  await bulkPut("habits", [
    { id: "h1", title: "Morning coding session", timeOfDay: "07:00", durationMinutes: 45, weekdays: [1, 2, 3, 4, 5], color: "#3D5A80", archived: false, createdAt: addDays(today, -60) },
    { id: "h2", title: "Evening review", timeOfDay: "21:00", durationMinutes: 15, weekdays: [1, 2, 3, 4, 5, 6], color: "#C4622D", archived: false, createdAt: addDays(today, -60) },
    { id: "h3", title: "Run", timeOfDay: "06:30", durationMinutes: 40, weekdays: [1, 3, 5], color: "#3F7A5C", archived: false, createdAt: addDays(today, -60) },
  ]);

  const logs = [];
  for (let d = 59; d >= 0; d--) {
    const iso = addDays(today, -d);
    const wd = weekdayOf(iso);
    for (const h of [
      { id: "h1", wds: [1, 2, 3, 4, 5] },
      { id: "h2", wds: [1, 2, 3, 4, 5, 6] },
      { id: "h3", wds: [1, 3, 5] },
    ]) {
      if (!h.wds.includes(wd)) continue;
      if (rand() > 0.16) logs.push({ id: `${h.id}:${iso}`, habitId: h.id, date: iso, done: true });
    }
  }
  await bulkPut("habitLogs", logs);

  // ---------- FOCUS SESSIONS (90 days) ----------
  const sessions = [];
  let sk = 0;
  const hourPool = [8, 9, 9.5, 10, 11, 14, 15, 16, 20, 21];
  for (let d = 89; d >= 0; d--) {
    const iso = addDays(today, -d);
    const wd = weekdayOf(iso);
    if (wd === 0) continue;
    const count = wd === 6 ? Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      sk++;
      const startHour = hourPool[Math.floor(rand() * hourPool.length)];
      const mins = [25, 45, 45, 50, 90][Math.floor(rand() * 5)];
      const start = new Date(`${iso}T00:00:00`);
      start.setHours(Math.floor(startHour), Math.round((startHour % 1) * 60), 0, 0);
      const ended = new Date(start.getTime() + mins * 60000);
      sessions.push({
        id: `fs${sk}`,
        taskTitle: TASK_TITLES[sk % TASK_TITLES.length],
        taskId: null,
        type: "focus",
        plannedMinutes: mins,
        durationSeconds: Math.round(mins * (0.82 + rand() * 0.18)) * 60,
        outcome: rand() > 0.22 ? "completed" : "partial",
        note: "",
        startedAt: start.toISOString(),
        endedAt: ended.toISOString(),
      });
    }
  }
  await bulkPut("focusSessions", sessions);

  // ---------- FOLDERS + NOTES ----------
  await bulkPut("folders", [
    { id: "f1", name: "Product", createdAt: addDays(today, -20) },
    { id: "f2", name: "Personal", createdAt: addDays(today, -18) },
  ]);
  await bulkPut("notes", [
    {
      id: "n1",
      folderId: "f1",
      title: "Priority engine — design notes",
      body:
        "The priority engine combines weighted signals into a single 0–100 priorityScore:\n\n- impact\n- urgency\n- deadline proximity\n- goal importance\n- effort (inverse)\n- dependency count\n\nRecompute on task change, not on a timer, to keep reads cheap.\n\nOpen question: should overdue weight decay after 3+ days?",
      tags: ["engineering"],
      createdAt: addDays(today, -8),
      updatedAt: addDays(today, -2),
    },
    {
      id: "n2",
      folderId: "f1",
      title: "Decision: local-first AI",
      body:
        "Decided to build the AIService abstraction targeting Ollama locally during development, with a clean seam to swap hosted APIs later.\n\nNo API keys ever touch client JS — anything needing a secret goes through a server function in the final Firebase step.",
      tags: ["decisions"],
      createdAt: addDays(today, -10),
      updatedAt: addDays(today, -4),
    },
    {
      id: "n3",
      folderId: "f2",
      title: "Race day nutrition plan",
      body:
        "Carb-load starting Thursday before the Saturday race.\nLight breakfast two hours before gun time.\nHydrate steadily, avoid anything new on race day.",
      tags: ["health"],
      createdAt: addDays(today, -14),
      updatedAt: addDays(today, -7),
    },
  ]);

  // ---------- INBOX ----------
  await bulkPut("inbox", [
    { id: "i1", type: "text", content: "Need to redesign the pricing page before launch", processed: false, createdAt: addDays(today, -1) },
    { id: "i2", type: "voice", content: "Call Arun tomorrow at 9am, and prep the presentation before Friday", processed: false, createdAt: addDays(today, -1) },
    { id: "i3", type: "idea", content: "Idea: weekly digest summarizing goal progress", processed: false, createdAt: addDays(today, 0) },
  ]);

  // ---------- CALENDAR EVENTS (current week) ----------
  const monday = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  await bulkPut("events", [
    { id: "e1", title: "Team standup", type: "meeting", date: addDays(monday, 0), startHour: 9, endHour: 9.5 },
    { id: "e2", title: "Deep work: Auth flow", type: "focus", date: addDays(monday, 0), startHour: 10, endHour: 11.5 },
    { id: "e3", title: "1:1 with mentor", type: "meeting", date: addDays(monday, 1), startHour: 14, endHour: 14.5 },
    { id: "e4", title: "Deep work: Priority engine", type: "focus", date: addDays(monday, 2), startHour: 9, endHour: 11 },
    { id: "e5", title: "MVP deadline", type: "deadline", date: addDays(monday, 3), startHour: 17, endHour: 17.5 },
    { id: "e6", title: "5K interval run", type: "focus", date: addDays(monday, 4), startHour: 7, endHour: 8 },
  ]);

  await setMeta("seeded", true);
  return true;
}
