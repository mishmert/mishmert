// actions.js — the mutation layer for schedule / employees / vacations / swaps /
// availability submissions. Extracted from index.html on 2026-11-24.
//
// Contents, in the same order as the source:
//  - SCHEDULE ACTIONS        : loadDateAssignments, assignEmployee, unassign,
//                              saveSchedule, publishSchedule, rejectBlock, lock
//                              helpers, custom-hours editor, cross-week conflict
//                              cache (_crossWeekCache).
//  - EMPLOYEE ACTIONS        : createInvitation, acceptInvitation, removeEmployee,
//                              updateEmployee, role toggles, impersonation helpers.
//  - VACATION ACTIONS        : addVacation, updateVacation, approve/reject helpers.
//  - SWAP ACTIONS            : updateSwapStatus and the swap-request state machine.
//  - AVAILABILITY SUBMISSION : submitAvailability + join-shift-request helpers.
//
// Each handler pattern is: optimistic write to S → sb.from(...).insert/update/delete
// → toast() on success/failure → render() → logAction() for the audit trail. The
// `S`, `sb`, `render()`, `logAction()`, `sendEmail()`, `sendPush()`, `toast()`,
// `uiConfirm()`, `friendlyError()`, and all data-layer loaders used here resolve
// at call time via the shared classic-<script> global scope.

// ══════════════════════════════════════════════════════
// SCHEDULE ACTIONS
// ══════════════════════════════════════════════════════
// Cross-week schedule cache for conflict checks
const _crossWeekCache = {};  // { "YYYY-MM-DD": {shiftId: [empIds]} }

async function loadDateAssignments(dateStr) {
  if (_crossWeekCache[dateStr]) return _crossWeekCache[dateStr];
  if (S.schedule[dateStr]) {
    _crossWeekCache[dateStr] = S.schedule[dateStr];
    return S.schedule[dateStr];
  }
  // Load from DB
  try {
    // Find week_start for this date
    const dt = new Date(dateStr+"T12:00:00");
    const dow = dt.getDay();
    const weekStart = new Date(dt);
    weekStart.setDate(dt.getDate() - dow);
    const wsStr = weekStart.getFullYear()+"-"+String(weekStart.getMonth()+1).padStart(2,"0")+"-"+String(weekStart.getDate()).padStart(2,"0");
    const { data: sched } = await sb.from("schedules").select("id")
      .eq("business_id", S.profile.business_id).eq("week_start", wsStr).maybeSingle();
    const result = {};
    if (sched) {
      const { data: assigns } = await sb.from("assignments").select("*")
        .eq("schedule_id", sched.id).eq("date", dateStr);
      (assigns || []).forEach(a => {
        if (!result[a.shift]) result[a.shift] = [];
        result[a.shift].push(a.employee_id);
      });
    }
    _crossWeekCache[dateStr] = result;
    return result;
  } catch (err) {
    console.warn("Could not load cross-week:", err);
    return {};
  }
}

// Returns conflict reason, or null. Checks across weeks too.
async function checkShiftConflictAsync(date, shift, empId, ignoreDate = null, ignoreShift = null) {
  // First check in-memory (current week)
  const syncCheck = checkShiftConflict(date, shift, empId, ignoreDate, ignoreShift);
  if (syncCheck) return syncCheck;
  
  const emp = getEmp(empId);
  const name = emp?.name || "עובד";
  
  // Cross-week: morning/morning2 → check previous day if not in S.schedule
  if (shift === "morning" || shift === "morning2") {
    const yesterday = new Date(new Date(date+"T12:00:00").getTime() - 86400000);
    const yStr = yesterday.getFullYear()+"-"+String(yesterday.getMonth()+1).padStart(2,"0")+"-"+String(yesterday.getDate()).padStart(2,"0");
    // If yesterday is in current schedule, already checked. Otherwise load from DB.
    if (!S.schedule[yStr]) {
      const prevDay = await loadDateAssignments(yStr);
      if ((prevDay["night"]||[]).includes(empId)) {
        return name + " עבד לילה ב-" + fmtDate(yStr) + " — לא ניתן לשבץ לבוקר";
      }
    }
  }
  
  // Cross-week: night → check next day's morning
  if (shift === "night") {
    const tomorrow = new Date(new Date(date+"T12:00:00").getTime() + 86400000);
    const tStr = tomorrow.getFullYear()+"-"+String(tomorrow.getMonth()+1).padStart(2,"0")+"-"+String(tomorrow.getDate()).padStart(2,"0");
    if (!S.schedule[tStr]) {
      const nextDay = await loadDateAssignments(tStr);
      if ((nextDay["morning"]||[]).includes(empId)) {
        return name + " משובץ לבוקר ב-" + fmtDate(tStr) + " — לא ניתן לשבץ ללילה";
      }
      if ((nextDay["morning2"]||[]).includes(empId)) {
        return name + " משובץ לבוקר ב׳ ב-" + fmtDate(tStr) + " — לא ניתן לשבץ ללילה";
      }
    }
  }
  
  return null;
}

function checkShiftConflict(date, shift, empId, ignoreDate = null, ignoreShift = null) {
  const emp = getEmp(empId);
  const name = emp?.name || "עובד";

  // פונקציית עזר שבודקת אם עובד משובץ, תוך התעלמות ממשמרת ספציפית (למקרה של חילוף)
  const isAssigned = (d, s) => {
    if (d === ignoreDate && s === ignoreShift) return false;
    return (S.schedule[d]?.[s]||[]).includes(empId);
  };

  // 1. האם כבר משובץ למשמרת אחרת באותו יום?
  const todayShifts = SHIFTS.filter(sh =>
    sh.id !== shift && isAssigned(date, sh.id)
  );
  if (todayShifts.length > 0) return `${name} כבר משובץ ל${todayShifts[0].label} ביום זה`;

  // 2. עבד לילה אתמול - לא יכול בוקר (גם בוקר ב׳)
  if (shift === "morning" || shift === "morning2") {
    const yesterday = new Date(new Date(date+"T12:00:00").getTime() - 86400000);
    const yStr = yesterday.getFullYear()+"-"+String(yesterday.getMonth()+1).padStart(2,"0")+"-"+String(yesterday.getDate()).padStart(2,"0");
    if (isAssigned(yStr, "night")) return `${name} עבד לילה אתמול — לא ניתן לשבץ לבוקר`;
  }

  // 3. משמרת לילה - בדיקה שלא עובד בוקר/בוקר ב׳ מחר
  if (shift === "night") {
    const tomorrow = new Date(new Date(date+"T12:00:00").getTime() + 86400000);
    const tStr = tomorrow.getFullYear()+"-"+String(tomorrow.getMonth()+1).padStart(2,"0")+"-"+String(tomorrow.getDate()).padStart(2,"0");
    if (isAssigned(tStr, "morning")) return `${name} משובץ לבוקר מחר — לא ניתן לשבץ ללילה`;
    if (isAssigned(tStr, "morning2")) return `${name} משובץ לבוקר ב׳ מחר — לא ניתן לשבץ ללילה`;
  }

  return null; // הכל תקין, אין התנגשות
}

