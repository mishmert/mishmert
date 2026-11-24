// utils.js — DOM builders, toast/dialog, skeleton loaders, and date helpers.
// Extracted from index.html on 2026-11-24.
//
// Notes on scope:
//  - Classic <script> files share one global scope, so top-level consts and
//    functions declared here are visible to the inline app script.
//  - A few helpers in this file (toast, uiConfirm/Prompt/Alert) reference `S`
//    and `render()` which live in the inline app script. That is OK — they
//    are resolved at CALL time, after the inline script has registered both.
// Load order required: constants.js → utils.js → inline app script.

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
"use strict";

import { render } from './main.js';
import { S } from './state.js';

export const $ = id => document.getElementById(id);
export function e(tag, props={}, children=[]) {
  const el = document.createElement(tag);
  // If props is an array, it's actually children
  if (Array.isArray(props)) { children = props; props = {}; }
  if (typeof props === "string") { children = [props]; props = {}; }
  for(const [k,v] of Object.entries(props)){
    if(v===null||v===undefined||v===false) continue;
    if(k==="class") el.className=v;
    else if(k==="style"&&typeof v==="object") Object.assign(el.style,v);
    // NOTE: a raw "html" prop was removed here — it allowed unsanitized innerHTML (XSS risk).
    // Use text children (auto-escaped via createTextNode) instead. Nothing in the app used it.
    else if(k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(),v);
    else el.setAttribute(k,v);
  }
  for(const c of (Array.isArray(children)?children:[children])){
    if(c==null||c===false||c===undefined) continue;
    if(typeof c==="string"||typeof c==="number") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}
export function div(cls,children=[],extra={}) { return e("div",{class:cls,...extra},children); }
export function btn(cls,txt,onclick,extra={}) {
  // Wrap onclick with a tiny haptic pulse — feels crisp on mobile, silent elsewhere.
  // Also auto-disables the button while an async handler is running (prevents double-submit
  // → duplicate DB inserts like the "two Lidors" bug we saw before). Shows a spinner too.
  const wrapped = onclick ? function(ev){
    haptic(8);
    const self = this;
    if (self.dataset.busy === "1") { ev?.preventDefault?.(); return; }
    const result = onclick.call(self, ev);
    if (result && typeof result.then === "function") {
      self.dataset.busy = "1";
      const prevDisabled = self.disabled;
      const prevOpacity = self.style.opacity;
      const prevCursor = self.style.cursor;
      self.disabled = true;
      self.style.opacity = "0.6";
      self.style.cursor = "wait";
      Promise.resolve(result).finally(() => {
        try {
          self.dataset.busy = "0";
          self.disabled = prevDisabled;
          self.style.opacity = prevOpacity;
          self.style.cursor = prevCursor;
        } catch(_) {}
      });
    }
    return result;
  } : onclick;
  return e("button",{class:cls,...extra,onclick: wrapped},txt);
}

export function toast(msg,type="ok",undoFn=null) {
  S.toast={msg,type,undo:undoFn}; render();
  // Undo toasts stay longer so the user can react.
  const ttl = undoFn ? 8000 : 3000;
  setTimeout(()=>{ if (S.toast && S.toast.msg === msg) { S.toast=null; render(); } },ttl);
  // Haptic feedback: short pulse for success, longer double-pulse for error.
  // navigator.vibrate is silently ignored on desktop and unsupported browsers.
  try {
    if (navigator.vibrate) navigator.vibrate(type === "err" ? [40,60,40] : 15);
  } catch(_){}
}

// ── Friendly error messages ──
// Supabase/Postgres errors are technical. This translates the common ones to Hebrew the
// user can act on. Returns the input string unchanged if no mapping exists, so nothing
// is ever hidden from the developer debugging via console.
export function friendlyError(err) {
  if (!err) return "שגיאה לא ידועה";
  const msg = typeof err === "string" ? err : (err.message || err.error_description || err.code || String(err));
  const low = msg.toLowerCase();
  if (low.includes("duplicate key") || low.includes("already exists") || low.includes("23505")) return "הפריט כבר קיים במערכת";
  if (low.includes("foreign key") || low.includes("23503")) return "הפעולה נכשלה — פריט תלוי במחיקה";
  if (low.includes("not null") || low.includes("23502")) return "חסר ערך חובה בטופס";
  if (low.includes("check constraint") || low.includes("23514")) return "ערך לא תקין";
  if (low.includes("permission denied") || low.includes("42501") || low.includes("rls")) return "אין לך הרשאה לפעולה זו";
  if (low.includes("invalid login") || low.includes("invalid credentials")) return "מייל או סיסמה שגויים";
  if (low.includes("email not confirmed")) return "המייל טרם אומת — בדוק בתיבת הדואר";
  if (low.includes("email rate limit")) return "נשלחו יותר מדי מיילים — נסה בעוד כמה דקות";
  if (low.includes("password") && low.includes("short")) return "סיסמה קצרה מדי (לפחות 10 תווים)";
  if (low.includes("network") || low.includes("failed to fetch")) return "בעיית רשת — בדוק את החיבור לאינטרנט";
  if (low.includes("jwt") || low.includes("expired") || low.includes("invalid token")) return "ההתחברות פגה — נא להתחבר מחדש";
  if (low.includes("too many") || low.includes("rate limit") || low.includes("429")) return "יותר מדי בקשות — המתן רגע ונסה שוב";
  if (low.includes("timeout")) return "חיבור איטי — נסה שוב";
  // Unknown error — show a generic Hebrew message but keep the raw code visible in brackets for debugging.
  if (err && err.code) return "שגיאה (" + err.code + ") — נסה שוב או פנה לתמיכה";
  return msg; // last resort: whatever the server said
}

// Minimal password check — just the Supabase built-in 6-char minimum.
// Strict policy was removed because employees couldn't reset passwords in practice.
export function validatePassword(password) {
  if (!password) return "נא להזין סיסמה";
  // MSH-202648-010: NIST SP 800-63B §5.1.1 min = 8; we raise to 10 for a
  // SOC-team tool. Server-side min should also be set to 10 in the
  // Supabase Dashboard (Authentication → Policies → Password Requirements).
  if (password.length < 10) return "סיסמה חייבת להיות לפחות 10 תווים";
  if (password.length > 72) return "סיסמה ארוכה מדי";
  return null;
}

// (withBtnLoading helper removed — auto-disable on async handlers now lives inside btn() itself)

// Tiny helper for tap feedback on buttons/interactive elements.
export function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern || 10); } catch(_){}
}

