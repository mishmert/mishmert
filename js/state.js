// state.js — the S object (app state) and the state-persistence layer.
// Extracted from index.html on 2026-11-24.
//
// Contents:
//  - let S = { ... }   : the single app-wide state object (also published as window.S).
//  - AVAIL-DRAFT PERSISTENCE   : localStorage save/restore of in-progress block selections.
//  - iOS picker tracking       : openPickerCount guard so silentRefresh doesn't yank a
//                                live <input type=date|time> wheel out from under the user.
//  - OFFLINE MODE              : last-known-good snapshot of core state so the app shows
//                                data without a network on cold load.
//  - online/offline listeners  : re-render on connectivity changes.
//  - beforeunload warning      : asks before losing unsaved availability drafts.
//
// Several helpers call render(), loadAll(), silentRefresh(), toast(), isUserBusy() —
// those live in the inline app script and resolve at call time via the shared
// global scope that classic <script>s share.

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
"use strict";

import { SHIFTS, SHIFT_BY_ID, SHIFT_LABELS, WEEKEND_SHIFTS } from './constants.js';
import { render, silentRefresh } from './main.js';
import { toast } from './utils.js';
export let S = {
  view: "loading",
  user: null, profile: null, business: null,
  employees: [], vacations: [], swapRequests: [], availSubmissions: [],
  schedule: {},         // { [dateStr]: { [shiftId]: [empId,...] } }
  publishedWeeks: new Set(),
  lockedSlots: {},      // { "date|shift": Set<empId> }
  customHours: {},      // { "date|shift|empId": {start,end} }
  assignmentNotes: {},  // { "date|shift|empId": "note text" }
  systems: [],  // shared system tags (e.g. ["Google", "Firewall", "EDR"])
  invitations: [],
  showInviteModal: false,
  newInvitation: { name: "", email: "", role: "employee" },
  weekOffset: 0,
  selectedCell: null,   // { date, shift }
  constraintsEmp: null,
  empViewId: null, empViewTab: "shifts",
  showAddEmp: false, showAddVac: false, showMgrAddVac: false, showSwapModal: false,
  showPublishModal: false, swapMyShift: null, swapTargetShift: null, empSwapTab: "swap", handoverShift: null, handoverTarget: null, showShiftEditor: false, publishType: 'final', publishVisibleUntil: null, scheduleExpired: false,
  newEmp: {name:"",email:"",idNumber:"",phone:"",role:"employee"},
  newVac: {employeeId:"",startDate:"",endDate:"",reason:""},
  availDraft: {}, availTargetOffset: null,
  testAsEmployee: false, blockReasons: {}, schedPublishType: {}, publishedInitial: null, monthOffset: 0, blocksWeekOffset: 0, swapWeekOffset: 0, mgrBlocksTab: "team", mgrSwapsTab: "approve", mgrVacTab: "approve", scheduleBackup: null, scheduleUndoStack: [], scheduleRedoStack: [], schedMobileView: "week", schedDayIdx: null, qualHistory: null,
  empScheduleFilter: null, // empId to filter the read-only employee schedule grid by, or null = show everyone
  myMonthOffset: 0, myMonthData: null, myMonthKey: null,
  analyticsPeriod: 3, analyticsData: null, analyticsKey: null,
  bizInvitesLoaded: false, bizInvites: [],

  calendarMonthData: null, calendarMonthKey: null,
  currentPublishType: null, showBlocksModal: false,
  toast: null, modal: null,
  loginMode: "login",
};
window.S = S;  // Expose state to debug helpers

// Reset S to a fresh object (e.g. on logout). Must live in state.js because
// an imported binding cannot be reassigned from the outside — only the
// module that declared `let S` can rebind it, and callers see the new value
// through the live binding.
export function resetState(partial) {
  S = { ...S, ...partial };
  window.S = S;
}


// ── AVAIL-DRAFT PERSISTENCE ──
// Save unfinished block selections to localStorage so a refresh, tab-crash or
// accidental log-out doesn't lose work. Keyed per-user so switching accounts
// doesn't leak across logins. Restored by loadAll() after a successful login.
export function persistAvailDraft() {
  try {
    if (!S.user) return;
    const draft = S.availDraft || {};
    const hasAny = Object.values(draft).some(Boolean);
    const key = "availDraft_" + S.user.id;
    if (!hasAny || !S._draftWeek) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      draft, week: S._draftWeek, reasons: S.blockReasons || {}, savedAt: Date.now()
    }));
  } catch(_){}
}
export function restoreAvailDraft() {
  try {
    if (!S.user) return;
    const raw = localStorage.getItem("availDraft_" + S.user.id);
    if (!raw) return;
    const payload = JSON.parse(raw);
    // Discard anything older than 14 days — stale drafts just confuse.
    if (!payload || !payload.savedAt || Date.now() - payload.savedAt > 14*86400000) {
      localStorage.removeItem("availDraft_" + S.user.id);
      return;
    }
    S.availDraft = payload.draft || {};
    S._draftWeek = payload.week || null;
    S.blockReasons = payload.reasons || {};
  } catch(_){}
}
export function clearPersistedAvailDraft() {
  try { if (S.user) localStorage.removeItem("availDraft_" + S.user.id); } catch(_){}
}