// Is this specific shift blocked by an approved absence (vacation/reserve/exam)?
// Handles PARTIAL days: on the first/last day of a vacation, only specific shifts may be blocked.
// Returns the blocking vacation object if blocked, or null if the employee is free for this shift.
// Human-readable description of partial-day shifts for a vacation (for display)
function describePartialVac(v) {
  const shiftLabel = (id) => (SHIFTS.find(s=>s.id===id)?.label || id);
  const parts = [];
  if (Array.isArray(v.start_day_shifts) && v.start_day_shifts.length > 0) {
    parts.push("יום ראשון: חסום רק " + v.start_day_shifts.map(shiftLabel).join(", "));
  }
  if (Array.isArray(v.end_day_shifts) && v.end_day_shifts.length > 0) {
    parts.push("יום אחרון: חסום רק " + v.end_day_shifts.map(shiftLabel).join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : "";
}

function getBlockingVacation(empId, date, shiftId) {
  const vacs = (S.vacations || []).filter(v =>
    v.employee_id === empId && v.status === "approved" &&
    date >= v.start_date && date <= v.end_date
  );
  for (const v of vacs) {
    const isFirstDay = (date === v.start_date);
    const isLastDay = (date === v.end_date);
    // Single-day vacation: both boundary rules could apply — block if EITHER blocks it
    if (isFirstDay && v.start_day_shifts != null) {
      // Only the listed shifts are blocked on the first day
      if (Array.isArray(v.start_day_shifts) && v.start_day_shifts.includes(shiftId)) return v;
      // If it's also the last day with its own rule, check that too
      if (isLastDay && v.end_day_shifts != null) {
        if (Array.isArray(v.end_day_shifts) && v.end_day_shifts.includes(shiftId)) return v;
      }
      continue; // first-day partial rule applied, this shift not in it -> not blocked by this vac
    }
    if (isLastDay && v.end_day_shifts != null) {
      if (Array.isArray(v.end_day_shifts) && v.end_day_shifts.includes(shiftId)) return v;
      continue;
    }
    // No partial rule for this boundary -> whole day blocked
    return v;
  }
  return null;
}

async function toggleCellEmp(date, shift, empId) {
  const weekStart = getWeekDates(S.weekOffset)[0];
  if (S.publishedWeeks.has(weekStart) && !(await uiConfirm({title:"השבוע כבר פורסם", message:"השינוי יוצג לעובדים מיד. התראה (מייל + פוש) עם סיכום כל השינויים תישלח לכל עובד שנפגע — 10 דקות לאחר השינוי האחרון. להמשיך?", tone:"warn", okLabel:"להמשיך"}))) return;
  if (!S.schedule[date]) S.schedule[date] = {};
  if (!S.schedule[date][shift]) S.schedule[date][shift] = [];
  const arr = S.schedule[date][shift];
  const idx = arr.indexOf(empId);
  
  // Snapshot for undo
  const empName = getEmp(empId)?.name?.split(" ")[0] || "עובד";
  const action = idx >= 0 ? "הסרת " + empName : "שיבוץ " + empName;
  pushScheduleHistory(action);

  if (idx >= 0) {
    // Removing — remove ALL occurrences
    S.schedule[date][shift] = arr.filter(id => id !== empId);
    // Also clear the manual lock for this slot — otherwise auto-schedule would still
    // "remember" the removed assignment as intentional.
    const removeLockKey = date+"|"+shift;
    if (S.lockedSlots[removeLockKey]) S.lockedSlots[removeLockKey].delete(empId);
  } else {
    // Adding — check if employee is in ANOTHER shift the same day (this is a MOVE)
    const otherShiftSameDay = SHIFTS.find(sh =>
      sh.id !== shift && (S.schedule[date]?.[sh.id] || []).includes(empId)
    );
    
    if (otherShiftSameDay) {
      const empName = getEmp(empId)?.name || "העובד";
      const currentLabel = otherShiftSameDay.label;
      const targetLabel = SHIFT_BY_ID[shift]?.label || shift;

      // Ask what the manager wants: MOVE (out of current shift) or ADD (double-shift day).
      // OK = move (default, matches the old behavior), Cancel = we ask about adding.
      const shouldMove = await uiConfirm({title:empName + " משובץ ל" + currentLabel, message:"מה לעשות?\n\n• אישור = להעביר ל" + targetLabel + "\n• ביטול = לשאול על הוספה כמשמרת נוספת", tone:"info", okLabel:"העבר ל" + targetLabel, cancelLabel:"לא, אחר"});

      if (!shouldMove) {
        // Second question: add as an additional shift, or cancel completely?
        if (!(await uiConfirm({title:"להוסיף כמשמרת נוספת?", message:empName + " יופיע ב" + currentLabel + " וגם ב" + targetLabel + " באותו יום.", tone:"warn", okLabel:"הוסף למשמרת נוספת"}))) {
          return; // user cancelled both — do nothing
        }
        // Add to the new shift WITHOUT removing from the current one
        if (!arr.includes(empId)) arr.push(empId);
        const lockKeyAdd = date+"|"+shift;
        if (!S.lockedSlots[lockKeyAdd]) S.lockedSlots[lockKeyAdd] = new Set();
        S.lockedSlots[lockKeyAdd].add(empId);
        saveScheduleToDB();
        render();
        toast(empName + " הוסף גם ל" + targetLabel + " ✓");
        return;
      }

      // MOVE flow (the original behavior): remove from the other shift
      S.schedule[date][otherShiftSameDay.id] = (S.schedule[date][otherShiftSameDay.id] || []).filter(id => id !== empId);
      
      // Also move custom hours and notes
      const oldKey = date+"|"+otherShiftSameDay.id+"|"+empId;
      const newKey = date+"|"+shift+"|"+empId;
      if (S.customHours[oldKey]) {
        S.customHours[newKey] = S.customHours[oldKey];
        delete S.customHours[oldKey];
      }
      if (S.assignmentNotes[oldKey]) {
        S.assignmentNotes[newKey] = S.assignmentNotes[oldKey];
        delete S.assignmentNotes[oldKey];
      }
      // Add to new shift and save
      if (!arr.includes(empId)) arr.push(empId);
      // Auto-lock: intra-day move is also a manual decision.
      const lockKeyMove = date+"|"+shift;
      if (!S.lockedSlots[lockKeyMove]) S.lockedSlots[lockKeyMove] = new Set();
      S.lockedSlots[lockKeyMove].add(empId);
      // And remove the lock from the shift they moved out of, if any.
      const oldLockKey = date+"|"+otherShiftSameDay.id;
      if (S.lockedSlots[oldLockKey]) S.lockedSlots[oldLockKey].delete(empId);
      saveScheduleToDB();
      render();
      toast("הועבר ל" + (SHIFT_BY_ID[shift]?.label || shift) + " ✓");
      return;
    }
    
    // Adding — check constraints (sync, current week)
    const conflict = checkShiftConflict(date, shift, empId);
    if (conflict) { toast(conflict,"err"); return; }
    
    // Cross-week check (async, looks at prev/next week)
    const crossConflict = await checkShiftConflictAsync(date, shift, empId);
    if (crossConflict) {
      if (!(await uiConfirm({title:"התנגשות שעות", message:crossConflict, tone:"warn", okLabel:"שבץ בכל זאת"}))) return;
    }
    // Snapshot for rollback
    const beforeAdd = [...arr];

    // Check if employee blocked this shift
    const blockShiftId = (shift === "morning2") ? "morning" : shift;
    const dateLocal = date;
    const empBlocked = S.availSubmissions.some(s =>
      s.employee_id === empId &&
      (s.slots||[]).some(sl => {
        if (sl.date && sl.date === dateLocal) return sl.shift === blockShiftId || sl.shift === shift;
        return false;
      })
    );
    if (empBlocked) {
      if (!(await uiConfirm({title:"העובד חסם משמרת זו", message:(getEmp(empId)?.name||"העובד") + " ביקש לא לעבוד במשמרת זו.", tone:"warn", okLabel:"שבץ בכל זאת"}))) return;
    }

    if (!arr.includes(empId)) arr.push(empId);
    // Auto-lock: any employee added manually via a direct click is treated as a manual
    // assignment and won't be touched by the next auto-schedule run.
    const lockKey = date+"|"+shift;
    if (!S.lockedSlots[lockKey]) S.lockedSlots[lockKey] = new Set();
    S.lockedSlots[lockKey].add(empId);
  }
  saveScheduleToDB();
  render();
}

function toggleLock(date, shift, empId) {
  const key = date+"|"+shift;
  if (!S.lockedSlots[key]) S.lockedSlots[key] = new Set();
  if (S.lockedSlots[key].has(empId)) S.lockedSlots[key].delete(empId);
  else S.lockedSlots[key].add(empId);
  render();
}

// Build the full week schedule data (all employees, all shifts) — used for manager preview
// AND for the "full schedule view" email sent to everyone on real publish.
function buildFullScheduleData(wd) {
  return wd.map(date => {
    const dt = new Date(date+"T00:00:00");
    const dayShifts = getShiftsForDate(date);
    return {
      day: DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth()+1),
      date: date,
      holiday: (typeof getHoliday === "function") ? getHoliday(date) : null,
      shifts: dayShifts.map(sh => {
        const empIds = S.schedule[date]?.[sh.id] || [];
        return {
          label: sh.label,
          hours: sh.start + "–" + sh.end,
          color: sh.color,
          employees: empIds.map(empId => {
            const emp = getEmp(empId);
            if (!emp) return null;
            const chKey = date+"|"+sh.id+"|"+empId;
            const ch = S.customHours[chKey];
            const note = S.assignmentNotes[chKey] || "";
            let tags = [];
            let freeText = "";
            if (note.startsWith("🏷️ ")) {
              const parts = note.split(" | ");
              tags = parts[0].replace("🏷️ ","").split(", ").map(t=>t.trim()).filter(Boolean);
              freeText = parts.slice(1).join(" | ");
            } else {
              freeText = note;
            }
            return {
              name: emp.name,
              // Always include the hours — use custom if set, else the shift's day-specific default.
              hours: ch ? (ch.start + "-" + ch.end) : (sh.start + "-" + sh.end),
              customHours: ch ? (ch.start + "-" + ch.end) : null,
              tags: tags,
              note: freeText
            };
          }).filter(Boolean)
        };
      })
    };
  });
}

async function publishWeek(type) {
  const wd = getWeekDates(S.weekOffset);
  const weekStart = wd[0];
  const weekLabel = fmtDate(wd[0]) + " — " + fmtDate(wd[6]);
  const isFinal = type === "final";
  const isPreview = type === "preview";

  // Preview: show manager selection modal first, then send to selected only
  if (isPreview) {
    const managers = S.employees.filter(e => 
      (e.role === "admin" || e.role === "manager") && e.email
    );
    
    if (managers.length === 0) {
      toast("אין מנהלים נוספים לשליחה","err");
      S.showPublishModal = false;
      render();
      return;
    }
    
    // Show manager-selection modal unless the user has already confirmed their selection
    if (!S.previewConfirmed) {
      S.showPublishModal = false;
      if (!S.previewSelectedMgrs) {
        // Default: all managers selected
        S.previewSelectedMgrs = new Set(managers.map(m => m.id));
      }
      S.showPreviewSelectModal = true;
      render();
      return;
    }
    // User confirmed selection via the modal — proceed
    S.previewConfirmed = false;
    
    // Filter to only selected managers
    const selectedManagers = managers.filter(m => S.previewSelectedMgrs.has(m.id));
    if (selectedManagers.length === 0) {
      toast("לא נבחרו מנהלים לשליחה","err");
      return;
    }
    
    // Build the FULL schedule for the week — all employees, all shifts
    const fullSchedule = buildFullScheduleData(wd);
    
    // Send the SAME full schedule to selected managers
    for (const mgr of selectedManagers) {
      sendEmail("schedule_preview_full", mgr.email, { 
        empName: mgr.name, 
        weekLabel: "[בדיקה] — " + weekLabel, 
        fullSchedule: fullSchedule,
        businessName: S.business?.name || ""
      });
    }
    
    S.showPublishModal = false;
    S.showPreviewSelectModal = false;
    S.previewSelectedMgrs = null;  // Reset for next time
    toast(`📝 סידור לבדיקה נשלח ל-${selectedManagers.length} מנהלים`);
    render();
    if (typeof logAction === "function") {
      logAction("schedule_preview_sent", { week_start: weekStart, recipients: managers.length });
    }
    return;
  }

  // For "initial" publish, respect S.publishVisibleUntil if set (ISO datetime string).
  // After that time, employees see "being prepared" even though the schedule is published.
  // "final" publish ignores the field — final is permanent until replaced.
  const payload = { business_id: S.profile.business_id, week_start: weekStart, published: true, publish_type: type };
  if (type === "initial" && S.publishVisibleUntil) {
    // The value from <input type="datetime-local"> is a wall-clock string with NO
    // timezone (e.g. "2026-10-28T18:00"). Postgres timestamptz would interpret that
    // as UTC, which would end up 2–3 hours later in Israel time than what the user
    // picked. Parse it as a local Date (which uses the browser's zone) and store
    // the proper ISO string so the deadline lands on the exact wall-clock minute.
    const localDate = new Date(S.publishVisibleUntil);
    payload.visible_until = isNaN(localDate.getTime()) ? S.publishVisibleUntil : localDate.toISOString();
  } else {
    // Clear any previous visibility deadline when publishing final or without one.
    payload.visible_until = null;
  }

  // Use upsert so this works whether the schedules row already exists or not,
  // and ALWAYS verify the write actually succeeded before telling the manager it worked.
  // Note: created_by intentionally omitted from the upsert payload so that publishing
  // an already-existing week never overwrites the original creator's attribution.
  const { data: upserted, error: publishError } = await sb.from("schedules")
    .upsert(payload, { onConflict: "business_id,week_start" })
    .select("id, published, publish_type, visible_until")
    .maybeSingle();

  if (publishError || !upserted || upserted.published !== true) {
    toast("❌ הפרסום נכשל: " + (publishError?.message || "לא ניתן לאמת שהשבוע פורסם"), "err");
    console.error("Publish failed", publishError, upserted);
    S.showPublishModal = false;
    render();
    return; // Do not proceed to update local flags or send emails on failure
  }

  if (isFinal) {
    S.publishedWeeks.add(weekStart);
  }
  S.publishedInitial = S.publishedInitial || new Set();
  if (!isFinal) S.publishedInitial.add(weekStart);

  const savedType = upserted.publish_type || type;
  if (typeof logAction === "function") {
    await logAction(savedType === "final" ? "schedule_published_final" : "schedule_published_initial", { week_start: weekStart, publish_type: savedType });
  }

  S.showPublishModal = false;
  toast(isFinal ? "סידור סופי פורסם 📢" : "סידור ראשוני פורסם 📋");
  render();
  silentRefresh();

  // Send email to each employee
  for (const emp of S.employees) {
    if (!emp.email || emp.id === S.user.id) continue;
    const myShifts = [];
    wd.forEach(date => {
      // Use day-specific shift definitions so Thu-night/Fri/Sat hours render correctly
      // in the published email, not just the generic weekday defaults.
      const dayShifts = getShiftsForDate(date);
      dayShifts.forEach(sh => {
        if ((S.schedule[date]?.[sh.id]||[]).includes(emp.id)) {
          const dt = new Date(date+"T00:00:00");
          // Use custom hours if defined for this employee
          const chKey = date+"|"+sh.id+"|"+emp.id;
          const ch = S.customHours[chKey];
          const startTime = ch?.start || sh.start;
          const endTime = ch?.end || sh.end;
          // Get note with system tags
          const noteKey = date+"|"+sh.id+"|"+emp.id;
          const note = S.assignmentNotes[noteKey] || "";
          // Parse note for tags vs free text
          let tags = [];
          let freeText = "";
          if (note.startsWith("🏷️ ")) {
            const parts = note.split(" | ");
            tags = parts[0].replace("🏷️ ","").split(", ").map(t=>t.trim()).filter(Boolean);
            freeText = parts.slice(1).join(" | ");
          } else {
            freeText = note;
          }
          myShifts.push({
            day: DAYS[dt.getDay()]+" "+dt.getDate(),
            date: date,           // YYYY-MM-DD — needed for .ics calendar attachment
            startTime: startTime, // HH:MM
            endTime: endTime,     // HH:MM
            shiftId: sh.id,       // morning / morning2 / afternoon / night — part of .ics UID
            label: sh.label,
            hours: startTime+"–"+endTime,
            color: sh.color,
            tags: tags,
            note: freeText
          });
        }
      });
    });
    sendEmail(
      isFinal ? "schedule_published" : "schedule_initial",
      emp.email,
      {
        empName: emp.name, weekLabel, shifts: myShifts, isFinal,
        // Per-employee reminder preference — null/undefined means no VALARM in .ics
        reminderMinutes: emp.shift_reminder_minutes ?? null,
        // Employee id is part of the .ics UID so a republish updates the same
        // calendar event in the viewer's calendar (no duplicate events).
        empId: emp.id,
      }
    );
    sendPush(isFinal ? "schedule_published" : "schedule_initial", emp.id, { weekLabel });
  }

  // Second email: full schedule view — publisher also receives it
  const fullScheduleForPublish = buildFullScheduleData(wd);
  for (const emp of S.employees) {
    if (!emp.email) continue;
    sendEmail(
      "schedule_full_view",
      emp.email,
      { 
        empName: emp.name, 
        weekLabel, 
        fullSchedule: fullScheduleForPublish, 
        isFinal, 
        businessName: S.business?.name || "" 
      }
    );
  }
}

// ══════════════════════════════════════════════════════
// EMPLOYEE ACTIONS
// ══════════════════════════════════════════════════════
async function createInvitation() {
  const { name, email, role } = S.newInvitation;
  
  // Validation
  if (!email.trim()) { toast("חובה להזין מייל","err"); return; }
  if (!isValidEmail(email.trim())) { toast("מייל לא תקין","err"); return; }
  
  const normalizedEmail = email.trim().toLowerCase();
  
  // Check if user with this email already exists in this business
  const existingEmp = S.employees.find(e => (e.email||"").toLowerCase() === normalizedEmail);
  if (existingEmp) { toast("עובד עם המייל הזה כבר קיים","err"); return; }
  
  // Check if there's an active invitation
  const existingInv = S.invitations.find(i => 
    i.email.toLowerCase() === normalizedEmail && i.status === "pending"
  );
  if (existingInv) {
    if (!(await uiConfirm({title:"הזמנה קיימת", message:"יש כבר הזמנה פתוחה לכתובת המייל הזו. יצירת הזמנה חדשה תבטל את הישנה.", tone:"warn", okLabel:"צור חדשה"}))) return;
    await sb.from("invitations").update({ status: "revoked" }).eq("id", existingInv.id);
  }
  
  // Generate secure token
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);  // 48 hour expiry
  
  // Create invitation
  const { data: inv, error } = await sb.from("invitations").insert({
    business_id: S.profile.business_id,
    email: normalizedEmail,
    name: name.trim() || null,
    role: role || "employee",
    token: token,
    invited_by: S.user.id,
    invited_by_name: S.profile.name,
    expires_at: expiresAt.toISOString()
  }).select().single();
  
  if (error) { toast(friendlyError(error), "err"); return; }
  
  // Send invitation email
  const inviteUrl = window.location.origin + "/?invite=" + token;
  await sendEmail("invitation", normalizedEmail, {
    inviteeName: name.trim() || "עובד חדש",
    inviterName: S.profile.name,
    businessName: S.business?.name || "החברה",
    role: role === "admin" || role === "manager" ? "מנהל" : "עובד",
    inviteUrl: inviteUrl,
    expiresAt: expiresAt.toLocaleDateString("he-IL") + " " + expiresAt.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})
  });
  
  if (typeof logAction === "function") {
    logAction("invitation_sent", { invitee_email: normalizedEmail, role: role });
  }
  
  S.showInviteModal = false;
  S.newInvitation = { name: "", email: "", role: "employee" };
  await loadInvitations();
  toast("✓ הזמנה נשלחה ל-" + normalizedEmail);
  render();
}

