import { icon } from "../dom.js";
import * as taskService from "../services/taskService.js";
import * as projectService from "../services/projectService.js";
import * as goalService from "../services/goalService.js";
import { getProfile } from "../services/settingsService.js";
import * as aiService from "../ai/aiService.js";
import { runGoalPlanner } from "../ui/goalPlanner.js";

let messages = null; // lazy init so the seed reflects live data

const suggestions = [
  "What should I focus on today?",
  "Summarize my open projects",
  "How are my goals going?",
  "Plan my week",
];

// Heuristic responder — real data in, honest rule-based answers out.
// Used whenever no local model is available.
async function buildReply(userText) {
  const t = userText.toLowerCase();
  const [tasks, projects, goals, profile] = await Promise.all([
    taskService.allTasks(),
    projectService.allProjects(),
    goalService.allGoals(),
    getProfile(),
  ]);
  const name = profile?.name?.split(" ")[0] || "there";
  const open = taskService.decorate(tasks.filter((x) => !["Completed", "Cancelled"].includes(x.status)));
  const prog = projectService.progressMap(projects, tasks);

  if (t.includes("focus") || t.includes("today") || t.includes("now")) {
    if (!open.length) return `${name}, you have no open tasks. Enjoy it — or capture something new.`;
    const top = open[0];
    return `Right now I'd start with **${top.title}** (${top.priority}, ${top.estimatedMinutes}m). It currently has the highest priority score (${top._score}/100). Open Focus mode and I'll keep the timer for you.`;
  }
  if (t.includes("week")) {
    return `Draft plan: protect your best morning window for “${open[0]?.title ?? "deep work"}”, batch the smaller remaining tasks into one afternoon block, and keep Friday light before deadlines. Try “Plan a goal” below for a full AI-drafted breakdown.`;
  }
  if (t.includes("project")) {
    const lines = projects
      .filter((p) => !["Completed", "Cancelled"].includes(p.status))
      .map((p) => {
        const m = prog[p.id];
        return `• ${p.name} — ${m.pct === null ? "no tasks yet" : `${m.pct}% done (${m.done}/${m.total})`}${p.deadline ? `, due ${p.deadline}` : ""}`;
      });
    return `Here's where your active projects stand:\n${lines.join("\n")}`;
  }
  if (t.includes("goal")) {
    const gProg = await goalService.progressMap(goals, projects, tasks);
    const lines = goals
      .filter((g) => g.status === "Active")
      .map((g) => `• ${g.title} — ${gProg[g.id]?.pct ?? 0}%`);
    return lines.length
      ? `Goal progress:\n${lines.join("\n")}\n\nTell me which one to push and I'll suggest the next milestone.`
      : "You have no active goals. Use **Plan a goal** below and describe it — I'll break it down.";
  }
  if (t.includes("plan") || t.includes("goal")) {
    return "Describe the outcome and a target date and I'll draft milestones plus a first batch of tasks for your review. Tap **Plan a goal** below to start.";
  }
  return `Got it, ${name}. I can summarize projects, check goals, or point you at the highest-priority task. Connect a local model (Settings → AI provider) for full conversation.`;
}

export async function renderAssistant(view, alive = () => true) {
  if (!messages) {
    const profile = await getProfile();
    const name = profile?.name?.split(" ")[0] || "there";
    messages = [
      {
        role: "ai",
        text: `Hi ${name}. I'm reading your live tasks, projects and goals as we speak.`,
      },
    ];
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
        <div class="chat-suggest-row">
          <button class="chat-suggest-chip" data-plan-goal>${icon("flag")} Plan a goal</button>
          ${suggestions.map((s) => `<button class="chat-suggest-chip" data-suggest="${s}">${s}</button>`).join("")}
        </div>
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

    const scroll = document.getElementById("chat-scroll");
    scroll.scrollTop = scroll.scrollHeight;

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
        reply = await aiService.chatReply(
          messages.filter((m) => m.role === "user" || m.role === "ai"),
          text
        );
      } catch {
        reply = await buildReply(text);
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

    view.querySelectorAll("[data-suggest]").forEach((chip) => {
      chip.addEventListener("click", () => send(chip.dataset.suggest));
    });

    view.querySelector("[data-plan-goal]").addEventListener("click", async () => {
      const created = await runGoalPlanner();
      if (created && alive()) window.location.hash = "#/goals";
    });
  }

  draw();
}