// Track open date/time pickers globally. On iOS, any re-render while the native wheel
// picker is open (realtime push, auto-refresh, animation) destroys the input element
// and dismisses the picker — the user has no chance to pick anything. We flag the open
// state here and read it from isUserBusy() so silentRefresh skips while picking.
document.addEventListener("focusin", function(ev){
  const t = ev.target;
  if (t && t.tagName === "INPUT" && (t.type === "date" || t.type === "datetime-local" || t.type === "time" || t.type === "month" || t.type === "week")) {
    S._datePickerOpen = true;
  }
}, true);
document.addEventListener("focusout", function(ev){
  const t = ev.target;
  if (t && t.tagName === "INPUT" && (t.type === "date" || t.type === "datetime-local" || t.type === "time" || t.type === "month" || t.type === "week")) {
    // Clear after a small delay so a quick re-focus (iOS wheel re-open) doesn't flicker.
    setTimeout(() => { S._datePickerOpen = false; }, 500);
  }
}, true);

// ── OFFLINE MODE ──
// Cache the critical state in localStorage after every successful load so the app can
// render the last-known schedule / employees / vacations / swaps even without network.
// Separate helpers keep this out of the main code paths — the cache is best-effort and
// only touches state after successful live loads.
S._online = typeof navigator !== "undefined" ? navigator.onLine : true;

export function _offlineCacheKey() {
  return S.user?.id ? "offlineCache_" + S.user.id : null;
}

export function persistOfflineCache() {
  try {
    const key = _offlineCacheKey();
    if (!key) return;
    const snapshot = {
      savedAt: Date.now(),
      profile: S.profile,
      business: S.business,
      employees: S.employees,
      schedule: S.schedule,
      vacations: S.vacations,
      swaps: S.swaps,
      availSubmissions: S.availSubmissions,
      publishedWeeks: Array.from(S.publishedWeeks || []),
      customHours: S.customHours,
      // SHIFTS / WEEKEND_SHIFTS vary per business (shift_config + savedHours
      // mutate them at load time), so they belong in the offline snapshot —
      // otherwise an offline restore falls back to the built-in defaults and
      // mis-displays businesses that customized their shift set.
      SHIFTS: SHIFTS,
      WEEKEND_SHIFTS: WEEKEND_SHIFTS,
    };
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch(_) { /* quota / serialization — not fatal */ }
}

export function restoreOfflineCache() {
  try {
    const key = _offlineCacheKey();
    if (!key) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    // Reject stale caches older than 48h — probably not useful.
    if (!snap || !snap.savedAt || Date.now() - snap.savedAt > 48*3600000) {
      localStorage.removeItem(key);
      return false;
    }
    S.profile = snap.profile || S.profile;
    S.business = snap.business || S.business;
    S.employees = snap.employees || [];
    S.schedule = snap.schedule || {};
    S.vacations = snap.vacations || [];
    S.swaps = snap.swaps || [];
    S.availSubmissions = snap.availSubmissions || [];
    S.publishedWeeks = new Set(snap.publishedWeeks || []);
    S.customHours = snap.customHours || {};
    if (Array.isArray(snap.SHIFTS)) { SHIFTS.length = 0; SHIFTS.push(...snap.SHIFTS); SHIFTS.forEach(s=>{SHIFT_BY_ID[s.id]=s; SHIFT_LABELS[s.id]=s.label;}); }
    if (Array.isArray(snap.WEEKEND_SHIFTS)) { WEEKEND_SHIFTS.length = 0; WEEKEND_SHIFTS.push(...snap.WEEKEND_SHIFTS); }
    S._offlineAge = Math.floor((Date.now() - snap.savedAt) / 60000); // age in minutes
    return true;
  } catch(_) { return false; }
}

// Flip _online on real browser events and re-render so the offline banner appears/disappears.
window.addEventListener("online", () => {
  S._online = true;
  render();
  // Immediately try to refresh with live data now that we're back.
  if (S.user && typeof silentRefresh === "function") silentRefresh();
});
window.addEventListener("offline", () => {
  S._online = false;
  render();
  toast("אין חיבור לרשת — מציג מידע שמור", "err");
});

// Warn before leaving the tab with unsaved selections — a tap on the back
// button or a browser crash shouldn't silently lose 10 minutes of work.
window.addEventListener("beforeunload", function(ev){
  try {
    const hasDraft = Object.values(S.availDraft||{}).some(Boolean);
    if (hasDraft) {
      ev.preventDefault();
      ev.returnValue = "יש לך חסימות שלא נשמרו — האם לצאת?";
      return ev.returnValue;
    }
  } catch(_){}
});