async function revokeInvitation(invId) {
  if (!(await uiConfirm({title:"לבטל הזמנה?", message:"הלינק שנשלח לא יהיה תקף יותר.", tone:"warn", okLabel:"בטל הזמנה"}))) return;
  const { error } = await sb.from("invitations").update({ status: "revoked" }).eq("id", invId);
  if (error) { toast(friendlyError(error), "err"); return; }
  if (typeof logAction === "function") logAction("invitation_revoked", { invitation_id: invId });
  await loadInvitations();
  toast("הזמנה בוטלה");
  render();
}

async function resendInvitation(inv) {
  // Generate new token and extend expiry
  const newToken = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);
  
  const { error } = await sb.from("invitations").update({
    token: newToken,
    expires_at: expiresAt.toISOString(),
    status: "pending"
  }).eq("id", inv.id);
  
  if (error) { toast(friendlyError(error), "err"); return; }
  
  const inviteUrl = window.location.origin + "/?invite=" + newToken;
  await sendEmail("invitation", inv.email, {
    inviteeName: inv.name || "עובד חדש",
    inviterName: S.profile.name,
    businessName: S.business?.name || "החברה",
    role: inv.role === "admin" || inv.role === "manager" ? "מנהל" : "עובד",
    inviteUrl: inviteUrl,
    expiresAt: expiresAt.toLocaleDateString("he-IL")
  });
  
  if (typeof logAction === "function") logAction("invitation_resent", { invitation_id: inv.id });
  await loadInvitations();
  toast("✓ הזמנה נשלחה מחדש ל-" + inv.email);
  render();
}

