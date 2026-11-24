// audit.js — write and read the public.audit_log table.
// Extracted from index.html on 2026-11-24.
//
// Contents:
//  - logAction(action, details)  : the fire-and-forget insert every state-changing
//                                  code path calls. A BEFORE INSERT trigger on the
//                                  server pins user_id/email/business_id to the
//                                  authenticated caller, so a tampered client
//                                  cannot forge another identity into this table.
//  - loadAuditLog / renderAuditLog etc : admin-only readers and view fragments.
//  - logout()                    : clears the client session, scrubs S back to a
//                                  guest shape, and re-renders to the login view.
//
// Dependencies at call time: `sb`, `S`, `render()`, `toast()`.

// ══════════════════════════════════════════════════════
// AUDIT LOG — security & compliance tracking
// ══════════════════════════════════════════════════════
"use strict";

import { loadAll } from './data.js';
import { _emailQueue, _processEmailQueue } from './email.js';
import { render, silentRefresh } from './main.js';
import { sb } from './sb.js';
import { S } from './state.js';
import { friendlyError, getWeekDates, toast, validatePassword } from './utils.js';
import { invalidateSwapCache } from './views-main.js';

export async function logAction(action, details) {
  if (!S.user || !S.profile?.business_id) return;
  try {
    await sb.from("audit_log").insert({
      business_id: S.profile.business_id,
      user_id: S.user.id,
      user_email: S.profile.email || null,
      user_name: S.profile.name || null,
      action: action,
      details: details || null,
      user_agent: navigator.userAgent.substring(0, 200)
    });
  } catch (err) {
    console.warn("📋 Audit log failed:", err);
    // Don't break the flow if audit fails
  }
}

export async function sendEmail(type, toEmail, data) {
  if (!toEmail) return;
  const settingMap = {
    "schedule_published": "notif_publish",
    "schedule_initial": "notif_publish",
    "vacation_approved": "notif_vac_approved",
    "vacation_rejected": "notif_vac_approved",
    "swap_request": "notif_swap",
    "absence_request": "notif_swap",
    "block_message": "notif_swap",
    "swap_decision": "notif_swap",
    "reminder": "notif_publish"
  };
  const settingKey = settingMap[type];
  const notifSettings = S.business?.notification_settings || {};
  if (settingKey && notifSettings[settingKey] === false) return;

  // Add to queue
  _emailQueue.push({ type, toEmail, data, retries: 0 });
  // Start processing if not already running
  _processEmailQueue();
}

export let _saveTimer = null;
export function saveScheduleToDB() {
  clearTimeout(_saveTimer);
  
  _saveTimer = setTimeout(async () => {
    if (!S.profile?.business_id) return;
    const weekDates = getWeekDates(S.weekOffset);
    const weekStart = weekDates[0];

    try {
      // משיכת או יצירת רשומת סידור לשבוע הנוכחי
      let { data: sched, error: schedError } = await sb.from("schedules")
        .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
        
      if (schedError && schedError.code !== "PGRST116") throw schedError; // מתעלם משגיאת "לא נמצא" רגילה

      if (!sched) {
        const { data: ns, error: insertError } = await sb.from("schedules")
          .insert({business_id: S.profile.business_id, week_start: weekStart, created_by: S.user.id}).select().single();
        if (insertError) throw insertError;
        sched = ns;
      }
      
      if (!sched) return;

      // מחיקת כל השיבוצים הקודמים לאותו שבוע בשרת
      const { error: deleteError } = await sb.from("assignments").delete().eq("schedule_id", sched.id);
      if (deleteError) throw deleteError;

      // הרכבת מערך השיבוצים החדש
      const rows = [];
      Object.entries(S.schedule).forEach(([date, shifts]) => {
        // דילוג חכם: מתעלם ממאפיינים שאינם תאריכים (כמו id שנוסף בשיבוץ האוטומטי)
        if (date === "id" || typeof shifts !== "object") return;
        
        Object.entries(shifts).forEach(([shift, empIds]) => {
          if (!Array.isArray(empIds)) return;
          const uniqueEmpIds = [...new Set(empIds)];
          uniqueEmpIds.forEach(empId => {
            const ch = S.customHours[date+"|"+shift+"|"+empId];
            const noteVal = S.assignmentNotes[date+"|"+shift+"|"+empId];
            rows.push({ schedule_id: sched.id, employee_id: empId, date, shift,
              custom_start: ch?.start||null, custom_end: ch?.end||null,
              note: noteVal||null });
          });
        });
      });

      // שמירת השיבוצים במסד הנתונים
      if (rows.length > 0) {
        const { error: assignError } = await sb.from("assignments").upsert(rows, 
          {onConflict: "schedule_id,employee_id,date,shift"});
        if (assignError) throw assignError;
      }

      // Persist manual-assignment locks alongside the schedule so refreshing the page
      // or opening on another device keeps knowing which chips were placed by hand.
      const locksToSave = {};
      Object.entries(S.lockedSlots || {}).forEach(([key, set]) => {
        const arr = set instanceof Set ? [...set] : (Array.isArray(set) ? set : []);
        if (arr.length > 0) locksToSave[key] = arr;
      });
      await sb.from("schedules").update({ locked_slots: locksToSave }).eq("id", sched.id);
      
      // Schedule changed — invalidate swap cache so other weeks are reloaded next view
      invalidateSwapCache();

    } catch (err) {
      console.error("🚨 שגיאת שמירה:", err);
      toast("שמירה נכשלה — " + friendlyError(err), "err");
    }
    silentRefresh();
  }, 800);
}

