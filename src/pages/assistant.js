// ============================================================
// AI ASSISTANT
//
// A prompt library of 32 intelligent prompts, every one answered
// dynamically from live data — never canned text. When a local
// Ollama model is available it handles conversation with full
// context; otherwise the rule-based engine computes honest,
// data-grounded answers from the live store.
// ============================================================

import { icon } from "../dom.js";
import { getProfile } from "../services/settingsService.js";
import * as aiService from "../ai/aiService.js";
import { runGoalPlanner } from "../ui/goalPlanner.js";
import { PROMPTS, matchPrompt, categories } from "../ai/prompts.js";

let messages = null;

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

export async function renderAssistant(view, alive = () => true) {
  if (!messages) {
    const profile = await getProfile();
    const name = profile?.name?.split(" ")[0] || "there";
    messages = [{ role: "ai", text: `Hi ${name}. I read your live tasks, projects, goals, habits and focus history — ask me anything below.` }];
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
          <summary>${icon("spark")} Prompt library · ${PROMPTS.length} prompts</summary>
          <div class="prompt-picker">
            <input type="text" id="prompt-search" placeholder="Filter prompts…" autocomplete="off" />
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

    // ---- Send logic: try prompt handler first, then Ollama, then fallback ----
    let busy = false;
    async function send(text) {
      if (!text.trim() || busy) return;
      busy = true;
      messages.push({ role: "user", text });
      draw(true);

      let reply;
      // 1. Try matching a prompt handler from the library
      const matched = matchPrompt(text);
      if (matched) {
        try {
          reply = await matched.handler();
        } catch (err) {
          console.error("[assistant] prompt handler failed", err);
        }
      }

      // 2. If no handler matched, try Ollama for free-form chat
      if (!reply) {
        try {
          reply = await aiService.chatReply(messages.slice(-9), text);
        } catch {
          // 3. Last resort: generic fallback
          const profile = await getProfile();
          const name = profile?.name?.split(" ")[0] || "there";
          reply = `I can help with planning, task prioritization, goal tracking, habit analysis, focus insights, and more — try a prompt from the library, ${name}. For free-form chat, connect a local model in Settings \u2192 AI provider.`;
        }
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

    // ---- Prompt library: grouped by category, click to send directly ----
    const lib = view.querySelector("#prompt-library");
    const searchEl = view.querySelector("#prompt-search");
    const listEl = view.querySelector("#prompt-list");

    function renderPromptList() {
      const q = (searchEl?.value || "").toLowerCase().trim();
      const cats = categories();

      const grouped = {};
      for (const cat of cats) grouped[cat] = [];
      for (const p of PROMPTS) {
        if (!q || p.label.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.prompt && p.prompt.toLowerCase().includes(q))) {
          grouped[p.category].push(p);
        }
      }

      let html = "";
      for (const cat of cats) {
        const items = grouped[cat];
        if (!items.length) continue;
        html += `<div class="prompt-category">${cat}</div>`;
        for (const p of items) {
          html += `<button type="button" class="prompt-option" data-prompt-id="${p.id}">${p.label}</button>`;
        }
      }

      if (!html) {
        html = `<div class="prompt-empty">No prompts match "${q}" — just send your own question.</div>`;
      }

      listEl.innerHTML = html;
      listEl.querySelectorAll("[data-prompt-id]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const prompt = PROMPTS.find((p) => p.id === btn.dataset.promptId);
          if (prompt) send(prompt.label);
          lib.removeAttribute("open");
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