async function copyInviteLink(inv) {
  const inviteUrl = window.location.origin + "/?invite=" + inv.token;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast("✓ הלינק הועתק");
  } catch (err) {
    await uiPrompt({title:"קישור להזמנה", message:"העתק את הלינק ושלח לעובד החדש:", defaultValue:inviteUrl, okLabel:"סגור", cancelLabel:"סגור"});
  }
}

async function addEmployee() {
  const {name,email,idNumber,phone,role} = S.newEmp;
  if (!name.trim()) { toast("נא להזין שם","err"); return; }
  const {error} = await sb.from("profiles").insert({
    id: crypto.randomUUID(),
    name, email: email||null, id_number: idNumber||null, phone: phone||null,
    role: role||"employee", business_id: S.profile.business_id, max_shifts_per_week:5,
    is_deleted:false,
  });
  if (error) { toast(friendlyError(error),"err"); return; }
  await loadEmployees();
  S.newEmp = {name:"",email:"",idNumber:"",phone:"",role:"employee"};
  S.showAddEmp = false;
  toast("עובד נוסף ✓"); render();
  silentRefresh();
}

async function renameEmployee(emp) {
  const newName = await uiPrompt({title:"עריכת שם", message:"שם חדש עבור " + emp.name, defaultValue:emp.name, placeholder:"שם מלא", okLabel:"שמור"});
  if (!newName || !newName.trim()) return;
  const trimmed = newName.trim();
  if (trimmed === emp.name) return;
  if (trimmed.length < 2) { toast("שם חייב להיות לפחות 2 תווים","err"); return; }
  
  try {
    const { error } = await sb.from("profiles").update({ name: trimmed }).eq("id", emp.id);
    if (error) { toast(friendlyError(error), "err"); return; }
    
    // Update local state
    emp.name = trimmed;
    if (emp.id === S.user.id) S.profile.name = trimmed;
    
    toast("✓ השם עודכן ל-" + trimmed);
    if (typeof logAction === "function") {
      logAction("employee_renamed", { emp_id: emp.id, new_name: trimmed });
    }
    await loadEmployees();
    render();
  } catch (err) {
    toast("שגיאה בעדכון השם","err");
    console.error(err);
  }
}

