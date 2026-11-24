// data.js — the data access, realtime, and push-notification layer.
// Extracted from index.html on 2026-11-24.
//
// Contents, in the order they appear here:
//  1. loadAll(user)                — the single orchestrator that runs on every
//                                    successful auth and performs the 2FA gate,
//                                    business lookup, and all parallel per-domain
//                                    loads, then subscribes to realtime channels.
//  2. REALTIME                    — setupRealtime() + the _realtimeChannels
//                                    registry. Postgres-change subscriptions that
//                                    call per-domain reloaders when the server
//                                    notifies of writes.
//  3. Per-domain loaders          — loadInvitations, loadEmployees, loadVacations,
//                                    loadMyMonthData, loadAvailSubmissions,
//                                    loadSwapRequests, loadJoinRequests,
//                                    loadSchedule. Each one reads its slice of
//                                    public.* tables into S and leaves rendering
//                                    to the caller.
//  4. PUSH NOTIFICATIONS          — the VAPID public key, subscription helpers
//                                    (enable/disable), sendPush() which proxies
//                                    through the rapid-action Edge Function, and
//                                    _pushContent() which maps event types to
//                                    localized notification title/body strings.
//
// Dependencies resolved at call time via the shared global scope of classic
// <script>s: `sb` (Supabase client, inline app), `S` (state.js), `render()`,
// `isManager()`, `isAdmin()`, `invalidateCaches()`, `silentRefresh()` (all inline),
// plus the pure helpers from constants.js / utils.js.

async function loadAll(user) {
  S.user = user;

  // ═══ 2FA gate ═══
  // Enforced for all users. Flow:
  //  • First-time login (no verified TOTP factor) → "mfa_enroll" view (show QR, user verifies once)
  //  • Returning user whose session is still AAL1 (password only) → "mfa_challenge" view
  //  • Session already AAL2 → proceed to the app
  try {
    const { data: aalData } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const currentAAL = aalData?.currentLevel || "aal1";
    const nextAAL = aalData?.nextLevel || "aal1";
    if (nextAAL === "aal2" && currentAAL === "aal1") {
      // Has an enrolled factor but hasn't verified in this session → challenge
      S.view = "mfa_challenge";
      render();
      return;
    }
    if (nextAAL === "aal1" && currentAAL === "aal1") {
      // No enrolled TOTP factor → force enrollment on first login
      S.view = "mfa_enroll";
      render();
      return;
    }
    // currentAAL === "aal2" → full access, continue below
  } catch (err) {
    console.warn("MFA check failed:", err);
    // Fail-safe: let the user through rather than locking them out if the MFA API errors.
  }

  let profile = null;
  try {
    const res = await sb.from("profiles")
      .select("*, business:businesses(*)").eq("id", user.id).maybeSingle();
    profile = res.data;
  } catch (netErr) {
    console.warn("Profile load failed — trying offline cache:", netErr);
    // Network error on the first query — fall back to the last good snapshot so the
    // employee can at least see their schedule. Role-based view will be set from cache.
    S.user = user;
    if (restoreOfflineCache() && S.profile) {
      S._online = false;
      S.view = S.profile.role === "employee" ? "empview" : "home";
      S.empViewId = user.id;
      render();
      return;
    }
    // No cache either — bounce to login with an error.
    S.view = "login"; render();
    toast("אין חיבור לרשת ואין מידע שמור", "err");
    return;
  }
  if (!profile) { S.view="login"; render(); return; }
  
  // 🛡️ הגנה: אם למשתמש המחובר חסר שם במסד הנתונים, ניתן לו שם זמני
  profile.name = profile.name || "משתמש ללא שם";
  
  S.profile = profile;
  S.business = profile.business;
  S.systems = profile.business?.systems || [];  // shared system tags
  S.qualifications = profile.business?.qualifications || {systems:{},shifts:{}};  // qualification expiry days
  
  // Apply saved shift hours from business config
  const savedHours = profile.business?.shift_hours || {};
  if (savedHours.morning?.start) { SHIFTS[0].start = savedHours.morning.start; SHIFTS[0].end = savedHours.morning.end; }
  if (savedHours.morning2?.start) { SHIFTS[1].start = savedHours.morning2.start; SHIFTS[1].end = savedHours.morning2.end; }
  if (savedHours.afternoon?.start) { SHIFTS[2].start = savedHours.afternoon.start; SHIFTS[2].end = savedHours.afternoon.end; }
  if (savedHours.night?.start) { SHIFTS[3].start = savedHours.night.start; SHIFTS[3].end = savedHours.night.end; }
  if (savedHours.weMorning?.start) { WEEKEND_SHIFTS[0].start = savedHours.weMorning.start; WEEKEND_SHIFTS[0].end = savedHours.weMorning.end; }
  if (savedHours.weNight?.start) { WEEKEND_SHIFTS[1].start = savedHours.weNight.start; WEEKEND_SHIFTS[1].end = savedHours.weNight.end; }

  // Per-business shift TYPE selection (which shift types exist, and which apply on Fri/Sat).
  // Only takes effect if a business has explicitly configured this (super admin) — otherwise
  // behavior is unchanged (same hardcoded 4 weekday / 2 weekend shifts as always).
  const baseShiftDefs = {};
  SHIFTS.forEach(s => baseShiftDefs[s.id] = { ...s } );
  const shiftCfg = profile.business?.shift_config;
  if (shiftCfg && Array.isArray(shiftCfg.weekday_shifts) && shiftCfg.weekday_shifts.length > 0) {
    const filtered = shiftCfg.weekday_shifts.map(id => baseShiftDefs[id]).filter(Boolean);
    SHIFTS.length = 0; SHIFTS.push(...filtered);
    Object.keys(SHIFT_BY_ID).forEach(k=>delete SHIFT_BY_ID[k]);
    Object.keys(SHIFT_LABELS).forEach(k=>delete SHIFT_LABELS[k]);
    SHIFTS.forEach(s=>{ SHIFT_BY_ID[s.id]=s; SHIFT_LABELS[s.id]=s.label; });
  }
  if (shiftCfg && Array.isArray(shiftCfg.weekend_shifts) && shiftCfg.weekend_shifts.length > 0) {
    const weFiltered = shiftCfg.weekend_shifts.map(id => baseShiftDefs[id]).filter(Boolean);
    WEEKEND_SHIFTS.length = 0; WEEKEND_SHIFTS.push(...weFiltered);
  }
  // Old invite code system removed — replaced with secure invitations

  await loadEmployees();
  await Promise.all([loadVacations(), loadSwapRequests(), loadAvailSubmissions(), loadSchedule(), loadInvitations(), loadJoinRequests()]);
  S._lastDataRefresh = Date.now();

  // Restore any availability-blocks draft the user left behind last time.
  restoreAvailDraft();

  // Role-based default view
  if (S.profile.role === "employee") {
    S.view = "empview";
    S.empViewId = S.user.id; // default to self
  } else {
    S.view = "home";
  }

  // Deep link: emails append ?goto=<target> so a link opens the relevant screen.
  applyDeepLink();

  // Save a snapshot now that everything loaded successfully — so next time the user
  // opens the app without network, we still have today's schedule to show.
  persistOfflineCache();

  render();
  startAutoRefresh();
  checkAutoReminder();
  setupRealtime();
}

