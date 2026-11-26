"use strict";

// main.js — the render dispatcher, the session-timeout watchdog, the swipe-gesture
// handlers, and the app-wide INIT (checkAuth + startSessionTimeout) at the very end.
//
// This file is loaded LAST in the script chain so by the time INIT runs every
// identifier it references from the other /js/*.js files is defined.
//
// Everything that used to live here that was a distinct concern has moved out:
//    the Supabase client     → sb.js
//    the small helpers        → helpers.js
//    the deep-link router     → router.js
//    the role predicates      → roles.js
//
// What remains is genuinely cross-cutting: the render() dispatcher that picks
// a view by S.view, the auto-refresh and session-timeout loops that watch the
// session on an interval, and the INIT at the end of the file that kicks
// everything off.

// ══════════════════════════════════════════════════════
// VIEWS

// ══════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════
// Side-effect import: initializes Sentry if VITE_SENTRY_DSN is set at build.
// Loaded first so a crash in any later module import still gets reported.
import "./sentry.js";
import { S, persistAvailDraft, persistOfflineCache } from "./state.js";
import {
  loadAvailSubmissions,
  loadEmployees,
  loadJoinRequests,
  loadSchedule,
  loadSwapRequests,
  loadVacations,
} from "./data.js";
import { $, _closeDialog, div, e, getWeekDates, israelNow, toast } from "./utils.js";
import { viewLoading, viewLogin, viewMfaChallenge, viewMfaEnroll } from "./views-auth.js";
import { checkAuth, viewPasswordReset } from "./router.js";
import { isManager } from "./roles.js";
// Authenticated-view modules are lazy-loaded via view-registry.js — they are
// about 2/3 of the whole bundle and nothing shown pre-login references them.
// These thin wrappers keep every call site below unchanged while routing each
// call through the registry cache, which preloadAuthenticatedViews() populates
// early in loadAll().
import { getView } from "./view-registry.js";
const viewConstraintsModal = (...a) => getView("viewConstraintsModal")(...a);
const viewEmpView = (...a) => getView("viewEmpView")(...a);
const viewEmployees = (...a) => getView("viewEmployees")(...a);
const viewExportModal = (...a) => getView("viewExportModal")(...a);
const viewHeader = (...a) => getView("viewHeader")(...a);
const viewHome = (...a) => getView("viewHome")(...a);
const viewPreviewSelectModal = (...a) => getView("viewPreviewSelectModal")(...a);
const viewPublishModal = (...a) => getView("viewPublishModal")(...a);
const viewSchedule = (...a) => getView("viewSchedule")(...a);
const viewSwaps = (...a) => getView("viewSwaps")(...a);
const viewVacations = (...a) => getView("viewVacations")(...a);
const viewAnalytics = (...a) => getView("viewAnalytics")(...a);
const viewCalendar = (...a) => getView("viewCalendar")(...a);
const viewEmpSettings = (...a) => getView("viewEmpSettings")(...a);
const viewManagerBlocks = (...a) => getView("viewManagerBlocks")(...a);
const viewQualifications = (...a) => getView("viewQualifications")(...a);
const viewSettings = (...a) => getView("viewSettings")(...a);
import { filterNavByFeatures, fmtDate } from "./helpers.js";
import { DAYS } from "./constants.js";
import { sendEmail } from "./audit.js";
import { sb } from "./sb.js";
export let _touchStartX = null,
  _touchStartY = null;