async function resetPassword(emp) {
  if (!emp.email) { toast("לעובד אין אימייל","err"); return; }
  if (!(await uiConfirm({title:"לשלוח איפוס סיסמה?", message:"לינק ישלח ל-" + emp.name + " בכתובת: " + emp.email, tone:"info", okLabel:"שלח לינק"}))) return;
  
  try {
    const { error } = await sb.auth.resetPasswordForEmail(emp.email, {
      redirectTo: window.location.origin + "/?reset=true"
    });
    if (error) {
      toast(friendlyError(error), "err");
      return;
    }
    toast("✓ לינק איפוס נשלח ל-" + emp.name);
    if (typeof logAction === "function") {
      logAction("password_reset_sent", { emp_id: emp.id, emp_name: emp.name });
    }
  } catch (err) {
    toast("שגיאה בשליחה", "err");
    console.error(err);
  }
}

async function deleteEmployee(id) {
  const emp = getEmp(id);
  if (!(await uiConfirm({title:"מחיקת עובד", message:"האם למחוק את " + (emp?.name || "העובד") + "? ניתן לשחזר במשך 8 שניות.", tone:"danger", okLabel:"מחק"}))) return;
  const {error} = await sb.from("profiles").update({is_deleted:true}).eq("id",id);
  if (error) { toast(friendlyError(error),"err"); return; }
  await loadEmployees();
  render();
  // Undo window: let the user press Undo and the employee is restored instantly.
  toast((emp?.name||"העובד")+" נמחק","ok", async () => {
    await sb.from("profiles").update({is_deleted:false}).eq("id",id);
    await loadEmployees();
    render();
  });
}