// ══════════════════════════════════════════════════════
// REALTIME — Supabase live subscriptions
// ══════════════════════════════════════════════════════
let _realtimeChannels = [];
function setupRealtime() {
  // Clean old channels
  _realtimeChannels.forEach(ch => sb.removeChannel(ch));
  _realtimeChannels = [];
  
  if (!S.profile?.business_id) return;
  const bizId = S.profile.business_id;
  
  // Subscribe to schedule changes.
  // Every realtime hit also bumps S._lastDataRefresh (so the header "live" chip is
  // accurate) and invalidates the 60s preload caches for the "who's on shift now" and
  // "next shift" cards — otherwise an employee sees stale assignments for up to a minute
  // after the manager changes the schedule.
  const invalidateCaches = () => {
    S._lastDataRefresh = Date.now();
    S._nowCardPreloaded = 0;
    S._nextShiftPreloaded = 0;
  };
  const schedChannel = sb.channel("schedule_changes_" + bizId)
    .on("postgres_changes", {event:"*",schema:"public",table:"schedules",filter:"business_id=eq."+bizId},
      () => { invalidateCaches(); if (!isUserBusy()) { loadSchedule().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"assignments"},
      () => { invalidateCaches(); if (!isUserBusy()) { loadSchedule().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"availability_submissions"},
      () => { S._lastDataRefresh = Date.now(); if (!isUserBusy()) { loadAvailSubmissions().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"swaps"},
      () => { S._lastDataRefresh = Date.now(); if (!isUserBusy()) { loadSwapRequests().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"shift_join_requests"},
      () => { S._lastDataRefresh = Date.now(); if (!isUserBusy()) { loadJoinRequests().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"vacations"},
      () => { S._lastDataRefresh = Date.now(); if (!isUserBusy()) { loadVacations().then(()=>render()); } })
    .on("postgres_changes", {event:"*",schema:"public",table:"profiles",filter:"business_id=eq."+bizId},
      () => { S._lastDataRefresh = Date.now(); if (!isUserBusy()) { loadEmployees().then(()=>render()); } })
    .subscribe();
  
  _realtimeChannels.push(schedChannel);
}

async function loadInvitations() {
  if (!S.profile?.business_id || !isManager()) return;
  const { data } = await sb.from("invitations")
    .select("*")
    .eq("business_id", S.profile.business_id)
    .order("created_at", { ascending: false });
  S.invitations = data || [];
}

async function loadEmployees() {
  if (!S.profile?.business_id) return;
  const { data } = await sb.from("profiles")
    .select("*").eq("business_id", S.profile.business_id)
    .eq("is_deleted", false).order("name");
  
  // 🛡️ הגנה: עוברים על כל העובדים ומוודאים שיש להם שם כדי למנוע קריסות
  S.employees = (data || []).map(emp => {
    emp.name = emp.name || "עובד ללא שם";
    return emp;
  });
}

async function loadVacations() {
  if (!S.profile?.business_id) return;
  const { data } = await sb.from("vacations").select("*").eq("business_id", S.profile.business_id);
  S.vacations = data || [];
}

// Personal monthly summary for an employee: shift count/hours breakdown + vacation days used.
// Only counts PUBLISHED schedules, matching what an employee is allowed to see elsewhere.
async function loadMyMonthData(empId, monthInfo) {
  const empty = { shifts: [], totalHours: 0, byShift: {}, vacationDays: 0 };
  const bizId = S.profile?.business_id;
  if (!bizId || !empId) return empty;

  // A week's Sunday (week_start) can fall up to 6 days before the 1st of the month
  // and still contain days that belong to this month, so widen the schedules search.
  const rangeStart = new Date(monthInfo.first);
  rangeStart.setDate(rangeStart.getDate() - 6);

  const { data: scheds } = await sb.from("schedules").select("id")
    .eq("business_id", bizId).eq("published", true)
    .gte("week_start", fmtYMD(rangeStart)).lte("week_start", monthInfo.lastStr);

  const schedIds = (scheds||[]).map(s=>s.id);
  if (schedIds.length === 0) return empty;

  const { data: assigns } = await sb.from("assignments")
    .select("date,shift,custom_start,custom_end")
    .eq("employee_id", empId).in("schedule_id", schedIds)
    .gte("date", monthInfo.firstStr).lte("date", monthInfo.lastStr)
    .order("date");

  const shifts = [];
  const byShift = {};
  let totalHours = 0;
  (assigns||[]).forEach(a => {
    const def = getShiftsForDate(a.date).find(s=>s.id===a.shift) || SHIFT_BY_ID[a.shift];
    const start = a.custom_start ? a.custom_start.slice(0,5) : def?.start;
    const end = a.custom_end ? a.custom_end.slice(0,5) : def?.end;
    const hours = shiftDurationHours(start, end);
    totalHours += hours;
    byShift[a.shift] = (byShift[a.shift]||0) + 1;
    shifts.push({ date: a.date, shift: a.shift, label: def?.label || a.shift, color: def?.color || "#64748B", start, end, hours });
  });

  // Vacation days used this month, from the already-loaded S.vacations
  let vacationDays = 0;
  (S.vacations||[]).forEach(v => {
    if (v.employee_id !== empId || v.status !== "approved") return;
    const s = v.start_date > monthInfo.firstStr ? v.start_date : monthInfo.firstStr;
    const en = v.end_date < monthInfo.lastStr ? v.end_date : monthInfo.lastStr;
    if (s <= en) {
      vacationDays += Math.round((new Date(en+"T00:00:00") - new Date(s+"T00:00:00"))/86400000) + 1;
    }
  });

  return { shifts, totalHours, byShift, vacationDays };
}

// ══════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Web Push via service worker + Supabase Edge Function
// ══════════════════════════════════════════════════════
// Public VAPID key — safe to embed client-side (pairs with the private key kept
// only as an Edge Function secret on Supabase).
const VAPID_PUBLIC_KEY = "BDXz-WWumCD7MRs7GFlenjr3jhk7Qmwmk_TAwdSHHu9Rel2pt7cJj7FJsy9CBMYX4FhttjTus2f3HNQDVLB5mhI";

function _urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("הדפדפן הזה לא תומך בהתראות Push", "err");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast("לא אושרה הרשאה להתראות", "err");
      render();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const raw = sub.toJSON();
    if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
      toast("המנוי לא הכיל את כל הנתונים הנדרשים", "err");
      render();
      return;
    }
    const { error } = await sb.from("push_subscriptions").upsert({
      business_id: S.profile.business_id,
      employee_id: S.user.id,
      endpoint: raw.endpoint,
      p256dh: raw.keys.p256dh,
      auth: raw.keys.auth
    }, { onConflict: "endpoint" });
    if (error) { console.error(error); toast("שמירה נכשלה — " + friendlyError(error), "err"); return; }
    toast("🔔 התראות Push הופעלו!");
  } catch (err) {
    console.error("Push subscribe failed:", err);
    toast("שגיאה: " + (err?.name ? err.name + " — " : "") + (err?.message || String(err)), "err");
  }
  render();
}

async function disablePushNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    toast("התראות Push כובו במכשיר הזה");
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
  }
  render();
}