export function setupSwipeGestures() {
  document.removeEventListener("touchstart", _onTouchStart);
  document.removeEventListener("touchend", _onTouchEnd);
  document.addEventListener("touchstart", _onTouchStart, { passive: true });
  document.addEventListener("touchend", _onTouchEnd, { passive: true });
}
export function _onTouchStart(e) {
  if (e.touches.length !== 1) return;
  _touchStartX = e.touches[0].clientX;
  _touchStartY = e.touches[0].clientY;
}
export function _onTouchEnd(e) {
  if (_touchStartX == null) return;
  const dx = e.changedTouches[0].clientX - _touchStartX;
  const dy = e.changedTouches[0].clientY - _touchStartY;
  _touchStartX = null;
  // Must be a horizontal swipe (more X than Y, more than 80px)
  if (Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
  // Don't trigger on inputs or buttons
  const t = e.target;
  if (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "BUTTON" ||
    t.tagName === "SELECT"
  )
    return;
  if (t.closest(".modal,.bottom-sheet,.emp-chip,.shift-cell")) return;

  // Only swipe in schedule views
  if (S.view === "schedule") {
    // If in mobile day mode, swipe between days
    if (S.schedMobileView === "day") {
      if (dx > 0) {
        // Next day
        if (S.schedDayIdx < 6) {
          S.schedDayIdx++;
          render();
        } else {
          S.weekOffset++;
          S.schedDayIdx = 0;
          loadSchedule().then(() => render());
        }
      } else {
        // Prev day
        if (S.schedDayIdx > 0) {
          S.schedDayIdx--;
          render();
        } else {
          S.weekOffset--;
          S.schedDayIdx = 6;
          loadSchedule().then(() => render());
        }
      }
    } else {
      // RTL: swipe right (positive dx) = next week, swipe left = prev week
      if (dx > 0) {
        S.weekOffset++;
        loadSchedule().then(() => render());
      } else {
        S.weekOffset--;
        loadSchedule().then(() => render());
      }
    }
  } else if (S.view === "calendar") {
    if (dx > 0) {
      S.monthOffset++;
      render();
    } else {
      S.monthOffset--;
      render();
    }
  } else if (S.view === "empview" && S.empViewTab === "schedule") {
    if (dx > 0) {
      S.weekOffset++;
      loadSchedule().then(() => render());
    } else {
      S.weekOffset--;
      loadSchedule().then(() => render());
    }
  }
}

export function render() {
  // Persist current avail-draft (cheap; no-op when nothing to save).
  persistAvailDraft();
  const app = $("app");
  // Preserve scroll position across the render, otherwise every state change causes the
  // page to jump back to the top (very noticeable on mobile when clicking a shift cell).
  const savedScroll = window.scrollY;
  // Also preserve horizontal scroll of the schedule table wrapper (RTL: measured from right).
  const oldSchedWrap = app.querySelector(".sched-wrap");
  const savedSchedScrollLeft = oldSchedWrap ? oldSchedWrap.scrollLeft : null;
  app.innerHTML = "";

  if (S.view === "loading") {
    app.appendChild(viewLoading());
    return;
  }
  if (S.view === "login") {
    app.appendChild(viewLogin());
  } else if (S.view === "mfa_enroll") {
    app.appendChild(viewMfaEnroll());
  } else if (S.view === "mfa_challenge") {
    app.appendChild(viewMfaChallenge());
  } else if (S.view === "password_reset") {
    app.appendChild(viewPasswordReset());
  } else {
    const appWrap = div("app");
    appWrap.appendChild(viewHeader());
    // Prominent offline banner — makes it obvious why actions may be limited.
    if (!S._online) {
      const ageTxt =
        S._offlineAge != null
          ? S._offlineAge < 60
            ? "לפני " + S._offlineAge + " דק'"
            : "לפני " + Math.floor(S._offlineAge / 60) + " שעות"
          : "";
      appWrap.appendChild(
        e(
          "div",
          {
            role: "status",
            "aria-live": "polite",
            style:
              "background:linear-gradient(90deg,#EF444422,#F9731622);border-bottom:1px solid #EF444455;padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;color:#FCA5A5;font-weight:600",
          },
          [
            e("span", { style: "font-size:18px" }, "📡"),
            e(
              "span",
              {},
              "אין חיבור לרשת · מציג מידע שמור" +
                (ageTxt ? " מ" + ageTxt : "") +
                " · פעולות שמירה לא זמינות"
            ),
          ]
        )
      );
    }
    const main = div("main");

    if (S.view === "home") main.appendChild(viewHome());
    else if (S.view === "schedule" && !isManager()) {
      S.empViewTab = "schedule";
      main.appendChild(viewEmpView());
    } // employees get read-only view with export buttons
    else if (S.view === "schedule") main.appendChild(viewSchedule());
    else if (S.view === "calendar") main.appendChild(viewCalendar());
    else if (S.view === "employees" && isManager()) main.appendChild(viewEmployees());
    else if (S.view === "employees" && !isManager()) {
      S.view = "empview";
      main.appendChild(viewEmpView());
    } else if (S.view === "manager_blocks" && isManager())
      main.appendChild(viewManagerBlocks()); // <--- הוסף את השורה הזו כאן!
    else if (S.view === "vacations" && !isManager()) {
      S.empViewTab = "vacation";
      main.appendChild(viewEmpView());
    } else if (S.view === "vacations") main.appendChild(viewVacations());
    else if (S.view === "swaps" && !isManager()) {
      S.empViewTab = "swaps_emp";
      main.appendChild(viewEmpView());
    } else if (S.view === "swaps") main.appendChild(viewSwaps());
    else if (S.view === "blocks") {
      S.empViewTab = "avail";
      main.appendChild(viewEmpView());
    } else if (S.view === "emp_settings") main.appendChild(viewEmpSettings());
    else if (S.view === "empview") main.appendChild(viewEmpView());
    else if (S.view === "settings") main.appendChild(viewSettings());
    else if (S.view === "qualifications" && isManager()) main.appendChild(viewQualifications());
    else if (S.view === "analytics" && isManager()) main.appendChild(viewAnalytics());

    appWrap.appendChild(main);
    app.appendChild(appWrap);

    // Modals
    if (S.constraintsEmp) app.appendChild(viewConstraintsModal());
    if (S.showPublishModal) app.appendChild(viewPublishModal());
    if (S.showPreviewSelectModal) app.appendChild(viewPreviewSelectModal());
    if (S.showExportModal) app.appendChild(viewExportModal());
  }

  // Mobile bottom nav
  if (S.view !== "login" && S.view !== "loading") {
    const pendingVacs2 = S.vacations.filter((v) => v.status === "pending").length;
    const bottomNav = e("div", {
      class: "mobile-bottom-nav",
      style: "overflow-x:auto;-webkit-overflow-scrolling:touch",
    });
    const isEmpOnly = S.profile?.role === "employee";
    const bottomTabs = isEmpOnly
      ? [
          { id: "empview", icon: "📋", label: "שלי" },
          { id: "schedule", icon: "📅", label: "סידור" },
          { id: "mymonth_nav", icon: "📆", label: "החודש שלי" },
          { id: "blocks", icon: "🚫", label: "חסימות" },
          { id: "vacations", icon: "🌴", label: "היעדרויות" },
          { id: "swaps_nav", icon: "🔄", label: "חילופים" },
          { id: "emp_settings", icon: "⚙️", label: "הגדרות" },
        ]
      : [
          { id: "home", icon: "🏠", label: "בית" },
          { id: "schedule", icon: "📅", label: "סידור" },
          { id: "calendar", icon: "🗓️", label: "חודש" },
          { id: "employees", icon: "👥", label: "עובדים" },
          { id: "manager_blocks", icon: "🚫", label: "חסימות" },
          { id: "qualifications", icon: "🎯", label: "כשירות" },
          { id: "vacations", icon: "🌴", label: "היעדרויות", badge: pendingVacs2 },
          { id: "swaps", icon: "🔄", label: "חילופים" },
          { id: "analytics", icon: "📊", label: "אנליטיקה" },
          { id: "settings", icon: "⚙️", label: "הגדרות" },
        ];
    const filteredBottomTabs = filterNavByFeatures(bottomTabs);
    filteredBottomTabs.forEach((t) => {
      const isActive = S.view === t.id;
      const btn2 = e(
        "button",
        {
          style: `flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10px 4px 8px;border:none;border-top:2px solid ${isActive ? "#3B82F6" : "transparent"};background:transparent;color:${isActive ? "#3B82F6" : "#64748B"};font-family:inherit;cursor:pointer;position:relative;min-height:56px;transition:color 0.15s`,
          onclick: () => {
            if (t.id === "swaps_nav") {
              S.view = "empview";
              S.empViewTab = "swaps_emp";
              S.selectedCell = null;
              render();
            } else if (t.id === "mymonth_nav") {
              S.view = "empview";
              S.empViewTab = "mymonth";
              S.selectedCell = null;
              render();
            } else if (t.id === "empview") {
              S.view = "empview";
              S.empViewTab = "shifts";
              S.selectedCell = null;
              render();
            } else {
              S.view = t.id;
              S.selectedCell = null;
              render();
            }
          },
        },
        [
          t.badge > 0
            ? e(
                "span",
                {
                  style:
                    "position:absolute;top:6px;right:calc(50% - 16px);background:#EF4444;color:white;border-radius:50%;width:14px;height:14px;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center",
                },
                String(t.badge)
              )
            : null,
          e("span", { style: "font-size:22px;line-height:1" }, t.icon),
          e(
            "span",
            { style: `font-size:10px;font-weight:${isActive ? "700" : "500"};margin-top:1px` },
            t.label
          ),
        ]
      );
      bottomNav.appendChild(btn2);
    });
    app.appendChild(bottomNav);
  }

  // Toast — aria-live announces to screen readers; assertive for errors (interrupt),
  // polite for success (wait for current speech to finish).
  if (S.toast) {
    const isErr = S.toast.type === "err";
    const icon = isErr ? "⚠️" : "✓";
    const toastEl = e(
      "div",
      {
        class: "toast" + (isErr ? " err" : ""),
        role: "status",
        "aria-live": isErr ? "assertive" : "polite",
        "aria-atomic": "true",
      },
      [
        e("span", { class: "toast-icon", "aria-hidden": "true" }, icon),
        e("span", { class: "toast-msg" }, S.toast.msg),
        S.toast.undo
          ? e(
              "button",
              {
                class: "toast-close",
                style:
                  "background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);padding:4px 12px;border-radius:8px;color:white;font-weight:700;font-size:12px;margin-left:8px",
                onclick: async () => {
                  const fn = S.toast.undo;
                  S.toast = null;
                  render();
                  try {
                    await fn();
                    toast("בוטל ✓");
                  } catch (err) {
                    toast("ביטול נכשל", "err");
                  }
                },
              },
              "↶ בטל"
            )
          : null,
        e(
          "button",
          {
            class: "toast-close",
            "aria-label": "סגור הודעה",
            onclick: () => {
              S.toast = null;
              render();
            },
          },
          "✕"
        ),
      ]
    );
    app.appendChild(toastEl);
  }
  // Custom dialog (replaces browser confirm/prompt/alert)
  if (S.dialog) {
    const d = S.dialog;
    const okBtnClass =
      "dlg-btn dlg-btn-" +
      (d.tone === "danger" ? "danger" : d.tone === "warn" ? "warn" : "primary");
    const inputEl =
      d.kind === "prompt"
        ? e("input", {
            class: "dlg-input",
            type: "text",
            value: d.defaultValue || "",
            placeholder: d.placeholder || "",
            id: "_dlg_input",
            onkeydown: (ev) => {
              if (ev.key === "Enter") _closeDialog(ev.target.value);
              if (ev.key === "Escape") _closeDialog(null);
            },
          })
        : null;
    const backdrop = e(
      "div",
      {
        class: "dlg-backdrop",
        onclick: (ev) => {
          if (ev.target === ev.currentTarget) _closeDialog(d.kind === "confirm" ? false : null);
        },
      },
      [
        e("div", { class: "dlg", onclick: (ev) => ev.stopPropagation() }, [
          e("div", { class: "dlg-icon " + d.tone }, d.icon),
          e("div", { class: "dlg-title" }, d.title),
          d.message ? e("div", { class: "dlg-msg" }, d.message) : null,
          inputEl,
          e("div", { class: "dlg-actions" }, [
            d.kind !== "alert"
              ? e(
                  "button",
                  {
                    class: "dlg-btn dlg-btn-ghost",
                    onclick: () => _closeDialog(d.kind === "confirm" ? false : null),
                  },
                  d.cancelLabel
                )
              : null,
            e(
              "button",
              {
                class: okBtnClass,
                onclick: () => {
                  if (d.kind === "prompt") {
                    const inp = document.getElementById("_dlg_input");
                    _closeDialog(inp ? inp.value : "");
                  } else if (d.kind === "confirm") {
                    _closeDialog(true);
                  } else {
                    _closeDialog();
                  }
                },
              },
              d.okLabel
            ),
          ]),
        ]),
      ]
    );
    app.appendChild(backdrop);
    if (d.kind === "prompt") {
      setTimeout(() => {
        const i = document.getElementById("_dlg_input");
        if (i) {
          i.focus();
          i.select();
        }
      }, 50);
    }
  }

  // Restore scroll position after the DOM is rebuilt so users don't jump to top on every
  // interaction. rAF ensures the new DOM has been laid out before we scroll.
  requestAnimationFrame(() => {
    if (savedScroll > 0) window.scrollTo(0, savedScroll);
    const newSchedWrap = app.querySelector(".sched-wrap");
    if (newSchedWrap) {
      if (savedSchedScrollLeft !== null) {
        // Restore the horizontal scroll from before this render.
        newSchedWrap.scrollLeft = savedSchedScrollLeft;
      } else {
        // First time we're seeing the schedule — scroll today's column into view so the
        // user lands on the current day rather than the start of the week.
        // scrollIntoView handles RTL correctly on iOS/Chrome/Safari without manual math.
        const todayCell = newSchedWrap.querySelector(".day-header.is-today");
        if (todayCell) {
          try {
            todayCell.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
          } catch (_) {
            // Older browsers don't support "instant"; fall back to default.
            todayCell.scrollIntoView({ block: "nearest", inline: "center" });
          }
        }
      }
    }
  });

  // Parse emoji → SVG via Twemoji (if loaded). Guarantees colorful emoji on every
  // platform including Windows without Segoe UI Emoji / Linux / ChromeOS.
  if (typeof twemoji !== "undefined") {
    try {
      twemoji.parse(document.body, {
        folder: "svg",
        ext: ".svg",
        base: "https://cdn.jsdelivr.net/gh/jdecked/twemoji@14.1.2/assets/",
      });
    } catch (e) {
      /* non-fatal */
    }
  }
}

// PWA install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  // Don't prevent default — just save the event for later
  S.pwaPrompt = e;
});