async function saveConstraints(empId, data) {
  const updateData = {
    max_shifts_per_week: data.maxShifts,
    block_limits: data.blockLimits || null,
    active_days: data.activeDays || [0,1,2,3,4,5,6],
    allowed_shifts: data.allowedShifts || null,
    exclude_from: data.excludeFrom || null,
    exclude_to: data.excludeTo || null,
    exclude_reason: data.excludeReason || null,
    fixed_shifts: data.fixedShifts || null,
  };
  const {error} = await sb.from("profiles").update(updateData).eq("id", empId);
  if (error) { 
    console.error("💾 Save error:", error);
    toast("שמירה נכשלה — " + friendlyError(error), "err"); 
    return; 
  }
  await loadEmployees();
  // Verify save worked
  const saved = getEmp(empId);
  S.constraintsEmp = null;
  toast("הגבלות נשמרו ✓"); render();
  silentRefresh();
}

// ══════════════════════════════════════════════════════
// VACATION ACTIONS
// ══════════════════════════════════════════════════════
async function addVacation() {
  if (!S.newVac.startDate || !S.newVac.endDate) {
    toast("נא למלא תאריכים", "err");
    return;
  }
  if (S.newVac.endDate < S.newVac.startDate) {
    toast("תאריך סיום לפני התחלה", "err");
    return;
  }

  // Sanity check: anything over 90 days is almost always a date-picker misclick (wrong
  // year/month). Ask the user to confirm before sending the request.
  const dayDiff = Math.round((new Date(S.newVac.endDate+"T00:00:00") - new Date(S.newVac.startDate+"T00:00:00")) / 86400000) + 1;
  if (dayDiff > 90) {
    const confirmLong = await uiConfirm({
      title:"בקשה ארוכה — לאשר?",
      message:`הבקשה היא ל-${dayDiff} ימים (${fmtDate(S.newVac.startDate)} עד ${fmtDate(S.newVac.endDate)}). בטוח שזה נכון? אם בחרת שנה לא נכונה — חזור ותקן.`,
      tone:"warn",
      okLabel:"כן, שלח"
    });
    if (!confirmLong) return;
  }

  const type = S.newVac.type || "vacation";
  // Manager can pick employee, employee defaults to self
  // In test mode, use the viewed employee's ID
  const empId = S.newVac.employeeId || (S.testAsEmployee ? S.empViewId : S.user.id);

  const payload = {
    employee_id: empId,
    business_id: S.profile.business_id,
    start_date: S.newVac.startDate,
    end_date: S.newVac.endDate,
    type,
    status: "pending",
    reason: S.newVac.reason || null,
    start_day_shifts: (type !== "exam" && S.newVac.startDayShifts != null) ? S.newVac.startDayShifts : null,
    end_day_shifts: (type !== "exam" && S.newVac.endDayShifts != null && S.newVac.endDate !== S.newVac.startDate) ? S.newVac.endDayShifts : null
  };

  const { error } = await sb.from("vacations").insert([payload]);
  if (error) { toast(friendlyError(error), "err"); return; }

  // שלח מייל למנהל
  const allManagers = getNotifiedManagers();
  allManagers.forEach(adminEmp => {
    const reqEmp = getEmp(empId) || S.profile;
    const typeLabel = type === "reserve" ? "מילואים 🎖️" : type === "exam" ? "מבחן 📝" : "חופשה 🌴";
    sendEmail("absence_request", adminEmp.email, {
      requesterName: reqEmp.name,
      typeLabel,
      type,
      startDate: S.newVac.startDate,
      endDate: S.newVac.endDate,
      reason: S.newVac.reason || ""
    });
    sendPush("absence_request", adminEmp.id, {
      requesterName: reqEmp.name,
      type,
      startDate: S.newVac.startDate,
      endDate: S.newVac.endDate
    });
  });

  const labels = { vacation: "חופשה 🌴", reserve: "מילואים 🎖️", exam: "מבחן 📝" };
  toast(`בקשת ${labels[type] || "היעדרות"} נשלחה לאישור מנהל ✓`);

  S.showAddVac = false;
  S.newVac = { type: "vacation", startDate: "", endDate: "", reason: "", startDayShifts: null, endDayShifts: null };
  await loadVacations();
  render();
  silentRefresh();
}