// Send a push notification to one employee, respecting the same per-business
// notification toggles used for email (S.business.notification_settings).
async function sendPush(type, employeeId, data) {
  if (!employeeId) return;
  const settingMap = {
    "schedule_published": "notif_publish",
    "schedule_initial": "notif_publish",
    "vacation_approved": "notif_vac_approved",
    "vacation_rejected": "notif_vac_approved",
    "swap_decision": "notif_swap",
    "absence_request": "notif_swap",
  };
  const settingKey = settingMap[type];
  const notifSettings = S.business?.notification_settings || {};
  if (settingKey && notifSettings[settingKey] === false) return;

  const content = _pushContent(type, data || {});
  try {
    // MSH-202648-001: the Edge Function requires the caller's session JWT so
    // it can authorise the push against the caller's tenant. The anon key
    // alone is rejected.
    const sess = (await sb.auth.getSession())?.data?.session;
    if (!sess?.access_token) { console.warn("🔔 Push skipped: no session"); return; }
    await fetch("https://zszlqoisokjgvplrcbic.supabase.co/functions/v1/rapid-action", {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + sess.access_token },
      body: JSON.stringify({
        type: "push",
        to: [employeeId],
        data: { title: content.title, body: content.body, url: _deepLinkUrl(type) }
      })
    });
  } catch (err) {
    console.warn("🔔 Push send failed:", err);
  }
}