// ── (Intermediate stateful helpers — AVAIL-DRAFT PERSISTENCE, iOS picker tracking,
//    OFFLINE MODE, unsaved-work warning — remain in the inline app script because
//    they are tightly coupled to S and render().)

// ── Skeleton Loader Helpers ──
// Return placeholder shapes shaped like the real content, so screens don't feel empty
// while data is fetching. Beats "טוען..." — perceived load time drops significantly.
export function skeleton(cls) { return e("div",{class:"skeleton "+(cls||"")}, ""); }

// A card skeleton — matches the general shape of a .card block with title + lines
export function skeletonCard() {
  return e("div",{class:"card"}, [
    skeleton("skeleton-title"),
    skeleton("skeleton-line"),
    skeleton("skeleton-line medium"),
    skeleton("skeleton-line short"),
  ]);
}

// Schedule grid skeleton — 7 columns of shift cells
export function skeletonSchedule() {
  const wrap = e("div",{class:"card"}, [
    skeleton("skeleton-title"),
  ]);
  const grid = e("div",{style:"display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px"});
  for (let i=0; i<28; i++) grid.appendChild(skeleton("skeleton-cell"));
  wrap.appendChild(grid);
  return wrap;
}

// A row of chip placeholders
export function skeletonChips(n) {
  const wrap = e("div",{style:"padding:4px 0"});
  for (let i=0; i<(n||6); i++) wrap.appendChild(skeleton("skeleton-chip"));
  return wrap;
}