async function deleteVacRequest(id) {
  if (!(await uiConfirm({title:"למחוק בקשה?", message:"ניתן לשחזר במשך 8 שניות אחרי המחיקה.", tone:"danger", okLabel:"מחק"}))) return;
  const vacBefore = S.vacations.find(v=>v.id===id);
  if (!vacBefore) return;
  const { error } = await sb.from("vacations").delete().eq("id", id);
  if (error) { toast(friendlyError(error), "err"); return; }
  if (typeof logAction === "function") {
    logAction("vacation_request_deleted_by_employee", {
      vacation_id: id,
      employee_id: vacBefore?.employee_id,
      type: vacBefore?.type,
      status_before: vacBefore?.status,
      dates: (vacBefore?.start_date||"") + " — " + (vacBefore?.end_date||"")
    });
  }
  S.vacations = S.vacations.filter(v => v.id !== id);
  render();
  // Undo: re-insert the exact row (minus FK-only fields the server fills).
  toast("הבקשה נמחקה","ok", async () => {
    const payload = Object.fromEntries(Object.entries(vacBefore).filter(([k,v])=>v!==null && k!=="approved_by"));
    const { error: reErr } = await sb.from("vacations").insert([payload]);
    if (reErr) throw reErr;
    await loadVacations();
    render();
  });
}

async function updateVacStatus(id, status, rejectReason) {
  const vacBefore = S.vacations.find(v=>v.id===id);
  const updateData = {status, approved_by: S.user.id};
  if (rejectReason) updateData.reject_reason = rejectReason;
  const { data: vacUpd, error: vacErr } = await sb.from("vacations").update(updateData).eq("id",id).select("id,status").maybeSingle();
  if (vacErr || !vacUpd || vacUpd.status !== status) {
    toast("❌ הפעולה נכשלה: " + (vacErr?.message || "לא ניתן לאמת את העדכון"), "err");
    return;
  }
  if (typeof logAction === "function") {
    logAction(status === "approved" ? "vacation_approved" : "vacation_rejected", {
      vacation_id: id,
      employee_id: vacBefore?.employee_id,
      type: vacBefore?.type,
      dates: (vacBefore?.start_date||"") + " — " + (vacBefore?.end_date||""),
      reject_reason: rejectReason || null
    });
  }
  await loadVacations();
  toast(status==="approved"?"חופשה אושרה ✓":"חופשה נדחתה"); render();
  silentRefresh();

  const vac = S.vacations.find(v=>v.id===id);
  if (vac) {
    const emp = getEmp(vac.employee_id);
    if (emp?.email) {
      sendEmail(
        status==="approved" ? "vacation_approved" : "vacation_rejected",
        emp.email,
        { empName: emp.name, startDate: vac.start_date, endDate: vac.end_date, reason: vac.reason||"", rejectReason: rejectReason||"" }
      );
    }
    if (emp?.id) {
      sendPush(
        status==="approved" ? "vacation_approved" : "vacation_rejected",
        emp.id,
        { startDate: vac.start_date, endDate: vac.end_date, rejectReason: rejectReason||"", type: vac.type }
      );
    }
  }
}

// ══════════════════════════════════════════════════════
// SWAP ACTIONS
// ══════════════════════════════════════════════════════
async function updateSwapStatus(id, status) {
  await sb.from("swap_requests").update({status}).eq("id",id);
  await loadSwapRequests();
  toast(status==="approved"?"חילוף אושר ✓":"חילוף נדחה"); render();

  // Send email to requester
  const swap = S.swapRequests.find(s=>s.id===id);
  if (swap) {
    const requester = getEmp(swap.requester_id);
    if (requester?.email) {
      const sh = SHIFT_BY_ID[swap.target_shift];
      sendEmail(
        status==="approved" ? "vacation_approved" : "vacation_rejected",
        requester.email,
        {
          empName: requester.name,
          startDate: swap.target_date + " — " + (sh?.label||swap.target_shift),
          endDate: swap.target_date,
          reason: "בקשת חילוף " + (status==="approved"?"אושרה":"נדחתה")
        }
      );
    }
    if (requester?.id) {
      const sh2 = SHIFT_BY_ID[swap.target_shift];
      sendPush("swap_decision", requester.id, {
        isApproved: status==="approved",
        statusText: status==="approved" ? "אושרה" : "נדחתה",
        targetDate: swap.target_date,
        shiftLabel: sh2?.label || swap.target_shift
      });
    }
  }
}

// ══════════════════════════════════════════════════════
// AVAILABILITY SUBMISSION
// ══════════════════════════════════════════════════════
// Employee requests to join an unfilled shift -> creates a pending request for the manager.
// Check whether joining `shiftId` on `date` would violate rest rules for this employee.
// Returns an error string if blocked, or null if OK.
function checkJoinRestConflict(empId, date, shiftId) {
  const name = getEmp(empId)?.name || "אתה";
  const worksShift = (d, s) => (S.schedule[d]?.[s] || []).includes(empId);

  // Same-day combinations that are NOT allowed (insufficient rest within the day):
  const sameDayAssigned = SHIFTS.filter(sh => sh.id !== shiftId && worksShift(date, sh.id)).map(sh => sh.id);

  for (const existing of sameDayAssigned) {
    // night + morning (either order) — no rest
    if ((existing === "night" && (shiftId === "morning" || shiftId === "morning2")) ||
        ((existing === "morning" || existing === "morning2") && shiftId === "night")) {
      return name + " כבר עובד באותו יום במשמרת מתנגשת (לילה/בוקר) — אין מנוחה מספקת";
    }
    // morning + afternoon/evening
    if (((existing === "morning" || existing === "morning2") && shiftId === "afternoon") ||
        (existing === "afternoon" && (shiftId === "morning" || shiftId === "morning2"))) {
      return name + " כבר עובד בוקר באותו יום — לא ניתן להוסיף משמרת ערב";
    }
    // afternoon/evening + night
    if ((existing === "afternoon" && shiftId === "night") ||
        (existing === "night" && shiftId === "afternoon")) {
      return name + " כבר עובד ערב באותו יום — לא ניתן להוסיף לילה";
    }
    // any other same-day double shift
    return name + " כבר משובץ למשמרת אחרת באותו יום";
  }

  // Cross-day rest rules (reuse the existing logic):
  if (typeof checkShiftConflict === "function") {
    const crossErr = checkShiftConflict(date, shiftId, empId);
    if (crossErr) return crossErr;
  }

  return null;
}