function _pushContent(type, data) {
  switch (type) {
    case "schedule_published":
      return { title: "📅 סידור סופי פורסם", body: "שבוע " + (data.weekLabel || "") };
    case "schedule_initial":
      return { title: "📋 סידור ראשוני פורסם", body: "שבוע " + (data.weekLabel || "") };
    case "vacation_approved": {
      const typeLabel = data.type === "reserve" ? "מילואים" : data.type === "exam" ? "מבחן" : "חופשה";
      return { title: `✅ בקשת ${typeLabel} אושרה`, body: data.startDate + (data.endDate && data.endDate !== data.startDate ? " עד " + data.endDate : "") };
    }
    case "vacation_rejected": {
      const typeLabel = data.type === "reserve" ? "מילואים" : data.type === "exam" ? "מבחן" : "חופשה";
      return { title: `❌ בקשת ${typeLabel} נדחתה`, body: data.rejectReason || "לפרטים פנה למנהל" };
    }
    case "swap_decision":
      return { title: (data.isApproved ? "✅" : "❌") + " בקשת חילוף " + (data.statusText || ""), body: (data.targetDate || "") + " — " + (data.shiftLabel || "") };
    case "absence_request": {
      const typeLabel = data.type === "reserve" ? "מילואים" : data.type === "exam" ? "מבחן" : "חופשה";
      return { title: `📥 בקשת ${typeLabel} חדשה`, body: `${data.requesterName || ""} — ${data.startDate || ""}${data.endDate && data.endDate !== data.startDate ? " עד " + data.endDate : ""}` };
    }
    default:
      return { title: "🔔 עדכון חדש", body: "יש עדכון חדש במערכת" };
  }
}