// ── Custom Dialog System ─────────────────────────────────────────────
// Replaces browser confirm() / prompt() / alert() with themed, RTL, animated
// dialogs. All three return a Promise, so callers use `await uiConfirm(...)`.
// uiConfirm  → Promise<boolean>          (true = OK, false = Cancel)
// uiPrompt   → Promise<string | null>    (string entered, or null if cancelled)
// uiAlert    → Promise<void>             (resolves when user acknowledges)
export let _dlgResolve = null;
export function _closeDialog(value) {
  haptic(8);
  const r = _dlgResolve;
  S.dialog = null;
  _dlgResolve = null;
  render();
  if (r) r(value);
}
export function uiConfirm(opts) {
  if (typeof opts === "string") opts = { message: opts };
  return new Promise(resolve => {
    _dlgResolve = resolve;
    S.dialog = {
      kind: "confirm",
      title: opts.title || "לאשר פעולה?",
      message: opts.message || "",
      okLabel: opts.okLabel || "אישור",
      cancelLabel: opts.cancelLabel || "ביטול",
      tone: opts.tone || "warn",
      icon: opts.icon || (opts.tone === "danger" ? "⚠️" : opts.tone === "info" ? "ℹ️" : opts.tone === "success" ? "✓" : "⚠️"),
    };
    render();
  });
}
export function uiPrompt(opts) {
  if (typeof opts === "string") opts = { message: opts };
  return new Promise(resolve => {
    _dlgResolve = resolve;
    S.dialog = {
      kind: "prompt",
      title: opts.title || "הזן ערך",
      message: opts.message || "",
      defaultValue: opts.defaultValue || "",
      placeholder: opts.placeholder || "",
      okLabel: opts.okLabel || "שמור",
      cancelLabel: opts.cancelLabel || "ביטול",
      tone: opts.tone || "info",
      icon: opts.icon || "✏️",
    };
    render();
  });
}
export function uiAlert(opts) {
  if (typeof opts === "string") opts = { message: opts };
  return new Promise(resolve => {
    _dlgResolve = resolve;
    S.dialog = {
      kind: "alert",
      title: opts.title || "הודעה",
      message: opts.message || "",
      okLabel: opts.okLabel || "הבנתי",
      tone: opts.tone || "info",
      icon: opts.icon || (opts.tone === "danger" ? "⛔" : opts.tone === "success" ? "✓" : "ℹ️"),
    };
    render();
  });
}

export function today() {
  // Always Israel's today — otherwise a device abroad rolls over at local
  // midnight, which could be hours off and put "today" on the wrong day.
  const d = israelNow();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
export function fmtYMD(d) {
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
// Duration in hours between two "HH:MM" strings, handling shifts that cross midnight.
export function shiftDurationHours(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const [sh,sm] = startStr.split(":").map(Number);
  const [eh,em] = endStr.split(":").map(Number);
  let startMin = sh*60+sm, endMin = eh*60+em;
  if (endMin <= startMin) endMin += 24*60; // crosses midnight
  return (endMin-startMin)/60;
}
// Info (first/last date, ISO range strings, Hebrew label) for the month at `offset` months from now.
export function getMonthInfo(offset=0) {
  // Anchor on Israel time so an admin abroad still gets "this month" relative
  // to their team's calendar, not the device's.
  const now = israelNow();
  const first = new Date(now.getFullYear(), now.getMonth()+offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth()+offset+1, 0);
  return {
    year: first.getFullYear(), month: first.getMonth(),
    first, last,
    firstStr: fmtYMD(first), lastStr: fmtYMD(last),
    label: first.toLocaleDateString("he-IL", {month:"long", year:"numeric"})
  };
}
export function getWeekDates(offset=0) {
  // Anchor on Israel's current day — otherwise a device in NY around 3-5pm
  // local would be on the *previous* Israel day and compute the wrong week.
  const d=israelNow();
  const dow=d.getDay(); // 0=Sun (Israel week starts Sunday)
  d.setDate(d.getDate()-dow+offset*7);
  return Array.from({length:7},(_,i)=>{
    const x=new Date(d);
    x.setDate(d.getDate()+i);
    const y=x.getFullYear();
    const m=String(x.getMonth()+1).padStart(2,"0");
    const dd=String(x.getDate()).padStart(2,"0");
    return y+"-"+m+"-"+dd;
  });
}
// ── Israel-time helpers ──
// The app runs for Israeli teams on Israel's work week and deadlines — using the
// device's local clock would misbehave for anyone opening it while abroad (wrong
// day-of-week preset, wrong greeting, "today" rolling over at local midnight
// instead of Jerusalem midnight). These helpers always evaluate against
// Asia/Jerusalem regardless of the device.
export function israelNow() {
  // toLocaleString(en-US, {timeZone}) re-expresses the instant as wall-clock
  // text in that zone; parsing that text back gives a Date whose getDay/
  // getHours etc. match Israel's wall clock.
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
}
// Today's date in Israel as "YYYY-MM-DD". Uses sv-SE because it formats as
// YYYY-MM-DD natively — en-US would give "MM/DD/YYYY" which is painful to slice.
export function israelTodayIso() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
}
export function israelYear() { return israelNow().getFullYear(); }