async function requestJoinShift(empId, date, shiftId, shiftLabel) {
  const emp = getEmp(empId) || getActiveProfile();
  const dt = new Date(date+"T00:00:00");
  const dateLabel = DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth()+1);

  // Rest-rule pre-check — block requests that would violate rest before they reach the manager
  const restErr = checkJoinRestConflict(empId, date, shiftId);
  if (restErr) {
    await uiAlert({title:"לא ניתן להצטרף", message:restErr, tone:"danger"});
    return;
  }

  if (!(await uiConfirm({title:"בקשה להצטרף למשמרת", message:"בקשה להצטרף ל" + shiftLabel + " ב" + dateLabel + " תישלח למנהל לאישור.", tone:"info", okLabel:"שלח בקשה"}))) return;

  const note = (await uiPrompt({title:"הערה למנהל", message:"אפשר להוסיף הערה קצרה למנהל (אופציונלי)", placeholder:"למשל: מוכן להתחיל שעה מאוחר יותר"})) || "";

  const { data: inserted, error } = await sb.from("shift_join_requests").upsert({
    business_id: S.profile.business_id,
    employee_id: empId,
    date: date,
    shift: shiftId,
    status: "pending",
    note: note.trim() || null
  }, { onConflict: "business_id,employee_id,date,shift" }).select("id").maybeSingle();

  if (error || !inserted) {
    toast("❌ שליחת הבקשה נכשלה: " + (error?.message || "שגיאה"), "err");
    return;
  }

  if (typeof logAction === "function") {
    logAction("join_request_created", { date, shift: shiftId, employee_id: empId });
  }

  // Notify managers by email
  const managers = getNotifiedManagers();
  for (const mgr of managers) {
    sendEmail("swap_request", mgr.email, {
      requesterName: emp?.name || "עובד",
      targetDate: dateLabel,
      shiftLabel: shiftLabel,
      note: note.trim(),
      title: "➕ בקשת הצטרפות למשמרת"
    });
  }

  await loadJoinRequests();
  toast("✓ הבקשה נשלחה למנהל לאישור");
  render();
}

// Manager approves/rejects a join request
async function processJoinRequest(req, isApproved) {
  // Safety net: re-check rest rules at approval time (schedule may have changed since the request)
  if (isApproved && typeof checkJoinRestConflict === "function") {
    const restErr = checkJoinRestConflict(req.employee_id, req.date, req.shift);
    if (restErr) {
      if (!(await uiConfirm({title:"בעיית מנוחה בין משמרות", message:restErr, tone:"warn", okLabel:"אשר בכל זאת"}))) return;
    }
  }

  let rejectReason = "";
  if (!isApproved) {
    rejectReason = (await uiPrompt({title:"סיבת דחייה", message:"סיבת הדחייה (אופציונלי, ישלח לעובד)", placeholder:"למשל: כבר יש 2 חופשות באותו שבוע"})) || "";
  }

  const upd = {
    status: isApproved ? "approved" : "rejected",
    decided_at: new Date().toISOString(),
    decided_by: S.user.id,
    reject_reason: isApproved ? null : (rejectReason.trim() || null)
  };

  const { data: updated, error } = await sb.from("shift_join_requests")
    .update(upd).eq("id", req.id).select("id,status").maybeSingle();

  if (error || !updated || updated.status !== upd.status) {
    toast("❌ הפעולה נכשלה: " + (error?.message || "לא ניתן לאמת"), "err");
    return;
  }

  // If approved -> actually add the employee to the shift in the schedule
  if (isApproved) {
    const sched = await _ensureScheduleRow(req.date);
    if (sched) {
      await sb.from("assignments").upsert({
        schedule_id: sched.id,
        employee_id: req.employee_id,
        date: req.date,
        shift: req.shift
      }, { onConflict: "schedule_id,employee_id,date,shift" });
    }
  }

  if (typeof logAction === "function") {
    logAction(isApproved ? "join_request_approved" : "join_request_rejected",
      { request_id: req.id, employee_id: req.employee_id, date: req.date, shift: req.shift });
  }

  // Notify the employee
  const emp = getEmp(req.employee_id);
  if (emp?.email) {
    const dt = new Date(req.date+"T00:00:00");
    const dateLabel = DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth()+1);
    sendEmail("swap_decision", emp.email, {
      empName: emp.name,
      isApproved: isApproved,
      statusText: isApproved ? "אושרה" : "נדחתה",
      targetDate: dateLabel,
      shiftLabel: SHIFT_BY_ID[req.shift]?.label || req.shift
    });
    sendPush("swap_decision", emp.id, {
      isApproved: isApproved,
      statusText: isApproved ? "אושרה" : "נדחתה",
      targetDate: dateLabel,
      shiftLabel: SHIFT_BY_ID[req.shift]?.label || req.shift
    });
  }

  await Promise.all([loadJoinRequests(), loadSchedule()]);
  toast(isApproved ? "✓ הבקשה אושרה והעובד שובץ" : "הבקשה נדחתה");
  render();
}

// Ensure a schedule row exists for the week containing `date`, return it
async function _ensureScheduleRow(date) {
  // Find the Sunday of the week containing date
  const dt = new Date(date+"T00:00:00");
  const sunday = new Date(dt);
  sunday.setDate(dt.getDate() - dt.getDay());
  const weekStart = sunday.getFullYear()+"-"+String(sunday.getMonth()+1).padStart(2,"0")+"-"+String(sunday.getDate()).padStart(2,"0");
  const { data: existing } = await sb.from("schedules")
    .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
  if (existing) return existing;
  const { data: created } = await sb.from("schedules")
    .insert({ business_id: S.profile.business_id, week_start: weekStart, published: false })
    .select("id").maybeSingle();
  return created;
}

async function submitAvailability(empId, weekStart, slots, note) {
  await sb.from("availability_submissions").upsert({
    employee_id: empId, business_id: S.profile.business_id,
    week_start: weekStart, slots, note: note||null
  }, {onConflict:"employee_id,week_start"});
  toast("חסימות נשלחו ✓");
  // Reload availability submissions immediately and re-render so the user sees
  // their just-submitted blocks right away — silentRefresh() would skip because
  // isUserBusy() returns true on the blocks view.
  try {
    S.availDraft = {};
    S._draftWeek = null;
    clearPersistedAvailDraft();
    await loadAvailSubmissions();
    render();
  } catch(err) { console.warn("post-submit reload failed:", err); }
}