// ══════════════════════════════════════════════════════
// SHIFT CHAT — small coordination thread per date+shift (e.g. "who's bringing equipment")
// ══════════════════════════════════════════════════════
async function loadAvailSubmissions() {
  if (!S.profile?.business_id) return;
  const { data } = await sb.from("availability_submissions").select("*")
    .eq("business_id", S.profile.business_id).order("created_at", {ascending:false});
  S.availSubmissions = data || [];
}

async function loadSwapRequests() {
  if (!S.profile?.business_id) return;
  // Load from both tables
  const { data: d1 } = await sb.from("swaps").select("*")
    .eq("business_id", S.profile.business_id).order("created_at", {ascending:false});
  const { data: d2 } = await sb.from("swap_requests").select("*")
    .eq("business_id", S.profile.business_id).order("created_at", {ascending:false});
  S.swaps = d1 || [];
  S.swapRequests = d2 || [];
}

async function loadJoinRequests() {
  if (!S.profile?.business_id) return;
  const { data } = await sb.from("shift_join_requests").select("*")
    .eq("business_id", S.profile.business_id).order("created_at", {ascending:false});
  S.joinRequests = data || [];
}

async function loadSchedule() {
  // Clear undo/redo history when loading fresh data
  S.scheduleUndoStack = [];
  S.scheduleRedoStack = [];

  if (!S.profile?.business_id) return;
  const weekDates = getWeekDates(S.weekOffset);
  const weekStart = weekDates[0];
  const { data: sched } = await sb.from("schedules")
    .select("*").eq("business_id", S.profile.business_id)
    .eq("week_start", weekStart).maybeSingle();

  if (!sched) { S.schedule={}; S.currentPublishType=null; return; }
  // Employee can only see published schedules (strict check)
  const userIsEmployee = S.profile?.role === "employee";
  if (userIsEmployee && !sched.published) { S.schedule={}; S.currentPublishType=null; return; }
  if (!isManager() && !sched.published) { S.schedule={}; S.currentPublishType=null; return; }
  // Temporary publish — if visible_until is set and has passed, treat as unpublished for employees.
  // Managers always see what they published, regardless of expiry.
  if (userIsEmployee && sched.published && sched.visible_until) {
    const expiry = new Date(sched.visible_until);
    if (!isNaN(expiry.getTime()) && Date.now() > expiry.getTime()) {
      S.schedule = {};
      S.currentPublishType = null;
      S.scheduleExpired = true;  // flag so UI can show "being prepared" message
      return;
    }
  }
  S.scheduleExpired = false;
  if (sched.published) {
    if (sched.publish_type === "final") {
      S.publishedWeeks.add(weekStart);
    }
    S.publishedInitial = S.publishedInitial || new Set();
    if (sched.publish_type === "initial" || sched.published) S.publishedInitial.add(weekStart);
    S.schedPublishType = S.schedPublishType || {};
    S.schedPublishType[weekStart] = sched.publish_type || (sched.published ? "final" : null);
  }

  const { data: assignments } = await sb.from("assignments")
    .select("*").eq("schedule_id", sched.id);

  const sched_obj = {};
  weekDates.forEach(d => {
    sched_obj[d] = {};
    SHIFTS.forEach(sh => { sched_obj[d][sh.id] = []; });
  });
  (assignments||[]).forEach(a => {
    if (!sched_obj[a.date]) sched_obj[a.date] = {};
    if (!sched_obj[a.date][a.shift]) sched_obj[a.date][a.shift] = [];
    if (!sched_obj[a.date][a.shift].includes(a.employee_id)) sched_obj[a.date][a.shift].push(a.employee_id);
    if (a.custom_start && a.custom_end) {
      // Postgres time columns return HH:MM:SS; the app works with HH:MM everywhere else,
      // so trim the seconds to avoid the ugly "07:45:00-16:00:00" display on chips.
      S.customHours[a.date+"|"+a.shift+"|"+a.employee_id] = {
        start: a.custom_start.slice(0,5),
        end:   a.custom_end.slice(0,5)
      };
    }
    if (a.note) {
      S.assignmentNotes[a.date+"|"+a.shift+"|"+a.employee_id] = a.note;
    }
  });
  S.schedule = sched_obj;

  // Restore manual-assignment locks so refreshing or opening on another device keeps
  // knowing which chips were placed by hand vs auto-scheduled.
  S.lockedSlots = {};
  const locksFromDb = sched.locked_slots || {};
  Object.entries(locksFromDb).forEach(([key, arr]) => {
    if (Array.isArray(arr) && arr.length > 0) S.lockedSlots[key] = new Set(arr);
  });
}
