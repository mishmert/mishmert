// history.js — undo/redo stacks for every mutation to S.schedule.
// Extracted from index.html on 2026-11-24.
//
// Stack based rather than event based so there are no off-by-one bugs when
// multiple mutations happen in one tick. Each pushScheduleState() snapshots
// the full schedule+locks+notes before the mutation; undoSchedule() pops the
// top of the undo stack onto the current state and pushes what we had onto
// the redo stack. MAX_HISTORY caps total memory.
//
// Dependencies at call time: `S` (state.js), `toast()` (utils.js), `render()`
// (inline).

// ══════════════════════════════════════════════════════
// SCHEDULE HISTORY (Undo/Redo) — stack based, no off-by-one bugs
// ══════════════════════════════════════════════════════
"use strict";

const MAX_HISTORY = 20;

function _snapshotCurrentSchedule(label) {
  // Deep-clone the locks (Set → array) so undo/redo restore not just the shifts themselves
  // but also which of them were manual (locked from auto-schedule).
  const locksClone = {};
  Object.entries(S.lockedSlots || {}).forEach(([k, s]) => {
    const arr = s instanceof Set ? [...s] : (Array.isArray(s) ? s : []);
    if (arr.length > 0) locksClone[k] = arr;
  });
  return {
    weekOffset: S.weekOffset,
    schedule: JSON.parse(JSON.stringify(S.schedule || {})),
    customHours: JSON.parse(JSON.stringify(S.customHours || {})),
    assignmentNotes: JSON.parse(JSON.stringify(S.assignmentNotes || {})),
    lockedSlots: locksClone,
    label: label || "שינוי",
    timestamp: Date.now()
  };
}

// Call this BEFORE making a change, with a label describing the change about to happen.
// Pushes the PRE-change state onto the undo stack and clears the redo stack.
function pushScheduleHistory(actionLabel) {
  if (!S.scheduleUndoStack) S.scheduleUndoStack = [];
  S.scheduleUndoStack.push(_snapshotCurrentSchedule(actionLabel));
  if (S.scheduleUndoStack.length > MAX_HISTORY) S.scheduleUndoStack.shift();
  S.scheduleRedoStack = [];
}

function canUndo() {
  return !!(S.scheduleUndoStack && S.scheduleUndoStack.length > 0);
}

function canRedo() {
  return !!(S.scheduleRedoStack && S.scheduleRedoStack.length > 0);
}

// Undo - pop the last pre-change snapshot and restore it; push current live state to redo stack
async function undoSchedule() {
  if (!canUndo()) {
    toast("אין מה לבטל", "err");
    return;
  }
  if (!S.scheduleRedoStack) S.scheduleRedoStack = [];
  S.scheduleRedoStack.push(_snapshotCurrentSchedule("מצב נוכחי"));
  const prev = S.scheduleUndoStack.pop();
  await restoreSnapshot(prev);
  toast("↶ בוטל: " + (prev?.label || "שינוי"));
  render();
}

// Redo - pop the last undone state and restore it; push current live state back to undo stack
async function redoSchedule() {
  if (!canRedo()) {
    toast("אין מה לחזור", "err");
    return;
  }
  if (!S.scheduleUndoStack) S.scheduleUndoStack = [];
  S.scheduleUndoStack.push(_snapshotCurrentSchedule("לפני חזרה"));
  const next = S.scheduleRedoStack.pop();
  await restoreSnapshot(next);
  toast("↷ חזר: " + (next?.label || "שינוי"));
  render();
}

