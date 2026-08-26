// ============================================================
// PROMPT LIBRARY — 32 intelligent prompts, each backed by a
// dynamic handler that computes answers from live data.
//
// Organized into 9 categories:
//   1. Daily Planning (5)
//   2. Task Intelligence (7)
//   3. Goals & Work/Projects (7)
//   4. Time & Focus (5)
//   5. Habits & Personal Productivity (4)
//   6. Notes & Knowledge (1)
//   7. Complete AI Coach (1)
//   8. Weekly Review (1)
//   9. Turn Idea Into Goal (1)
// ============================================================

import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import * as habitsSvc from "../services/habitService.js";
import * as eventService from "../services/eventService.js";
import * as focusSvc from "../services/focusService.js";
import * as analyticsSvc from "../services/analyticsService.js";
import * as noteService from "../services/noteService.js";
import { getProfile } from "../services/settingsService.js";
import { reasonsFor } from "./prioritizer.js";
import { todayISO, addDays, diffDays, weekdayOf, fmtHour, minutesToHuman } from "../utils/dates.js";
import * as db from "../store/db.js";

// ---------- shared helpers ----------

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function b(list) {
  return list.map((l) => `\u2022 ${l}`).join("\n");
}

async function loadCore() {
  const [tasks, projects, goals, habitList, events, sessions, profile] = await Promise.all([
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    habitsSvc.allHabits(),
    eventService.allEvents(),
    focusSvc.allSessions(),
    getProfile(),
  ]);
  const open = taskService
    .decorate(tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status)))
    .sort((a, b) => b._score - a._score);
  const prog = projectService.progressMap(projects, tasks);
  const gProg = await goalService.progressMap(goals, projects, tasks);
  const today = todayISO();
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  return { tasks, projects, goals, habitList, events, sessions, profile, open, prog, gProg, today, overdue, name: profile?.name?.split(" ")[0] || "there" };
}