// Service worker registration
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// AUTO-REMINDER CHECK
export async function checkAutoReminder() {
  if (!isManager()) return;
  const biz = S.business;
  if (!biz) return;
  // Business-local (Israel) — the reminder fires when it's time at the business,
  // not when it happens to be that time on the admin's device.
  const now = israelNow();
  const currentTime =
    String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  // ─── Auto-reminder for blocks submission ───
  if (biz.reminder_day == null) return;
  if (now.getDay() !== biz.reminder_day) return;
  if (currentTime < (biz.reminder_time || "09:00")) return;
  const sentKey = "reminder_sent_" + now.getDay() + "_" + getWeekDates(1)[0];
  if (localStorage.getItem(sentKey)) return;
  const nextWD = getWeekDates(1);
  const sub = S.availSubmissions
    .filter((s) => s.week_start === nextWD[0])
    .map((s) => s.employee_id);
  const notSub = S.employees.filter(
    (emp) => !sub.includes(emp.id) && emp.email && emp.role !== "admin" && emp.role !== "manager"
  );
  if (notSub.length === 0) return;
  for (const emp of notSub) {
    const adlDay = S.business?.deadline_day;
    const adlTime = S.business?.deadline_time || "20:00";
    const adlText = adlDay != null ? "יום " + DAYS[adlDay] + " בשעה " + adlTime : "";
    await sendEmail("reminder", emp.email, {
      weekLabel: fmtDate(nextWD[0]) + " — " + fmtDate(nextWD[6]),
      deadline: adlText,
    });
  }
  localStorage.setItem(sentKey, "1");
}