export async function handleLogin(email, password) {
  const {error} = await sb.auth.signInWithPassword({email,password});
  if (error) throw error;
  const { data: {user} } = await sb.auth.getUser();
  // Credential Management API — explicitly ask the browser to store the credentials
  // in the OS keychain (Chrome / Edge). Safari does this automatically via the native
  // "Save password?" prompt, so this call just ensures Chrome also triggers it.
  // Result: next time the user lands on the login screen, iOS/Chrome offers Face ID /
  // Touch ID to autofill.
  try {
    if (window.PasswordCredential) {
      const cred = new window.PasswordCredential({ id: email, password, name: email });
      await navigator.credentials.store(cred);
    }
  } catch (_) { /* non-fatal — autofill still works via browser native prompt */ }
  await loadAll(user);
}

// Manager registers a new business (creates a new account + business) — requires a
// valid business-creation invite token from the platform super admin.
// Employees can only join via secure invitation (see handleAcceptInvitation)
export async function handleRegister(name, businessName, email, password, bizInviteToken) {
  if (!bizInviteToken) throw new Error("נדרשת הזמנה תקפה כדי לפתוח עסק חדש");
  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);
  const {data:auth, error:ae} = await sb.auth.signUp({email,password,options:{data:{name}}});
  if(ae) throw ae;

  const { data: result, error: consumeErr } = await sb.rpc("create_business_via_invite", {
    p_token: bizInviteToken,
    p_business_name: businessName,
    p_user_id: auth.user.id
  });
  if (consumeErr) throw consumeErr;
  const r = result?.[0];
  if (!r?.success) {
    const reasons = {
      invalid_token: "הלינק לא תקין",
      used: "ההזמנה כבר נוצלה",
      revoked: "ההזמנה בוטלה",
      expired: "ההזמנה פגה"
    };
    throw new Error(reasons[r?.error_reason] || "שגיאה בפתיחת העסק");
  }
  await loadAll(auth.user);
}

export async function handleAcceptInvitation(name, password, token, email) {
  if (!name?.trim()) throw new Error("נא להזין שם");
  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);
  
  // Sign up the user with the email from the invitation
  const { data: auth, error: signupError } = await sb.auth.signUp({
    email: email,
    password: password,
    options: { data: { name: name.trim() } }
  });
  if (signupError) throw signupError;
  if (!auth.user) throw new Error("שגיאה ביצירת המשתמש");
  
  // Consume the invitation
  const { data: consumeResult, error: consumeError } = await sb.rpc("consume_invitation", {
    p_token: token,
    p_user_id: auth.user.id
  });
  
  if (consumeError) throw consumeError;
  const result = consumeResult?.[0];
  if (!result?.success) {
    const reasons = {
      invalid_token: "הלינק לא תקין",
      already_used: "ההזמנה כבר נוצלה",
      revoked: "ההזמנה בוטלה",
      expired: "ההזמנה פגה",
      used: "ההזמנה כבר נוצלה"
    };
    throw new Error(reasons[result?.error_reason] || "שגיאה בקבלת ההזמנה");
  }
  
  // Clean up URL
  window.history.replaceState({}, "", window.location.pathname);
  S.pendingInvitation = null;
  S.loginMode = "login";
  
  // Load app
  await loadAll(auth.user);
}

export async function handleLogout() {
  await sb.auth.signOut();
  S = {...S, view:"login", user:null, profile:null, business:null, employees:[], vacations:[], schedule:{}, publishedWeeks:new Set()};
  render();
}