function wh(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}:${String(m).padStart(2, "0")} ${ampm}`;
}

function monthDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ============================================================
// PROMPT DEFINITIONS
// ============================================================

export const PROMPTS = [

  // ===================== DAILY PLANNING =====================

  {
    id: "plan-my-day",
    category: "Daily Planning",
    label: "Plan My Day",
    match: (t) => t.includes("plan my day") || (t.includes("plan") && t.includes("day")),
    handler: async () => {
      const { tasks, events, habitList, open, today, name } = await loadCore();
      const logsToday = await db.getAll("habitLogs");
      const doneHabitIds = new Set(logsToday.filter((l) => l.done && l.date === today).map((l) => l.habitId));
      const timed = open.filter((x) => x.dueDate === today && x.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const untimed = open.filter((x) => x.dueDate === today && !x.startTime).slice(0, 4);
      const habitsToday = habitList.filter((h) => !h.archived && habitsSvc.scheduledOn(h, today) && !doneHabitIds.has(h.id));
      const dueToday = tasks.filter((x) => x.dueDate === today);
      const completedToday = dueToday.filter((x) => x.status === "Completed");

      const morning = [];
      const afternoon = [];
      for (const e of events) (e.startHour < 12 ? morning : afternoon).push(`${wh(e.startHour)} ${e.title}`);
      for (const x of timed) (Number(x.startTime.split(":")[0]) < 12 ? morning : afternoon).push(`${wh(Number(x.startTime.split(":")[0]))} ${x.title}`);
      for (const x of untimed) afternoon.push(x.title);
      for (const h of habitsToday) morning.push(`${h.timeOfDay} \u00b7 ${h.title}`);

      const unscheduledMin = open.filter((x) => !x.dueDate).reduce((a, x) => a + (x.estimatedMinutes || 0), 0);

      if (!morning.length && !afternoon.length) {
        return `Good morning, ${name}! Nothing is due today and no habits are pending. Perfect day for the highest-scored backlog item: **${open[0]?.title || "\u2014"}**.`;
      }

      return [
        `Good morning, ${name}! Here's your plan for today based on deadlines, calendar, and energy patterns:`,
        "",
        "**\ud83d\udd34 Do first (before noon)**",
        b(morning.length ? morning : ["Free \u2014 good slot for deep work"]),
        "",
        "**\ud83d\udfe1 Mid-day / afternoon**",
        b(afternoon.length ? afternoon : ["Open \u2014 batch small tasks here"]),
        "",
        completedToday.length ? `\u2705 ${completedToday.length} task${completedToday.length === 1 ? "" : "s"} already done today.` : "",
        unscheduledMin > 60 ? `You have roughly ${minutesToHuman(unscheduledMin)} of unscheduled work in the backlog \u2014 consider pulling some in.` : "",
      ].filter(Boolean).join("\n");
    },
  },

  {
    id: "what-should-i-do-now",
    category: "Daily Planning",
    label: "What Should I Do Now?",
    match: (t) => t.includes("focus") || t.includes("right now") || t.includes("should i do") || t.includes("what should i do"),
    handler: async () => {
      const { open, projects, name } = await loadCore();
      if (!open.length) return `${name}, your task list is clear. Capture something new or enjoy the whitespace.`;
      const top = open[0];
      const pname = projects.find((p) => p.id === top.projectId)?.name || null;
      const rs = reasonsFor(top, pname);
      return [
        `Right now, the best use of your time is **${top.title}**.`,
        "",
        `It's ${top.priority.toLowerCase()} priority, ~${top.estimatedMinutes} min${top.dueDate ? `, due ${top.dueDate}` : ""}, with a priority score of ${top._score}/100.`,
        "",
        "Why this one:",
        b(rs.slice(0, 3)),
        open[1] ? `\nRunner-up: **${open[1].title}**.` : "",
      ].filter(Boolean).join("\n");
    },
  },

  {
    id: "top-3",
    category: "Daily Planning",
    label: "Give Me My Top 3",
    match: (t) => t.includes("top 3") || t.includes("top three") || t.includes("three most"),
    handler: async () => {
      const { open } = await loadCore();
      if (!open.length) return "No open tasks \u2014 you're fully clear.";
      const top3 = open.slice(0, 3);
      const lines = top3.map((t, i) => {
        const parts = [`${i + 1}. **${t.title}**`];
        if (t.dueDate) parts.push(`due ${t.dueDate}`);
        if (t.priority === "Urgent" || t.priority === "High") parts.push(t.priority.toLowerCase());
        return parts.join(" \u2014 ");
      });
      const canWait = open.slice(3).length;
      return [
        "Here are your top 3 for today:",
        "",
        ...lines,
        "",
        canWait ? `Everything else (${canWait} tasks) can wait until tomorrow without real cost.` : "That covers everything on your plate.",
      ].join("\n");
    },
  },

  {
    id: "plan-my-week",
    category: "Daily Planning",
    label: "Plan My Week",
    match: (t) => t.includes("plan my week") || (t.includes("plan") && t.includes("week") && !t.includes("recap")),
    handler: async () => {
      const { open, name } = await loadCore();
      if (!open.length) return "No open tasks to plan \u2014 your week is a blank page.";
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
        idx += slice.length;
        planned += slice.length;
        lines.push(`**${WD[wd]} (${monthDay(iso)})** \u2014 ${slice.map((s) => s.title).join(", ") || "light day"}`);
      }
      const rest = open.length - planned;
      return [
        `Here's a realistic plan for your week, ${name}:`,
        "",
        ...lines,
        rest > 0 ? `\nPlus ${rest} more queued \u2014 pull them in as days free up.` : "",
      ].filter(Boolean).join("\n");
    },
  },

  {
    id: "replan-my-day",
    category: "Daily Planning",
    label: "Replan My Day",
    match: (t) => t.includes("replan") || t.includes("re-plan") || t.includes("rebuild") || t.includes("schedule changed"),
    handler: async () => {
      const { open, today, name } = await loadCore();
      if (!open.length) return `${name}, you have nothing left on your plate. All clear.`;

      const now = new Date();
      const hoursLeft = 24 - now.getHours() - now.getMinutes() / 60;
      const keep = open.filter((x) => x.dueDate === today);
      const push = open.filter((x) => x.dueDate && x.dueDate > today).slice(0, 5);
      const fits = open.filter((x) => (!x.dueDate || x.dueDate <= today) && (x.estimatedMinutes || 0) <= 30).slice(0, 3);

      return [
        `Got it \u2014 rebuilding your day, ${name}. You have roughly ${Math.round(hoursLeft)} hours left and ${open.length} unfinished tasks.`,
        "",
        keep.length ? [`**Keep:**`, ...keep.map((x) => `\u2022 ${x.title} (due today)`)].join("\n") : "**Keep:** Nothing explicitly due today.",
        "",
        push.length ? [`**Push to tomorrow:**`, ...push.map((x) => `\u2022 ${x.title}`)].join("\n") : "",
        "",
        fits.length ? [`**Fits now (quick tasks):**`, ...fits.map((x) => `\u2022 ${x.title} (~${x.estimatedMinutes}m)`)].join("\n") : "",
      ].filter(Boolean).join("\n");
    },
  },

  // ===================== TASK INTELLIGENCE =====================

  {
    id: "what-is-most-urgent",
    category: "Task Intelligence",
    label: "What Is Most Urgent?",
    match: (t) => t.includes("most urgent") || t.includes("urgency") || (t.includes("urgent") && t.includes("task")),
    handler: async () => {
      const { open, today, overdue, projects } = await loadCore();
      if (!open.length) return "No open tasks \u2014 nothing urgent.";

      const odTasks = [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const dueToday = open.filter((x) => x.dueDate === today);
      const upcoming = open.filter((x) => x.dueDate && x.dueDate > today && x.dueDate <= addDays(today, 3));

      const lines = [];
      if (odTasks.length) {
        lines.push(`**Your most urgent task is "${odTasks[0].title}"** \u2014 ${Math.abs(diffDays(odTasks[0].dueDate, today))} day${Math.abs(diffDays(odTasks[0].dueDate, today)) === 1 ? "" : "s"} overdue.`);
        if (odTasks.length > 1) lines.push(`Close behind: **${odTasks[1].title}** \u2014 also overdue.`);
      } else if (dueToday.length) {
        lines.push(`Your most urgent task is **"${dueToday[0].title}"** \u2014 due today, ${dueToday[0].priority.toLowerCase()} priority.`);
      } else if (upcoming.length) {
        lines.push(`Nothing is overdue, but **"${upcoming[0].title}"** is due ${upcoming[0].dueDate} and should be started soon.`);
      }

      if (upcoming.length > 1) {
        lines.push("", "Also approaching:", b(upcoming.slice(1, 4).map((x) => `${x.title} \u2014 due ${x.dueDate}`)));
      }
      lines.push("", "Everything else can safely wait.");
      return lines.join("\n");
    },
  },

  {
    id: "clean-up-my-tasks",
    category: "Task Intelligence",
    label: "Clean Up My Tasks",
    match: (t) => t.includes("clean up") || t.includes("cleanup") || t.includes("organize task") || t.includes("tidy"),
    handler: async () => {
      const { open, tasks, projects } = await loadCore();
      if (!open.length) return "Nothing to clean up \u2014 your list is empty.";

      const complete = open.filter((x) => (x.estimatedMinutes || 0) <= 10 && !x.dueDate);
      const stale = open.filter((x) => x.updatedAt && diffDays(x.updatedAt.slice(0, 10), todayISO()) > 14 && !x.dueDate);
      const orphans = open.filter((x) => !x.projectId && !x.goalId);

      // Find potential duplicates (similar titles)
      const titleMap = {};
      for (const t of open) {
        const norm = t.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
        if (!titleMap[norm]) titleMap[norm] = [];
        titleMap[norm].push(t);
      }
      const duplicates = Object.values(titleMap).filter((arr) => arr.length > 1);

      const lines = [`I analyzed your ${open.length} open tasks. Here's what I found:`];

      if (complete.length) lines.push("", `**Complete now (${complete.length}):** small, quick, still relevant`, b(complete.slice(0, 4).map((x) => `${x.title} (~${x.estimatedMinutes}m)`)));
      if (stale.length) lines.push("", `**Postpone or cancel (${stale.length}):** no activity in 14+ days, no deadline`, b(stale.slice(0, 4).map((x) => x.title)));
      if (orphans.length) lines.push("", `**File under a project (${orphans.length}):** no project or goal linked`, b(orphans.slice(0, 3).map((x) => x.title)));
      if (duplicates.length) lines.push("", `**Possible duplicates (${duplicates.length} group${duplicates.length === 1 ? "" : "s"}):**`, b(duplicates.slice(0, 3).map((arr) => arr.map((x) => x.title).join(" + "))));

      const totalCleanable = complete.length + stale.length + duplicates.length;
      if (totalCleanable) lines.push("", `This could shrink your list by ~${totalCleanable} items.`);
      if (!lines.length || lines.length === 1) lines.push("Everything looks reasonably organized.");

      return lines.join("\n");
    },
  },

  {
    id: "what-can-i-finish-quickly",
    category: "Task Intelligence",
    label: "What Can I Finish Quickly?",
    match: (t) => t.includes("quick win") || t.includes("finish quickly") || t.includes("15 min") || t.includes("30 min") || t.includes("short task"),
    handler: async () => {
      const { open } = await loadCore();
      if (!open.length) return "No open tasks to work with.";

      const q15 = open.filter((x) => (x.estimatedMinutes || 0) <= 15).slice(0, 3);
      const q30 = open.filter((x) => (x.estimatedMinutes || 0) > 15 && (x.estimatedMinutes || 0) <= 30).slice(0, 3);
      const q60 = open.filter((x) => (x.estimatedMinutes || 0) > 30 && (x.estimatedMinutes || 0) <= 60).slice(0, 3);

      const lines = ["Here's what fits your available time:"];
      if (q15.length) lines.push("", "**15 minutes:**", b(q15.map((x) => `${x.title} (${x.estimatedMinutes}m, ${x.priority})`)));
      if (q30.length) lines.push("", "**30 minutes:**", b(q30.map((x) => `${x.title} (${x.estimatedMinutes}m, ${x.priority})`)));
      if (q60.length) lines.push("", "**60 minutes:**", b(q60.map((x) => `${x.title} (${x.estimatedMinutes}m, ${x.priority})`)));

      if (q15.length + q30.length + q60.length === 0) {
        return "No short tasks left \u2014 everything open needs 60+ minutes. That's a deep-work kind of day.";
      }

      return lines.join("\n");
    },
  },

  {
    id: "what-is-overdue",
    category: "Task Intelligence",
    label: "What Is Overdue?",
    match: (t) => t.includes("overdue") || t.includes("late") || t.includes("behind schedule"),
    handler: async () => {
      const { open, today, overdue } = await loadCore();
      if (!overdue.length) return "Nothing overdue \u2014 you're running clean.";

      const sorted = [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const stale = sorted.filter((x) => diffDays(x.dueDate, today) > 3);

      return [
        `You have **${sorted.length} overdue task${sorted.length === 1 ? "" : "s"}:**`,
        b(sorted.slice(0, 5).map((x) => `${x.title} \u2014 ${Math.abs(diffDays(x.dueDate, today))}d late \u00b7 ${x.priority}`)),
        "",
        stale.length ? `"${sorted[0].title}" has been overdue for ${Math.abs(diffDays(sorted[0].dueDate, today))} days \u2014 it may be stale. Consider rescheduling or cancelling it.` : "These are all recently overdue \u2014 reschedule or complete them today.",
        "",
        `Suggestion: pick the oldest two and either finish or reschedule them now.`,
      ].join("\n");
    },
  },

  {
    id: "find-blocked-work",
    category: "Task Intelligence",
    label: "Find Blocked Work",
    match: (t) => t.includes("block") && (t.includes("task") || t.includes("work") || t.includes("find") || t.includes("show")),
    handler: async () => {
      const { tasks, projects } = await loadCore();
      const blocked = tasks.filter((x) => x.status === "Blocked");
      if (!blocked.length) return "No blocked tasks \u2014 nothing is waiting on anyone.";

      const byProject = {};
      for (const t of blocked) {
        const pname = projects.find((p) => p.id === t.projectId)?.name || "No project";
        if (!byProject[pname]) byProject[pname] = [];
        byProject[pname].push(t);
      }

      const lines = [`**${blocked.length} blocked task${blocked.length === 1 ? "" : "s"}:**`];
      for (const [proj, tasks] of Object.entries(byProject)) {
        lines.push("", `_${proj}_`, b(tasks.map((x) => `${x.title} \u2014 ${x.dueDate ? `due ${x.dueDate}` : "no deadline"}`)));
      }
      lines.push("", "Neither can move forward without someone else's action. Send a reminder or escalate.");
      return lines.join("\n");
    },
  },

  {
    id: "break-down-my-tasks",
    category: "Task Intelligence",
    label: "Break Down My Tasks",
    match: (t) => t.includes("break down") || t.includes("breakdown") || t.includes("too big") || t.includes("stuck on"),
    handler: async () => {
      const { open } = await loadCore();
      if (!open.length) return "No open tasks to analyze.";

      // Find large tasks (60+ min) or stale tasks (not updated in 7+ days)
      const stale = open.filter((x) => x.updatedAt && diffDays(x.updatedAt.slice(0, 10), todayISO()) > 7);
      const large = open.filter((x) => (x.estimatedMinutes || 0) >= 60);
      const candidates = [...large, ...stale.filter((x) => !large.includes(x))];

      if (!candidates.length) return "All your tasks are reasonably sized and recently active. Nothing needs breaking down.";

      const target = candidates[0];
      return [
        `"**${target.title}**" has been sitting for ${target.updatedAt ? Math.abs(diffDays(target.updatedAt.slice(0, 10), todayISO())) : "?"} days and is estimated at ${target.estimatedMinutes || "?"} min \u2014 it may be too big as a single task.`,
        "",
        "Here's how I'd approach breaking it down:",
        `1. Define the specific outcome of this task`,
        `2. Identify the first concrete action`,
        `3. List 2-3 intermediate steps`,
        `4. Determine the "done" criteria`,
        `5. Set a realistic time estimate for each part`,
        "",
        "This turns one vague task into clear, doable steps.",
      ].join("\n");
    },
  },

  {
    id: "prioritize-my-backlog",
    category: "Task Intelligence",
    label: "Prioritize My Backlog",
    match: (t) => t.includes("prioritize") || t.includes("backlog") || t.includes("rank my task") || t.includes("order my task"),
    handler: async () => {
      const { open, projects } = await loadCore();
      if (!open.length) return "No backlog to prioritize.";

      const top5 = open.slice(0, 5);
      const lowImpact = open.slice(8);

      const lines = [
        `I ranked your **${open.length}-task** backlog by real priority:`,
        "",
        "**Top 5 right now:**",
      ];
      for (let i = 0; i < top5.length; i++) {
        const t = top5[i];
        const pname = projects.find((p) => p.id === t.projectId)?.name;
        const parts = [`${i + 1}. **${t.title}**`];
        if (t.dueDate) parts.push(`due ${t.dueDate}`);
        if (pname) parts.push(`project: ${pname}`);
        if (t.priority === "Urgent" || t.priority === "High") parts.push(t.priority.toLowerCase());
        lines.push(parts.join(" \u2014 "));
      }

      if (lowImpact.length) {
        lines.push("", `The rest (${lowImpact.length} tasks) are lower urgency \u2014 I'd deprioritize anything without a deadline or goal link.`);
      }
      return lines.join("\n");
    },
  },

  // ===================== GOALS & WORK/PROJECTS =====================

  {
    id: "analyze-my-goals",
    category: "Goals & Work",
    label: "Analyze My Goals",
    match: (t) => t.includes("analyze") && t.includes("goal") || t.includes("goal") && t.includes("status") || t === "goals",
    handler: async () => {
      const { goals, gProg, today, name } = await loadCore();
      const active = goals.filter((g) => g.status !== "Completed");
      if (!active.length) return "No open goals \u2014 set one and I'll help you track it.";

      const lines = [`Here's where your ${active.length} goal${active.length === 1 ? "" : "s"} stand, ${name}:`];
      for (const g of active) {
        const pct = gProg[g.id]?.pct ?? 0;
        const target = g.targetDate;
        let status;
        if (target) {
          const daysLeft = diffDays(today, target);
          const expectedPct = Math.max(0, Math.min(100, Math.round(((diffDays(g.startDate || today, today)) / Math.max(1, diffDays(g.startDate || today, target))) * 100)));
          if (pct >= expectedPct - 10) status = "\u2705 On track";
          else if (daysLeft <= 7 && pct < 50) status = "\u26a0\ufe0f Behind schedule";
          else if (daysLeft <= 0 && pct < 100) status = "\ud83d\udd34 At risk";
          else status = "\ud83d\udfe1 In progress";
        } else {
          status = pct > 0 ? "\ud83d\udfe1 In progress" : "\u2753 Not started";
        }
        lines.push(`\n${status}: **${g.title}** \u2014 ${pct}% complete${target ? `, target ${target}` : ""}`);
      }
      return lines.join("\n");
    },
  },

  {
    id: "break-down-my-goal",
    category: "Goals & Work",
    label: "Break Down My Goal",
    match: (t) => (t.includes("break") && t.includes("goal")) || t.includes("milestone") || t.includes("goal breakdown"),
    handler: async () => {
      const { goals, gProg } = await loadCore();
      const active = goals.filter((g) => g.status !== "Completed");
      if (!active.length) return "No active goals to break down. Create one first.";

      const g = active[0];
      const pct = gProg[g.id]?.pct ?? 0;
      const msTotal = g.milestones?.length || 0;
      const msDone = (g.milestones || []).filter((m) => m.done).length;

      const lines = [`Here's the breakdown for **${g.title}** (${pct}% complete):`];

      if (msTotal) {
        lines.push("", "**Milestones:**");
        for (const m of g.milestones) {
          lines.push(`${m.done ? "\u2705" : "\u25fb"} ${m.label}`);
        }
      }

      lines.push("", `Progress: ${msDone}/${msTotal} milestones complete, ${pct}% overall.`);
      if (g.targetDate) {
        const daysLeft = diffDays(todayISO(), g.targetDate);
        lines.push(daysLeft > 0 ? `${daysLeft} days remaining.` : `${Math.abs(daysLeft)} days past target.`);
      }

      return lines.join("\n");
    },
  },

  {
    id: "which-goal-needs-me-most",
    category: "Goals & Work",
    label: "Which Goal Needs Me Most?",
    match: (t) => t.includes("which goal") || t.includes("goal need") || t.includes("goal attention"),
    handler: async () => {
      const { goals, gProg, today } = await loadCore();
      const active = goals.filter((g) => g.status !== "Completed" && g.targetDate);
      if (!active.length) return "No goals with target dates \u2014 set targets to enable tracking.";

      const scored = active.map((g) => {
        const pct = gProg[g.id]?.pct ?? 0;
        const daysLeft = diffDays(today, g.targetDate);
        const daysTotal = Math.max(1, diffDays(g.startDate || today, g.targetDate));
        const elapsed = Math.max(0, diffDays(g.startDate || today, today));
        const expectedPct = Math.min(100, Math.round((elapsed / daysTotal) * 100));
        const gap = expectedPct - pct;
        return { g, pct, daysLeft, expectedPct, gap };
      }).sort((a, b) => b.gap - a.gap);

      const worst = scored[0];
      if (worst.gap <= 5) return "All your goals are roughly on pace. No single goal needs emergency attention.";

      return [
        `**"${worst.g.title}"** needs you most right now.`,
        "",
        `You're at ${worst.pct}% progress with ${worst.daysLeft} days left \u2014 expected pace was ${worst.expectedPct}%. The pace needs to roughly ${Math.max(1, Math.round(100 / Math.max(1, worst.pct)) * (100 - worst.pct) / Math.max(1, worst.daysLeft))}x to catch up.`,
        "",
        `Your other goals have more breathing room.`,
      ].join("\n");
    },
  },

  {
    id: "analyze-my-work",
    category: "Goals & Work",
    label: "Analyze My Work",
    match: (t) => t.includes("project") && !t.includes("attention") || t.includes("analyze") && t.includes("work") || t.includes("project status"),
    handler: async () => {
      const { projects, prog, tasks } = await loadCore();
      const active = projects.filter((p) => !["Completed", "Cancelled"].includes(p.status));
      if (!active.length) return "No active projects right now.";

      const lines = ["**Project status:**"];
      for (const p of active) {
        const m = prog[p.id];
        let icon;
        if (p.status === "On Hold") icon = "\ud83d\udecc";
        else if (m.pct === 0 || m.pct === null) icon = "\ud83d\udd34";
        else if (m.pct >= 80) icon = "\u2705";
        else icon = "\ud83d\udfe1";

        const statusLabel = p.status === "On Hold" ? "stalled" : p.status === "Planning" ? "planning" : m.pct === null ? "no tasks yet" : `${m.pct}% done`;
        lines.push(`${icon} **${p.name}** \u2014 ${statusLabel}${p.deadline ? ` \u00b7 due ${p.deadline}` : ""}`);
      }

      const stalled = active.filter((p) => p.status === "On Hold" || (prog[p.id]?.pct !== null && prog[p.id]?.pct < 20));
      if (stalled.length) {
        lines.push("", `${stalled.length === 1 ? "One project is" : `${stalled.length} projects are`} underperforming \u2014 consider resuming or explicitly pausing.`);
      }

      return lines.join("\n");
    },
  },

  {
    id: "find-my-biggest-risk",
    category: "Goals & Work",
    label: "Find My Biggest Risk",
    match: (t) => t.includes("biggest risk") || t.includes("risk") || t.includes("what could fail"),
    handler: async () => {
      const { goals, projects, gProg, overdue, today } = await loadCore();

      // Goal risks
      const goalRisks = goals
        .filter((g) => g.targetDate && g.status !== "Completed")
        .map((g) => {
          const pct = gProg[g.id]?.pct ?? 0;
          const daysLeft = diffDays(today, g.targetDate);
          return { g, pct, daysLeft, urgency: daysLeft <= 14 && pct < 60 ? (14 - daysLeft) + (60 - pct) : 0 };
        })
        .filter((x) => x.urgency > 0)
        .sort((a, b) => b.urgency - a.urgency);

      const lines = [];
      if (goalRisks.length) {
        const r = goalRisks[0];
        lines.push(`Your biggest risk right now is **"${r.g.title}"**.`);
        lines.push("", `With ${r.daysLeft} days left and only ${r.pct}% progress, this is the item most likely to fail without intervention.`);
        lines.push("", `To prevent it: shift focus away from lower-impact tasks this week and dedicate focused time to this goal daily.`);
      } else if (overdue.length) {
        lines.push(`Your biggest risk is **${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}**.`);
        lines.push("", `"${overdue[0].title}" is ${Math.abs(diffDays(overdue[0].dueDate, today))} days overdue \u2014 address it before it cascades.`);
      } else {
        lines.push("No major risks detected across your goals and tasks. Steady ship.");
      }

      return lines.join("\n");
    },
  },

  {
    id: "goal-progress-check",
    category: "Goals & Work",
    label: "Goal Progress Check",
    match: (t) => t.includes("goal") && (t.includes("progress") || t.includes("pace") || t.includes("track")),
    handler: async () => {
      const { goals, gProg, today } = await loadCore();
      const active = goals.filter((g) => g.status !== "Completed");
      if (!active.length) return "No active goals to check.";

      const lines = ["Here's how you're tracking against expected pace:"];
      for (const g of active) {
        const pct = gProg[g.id]?.pct ?? 0;
        if (g.targetDate) {
          const daysTotal = Math.max(1, diffDays(g.startDate || today, g.targetDate));
          const elapsed = Math.max(0, diffDays(g.startDate || today, today));
          const expectedPct = Math.min(100, Math.round((elapsed / daysTotal) * 100));
          const diff = pct - expectedPct;
          let verdict;
          if (diff >= 5) verdict = "\u2705 **ahead**";
          else if (diff >= -10) verdict = "\ud83d\udfe1 **on pace**";
          else verdict = "\u26a0\ufe0f **behind**";
          lines.push(`\n**${g.title}**: ${pct}% done vs. ${expectedPct}% expected \u2014 ${verdict}`);
        } else {
          lines.push(`\n**${g.title}**: ${pct}% complete (no target date set)`);
        }
      }
      return lines.join("\n");
    },
  },

  {
    id: "what-should-i-stop",
    category: "Goals & Work",
    label: "What Should I Stop?",
    match: (t) => t.includes("stop") || t.includes("drop") || t.includes("quit") || t.includes("low value") || t.includes("waste"),
    handler: async () => {
      const { open, projects, goals, gProg } = await loadCore();
      const today = todayISO();
      const candidates = [];

      // Stale tasks with no deadline or goal
      const orphanStale = open.filter((x) => !x.dueDate && !x.goalId && !x.projectId && x.updatedAt && diffDays(x.updatedAt.slice(0, 10), today) > 21);
      for (const t of orphanStale.slice(0, 3)) {
        candidates.push({ type: "task", title: t.title, reason: `No deadline, no project, no goal \u2014 ${Math.abs(diffDays(t.updatedAt.slice(0, 10), today))} days since last activity` });
      }

      // On-hold projects with no momentum
      const stalledProj = projects.filter((p) => p.status === "On Hold");
      for (const p of stalledProj.slice(0, 2)) {
        candidates.push({ type: "project", title: p.name, reason: "On hold \u2014 consider closing or explicitly resuming" });
      }

      // Low-progress goals near expiry
      const dyingGoals = goals.filter((g) => g.targetDate && g.status !== "Completed").filter((g) => {
        const pct = gProg[g.id]?.pct ?? 0;
        return pct < 30 && diffDays(today, g.targetDate) < 7;
      });
      for (const g of dyingGoals.slice(0, 2)) {
        candidates.push({ type: "goal", title: g.title, reason: `Only ${gProg[g.id]?.pct ?? 0}% with ${diffDays(today, g.targetDate)} days left \u2014 may not be worth the pressure` });
      }

      if (!candidates.length) return "Nothing stands out as low-value right now. Everything on your plate has a reasonable claim on your time.";

      const lines = ["Looking at your workload, a few things stand out as low-value:"];
      for (const c of candidates) {
        lines.push(`\n\u2022 **${c.title}** (${c.type}) \u2014 ${c.reason}`);
      }
      lines.push("", "Dropping or pausing these would free up time for higher-impact goals.");
      return lines.join("\n");
    },
  },

  // ===================== TIME & FOCUS =====================

  {
    id: "optimize-my-schedule",
    category: "Time & Focus",
    label: "Optimize My Schedule",
    match: (t) => t.includes("optimize") && t.includes("schedule") || t.includes("better schedule") || t.includes("rearrange"),
    handler: async () => {
      const { events, open, today } = await loadCore();

      // Count events per day for the next 5 days
      const dayCounts = {};
      for (let d = 0; d < 5; d++) {
        const iso = addDays(today, d);
        const wd = weekdayOf(iso);
        if (wd === 0 || wd === 6) continue;
        const dayEvents = events.filter((e) => e.date === iso);
        const dayTasks = open.filter((x) => x.dueDate === iso);
        dayCounts[iso] = { events: dayEvents.length, tasks: dayTasks.length, total: dayEvents.length + dayTasks.length };
      }

      const days = Object.entries(dayCounts).sort((a, b) => a[1].total - b[1].total);
      if (!days.length) return "No schedule data to optimize \u2014 your week looks flexible.";

      const lightest = days[0];
      const heaviest = days[days.length - 1];

      const lines = [];
      if (heaviest[1].total > 5) {
        lines.push(`**${WD[weekdayOf(heaviest[0])]}** is overloaded (${heaviest[1].total} items). Consider moving a task to ${WD[weekdayOf(lightest[0])]}, which has only ${lightest[1].total} items.`);
      } else {
        lines.push("Your schedule is reasonably balanced across the week.");
      }

      // Find best deep work slot
      const freeSlots = days.filter((d) => d[1].events < 2).map((d) => d[0]);
      if (freeSlots.length) {
        lines.push("", `Best deep-work slots: ${freeSlots.map((d) => `**${WD[weekdayOf(d)]}**`).join(", ")}`);
      }

      return lines.join("\n");
    },
  },

  {
    id: "improve-my-focus",
    category: "Time & Focus",
    label: "Improve My Focus",
    match: (t) => t.includes("improve") && t.includes("focus") || t.includes("focus") && t.includes("better") || t.includes("concentration"),
    handler: async () => {
      const s = await analyticsSvc.rangeStats(30);
      if (!s.sessionCount) return "No focus sessions yet \u2014 start a 25-minute timer on the Focus page. Momentum follows motion.";

      const avgLen = Math.round(s.focusMinutes / Math.max(1, s.sessionCount));
      const deepPct = s.focusMinutes ? Math.round((s.deepMinutes / s.focusMinutes) * 100) : 0;

      // Find peak hours
      const peakHour = s.hourBuckets.indexOf(Math.max(...s.hourBuckets));
      const peakLabel = wh(peakHour);

      // Find weak hours (afternoon dip)
      const afternoonMin = s.hourBuckets.slice(12, 17).reduce((a, v) => a + v, 0);
      const morningMin = s.hourBuckets.slice(8, 12).reduce((a, v) => a + v, 0);

      const lines = ["Here's how to sharpen your focus:"];
      lines.push(`\n\u2022 Average session: **${avgLen} min** \u2014 ${avgLen < 30 ? "too short for deep work, try extending to 45 min" : avgLen < 45 ? "room to push toward 45-min blocks" : "solid deep work length"}`);
      lines.push(`\u2022 Deep work ratio: **${deepPct}%** \u2014 ${deepPct < 40 ? "most focus time is in short bursts, try consolidating" : "good deep-work discipline"}`);
      lines.push(`\u2022 Peak performance window: **${peakLabel}** \u2014 guard this for hard tasks`);
      if (morningMin > afternoonMin * 2) {
        lines.push(`\u2022 Morning focus is ${Math.round(morningMin / Math.max(1, afternoonMin))}x stronger than afternoon \u2014 schedule meetings in the afternoon`);
      }

      return lines.join("\n");
    },
  },

  {
    id: "find-my-best-working-time",
    category: "Time & Focus",
    label: "Find My Best Working Time",
    match: (t) => t.includes("productive") || t.includes("best hour") || t.includes("best time") || t.includes("peak hour"),
    handler: async () => {
      const s = await analyticsSvc.rangeStats(30);
      const win = analyticsSvc.bestWindow(s.hourBuckets);

      if (win.totalMinutes <= 60) return "Not enough session data yet \u2014 run a few focus timers and I'll map your peak hours.";

      const startLabel = wh(win.startHour);
      const endLabel = wh(win.startHour + 3);

      // Find worst window too
      let worstStart = 12;
      let worstSum = Infinity;
      for (let h = 8; h <= 18; h++) {
        const sum = s.hourBuckets[h] + s.hourBuckets[h + 1] + s.hourBuckets[h + 2];
        if (sum < worstSum) { worstSum = sum; worstStart = h; }
      }

      const lines = [
        `Based on your last 30 days of focus data:`,
        "",
        `\u2022 **Strongest window: ${startLabel}\u2013${endLabel}** \u2014 ${minutesToHuman(win.totalMinutes)} of focus landed here`,
        `\u2022 **Weakest window: ${wh(worstStart)}\u2013${wh(worstStart + 3)}** \u2014 avoid scheduling hard work here`,
        "",
        "Guard your peak hours for deep work; push meetings and admin elsewhere.",
      ];
      return lines.join("\n");
    },
  },

  {
    id: "i-have-limited-time",
    category: "Time & Focus",
    label: "I Have Limited Time",
    match: (t) => t.includes("limited time") || t.includes("only have") || t.includes("only got") || t.includes("quickly"),
    handler: async () => {
      const { open } = await loadCore();
      if (!open.length) return "You're all caught up \u2014 nothing needs doing.";

      const top = open[0];
      const runnerUp = open[1];

      return [
        `With limited time, your highest-value option is **${top.title}**.`,
        "",
        `~${top.estimatedMinutes} min, ${top.priority.toLowerCase()} priority${top.dueDate ? `, due ${top.dueDate}` : ""}.`,
        runnerUp ? `\nAlternative: **${runnerUp.title}** (~${runnerUp.estimatedMinutes}m) if you'd rather switch context.` : "",
      ].filter(Boolean).join("\n");
    },
  },

  {
    id: "protect-my-deep-work",
    category: "Time & Focus",
    label: "Protect My Deep Work",
    match: (t) => t.includes("deep work") || t.includes("protect") || t.includes("uninterrupted"),
    handler: async () => {
      const { events, open, today } = await loadCore();
      const s = await analyticsSvc.rangeStats(30);
      const win = analyticsSvc.bestWindow(s.hourBuckets);

      // Find open blocks in the next 3 days
      const openBlocks = [];
      for (let d = 0; d < 3; d++) {
        const iso = addDays(today, d);
        const dayEvents = events.filter((e) => e.date === iso).sort((a, b) => a.startHour - b.startHour);
        const occupied = new Set();
        for (const e of dayEvents) {
          for (let h = Math.floor(e.startHour); h < Math.ceil(e.endHour); h++) occupied.add(h);
        }
        const free = [];
        for (let h = 8; h <= 17; h++) {
          if (!occupied.has(h)) free.push(h);
        }
        if (free.length >= 2) {
          openBlocks.push({ date: iso, start: free[0], hours: free.length });
        }
      }

      const deepWorkTasks = open.filter((x) => (x.estimatedMinutes || 0) >= 45).slice(0, 3);

      const lines = [];
      if (openBlocks.length) {
        const best = openBlocks[0];
        lines.push(`Your best open block for deep work is **${WD[weekdayOf(best.date)]}, ${wh(best.start)}\u2013${wh(best.start + best.hours)}** \u2014 ${best.hours} hours, no meetings.`);
      } else {
        lines.push("No large open blocks found in the next 3 days \u2014 consider blocking time explicitly.");
      }

      if (win.totalMinutes > 60) {
        lines.push(`\nYour historical peak is around **${wh(win.startHour)}** \u2014 try to reserve that hour for your most important deep work.`);
      }

      if (deepWorkTasks.length) {
        lines.push("", "Tasks that need deep work:", b(deepWorkTasks.map((x) => `${x.title} (${x.estimatedMinutes}m)`)));
      }

      return lines.join("\n");
    },
  },

  // ===================== HABITS & PERSONAL PRODUCTIVITY =====================

  {
    id: "analyze-my-habits",
    category: "Habits",
    label: "Analyze My Habits",
    match: (t) => t.includes("habit") && (t.includes("analyze") || t.includes("summary") || t.includes("status") || t === "habits"),
    handler: async () => {
      const { habitList, today } = await loadCore();
      const active = habitList.filter((h) => !h.archived);
      if (!active.length) return "No active habits \u2014 create one on the Goals page.";

      const cons = await analyticsSvc.habitConsistency(14);
      const consMap = {};
      for (const c of cons) consMap[c.habit.id] = c;

      const streaks = await analyticsSvc.computeStreaks();
      const streakMap = {};
      for (const s of streaks) streakMap[s.habit.id] = s.streak;

      const lines = [`Here's your habit summary for the last 14 days:`];
      for (const h of active) {
        const c = consMap[h.id];
        const streak = streakMap[h.id] || 0;
        const pct = c?.pct ?? 0;
        let trend;
        if (pct >= 80) trend = "\u2705 strong";
        else if (pct >= 50) trend = "\ud83d\udfe1 slipping";
        else trend = "\u26a0\ufe0f needs attention";

        lines.push(`\n\u2022 **${h.title}** \u2014 ${trend} (${pct}% consistency, streak: ${streak} day${streak === 1 ? "" : "s"})`);
      }

      const weakest = cons.filter((c) => c.pct < 60).sort((a, b) => a.pct - b.pct);
      if (weakest.length) {
        lines.push("", `**${weakest[0].habit.title}** is the habit that needs the most attention \u2014 only ${weakest[0].pct}% this week.`);
      }

      return lines.join("\n");
    },
  },

  {
    id: "improve-my-routine",
    category: "Habits",
    label: "Improve My Routine",
    match: (t) => t.includes("routine") || t.includes("daily routine") || t.includes("better routine"),
    handler: async () => {
      const { habitList, events, today } = await loadCore();
      const active = habitList.filter((h) => !h.archived);
      const s = await analyticsSvc.rangeStats(30);
      const win = analyticsSvc.bestWindow(s.hourBuckets);

      const lines = ["Based on your patterns, here's an optimized daily routine:"];

      // Morning block
      const morningHabits = active.filter((h) => h.timeOfDay && Number(h.timeOfDay.split(":")[0]) < 12);
      lines.push("", "**Morning (high energy):**");
      if (win.totalMinutes > 60) {
        lines.push(`\u2022 ${wh(win.startHour)}\u2013${wh(win.startHour + 2)}: Deep work block (your peak performance window)`);
      }
      for (const h of morningHabits) {
        lines.push(`\u2022 ${h.timeOfDay}: ${h.title}`);
      }

      // Afternoon
      const afternoonHabits = active.filter((h) => h.timeOfDay && Number(h.timeOfDay.split(":")[0]) >= 12);
      lines.push("", "**Afternoon (lower energy):**");
      lines.push("\u2022 Meetings, admin, and lighter tasks");
      for (const h of afternoonHabits) {
        lines.push(`\u2022 ${h.timeOfDay}: ${h.title}`);
      }

      lines.push("", "This routine prioritizes deep work in your peak window and batches lighter work for the afternoon.");
      return lines.join("\n");
    },
  },

  {
    id: "find-productivity-patterns",
    category: "Habits",
    label: "Find My Productivity Patterns",
    match: (t) => t.includes("pattern") || t.includes("habit") && t.includes("consistent") || t.includes("consistency"),
    handler: async () => {
      const s = await analyticsSvc.rangeStats(30);
      const { tasks, sessions } = await loadCore();
      const today = todayISO();

      // Task completion patterns
      const completed = tasks.filter((t) => t.status === "Completed" && t.completedAt);
      const byDay = {};
      for (let d = 0; d < 30; d++) {
        const iso = addDays(today, -d);
        const wd = weekdayOf(iso);
        if (!byDay[wd]) byDay[wd] = 0;
        byDay[wd] += completed.filter((t) => t.completedAt.slice(0, 10) === iso).length;
      }
      const bestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
      const worstDay = Object.entries(byDay).sort((a, b) => a[1] - b[1])[0];

      // Focus patterns
      const avgSession = s.sessionCount ? Math.round(s.focusMinutes / s.sessionCount) : 0;

      const lines = ["Key patterns from your last 30 days:"];
      if (bestDay) lines.push(`\n\u2022 **${WD[bestDay[0]]}** is your most productive day (${bestDay[1]} tasks completed)`);
      if (worstDay && worstDay[0] !== bestDay?.[0]) lines.push(`\u2022 **${WD[worstDay[0]]}** is your slowest day (${worstDay[1]} tasks completed)`);
      if (s.sessionCount) {
        lines.push(`\u2022 Average focus session: **${avgSession} min** \u2014 ${avgSession < 30 ? "short bursts dominate" : "solid deep work blocks"}`);
      }

      // Streaks
      const habitCons = await analyticsSvc.habitConsistency(30);
      const strongHabits = habitCons.filter((h) => h.pct >= 80);
      if (strongHabits.length) {
        lines.push(`\u2022 Strongest habits: ${strongHabits.map((h) => `${h.habit.title} (${h.pct}%)`).join(", ")}`);
      }

      lines.push("", "Use these patterns to schedule high-impact work on your best days and admin on your slowest.");
      return lines.join("\n");
    },
  },

  {
    id: "why-less-productive",
    category: "Habits",
    label: "Why Was I Less Productive?",
    match: (t) => t.includes("less productive") || t.includes("why") && t.includes("productive") || t.includes("decline") || t.includes("slower"),
    handler: async () => {
      const sThisWeek = await analyticsSvc.rangeStats(7);
      const sLastWeek = await analyticsSvc.rangeStats(7, 7);
      const { sessions } = await loadCore();
      const today = todayISO();

      const thisWeekSessions = sessions.filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) >= addDays(today, -6));
      const lastWeekSessions = sessions.filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) >= addDays(today, -13) && s.startedAt.slice(0, 10) < addDays(today, -6));

      const taskDiff = sThisWeek.tasksCompleted - sLastWeek.tasksCompleted;
      const focusDiff = sThisWeek.focusMinutes - sLastWeek.focusMinutes;

      const lines = [];
      if (taskDiff < 0) {
        lines.push(`Your task completion dropped **${Math.abs(taskDiff)} tasks** this week compared to last week.`);
      } else if (taskDiff > 0) {
        lines.push(`You actually completed **${taskDiff} more tasks** this week than last \u2014 you're picking up pace.`);
      } else {
        lines.push("Your task completion rate held steady week-over-week.");
      }

      // Focus comparison
      if (focusDiff < -60) {
        lines.push(`\nFocus time dropped by **${minutesToHuman(Math.abs(focusDiff))}** \u2014 fewer or shorter sessions.`);
      }

      // Session count comparison
      if (thisWeekSessions.length < lastWeekSessions.length) {
        lines.push(`Session count: ${thisWeekSessions.length} this week vs. ${lastWeekSessions.length} last week.`);
      }

      // Habit comparison
      const consThisWeek = await analyticsSvc.habitConsistency(7);
      const avgCons = consThisWeek.length ? Math.round(consThisWeek.reduce((a, h) => a + (h.pct ?? 0), 0) / consThisWeek.length) : 0;
      if (avgCons < 60) {
        lines.push(`\nHabit consistency averaged ${avgCons}% this week \u2014 missed habits often correlate with lower focus.`);
      }

      if (lines.length <= 1) lines.push("\nNo major dips detected \u2014 you're holding steady.");

      return lines.join("\n");
    },
  },

  // ===================== NOTES & KNOWLEDGE =====================

  {
    id: "find-what-i-need",
    category: "Notes & Knowledge",
    label: "Find What I Need",
    match: (t) => t.includes("find") || t.includes("search") || t.includes("note") || t.includes("wrote about") || t.includes("where"),
    handler: async () => {
      const { notes, tasks, goals, projects } = await loadCore();

      // Gather keywords from open tasks, goals, and projects
      const keywords = new Set();
      for (const t of tasks.slice(0, 5)) {
        for (const w of t.title.toLowerCase().split(/\s+/)) if (w.length > 3) keywords.add(w);
      }
      for (const g of goals.filter((g) => g.status !== "Completed")) {
        for (const w of g.title.toLowerCase().split(/\s+/)) if (w.length > 3) keywords.add(w);
      }
      for (const p of projects.filter((p) => !["Completed", "Cancelled"].includes(p.status))) {
        for (const w of p.name.toLowerCase().split(/\s+/)) if (w.length > 3) keywords.add(w);
      }

      const allNotes = await noteService.allNotes();
      const relevant = [];
      for (const note of allNotes) {
        const text = `${note.title} ${note.body}`.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (text.includes(kw)) score++;
        }
        if (score > 0) relevant.push({ note, score });
      }
      relevant.sort((a, b) => b.score - a.score);

      if (!relevant.length) return "No notes match your current active topics. Your notes may need new content.";

      const lines = [`Found **${relevant.length} note${relevant.length === 1 ? "" : "s"}** connected to your active work:`];
      for (const { note } of relevant.slice(0, 5)) {
        lines.push(`\n\u2022 **${note.title}** (edited ${note.updatedAt ? note.updatedAt.slice(0, 10) : "?"})`);
        if (note.body) lines.push(`  ${note.body.slice(0, 100)}${note.body.length > 100 ? "..." : ""}`);
      }

      return lines.join("\n");
    },
  },

  // ===================== COMPLETE AI COACH =====================

  {
    id: "complete-productivity-report",
    category: "AI Coach",
    label: "Give Me My Complete Productivity Report",
    match: (t) => t.includes("complete") && t.includes("report") || t.includes("full") && t.includes("report") || t.includes("everything") || t.includes("overall"),
    handler: async () => {
      const { open, tasks, projects, goals, gProg, overdue, today, name, sessions, habitList } = await loadCore();
      const s = await analyticsSvc.rangeStats(7);
      const cons = await analyticsSvc.habitConsistency(7);

      const lines = [`**Here's your full productivity picture, ${name}:**`];

      // What's working
      const workingItems = [];
      const strongHabits = cons.filter((h) => h.pct >= 80);
      if (strongHabits.length) workingItems.push(`${strongHabits[0].habit.title} habit (${strongHabits[0].pct}% consistency)`);
      const onTrackGoals = goals.filter((g) => g.status !== "Completed" && g.targetDate).filter((g) => {
        const pct = gProg[g.id]?.pct ?? 0;
        const daysTotal = Math.max(1, diffDays(g.startDate || today, g.targetDate));
        const elapsed = Math.max(0, diffDays(g.startDate || today, today));
        return pct >= Math.round((elapsed / daysTotal) * 100) - 10;
      });
      if (onTrackGoals.length) workingItems.push(`"${onTrackGoals[0].title}" goal is on track`);
      if (s.tasksCompleted >= 5) workingItems.push(`${s.tasksCompleted} tasks completed this week`);
      if (s.focusMinutes >= 300) workingItems.push(`${minutesToHuman(s.focusMinutes)} of focus time`);

      if (workingItems.length) lines.push("", "\u2705 **What's working:**", b(workingItems));

      // What's hurting
      const hurtingItems = [];
      const weakHabits = cons.filter((h) => h.pct < 60);
      if (weakHabits.length) hurtingItems.push(`${weakHabits[0].habit.title} habit slipping (${weakHabits[0].pct}%)`);
      if (overdue.length) hurtingItems.push(`${overdue.length} overdue tasks`);
      if (s.completionRate !== null && s.completionRate < 60) hurtingItems.push(`Only ${s.completionRate}% completion rate on due tasks`);
      if (hurtingItems.length) lines.push("", "\u26a0\ufe0f **What's hurting you:**", b(hurtingItems));

      // At risk
      const atRisk = goals.filter((g) => g.targetDate && g.status !== "Completed").filter((g) => {
        const pct = gProg[g.id]?.pct ?? 0;
        return pct < 50 && diffDays(today, g.targetDate) <= 14;
      });
      if (atRisk.length) {
        lines.push("", "\ud83d\udd34 **At risk:**", b(atRisk.map((g) => `"${g.title}" \u2014 ${gProg[g.id]?.pct ?? 0}% with ${diffDays(today, g.targetDate)} days left`)));
      }

      // What to change
      const changes = [];
      if (weakHabits.length) changes.push(`Reinforce ${weakHabits[0].habit.title} habit \u2014 adjust timing or set reminders`);
      if (overdue.length) changes.push(`Clear ${overdue.length} overdue item${overdue.length === 1 ? "" : "s"} before adding new work`);
      if (s.focusMinutes < 120) changes.push("Increase focus time \u2014 book one 90-minute block tomorrow morning");
      if (changes.length) lines.push("", "\ud83d\udd27 **What to change:**", b(changes));

      // Best next action
      let nextAction;
      if (overdue.length) nextAction = `"${overdue[0].title}" \u2014 it's ${Math.abs(diffDays(overdue[0].dueDate, today))} days overdue`;
      else if (atRisk.length) nextAction = `Spend time on "${atRisk[0].title}" \u2014 only ${gProg[atRisk[0].id]?.pct ?? 0}% with ${diffDays(today, atRisk[0].targetDate)} days left`;
      else if (open.length) nextAction = `"${open[0].title}" \u2014 highest priority score (${open[0]._score}/100)`;
      else nextAction = "Create new goals or tasks \u2014 your plate is clear";

      lines.push("", `\ud83c\udfaf **Best next action:** ${nextAction}`);

      return lines.join("\n");
    },
  },

  // ===================== WEEKLY REVIEW =====================

  {
    id: "weekly-review",
    category: "Weekly Review",
    label: "Weekly Review",
    match: (t) => t.includes("recap") || t.includes("review my week") || t.includes("weekly review") || t.includes("summary of my week") || t.includes("this week"),
    handler: async () => {
      const s = await analyticsSvc.rangeStats(7);
      const { tasks, sessions, habitList, today } = await loadCore();

      const logs = await db.getAll("habitLogs");
      const weekStart = addDays(today, -6);
      const habitDone = logs.filter((l) => l.done && l.date >= weekStart).length;
      const sessCount = sessions.filter((x) => x.type === "focus" && x.startedAt.slice(0, 10) >= weekStart).length;

      // Planned vs completed
      const planned = tasks.filter((t) => t.dueDate && t.dueDate >= weekStart && t.dueDate <= today).length;
      const completed = s.tasksCompleted;

      const lines = [
        "**Here's how this week actually went:**",
        "",
        `\u2022 **Planned tasks (due this week):** ${planned}`,
        `\u2022 **Completed:** ${completed} task${completed === 1 ? "" : "s"}`,
        `\u2022 **Completion rate:** ${s.completionRate === null ? "\u2014" : `${s.completionRate}%`}`,
        `\u2022 **Focus:** ${minutesToHuman(s.focusMinutes)} over ${sessCount} session${sessCount === 1 ? "" : "s"}`,
        `\u2022 **Habit checkmarks:** ${habitDone}`,
      ];

      // Wins and misses
      const wins = tasks.filter((t) => t.status === "Completed" && t.completedAt && t.completedAt.slice(0, 10) >= weekStart);
      if (wins.length) {
        lines.push("", "**Biggest win:**", `\u2022 ${wins[0].title}`);
      }

      const missed = tasks.filter((t) => t.dueDate && t.dueDate < weekStart && !["Completed", "Cancelled"].includes(t.status));
      if (missed.length) {
        lines.push("", "**Missed:**", b(missed.slice(0, 3).map((x) => `${x.title} (due ${x.dueDate})`)));
      }

      // Pattern
      if (s.completionRate !== null && s.completionRate < 60) {
        lines.push("", "Pattern: tasks without hard deadlines tend to get postponed. Try adding soft deadlines.");
      } else if (completed >= 10) {
        lines.push("", "High-output week \u2014 recover well over the weekend.");
      } else {
        lines.push("", "Solid base; one extra deep block next week moves the needle.");
      }

      return lines.join("\n");
    },
  },

  // ===================== TURN IDEA INTO GOAL =====================

  {
    id: "turn-idea-into-goal",
    category: "Goal Builder",
    label: "Turn Idea Into Goal",
    match: (t) => t.includes("turn") && t.includes("goal") || t.includes("create goal") || t.includes("new goal") || t.includes("idea into"),
    handler: async () => {
      return `I'd love to help structure a new goal! Tell me your idea in a sentence or two, and I'll break it down into milestones, timelines, and first steps.\n\nFor example: "I want to grow my freelance business" or "I want to learn to code."\n\nJust type your idea below and press Send.`;
    },
  },
];

// ============================================================
// LOOKUP HELPERS
// ============================================================

/** Find matching handler by user text. Returns { prompt, handler } or null. */
export function matchPrompt(userText) {
  const t = userText.toLowerCase().trim();
  for (const p of PROMPTS) {
    if (p.match(t)) return p;
  }
  return null;
}

/** Get all unique category labels. */
export function categories() {
  return [...new Set(PROMPTS.map((p) => p.category))];
}