// SILENT REFRESH — reload data after actions + every 30 seconds
export let _autoRefreshTimer = null;
export let _refreshDebounce = null;

export function isUserBusy() {
  if (S.selectedCell) return true;
  if (S.constraintsEmp) return true;
  if (S.showAddEmp) return true;
  if (S.showAddVac) return true;
  if (S.showMgrAddVac) return true; // manager's add-vacation form
  if (S.showInviteModal) return true; // invite-new-employee modal (has email/name inputs)
  if (S.showPublishModal) return true;
  if (S.showPreviewSelectModal) return true;
  if (S.showExportModal) return true;
  if (S.showWeekNotes) return true;
  if (S.showSwapModal) return true;
  if (S.dialog) return true; // custom confirm/prompt/alert dialog is open
  if (S._datePickerOpen) return true; // any date/time picker is currently open
  // Only count as "busy" when the user is MID-EDIT — not just viewing a page.
  // The old behavior treated the whole blocks page as busy, which killed every
  // realtime push while the user was there (own submissions, manager approvals,
  // peer updates). Now viewing is fine; only an unsaved draft or a focused input blocks a refresh.
  if (Object.values(S.availDraft || {}).some(Boolean)) return true;
  // Any input/textarea/select focused
  if (
    document.activeElement &&
    (document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA" ||
      document.activeElement.tagName === "SELECT")
  )
    return true;
  return false;
}