// Restore a snapshot — both in memory and to DB
async function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  
  // Restore state
  S.schedule = JSON.parse(JSON.stringify(snapshot.schedule));
  S.customHours = JSON.parse(JSON.stringify(snapshot.customHours));
  S.assignmentNotes = JSON.parse(JSON.stringify(snapshot.assignmentNotes));
  // Restore manual-assignment locks from the snapshot too.
  S.lockedSlots = {};
  Object.entries(snapshot.lockedSlots || {}).forEach(([k, arr]) => {
    if (Array.isArray(arr) && arr.length > 0) S.lockedSlots[k] = new Set(arr);
  });
  
  // Persist to DB (use the snapshot's weekOffset to find the right schedule)
  if (!S.profile?.business_id) return;
  const weekStart = getWeekDates(snapshot.weekOffset)[0];
  
  let { data: sched } = await sb.from("schedules")
    .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
  if (!sched) {
    const { data: ns } = await sb.from("schedules")
      .insert({business_id:S.profile.business_id, week_start:weekStart, created_by:S.user.id}).select().single();
    sched = ns;
  }
  if (!sched) return;
  
  S.schedule.id = sched.id;
  
  // Delete current and re-insert from snapshot
  await sb.from("assignments").delete().eq("schedule_id", sched.id);
  
  const rows = [];
  Object.entries(S.schedule).forEach(([date, shifts]) => {
    if (date === "id" || !shifts || typeof shifts !== "object") return;
    Object.entries(shifts).forEach(([shift, empIds]) => {
      if (!Array.isArray(empIds)) return;
      const unique = [...new Set(empIds)];
      unique.forEach(empId => {
        const noteKey = date+"|"+shift+"|"+empId;
        const chKey = noteKey;
        const ch = S.customHours[chKey];
        const note = S.assignmentNotes[noteKey];
        rows.push({ 
          schedule_id:sched.id, 
          employee_id:empId, 
          date, 
          shift,
          custom_start: ch?.start || null,
          custom_end: ch?.end || null,
          note: note || null
        });
      });
    });
  });
  if (rows.length) {
    await sb.from("assignments").upsert(rows, {onConflict: "schedule_id,employee_id,date,shift"});
  }
  
  // Invalidate caches
  if (typeof invalidateSwapCache === "function") invalidateSwapCache();
  if (typeof invalidateMonthCache === "function") invalidateMonthCache();
  S.qualHistory = null;
}

// Undo the last auto-schedule run
async function undoAutoSchedule() {
  if (!S.scheduleBackup) {
    toast("אין שיבוץ לבטל", "err");
    return;
  }
  
  if (!(await uiConfirm({title:"לבטל שיבוץ אוטומטי?", message:"הפעולה תחזיר את הסידור למצב שלפני השיבוץ האחרון.", tone:"warn", okLabel:"כן, לבטל"}))) return;
  
  // Restore from backup
  S.schedule = JSON.parse(JSON.stringify(S.scheduleBackup.schedule));
  const backupWeekOffset = S.scheduleBackup.weekOffset;
  
  // Persist to DB
  if (!S.profile?.business_id) return;
  const weekStart = getWeekDates(backupWeekOffset)[0];
  
  let { data: sched } = await sb.from("schedules")
    .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
  if (!sched) {
    const { data: ns } = await sb.from("schedules")
      .insert({business_id:S.profile.business_id, week_start:weekStart, created_by:S.user.id}).select().single();
    sched = ns;
  }
  if (!sched) {
    toast("שגיאה בשחזור", "err");
    return;
  }
  
  S.schedule.id = sched.id;
  
  // Delete all current assignments for this week
  await sb.from("assignments").delete().eq("schedule_id", sched.id);
  
  // Insert the backup assignments
  const rows = [];
  Object.entries(S.schedule).forEach(([date, shifts]) => {
    if (date === "id" || !shifts || typeof shifts !== "object") return;
    Object.entries(shifts).forEach(([shift, empIds]) => {
      if (!Array.isArray(empIds)) return;
      const unique = [...new Set(empIds)];
      unique.forEach(empId => {
        rows.push({ schedule_id:sched.id, employee_id:empId, date, shift });
      });
    });
  });
  if (rows.length) {
    await sb.from("assignments").upsert(rows, {onConflict: "schedule_id,employee_id,date,shift"});
  }
  
  // Clear backup
  S.scheduleBackup = null;
  
  // Invalidate caches
  if (typeof invalidateSwapCache === "function") invalidateSwapCache();
  if (typeof invalidateMonthCache === "function") invalidateMonthCache();
  S.qualHistory = null;
  
  if (typeof logAction === "function") logAction("auto_schedule_undone", {week_start: weekStart});
  
  toast("↶ הסידור הוחזר למצב הקודם");
  render();
}
