// scheduler.js — the SMART SCHEDULE auto-fill algorithm.
// Extracted from index.html on 2026-11-24.
//
// runSmartSchedule() iterates every (date, shift) slot in the current week and
// scores each employee against the pluggable RULES engine from constants.js:
// hard blocks (vacation, availability, cross-shift conflicts) rule people out,
// soft scores (prefer fewer hours, prefer last-week's pairing, etc.) rank the
// remaining candidates, and the top-scoring employee is assigned. Writes land
// in S.schedule in memory; actual DB persistence happens later from the
// schedule-actions code path.
//
// A copy of the pre-run schedule is pushed into S.scheduleBackup so the user
// can hit Undo and get back to where they started if the result is wrong.
//
// Dependencies at call time: `S` (state.js), `SHIFTS`/`getShiftsForDate`/
// `SHIFT_BY_ID`/`RULES`/`runRules` (constants.js), `getWeekDates`/`fmtYMD`/
// `toast` (utils.js), `render()` (inline).

// ══════════════════════════════════════════════════════
// SMART SCHEDULE ALGORITHM
// ══════════════════════════════════════════════════════
async function runSmartSchedule() {
  // Backup current schedule for undo
  S.scheduleBackup = {
    weekOffset: S.weekOffset,
    schedule: JSON.parse(JSON.stringify(S.schedule || {})),
    timestamp: Date.now()
  };
  
  // Push to history
  pushScheduleHistory("שיבוץ אוטומטי");
  
  // Reload blocks to ensure fresh data
  await loadAvailSubmissions();

  // ── Weekend rotation memory ─────────────────────────────
  // Look at the past 4 weekends and count:
  //   1) How many weekend shifts each employee has worked (rotation).
  //   2) What shift-type each did last weekend (variety — morning vs night).
  //   3) Who was on vacation each of the past 4 weekends (rotation-off).
  // We then use these when scoring weekend shifts this week.
  const weekendHistory = {
    workedByEmp: {},   // empId → total weekend shifts in past 4 weekends
    lastWeType: {},    // empId → last weekend's shift type ("morning" | "night")
    offByEmp: {},      // empId → how many of the past 4 weekends they were OFF
  };
  try {
    // Get the 4 past weekend Sat/Fri dates
    const pastWeekends = [];
    for (let i = 1; i <= 4; i++) {
      const wd = getWeekDates(S.weekOffset - i);
      // wd[5] = Friday, wd[6] = Saturday
      pastWeekends.push([wd[5], wd[6]]);
    }
    const allWeekendDates = pastWeekends.flat();
    if (allWeekendDates.length > 0) {
      const { data: hist } = await sb.from("schedules")
        .select("id, week_start")
        .eq("business_id", S.profile.business_id)
        .in("week_start", [
          getWeekDates(S.weekOffset - 1)[0],
          getWeekDates(S.weekOffset - 2)[0],
          getWeekDates(S.weekOffset - 3)[0],
          getWeekDates(S.weekOffset - 4)[0],
        ]);
      const histIds = (hist||[]).map(h => h.id);
      if (histIds.length > 0) {
        const { data: histAssigns } = await sb.from("assignments")
          .select("date, shift, employee_id")
          .in("schedule_id", histIds)
          .in("date", allWeekendDates);
        (histAssigns||[]).forEach(a => {
          weekendHistory.workedByEmp[a.employee_id] = (weekendHistory.workedByEmp[a.employee_id]||0) + 1;
        });
        // For "last weekend type" — look at the most recent weekend
        const lastWeekendDates = pastWeekends[0];
        (histAssigns||[]).forEach(a => {
          if (lastWeekendDates.includes(a.date)) {
            weekendHistory.lastWeType[a.employee_id] = a.shift; // "morning" or "night"
          }
        });
      }
      // Vacations that overlapped past weekends
      pastWeekends.forEach(([fri, sat]) => {
        schedulableEmployees().forEach(emp => {
          const wasOff = S.vacations.some(v =>
            v.employee_id === emp.id && v.status === "approved" &&
            fri <= v.end_date && sat >= v.start_date
          ) || !((weekendHistory.workedByEmp[emp.id] || 0) > 0);
          // We only reliably know "on vacation"; not-worked could be either.
          if (S.vacations.some(v => v.employee_id === emp.id && v.status === "approved" &&
              fri <= v.end_date && sat >= v.start_date)) {
            weekendHistory.offByEmp[emp.id] = (weekendHistory.offByEmp[emp.id]||0) + 1;
          }
        });
      });
    }
  } catch(err) {
    console.warn("Weekend history load failed:", err);
  }

  // Preload previous Saturday (so we know about night shifts from last week)
  const wDates = getWeekDates(S.weekOffset);
  const prevSat = new Date(new Date(wDates[0]+"T12:00:00").getTime() - 86400000);
  const prevSatStr = prevSat.getFullYear()+"-"+String(prevSat.getMonth()+1).padStart(2,"0")+"-"+String(prevSat.getDate()).padStart(2,"0");
  if (!S.schedule[prevSatStr]) {
    // Try to load from previous week's schedule
    try {
      const prevWeekStart = getWeekDates(S.weekOffset - 1)[0];
      const { data: prevSched } = await sb.from("schedules").select("id")
        .eq("business_id", S.profile.business_id).eq("week_start", prevWeekStart).maybeSingle();
      if (prevSched) {
        const { data: prevAssigns } = await sb.from("assignments").select("*")
          .eq("schedule_id", prevSched.id).eq("date", prevSatStr);
        if (prevAssigns && prevAssigns.length > 0) {
          S.schedule[prevSatStr] = {};
          prevAssigns.forEach(a => {
            if (!S.schedule[prevSatStr][a.shift]) S.schedule[prevSatStr][a.shift] = [];
            if (!S.schedule[prevSatStr][a.shift].includes(a.employee_id)) {
              S.schedule[prevSatStr][a.shift].push(a.employee_id);
            }
          });
        }
      }
    } catch (err) {
      console.warn("Could not preload previous Saturday:", err);
    }
  }
  const weekDates = getWeekDates(S.weekOffset).map(d=>new Date(d+"T00:00:00"));
  const shiftIds = SHIFTS.map(s=>s.id);
  const newSched = {};
  const totalCount = {};
  const shiftTypeCount = {};

  const weekendCount = {};
  schedulableEmployees().forEach(emp => {
    totalCount[emp.id] = 0;
    shiftTypeCount[emp.id] = {};
    weekendCount[emp.id] = 0;
  });

  // Calculate ideal shifts per employee
  const totalSlotsNeeded = (() => {
    let total = 0;
    const wt = S.business?.weekend_targets || {morning:2,night:1};
    const st = S.business?.shift_targets || {morning:2,morning2:1,afternoon:1,night:1};
    weekDates.forEach(d => {
      const dow = d.getDay();
      const isWE = dow === 5 || dow === 6;
      if (isWE) {
        total += (wt.morning||1) + (wt.night||1);
      } else {
        total += (st.morning||2) + (st.morning2||1) + (st.afternoon||1) + (st.night||1);
      }
    });
    return total;
  })();
  const availableEmps = schedulableEmployees().filter(emp => {
    if (emp.exclude_from && emp.exclude_to) {
      const start = emp.exclude_from, end = emp.exclude_to;
      const weekStart = getWeekDates(S.weekOffset)[0];
      const weekEnd = getWeekDates(S.weekOffset)[6];
      if (start <= weekEnd && end >= weekStart) return false;
    }
    return true;
  }).length || 1;
  // Per-employee target: what does each individual want?
  // The team standard is 5 shifts per week per employee. Anyone with a lower max_shifts_per_week
  // (e.g. Gal with 4) gets THEIR number, not 5. That way the algorithm respects both:
  // "most people should hit 5" AND "person X should hit fewer".
  const perEmpIdeal = {};
  schedulableEmployees().forEach(emp => {
    perEmpIdeal[emp.id] = Math.min(5, emp.max_shifts_per_week || 5);
  });
  // Fallback ideal for old code paths that don't have an emp — average of all targets.
  const idealShifts = Math.round(
    Object.values(perEmpIdeal).reduce((a,b) => a+b, 0) / Math.max(1, Object.values(perEmpIdeal).length)
  );
  // Reorder: weekend FIRST (Fri=5, Sat=6), then weekdays (Sun-Thu)
  const schedOrder = [];
  weekDates.forEach((d,i) => { if (d.getDay()===5||d.getDay()===6) schedOrder.push(i); });
  weekDates.forEach((d,i) => { if (d.getDay()!==5&&d.getDay()!==6) schedOrder.push(i); });

  schedOrder.forEach(dayIdx => {
    const dateObj = weekDates[dayIdx];
    const dateStr = dateObj.getFullYear()+"-"+String(dateObj.getMonth()+1).padStart(2,"0")+"-"+String(dateObj.getDate()).padStart(2,"0");
    const dayName = DAYS[dateObj.getDay()];
    newSched[dateStr] = {};

    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const dayShiftIds = isWeekend ? shiftIds.filter(s => s !== "afternoon" && s !== "morning2") : shiftIds;

    // Priority: fill CRITICAL shifts first (morning, afternoon, night) — the ones that
    // provide essential coverage. morning2 is the "extra" overlap shift and gets filled
    // LAST, so if the team runs out of available employees due to blocks/vacations, the
    // day still ends up with essential coverage (1 morning, 1 afternoon, 1 night) even if
    // morning2 stays empty.
    const CRITICAL_ORDER = ["morning","afternoon","night","morning2"];
    // Rotate the order of critical shifts slightly per weekday to avoid patterns, but
    // ALWAYS keep morning2 last so it's the sacrifice slot.
    const criticalRotations = [
      ["night","afternoon","morning"],   // Sun
      ["morning","night","afternoon"],   // Mon
      ["afternoon","morning","night"],   // Tue
      ["night","morning","afternoon"],   // Wed
      ["morning","afternoon","night"],   // Thu
    ];
    const orderedShiftIds = isWeekend
      ? dayShiftIds
      : [...(criticalRotations[dayOfWeek] || CRITICAL_ORDER.slice(0,3)), "morning2"]
          .filter(s => dayShiftIds.includes(s));

    // Initialize all shift arrays for this day with locked slots first.
    // CRITICAL: Do this BEFORE assigning fixed_shifts, so when fixed_shifts puts
    // Ykava into morning2, the morning slot already exists as an empty array and the
    // "no double shift today" check works correctly.
    dayShiftIds.forEach(shiftId => {
      const lockedKey = dateStr+"|"+shiftId;
      const lockedEmpIds = S.lockedSlots[lockedKey] ? [...S.lockedSlots[lockedKey]] : [];
      newSched[dateStr][shiftId] = [...lockedEmpIds];
      lockedEmpIds.forEach(id => {
        totalCount[id] = (totalCount[id]||0)+1;
        shiftTypeCount[id][shiftId] = (shiftTypeCount[id][shiftId]||0)+1;
      });
    });

    // Apply ALL fixed_shifts for the entire day BEFORE iterating through the shift-order
    // loop. This prevents the bug where an employee with fixed=morning2 gets picked up
    // by the earlier morning slot's scoring loop, since morning2 isn't filled yet.
    schedulableEmployees().forEach(emp => {
      if (!emp.fixed_shifts) return;
      // Find which shift (if any) is fixed for this employee today
      const fixedShiftForToday = dayShiftIds.find(sh => emp.fixed_shifts[dayOfWeek + "_" + sh]);
      if (!fixedShiftForToday) return;
      // Respect active_days — if the employee isn't active today, skip even their fixed shift.
      const activeDaysEmp = emp.active_days || [0,1,2,3,4,5,6];
      if (!activeDaysEmp.includes(dayOfWeek)) return;
      // Respect allowed_shifts — the fixed shift must be in their allowed list.
      const allowedEmp = emp.allowed_shifts || SHIFTS.map(s=>s.id);
      if (!allowedEmp.includes(fixedShiftForToday)) return;
      const lockedEmpIds = S.lockedSlots[dateStr+"|"+fixedShiftForToday] ? [...S.lockedSlots[dateStr+"|"+fixedShiftForToday]] : [];
      if (lockedEmpIds.includes(emp.id)) return;
      if (newSched[dateStr][fixedShiftForToday].includes(emp.id)) return;
      const empMax = emp.max_shifts_per_week || 5;
      if ((totalCount[emp.id]||0) >= empMax) return;
      // No double shift same day
      const hasOtherShiftToday = dayShiftIds.some(s => s !== fixedShiftForToday && (newSched[dateStr]?.[s]||[]).includes(emp.id));
      if (hasOtherShiftToday) return;
      // Exclusions
      if (emp.exclude_from && emp.exclude_to && dateStr >= emp.exclude_from && dateStr <= emp.exclude_to) return;
      const onVac2 = (typeof getBlockingVacation === "function") ? !!getBlockingVacation(emp.id, dateStr, fixedShiftForToday) : S.vacations.some(v => v.employee_id === emp.id && v.status === "approved" && dateStr >= v.start_date && dateStr <= v.end_date);
      if (onVac2) return;
      // Blocks
      const isBlocked2 = S.availSubmissions.some(s => s.employee_id === emp.id && (s.slots||[]).some(sl => sl.date === dateStr && sl.shift === fixedShiftForToday));
      if (isBlocked2) return;
      newSched[dateStr][fixedShiftForToday].push(emp.id);
      totalCount[emp.id] = (totalCount[emp.id]||0)+1;
      shiftTypeCount[emp.id][fixedShiftForToday] = (shiftTypeCount[emp.id][fixedShiftForToday]||0)+1;
      if (isWeekend) weekendCount[emp.id] = (weekendCount[emp.id]||0)+1;
    });

    orderedShiftIds.forEach((shiftId, shIdx) => {
      const lockedKey = dateStr+"|"+shiftId;
      const lockedEmpIds = S.lockedSlots[lockedKey] ? [...S.lockedSlots[lockedKey]] : [];

      // כמה עובדים דרושים לכל משמרת (ניתן להגדיר בהגדרות)
      const shiftTargets = S.business?.shift_targets || { morning: 2, morning2: 1, afternoon: 1, night: 1 };
      const weekendTargets = S.business?.weekend_targets || { morning: 2, night: 1 };
      const target = isWeekend ? (weekendTargets[shiftId] || 1) : (shiftTargets[shiftId] || 2);
      // Count what's ALREADY in the slot (locked slots + fixed_shifts just placed above)
      // so we don't over-fill a shift that already has its target met.
      const currentlyAssigned = (newSched[dateStr][shiftId] || []).length;
      if (currentlyAssigned >= target) return;
      const need = target - currentlyAssigned;

      // Score available employees via the modular RULES engine (see const RULES up top).
      // Every hard block and every scoring rule the team defined is enforced consistently
      // here, in one place, so there's no drift between "what's in the RULES definitions"
      // and "what the auto-scheduler actually runs" — they're the same thing now.
      const alreadyInSlot = new Set(newSched[dateStr][shiftId]);
      const shuffledEmps = [...S.employees].sort(() => Math.random() - 0.5);
      const scored = shuffledEmps
        .filter(emp => !lockedEmpIds.includes(emp.id) && !alreadyInSlot.has(emp.id))
        .map(emp => {
          const dayName = DAYS[dateObj.getDay()];
          const ctx = {
            S, emp, shiftId, dateStr, dateObj, dayIdx, dayName,
            dayOfWeek: dateObj.getDay(),
            isWeekend, weekDates, newSched,
            totalCount, shiftTypeCount, weekendCount, idealShifts, perEmpIdeal, weekendHistory,
          };
          const result = runRules(ctx);
          if (result.blocked) return null;
          // Does this employee have a fixed_shift for TODAY that's a DIFFERENT shift?
          // If so, they're reserved for that other shift — don't let the scoring loop
          // grab them for the current one even if we got here (e.g. the fixed-shift
          // placement failed because of a block/vacation on that specific slot).
          if (emp.fixed_shifts) {
            const hasFixedOtherShiftToday = Object.keys(emp.fixed_shifts).some(k => {
              if (!emp.fixed_shifts[k]) return false;
              const [d, s] = k.split("_");
              return parseInt(d, 10) === dateObj.getDay() && s !== shiftId;
            });
            if (hasFixedOtherShiftToday) return null;
          }
          // Base score 100 keeps the same range as the previous algorithm; RULES only add
          // positive/negative adjustments on top.
          const preferred = emp.preferred_shifts || [];
          let extra = 0;
          // Preference bonus only kicks in if the employee is UNDER their ideal for this
          // shift-type. Otherwise "I like mornings" would compound with "I've already done
          // 4 mornings" and give them all the mornings — which broke fairness completely.
          const myCounts = shiftTypeCount[emp.id] || {};
          const thisTypeAlreadyDone = shiftId === "morning" || shiftId === "morning2"
            ? (myCounts["morning"]||0) + (myCounts["morning2"]||0)
            : (myCounts[shiftId] || 0);
          const idealPerType = Math.max(1, Math.floor((perEmpIdeal[emp.id] || idealShifts) / 3));
          const stillUnderIdeal = thisTypeAlreadyDone < idealPerType;
          if (preferred.includes(shiftId) && stillUnderIdeal) extra += 15;  // was +30
          if ((emp.day_constraints || {})[dayName]?.[shiftId] === 1 && stillUnderIdeal) extra += 10;  // was +20
          return { emp, score: 100 + result.score + extra };
        })
        .filter(Boolean)
        .sort((a,b) => {
          const diff = b.score - a.score;
          if (Math.abs(diff) < 5) return Math.random() - 0.5; // random tiebreaker
          return diff;
        });

      const toAdd = scored.slice(0, need).map(s => s.emp.id).filter(id => !newSched[dateStr][shiftId].includes(id));
      newSched[dateStr][shiftId].push(...toAdd);
      toAdd.forEach(id => {
        totalCount[id] = (totalCount[id]||0)+1;
        shiftTypeCount[id][shiftId] = (shiftTypeCount[id][shiftId]||0)+1;
        if (isWeekend) weekendCount[id] = (weekendCount[id]||0)+1;
      });
    });
  });

  // Balance pass — if employees are still under-assigned relative to THEIR OWN ideal, top them up.
  const underAssigned = schedulableEmployees().filter(emp => {
    const count = totalCount[emp.id] || 0;
    const myIdeal = perEmpIdeal[emp.id] || idealShifts;
    return count < myIdeal - 1 && count < (emp.max_shifts_per_week || 5);
  });
  
  if (underAssigned.length > 0) {
    // Go through weekdays and try to add them to afternoon.
    // IMPORTANT: respect every constraint — otherwise balance will create bugs where
    // Ykava (fixed to morning2) gets slotted into afternoon, Gal (max=4) gets a 5th
    // shift, or afternoon gets overfilled past its target.
    const weekdayDates = weekDates.filter(d => d.getDay() !== 5 && d.getDay() !== 6);
    const afternoonTarget = (S.business?.shift_targets?.afternoon) || 1;
    for (const emp of underAssigned) {
      const myIdeal = perEmpIdeal[emp.id] || idealShifts;
      // Respect this employee's hard max separately from the ideal.
      const myMax = emp.max_shifts_per_week || 5;
      for (const dateObj of weekdayDates) {
        if ((totalCount[emp.id]||0) >= myIdeal) break;
        if ((totalCount[emp.id]||0) >= myMax) break;
        const ds = dateObj.getFullYear()+"-"+String(dateObj.getMonth()+1).padStart(2,"0")+"-"+String(dateObj.getDate()).padStart(2,"0");
        // Check if already working this day
        const worksToday = SHIFTS.some(s => (newSched[ds]?.[s.id]||[]).includes(emp.id));
        if (worksToday) continue;
        // Don't exceed the afternoon shift's target capacity.
        const currentAfternoon = (newSched[ds]?.["afternoon"]||[]).length;
        if (currentAfternoon >= afternoonTarget) continue;
        // Check active days
        const activeDays = emp.active_days || [0,1,2,3,4,5,6];
        if (!activeDays.includes(dateObj.getDay())) continue;
        // Check allowed shifts
        const empAllowed = emp.allowed_shifts || SHIFTS.map(s=>s.id);
        if (!empAllowed.includes("afternoon")) continue;
        // Fixed_shifts — if the employee has a fixed shift on another day type today,
        // they're reserved for that; don't force them into afternoon.
        if (emp.fixed_shifts) {
          const hasFixedToday = Object.keys(emp.fixed_shifts).some(k => {
            if (!emp.fixed_shifts[k]) return false;
            const [d, _] = k.split("_");
            return parseInt(d, 10) === dateObj.getDay();
          });
          if (hasFixedToday) continue;
        }
        // Check exclusion
        if (emp.exclude_from && emp.exclude_to && ds >= emp.exclude_from && ds <= emp.exclude_to) continue;
        // Check vacation
        const onVac = (typeof getBlockingVacation === "function") ? !!getBlockingVacation(emp.id, ds, "afternoon") : S.vacations.some(v => v.employee_id === emp.id && v.status === "approved" && ds >= v.start_date && ds <= v.end_date);
        if (onVac) continue;
        // Check blocks
        const isBlocked = S.availSubmissions.some(s => s.employee_id === emp.id && (s.slots||[]).some(sl => { if (sl.date && sl.date === ds) return sl.shift === "afternoon"; return false; }));
        if (isBlocked) continue;
        // Rest check: worked night yesterday? can't do afternoon today (14:45 start, <8h rest)
        const prevDay = weekDates[weekDates.indexOf(dateObj)-1];
        if (prevDay) {
          const pds = prevDay.getFullYear()+"-"+String(prevDay.getMonth()+1).padStart(2,"0")+"-"+String(prevDay.getDate()).padStart(2,"0");
          if ((newSched[pds]?.["night"]||[]).includes(emp.id)) continue;
        }
        // Rest check: do we have a night TOMORROW already assigned? Afternoon ends 23:00,
        // night starts 22:45 — this is an overlap, not just rest.
        const nextDay = weekDates[weekDates.indexOf(dateObj)+1];
        if (nextDay) {
          const nds = nextDay.getFullYear()+"-"+String(nextDay.getMonth()+1).padStart(2,"0")+"-"+String(nextDay.getDate()).padStart(2,"0");
          if ((newSched[nds]?.["morning"]||[]).includes(emp.id)) continue;
        }
        // Add to afternoon
        if (!newSched[ds]["afternoon"]) newSched[ds]["afternoon"] = [];
        if (!newSched[ds]["afternoon"].includes(emp.id)) {
          newSched[ds]["afternoon"].push(emp.id);
          totalCount[emp.id] = (totalCount[emp.id]||0) + 1;
          shiftTypeCount[emp.id]["afternoon"] = (shiftTypeCount[emp.id]["afternoon"]||0) + 1;
        }
      }
    }
  }

  // Final safety net: dedupe every shift's employee list before committing, so no employee
  // can end up assigned twice to the same shift regardless of which code path added them.
  Object.keys(newSched).forEach(dateStr => {
    Object.keys(newSched[dateStr]).forEach(shiftId => {
      newSched[dateStr][shiftId] = [...new Set(newSched[dateStr][shiftId])];
    });
  });

  // ═══════════════ SHIFT-TYPE BALANCE PASS ═══════════════
  // After primary allocation is done, look for obvious inequities in shift-type distribution
  // and attempt to swap them out. Example: A has 4 nights and 0 mornings while B has 0 nights
  // and 4 mornings — try to swap a night from A with a morning from B (if the constraints
  // still hold on both sides). Runs up to N iterations, greedily improving each pass.
  function _typeOf(shiftId) {
    if (shiftId === "morning" || shiftId === "morning2") return "morning";
    if (shiftId === "afternoon") return "afternoon";
    return "night";
  }
  function _countsByType(empId) {
    const c = shiftTypeCount[empId] || {};
    return {
      morning: (c["morning"]||0) + (c["morning2"]||0),
      afternoon: c["afternoon"] || 0,
      night: c["night"] || 0,
    };
  }
  const empIds = schedulableEmployees().map(e => e.id);
  const MAX_SWAP_ITERS = 30;
  let swaps = 0;
  for (let iter = 0; iter < MAX_SWAP_ITERS; iter++) {
    // Find the most unbalanced pair — someone with too many of one type, someone with too few
    let bestSwap = null;
    let bestGain = 0;
    for (const empA of empIds) {
      for (const empB of empIds) {
        if (empA === empB) continue;
        const cA = _countsByType(empA);
        const cB = _countsByType(empB);
        // What's each one over/under on?
        // Try swapping A's excess type for B's excess type (only if that reduces the gap)
        for (const typeA of ["night","afternoon","morning"]) {
          for (const typeB of ["night","afternoon","morning"]) {
            if (typeA === typeB) continue;
            // A has too much of typeA; B has too much of typeB; A wants typeB; B wants typeA.
            if (cA[typeA] <= cB[typeA]) continue;  // A doesn't have more of A than B
            if (cB[typeB] <= cA[typeB]) continue;  // B doesn't have more of B than A
            const currentGap = Math.abs(cA[typeA] - cB[typeA]) + Math.abs(cA[typeB] - cB[typeB]);
            const newGap = Math.abs((cA[typeA]-1) - (cB[typeA]+1)) + Math.abs((cA[typeB]+1) - (cB[typeB]-1));
            const gain = currentGap - newGap;
            if (gain <= bestGain) continue;
            // Find a concrete date/shift where the swap works
            for (const dateStr in newSched) {
              for (const shiftId in newSched[dateStr]) {
                if (_typeOf(shiftId) !== typeA) continue;
                if (!newSched[dateStr][shiftId].includes(empA)) continue;
                // Is this slot locked? Skip if it is.
                if ((S.lockedSlots[dateStr+"|"+shiftId] || new Set()).has(empA)) continue;
                // Find a matching typeB slot on ANY date where empB works and empA can go
                for (const dateStr2 in newSched) {
                  for (const shiftId2 in newSched[dateStr2]) {
                    if (_typeOf(shiftId2) !== typeB) continue;
                    if (!newSched[dateStr2][shiftId2].includes(empB)) continue;
                    if ((S.lockedSlots[dateStr2+"|"+shiftId2] || new Set()).has(empB)) continue;
                    // Would empA fit shiftId2 on dateStr2?
                    const empAObj = S.employees.find(e => e.id === empA);
                    const empBObj = S.employees.find(e => e.id === empB);
                    if (!empAObj || !empBObj) continue;
                    // Doesn't already work that day / another shift
                    const empAOtherToday = SHIFTS.some(s => s.id !== shiftId2 && (newSched[dateStr2]?.[s.id]||[]).includes(empA));
                    const empBOtherToday = SHIFTS.some(s => s.id !== shiftId && (newSched[dateStr]?.[s.id]||[]).includes(empB));
                    if (empAOtherToday || empBOtherToday) continue;
                    // Basic constraints
                    const empAAllowed = empAObj.allowed_shifts || SHIFTS.map(s=>s.id);
                    const empBAllowed = empBObj.allowed_shifts || SHIFTS.map(s=>s.id);
                    if (!empAAllowed.includes(shiftId2)) continue;
                    if (!empBAllowed.includes(shiftId)) continue;
                    // Respect fixed_shifts — don't move anyone OUT of a slot that was
                    // locked to them by their fixed schedule (e.g. Ykava on morning2),
                    // and don't move anyone INTO a slot where someone else should be fixed.
                    const dayA = new Date(dateStr+"T00:00:00").getDay();
                    const dayB = new Date(dateStr2+"T00:00:00").getDay();
                    if (empAObj.fixed_shifts && empAObj.fixed_shifts[dayA + "_" + shiftId]) continue;
                    if (empBObj.fixed_shifts && empBObj.fixed_shifts[dayB + "_" + shiftId2]) continue;
                    // Also, if the destination day has a fixed slot pointing to someone
                    // else, don't allow this swap to overwrite them.
                    if (empBObj.fixed_shifts && empBObj.fixed_shifts[dayA + "_" + shiftId]) continue;
                    if (empAObj.fixed_shifts && empAObj.fixed_shifts[dayB + "_" + shiftId2]) continue;
                    // Vacation / block check
                    const dt2 = new Date(dateStr2+"T00:00:00");
                    const dt1 = new Date(dateStr+"T00:00:00");
                    const empAVac = S.vacations.some(v => v.employee_id === empA && v.status === "approved" && dateStr2 >= v.start_date && dateStr2 <= v.end_date);
                    const empBVac = S.vacations.some(v => v.employee_id === empB && v.status === "approved" && dateStr >= v.start_date && dateStr <= v.end_date);
                    if (empAVac || empBVac) continue;
                    const empABlocked = S.availSubmissions.some(s => s.employee_id === empA && (s.slots||[]).some(sl => sl.date === dateStr2 && sl.shift === shiftId2));
                    const empBBlocked = S.availSubmissions.some(s => s.employee_id === empB && (s.slots||[]).some(sl => sl.date === dateStr && sl.shift === shiftId));
                    if (empABlocked || empBBlocked) continue;
                    // Active days — don't swap into a day the employee isn't active
                    const empAActive = empAObj.active_days || [0,1,2,3,4,5,6];
                    const empBActive = empBObj.active_days || [0,1,2,3,4,5,6];
                    if (!empAActive.includes(dayB)) continue;
                    if (!empBActive.includes(dayA)) continue;
                    // Exclusions (temporary suspension / medical leave)
                    if (empAObj.exclude_from && empAObj.exclude_to && dateStr2 >= empAObj.exclude_from && dateStr2 <= empAObj.exclude_to) continue;
                    if (empBObj.exclude_from && empBObj.exclude_to && dateStr >= empBObj.exclude_from && dateStr <= empBObj.exclude_to) continue;
                    // Rest check — swapping someone to night today when they have morning tomorrow is a violation.
                    // Check the day BEFORE the destination for a night shift (<7h rest to morning/afternoon next day).
                    const checkRestBefore = (empId, dstDate, dstShift) => {
                      if (dstShift === "night") return true; // night preceded by anything is OK (long gap)
                      const dstDt = new Date(dstDate+"T00:00:00");
                      const prevDt = new Date(dstDt.getTime() - 86400000);
                      const pds = prevDt.getFullYear()+"-"+String(prevDt.getMonth()+1).padStart(2,"0")+"-"+String(prevDt.getDate()).padStart(2,"0");
                      return !((newSched[pds]?.["night"]||[]).includes(empId));
                    };
                    const checkRestAfter = (empId, dstDate, dstShift) => {
                      if (dstShift !== "night") return true;
                      const dstDt = new Date(dstDate+"T00:00:00");
                      const nextDt = new Date(dstDt.getTime() + 86400000);
                      const nds = nextDt.getFullYear()+"-"+String(nextDt.getMonth()+1).padStart(2,"0")+"-"+String(nextDt.getDate()).padStart(2,"0");
                      const nextSched = newSched[nds] || {};
                      return !(["morning","morning2","afternoon"].some(sh => (nextSched[sh]||[]).includes(empId)));
                    };
                    if (!checkRestBefore(empA, dateStr2, shiftId2)) continue;
                    if (!checkRestBefore(empB, dateStr, shiftId)) continue;
                    if (!checkRestAfter(empA, dateStr2, shiftId2)) continue;
                    if (!checkRestAfter(empB, dateStr, shiftId)) continue;
                    // Winner — this swap works
                    bestSwap = { empA, empB, dateA: dateStr, shiftA: shiftId, dateB: dateStr2, shiftB: shiftId2 };
                    bestGain = gain;
                    break;
                  }
                  if (bestSwap && bestGain === gain) break;
                }
                if (bestSwap && bestGain === gain) break;
              }
              if (bestSwap && bestGain === gain) break;
            }
          }
        }
      }
    }
    if (!bestSwap) break;
    // Execute the swap
    const { empA, empB, dateA, shiftA, dateB, shiftB } = bestSwap;
    newSched[dateA][shiftA] = newSched[dateA][shiftA].filter(id => id !== empA);
    newSched[dateA][shiftA].push(empB);
    newSched[dateB][shiftB] = newSched[dateB][shiftB].filter(id => id !== empB);
    newSched[dateB][shiftB].push(empA);
    // Update counters
    shiftTypeCount[empA][shiftA] = Math.max(0, (shiftTypeCount[empA][shiftA]||0) - 1);
    shiftTypeCount[empA][shiftB] = (shiftTypeCount[empA][shiftB]||0) + 1;
    shiftTypeCount[empB][shiftB] = Math.max(0, (shiftTypeCount[empB][shiftB]||0) - 1);
    shiftTypeCount[empB][shiftA] = (shiftTypeCount[empB][shiftA]||0) + 1;
    swaps++;
  }
  if (swaps > 0) console.log("⚖️ Balance-swap pass: " + swaps + " swaps performed");

  S.schedule = newSched;
  // Save immediately (no debounce)
  clearTimeout(_saveTimer);
  (async()=>{
    if (!S.profile?.business_id) return;
    const weekStart = getWeekDates(S.weekOffset)[0];
    let { data: sched } = await sb.from("schedules")
      .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
    if (!sched) {
      const { data: ns } = await sb.from("schedules")
        .insert({business_id:S.profile.business_id, week_start:weekStart, created_by:S.user.id}).select().single();
      sched = ns;
    }
    if (!sched) return;
    S.schedule.id = sched.id;
    await sb.from("assignments").delete().eq("schedule_id", sched.id);
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
    if (rows.length) await sb.from("assignments").upsert(rows, {onConflict: "schedule_id,employee_id,date,shift"});
    logAction("auto_schedule", {week_start:(weekDates[0].getFullYear()+"-"+String(weekDates[0].getMonth()+1).padStart(2,"0")+"-"+String(weekDates[0].getDate()).padStart(2,"0")), count:Object.keys(newSched).length});
  // Compute distribution stats — surface them so the user sees whether the balance is fair.
  const counts = Object.values(totalCount).filter(c => c > 0);
  const minC = counts.length ? Math.min(...counts) : 0;
  const maxC = counts.length ? Math.max(...counts) : 0;
  const spread = maxC - minC;
  const fairnessMsg = spread <= 1
    ? "שיבוץ אוטומטי — חלוקה מאוזנת ✓"
    : spread <= 2
      ? "שיבוץ אוטומטי (פער " + spread + " משמרות) ✓"
      : "שיבוץ אוטומטי — פער " + spread + " משמרות ⚠";
  toast(fairnessMsg);
  })();
  render();
}