export function silentRefresh() {
  clearTimeout(_refreshDebounce);
  _refreshDebounce = setTimeout(async () => {
    if (!S.user || S.view === "login" || S.view === "loading") return;
    if (isUserBusy()) {
      return;
    }
    try {
      await Promise.all([
        loadSchedule(),
        loadAvailSubmissions(),
        loadSwapRequests(),
        loadVacations(),
        loadEmployees(),
        loadJoinRequests(),
      ]);
      S._lastDataRefresh = Date.now();
      S._online = true;
      persistOfflineCache();
      render();
    } catch (err) {
      console.warn("🔄 Refresh failed:", err);
      // Mark offline so the banner appears; realtime 'online' event will flip it back.
      if (navigator.onLine === false) {
        S._online = false;
        render();
      }
    }
  }, 1500);
}

export function startAutoRefresh() {
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshTimer = setInterval(() => {
    if (!isUserBusy()) silentRefresh();
  }, 30000);
}

// ═══ Session timeout — force re-login (and 2FA) after idle inactivity ═══
// Reasoning: Supabase sessions last for hours/days by default. We still want a
// forced re-auth so a shared/stolen device can't keep the window open, but 30 min
// was too aggressive for day-to-day admin work (owner request 2026-11-26). 2 hours
// balances security with the practical pattern of leaving the tab open while
// working in other windows.
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export let _lastActivityMs = Date.now();
export let _sessionTimeoutTimer = null;
export function bumpActivity() {
  _lastActivityMs = Date.now();
}
// Activity events — include input/change/focus so filling a long form while the iOS
// date-wheel is open (no scroll/keydown) still counts as activity and avoids a
// mid-form session timeout.
[
  "mousedown",
  "keydown",
  "touchstart",
  "touchmove",
  "scroll",
  "input",
  "change",
  "focus",
  "pointerdown",
].forEach((ev) => window.addEventListener(ev, bumpActivity, { passive: true, capture: true }));
export function startSessionTimeout() {
  if (_sessionTimeoutTimer) clearInterval(_sessionTimeoutTimer);
  _lastActivityMs = Date.now();
  _sessionTimeoutTimer = setInterval(async () => {
    if (!S.user || S.view === "login" || S.view === "loading") return;
    if (S.view === "mfa_enroll" || S.view === "mfa_challenge" || S.view === "password_reset")
      return; // mid-auth
    if (Date.now() - _lastActivityMs < SESSION_TIMEOUT_MS) return;
    try {
      clearInterval(_sessionTimeoutTimer);
      clearInterval(_autoRefreshTimer);
      await sb.auth.signOut();
      toast("ההתחברות פגה — נא להתחבר מחדש");
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      console.warn("Session timeout sign-out failed:", err);
      location.reload();
    }
  }, 30000); // check every 30s
}

// INIT
checkAuth();
startSessionTimeout();
