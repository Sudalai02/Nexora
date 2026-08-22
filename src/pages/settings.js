import { openForm, confirm as confirmModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import * as db from "../store/db.js";
import * as aiService from "../ai/aiService.js";
import { getProfile, saveProfile, getSettings, saveSettings, DEFAULT_SETTINGS } from "../services/settingsService.js";

const sections = [
  { id: "account", label: "Account" },
  { id: "focus", label: "Focus & Pomodoro" },
  { id: "ai", label: "AI & automation" },
  { id: "notifications", label: "Notifications" },
  { id: "calendar", label: "Calendar sync" },
  { id: "privacy", label: "Privacy & data" },
  { id: "workspace", label: "Workspace" },
];

let active = "account";

function switchEl(id, on, label, desc) {
  return `
    <div class="settings-row">
      <div>
        <div class="settings-row-label">${label}</div>
        ${desc ? `<div class="settings-row-desc">${desc}</div>` : ""}
      </div>
      <button class="switch ${on ? "on" : ""}" data-switch="${id}" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${label}"></button>
    </div>
  `;
}

export async function renderSettings(view, alive = () => true) {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!alive()) return;

  function sectionBody(id) {
    if (id === "account") {
      return `
        <div class="settings-section">
          <h3>Profile</h3>
          <div class="sub">Your details — used across the app.</div>
          <div class="settings-row"><div class="settings-row-label">Name</div><div style="display:flex; align-items:center; gap:10px;"><span class="settings-row-desc">${profile?.name || "—"}</span><button class="btn btn-ghost btn-sm" data-edit-profile>Edit</button></div></div>
          <div class="settings-row"><div class="settings-row-label">Email</div><span class="settings-row-desc">${profile?.email || "—"}</span></div>
          <div class="settings-row"><div class="settings-row-label">Sign-in method</div><span class="settings-row-desc">Local device · Firebase auth arrives in the final integration step</span></div>
        </div>
        <div class="settings-section">
          <h3>Session</h3>
          <button class="btn btn-secondary btn-sm" data-soon-auth>Log out</button>
        </div>
      `;
    }
    if (id === "focus") {
      const p = settings.pomodoro;
      return `
        <div class="settings-section">
          <h3>Pomodoro</h3>
          <div class="sub">Defaults used by the Focus timer.</div>
          <div class="settings-row"><div class="settings-row-label">Focus length (min)</div><input type="number" min="5" max="120" step="5" value="${p.focusMinutes}" data-pomo="focusMinutes" style="width:76px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" /></div>
          <div class="settings-row"><div class="settings-row-label">Short break (min)</div><input type="number" min="1" max="30" value="${p.shortBreakMinutes}" data-pomo="shortBreakMinutes" style="width:76px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" /></div>
          <div class="settings-row"><div class="settings-row-label">Long break (min)</div><input type="number" min="5" max="60" value="${p.longBreakMinutes}" data-pomo="longBreakMinutes" style="width:76px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" /></div>
          <div class="settings-row"><div class="settings-row-label">Sessions before long break</div><input type="number" min="2" max="8" value="${p.sessionsBeforeLongBreak}" data-pomo="sessionsBeforeLongBreak" style="width:76px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" /></div>
          <button class="btn btn-primary btn-sm" id="save-pomo" style="margin-top:12px;">Save focus settings</button>
        </div>
      `;
    }
    if (id === "ai") {
      const ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) };
      return `
        <div class="settings-section">
          <h3>Automation</h3>
          <div class="sub">Control what the system can do without asking first.</div>
          ${switchEl("autoSchedule", settings.autoSchedule, "Automatic rescheduling", "Move missed tasks without confirming each time")}
        </div>
        <div class="settings-section">
          <h3>AI provider</h3>
          <div class="sub">Nexora runs entirely on your device: it uses a local model through Ollama when one is available, and silently falls back to built-in smart rules otherwise.</div>
          <div class="settings-row">
            <div class="settings-row-label">Engine preference</div>
            <select data-ai="provider" style="padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;">
              <option value="auto" ${ai.provider === "auto" ? "selected" : ""}>Auto (recommended)</option>
              <option value="heuristic" ${ai.provider === "heuristic" ? "selected" : ""}>Smart rules only</option>
            </select>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">Ollama URL</div>
            <input type="text" data-ai="ollamaUrl" value="${ai.ollamaUrl}" style="width:230px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" />
          </div>
          <div class="settings-row">
            <div class="settings-row-label">Model</div>
            <input type="text" data-ai="model" value="${ai.model}" placeholder="(first available)" style="width:230px; padding:6px 8px; border:1px solid var(--hairline-strong); border-radius:8px;" />
          </div>
          <div style="display:flex; gap:10px; margin-top:14px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="check-ai-btn">Check connection</button>
            <button class="btn btn-primary btn-sm" id="save-ai-btn">Save AI settings</button>
          </div>
          <div id="conn-status" class="conn-status" style="margin-top:12px;"></div>
          <div class="form-hint" style="margin-top:8px;">No local model yet? Install from ollama.com then run <code>ollama pull llama3.2</code>. If Nexora runs on a different port/origin, start Ollama with <code>OLLAMA_ORIGINS=*</code>.</div>
        </div>
      `;
    }
    if (id === "notifications") {
      const n = settings.notifications;
      return `
        <div class="settings-section">
          <h3>Alerts</h3>
          ${switchEl("n-deadline", n.deadline, "Deadline alerts")}
          ${switchEl("n-habit", n.habit, "Habit reminders")}
          ${switchEl("n-morning", n.morning, "Morning briefing")}
          ${switchEl("n-evening", n.evening, "Evening review")}
          ${switchEl("n-risk", n.risk, "Goal risk alerts")}
        </div>
      `;
    }
    if (id === "calendar") {
      return `
        <div class="settings-section">
          <h3>Connected calendars</h3>
          <div class="sub">External calendar integrations are planned for the integrations phase.</div>
          <div class="settings-row"><div class="settings-row-label">Google Calendar</div><button class="btn btn-secondary btn-sm" data-soon>Connect</button></div>
          <div class="settings-row"><div class="settings-row-label">Outlook Calendar</div><button class="btn btn-secondary btn-sm" data-soon>Connect</button></div>
        </div>
      `;
    }
    if (id === "privacy") {
      return `
        <div class="settings-section">
          <h3>Your data</h3>
          <div class="sub">Everything is stored locally on this device right now.</div>
          <div class="settings-row"><div class="settings-row-label">Export all data</div><button class="btn btn-secondary btn-sm" id="export-btn">Export JSON</button></div>
          <div class="settings-row"><div class="settings-row-label">Delete account</div><button class="btn btn-danger btn-sm" data-soon-account>Delete</button></div>
        </div>
      `;
    }
    if (id === "workspace") {
      return `
        <div class="settings-section">
          <h3>Workspace</h3>
          <div class="settings-row"><div class="settings-row-label">Current workspace</div><span class="settings-row-desc">${profile?.workspace || "Personal workspace"}</span></div>
          <div class="settings-row"><div class="settings-row-label">Type</div><span class="settings-row-desc">Personal · team workspaces arrive with collaboration</span></div>
        </div>
      `;
    }
    return "";
  }

  function draw() {
    view.innerHTML = `
      <div class="page-header">
        <h1>Settings</h1>
      </div>
      <div class="settings-layout">
        <div class="settings-nav">
          ${sections.map((s) => `<button class="settings-nav-item ${active === s.id ? "active" : ""}" data-section="${s.id}">${s.label}</button>`).join("")}
        </div>
        <div>${sectionBody(active)}</div>
      </div>
    `;
    wire();
  }

  function wire() {
    view.querySelectorAll("[data-section]").forEach((btn) =>
      btn.addEventListener("click", () => {
        active = btn.dataset.section;
        draw();
      })
    );

    // Persisted switches
    view.querySelectorAll("[data-switch]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.classList.toggle("on");
        const on = btn.classList.contains("on");
        btn.setAttribute("aria-checked", String(on));
        const key = btn.dataset.switch;

        if (key === "autoSchedule") await saveSettings({ autoSchedule: on });
        else if (key.startsWith("n-")) {
          const map = { "n-deadline": "deadline", "n-habit": "habit", "n-morning": "morning", "n-evening": "evening", "n-risk": "risk" };
          const notifications = { ...DEFAULT_SETTINGS.notifications, ...settings.notifications, [map[key]]: on };
          settings.notifications = notifications;
          await saveSettings({ notifications });
        }
        toast(on ? "Enabled" : "Disabled");
      })
    );

    // Pomodoro save
    view.querySelector("#save-pomo")?.addEventListener("click", async () => {
      const read = (k) => Number(view.querySelector(`[data-pomo="${k}"]`).value);
      const pomodoro = {
        focusMinutes: Math.min(120, Math.max(5, read("focusMinutes"))),
        shortBreakMinutes: Math.min(30, Math.max(1, read("shortBreakMinutes"))),
        longBreakMinutes: Math.min(60, Math.max(5, read("longBreakMinutes"))),
        sessionsBeforeLongBreak: Math.min(8, Math.max(2, read("sessionsBeforeLongBreak"))),
      };
      Object.assign(settings.pomodoro, pomodoro);
      await saveSettings({ pomodoro });
      toast("Focus settings saved");
    });

    // Profile edit
    view.querySelector("[data-edit-profile]")?.addEventListener("click", async () => {
      const res = await openForm({
        title: "Edit profile",
        values: { name: profile?.name || "", email: profile?.email || "", workspace: profile?.workspace || "" },
        fields: [
          { name: "name", label: "Name", required: true },
          { name: "email", label: "Email" },
          { name: "workspace", label: "Workspace name" },
        ],
      });
      if (!res) return;
      Object.assign(profile, await saveProfile(res));
      toast("Profile updated");
      draw();
    });

    // AI provider settings
    view.querySelector("#save-ai-btn")?.addEventListener("click", async () => {
      const aiSettings = {
        provider: view.querySelector('[data-ai="provider"]').value,
        ollamaUrl: view.querySelector('[data-ai="ollamaUrl"]').value.trim() || DEFAULT_SETTINGS.ai.ollamaUrl,
        model: view.querySelector('[data-ai="model"]').value.trim(),
      };
      settings.ai = aiSettings;
      await saveSettings({ ai: aiSettings });
      toast("AI settings saved");
      draw();
    });

    view.querySelector("#check-ai-btn")?.addEventListener("click", async () => {
      const url = view.querySelector('[data-ai="ollamaUrl"]').value.trim() || DEFAULT_SETTINGS.ai.ollamaUrl;
      const status = view.querySelector("#conn-status");
      status.className = "conn-status";
      status.textContent = "Checking…";
      const p = await aiService.probe(url, true);
      if (p.available && p.models.length) {
        status.className = "conn-status ok";
        status.innerHTML = `Connected — ${p.models.length} model${p.models.length === 1 ? "" : "s"} available:<br/><span class="conn-models">${p.models.slice(0, 6).map((m) => m.split(":")[0]).join(", ")}</span>`;
      } else if (p.available) {
        status.className = "conn-status warn";
        status.textContent = "Ollama is running but no models are pulled yet. Try: ollama pull llama3.2";
      } else {
        status.className = "conn-status err";
        status.textContent = "Could not reach Ollama. Is it installed and running? Smart rules remain active meanwhile.";
      }
    });

    // Export
    view.querySelector("#export-btn")?.addEventListener("click", async () => {
      const dump = {};
      for (const store of db.STORES) dump[store] = await db.getAll(store);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nexora-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Export downloaded");
    });

    view.querySelectorAll("[data-soon]").forEach((b) =>
      b.addEventListener("click", () => toast("Arrives with the integrations phase"))
    );
    view.querySelectorAll("[data-soon-auth]").forEach((b) =>
      b.addEventListener("click", () => toast("Accounts arrive with Firebase authentication"))
    );
    view.querySelectorAll("[data-soon-account]").forEach((b) =>
      b.addEventListener("click", () => toast("Account deletion arrives with Firebase authentication"))
    );
  }

  draw();
}
