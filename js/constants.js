// constants.js — pure data tables and the stateless rule engine.
// Extracted from index.html on 2026-11-24. No runtime dependencies
// on Supabase or app state (S); everything RULES.*.check() needs
// is passed through the `ctx` argument from the caller.
// Loaded as a classic <script> BEFORE the inline app script so its
// const/let/function names are visible in the inline script's scope.


// CONSTANTS
// ══════════════════════════════════════════════════════
"use strict";

import { getBlockingVacation } from './actions.js';
import { S } from './state.js';
import { e } from './utils.js';

export const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
export const SHIFTS = [
  { id:"morning",   label:"בוקר",    start:"07:00", end:"15:00", color:"#F59E0B" },
  { id:"morning2",  label:"בוקר ב׳", start:"09:00", end:"17:00", color:"#F97316" },
  { id:"afternoon", label:"צהריים",  start:"15:00", end:"23:00", color:"#10B981" },
  { id:"night",     label:"לילה",    start:"23:00", end:"07:00", color:"#6366F1" },
];
export const BLOCK_SHIFTS = [
  { id:"morning",   label:"בוקר",   start:"07:00", end:"17:00", color:"#F59E0B" },
  { id:"afternoon", label:"צהריים", start:"15:00", end:"23:00", color:"#10B981" },
  { id:"night",     label:"לילה",   start:"23:00", end:"07:00", color:"#6366F1" },
];
// Per-day overrides for shifts whose hours differ from the base SHIFTS defaults.
// Thursday: only the night shift is different (starts earlier, ends later — 22:45-07:30
// instead of the usual 23:00-07:00), because it overlaps into Friday morning handover.
// Friday/Saturday: all shifts have their own hours (morning + night only — no afternoon).
export const DAY_SHIFT_OVERRIDES = {
  4: [ // Thursday — only night overridden, morning/morning2/afternoon inherit from SHIFTS
    { id:"night", label:"לילה", start:"22:45", end:"08:00", color:"#6366F1" },
  ],
  5: [ // Friday
    { id:"morning", label:"בוקר", start:"07:45", end:"19:45", color:"#F59E0B" },
    { id:"night",   label:"לילה", start:"19:30", end:"07:30", color:"#6366F1" },
  ],
  6: [ // Saturday
    { id:"morning", label:"בוקר", start:"07:15", end:"19:15", color:"#F59E0B" },
    { id:"night",   label:"לילה", start:"19:00", end:"07:00", color:"#6366F1" },
  ],
};
// Generic weekend fallback (used in places where the specific day isn't known — e.g. rules
// engine looking up shift definitions by id only). Saturday hours are the safest generic pick.
export const WEEKEND_SHIFTS = DAY_SHIFT_OVERRIDES[6];

export function getShiftsForDate(date) {
  const dt = new Date(date+"T00:00:00");
  const day = dt.getDay();
  // Fri/Sat: return ONLY the two shifts that run (morning + night)
  if (day === 5 || day === 6) return DAY_SHIFT_OVERRIDES[day];
  // Other weekdays: apply overrides on top of the default SHIFTS list
  const overrides = DAY_SHIFT_OVERRIDES[day];
  if (!overrides) return SHIFTS;
  return SHIFTS.map(sh => overrides.find(o => o.id === sh.id) || sh);
}
export const SHIFT_BY_ID = Object.fromEntries(SHIFTS.map(s=>[s.id,s]));
export const SHIFT_LABELS = Object.fromEntries(SHIFTS.map(s=>[s.id,s.label]));

// ══════════════════════════════════════════════════════
// RULE ENGINE — pluggable scheduling rules
// Each rule receives context and returns:
//   - blocked: true → employee cannot be assigned to this shift
//   - score: number → added to total score (positive = prefer, negative = avoid)
// ══════════════════════════════════════════════════════
export const RULES = {
  // === HARD BLOCKS ===
  vacation: {
    name: "חופשה מאושרת",
    enabled: true,
    check: (ctx) => {
      // Partial-day aware: on the first/last day, only specific shifts may be blocked.
      const v = (typeof getBlockingVacation === "function")
        ? getBlockingVacation(ctx.emp.id, ctx.dateStr, ctx.shiftId)
        : ctx.S.vacations.find(vv => vv.employee_id === ctx.emp.id && vv.status === "approved" && ctx.dateStr >= vv.start_date && ctx.dateStr <= vv.end_date);
      return v ? { blocked: true, reason: "חופשה" } : null;
    }
  },
  exclusion: {
    name: "השעיה זמנית",
    enabled: true,
    check: (ctx) => {
      const e = ctx.emp;
      if (e.exclude_from && e.exclude_to && ctx.dateStr >= e.exclude_from && ctx.dateStr <= e.exclude_to) {
        return { blocked: true, reason: e.exclude_reason || "השעיה" };
      }
      return null;
    }
  },
  activeDays: {
    name: "ימים פעילים",
    enabled: true,
    check: (ctx) => {
      const active = ctx.emp.active_days || [0,1,2,3,4,5,6];
      if (!active.includes(ctx.dayOfWeek)) return { blocked: true, reason: "יום לא פעיל" };
      return null;
    }
  },
  allowedShifts: {
    name: "משמרות מותרות",
    enabled: true,
    check: (ctx) => {
      const allowed = ctx.emp.allowed_shifts || SHIFTS.map(s=>s.id);
      if (!allowed.includes(ctx.shiftId)) return { blocked: true, reason: "משמרת לא מותרת" };
      return null;
    }
  },
  maxShifts: {
    name: "מקסימום משמרות",
    enabled: true,
    check: (ctx) => {
      const max = ctx.emp.max_shifts_per_week || 5;
      if ((ctx.totalCount[ctx.emp.id] || 0) >= max) return { blocked: true, reason: "מקסימום הגיע" };
      return null;
    }
  },
  alreadyToday: {
    name: "כבר עובד היום",
    enabled: true,
    check: (ctx) => {
      const works = SHIFTS.some(s => s.id !== ctx.shiftId && (ctx.newSched[ctx.dateStr]?.[s.id]||[]).includes(ctx.emp.id));
      return works ? { blocked: true, reason: "כבר עובד היום" } : null;
    }
  },
  blockedShift: {
    name: "חסימת עובד",
    enabled: true,
    check: (ctx) => {
      const blockId = ctx.shiftId === "morning2" ? "morning" : ctx.shiftId;
      const isBlocked = ctx.S.availSubmissions.some(s =>
        s.employee_id === ctx.emp.id &&
        (s.slots||[]).some(sl => sl.date === ctx.dateStr && (sl.shift === blockId || sl.shift === ctx.shiftId))
      );
      return isBlocked ? { blocked: true, reason: "עובד חסם" } : null;
    }
  },
  
  // === SCORING RULES ===
  equalDistribution: {
    name: "חלוקה שווה",
    enabled: true,
    check: (ctx) => {
      const count = ctx.totalCount[ctx.emp.id] || 0;
      // Prefer the per-employee target if provided (each employee's own max), fall back
      // to the global average otherwise. Someone whose max is 4 is measured against 4;
      // someone whose max is 5 is measured against 5.
      const myIdeal = (ctx.perEmpIdeal && ctx.perEmpIdeal[ctx.emp.id]) || ctx.idealShifts;
      let score = 0;
      // Hard: whoever's over their ideal takes a big hit — protects the ceiling.
      if (count >= myIdeal + 1) score -= 500;
      // Anyone under their ideal is prioritized proportionally.
      if (count < myIdeal) score += (myIdeal - count) * 60;
      else score -= (count - myIdeal) * 80;
      // Every existing shift subtracts more strongly than before (was -15, now -30).
      score -= count * 30;
      return { score };
    }
  },
  shiftTypeVariety: {
    name: "חלוקה הוגנת לפי סוג משמרת",
    enabled: true,
    check: (ctx) => {
      // The team told me: unbalanced shift-type distribution is the #1 complaint.
      // Someone gets 4 mornings and 0 nights while another gets the opposite. This rule
      // fixes that by heavily favoring whoever has done the FEWEST of the shift-type
      // we're currently filling.
      const myShiftCounts = ctx.shiftTypeCount[ctx.emp.id] || {};
      const isMorningOnly = ctx.emp.allowed_shifts && ctx.emp.allowed_shifts.length > 0 &&
        !ctx.emp.allowed_shifts.includes("afternoon") && !ctx.emp.allowed_shifts.includes("night");
      if (isMorningOnly) return { score: 0 };

      // Group morning+morning2 together, since they overlap in role.
      const morningTotal = (myShiftCounts["morning"]||0) + (myShiftCounts["morning2"]||0);
      const afternoonTotal = myShiftCounts["afternoon"] || 0;
      const nightTotal = myShiftCounts["night"] || 0;
      const isMorningShift = ctx.shiftId === "morning" || ctx.shiftId === "morning2";
      const thisTypeTotal = isMorningShift ? morningTotal
        : (ctx.shiftId === "afternoon" ? afternoonTotal : nightTotal);

      // What's the target per type? Total shifts ÷ 3 types, roughly.
      // Per-employee ideal — if this employee's max is 4, they should get ~1.3 of each type;
      // if 5, ~1.7. Fall back to the global average.
      const myIdeal = (ctx.perEmpIdeal && ctx.perEmpIdeal[ctx.emp.id]) || ctx.idealShifts;
      const idealPerType = Math.max(1, Math.floor(myIdeal / 3));

      let score = 0;

      // #1 — the most important: every existing shift of THIS type is a heavy penalty.
      // 3 nights already worked = -180 → almost impossible to get another night unless
      // no one else is available.
      score -= thisTypeTotal * 60;

      // #2 — bonus for being under the ideal for this type.
      if (thisTypeTotal < idealPerType) {
        score += (idealPerType - thisTypeTotal) * 50;
      }

      // #3 — hard penalty if we're clearly over the ideal for this type.
      if (thisTypeTotal > idealPerType + 1) score -= 200;

      // #4 — protect the "someone has 0" case: if this employee has 0 of a certain type,
      // they should get that type first, regardless of night/morning preferences.
      const hasZeroNight = nightTotal === 0;
      const hasZeroAfternoon = afternoonTotal === 0;
      const hasZeroMorning = morningTotal === 0;
      if (ctx.shiftId === "night" && hasZeroNight) score += 100;
      if (ctx.shiftId === "afternoon" && hasZeroAfternoon) score += 80;
      if (isMorningShift && hasZeroMorning) score += 60;

      // #5 — the ORIGINAL variety rule kept: penalize anyone stacking one type while
      // having zero of another.
      const minType = Math.min(morningTotal, afternoonTotal, nightTotal);
      if (thisTypeTotal >= 2 && minType === 0) score -= 400;

      return { score };
    }
  },
  weekendFairness: {
    name: "חלוקת סופ״ש שווה",
    enabled: true,
    check: (ctx) => {
      if (!ctx.isWeekend) return { score: 0 };
      const wkCount = ctx.weekendCount[ctx.emp.id] || 0;
      const totalWk = Object.values(ctx.weekendCount).reduce((a,b)=>a+b,0);
      const avgWk = totalWk / (ctx.S.employees.length || 1);
      let score = 0;
      // Within-this-week balance: don't stack too many weekend shifts on one person.
      if (wkCount > avgWk + 0.5) score -= 25;
      if (wkCount < avgWk) score += 20;

      // ── Weekend rotation memory (past 4 weekends) ──
      // 1) ROTATION — much stronger now. Someone who worked 3 of the past 4 weekends
      //    gets a heavy penalty so someone who's been off gets priority.
      const hist = ctx.weekendHistory || {};
      const pastWorked = (hist.workedByEmp && hist.workedByEmp[ctx.emp.id]) || 0;
      // Progressive penalty: 1 past weekend = -50, 2 = -110, 3 = -180, 4 = -260
      score -= pastWorked * 50 + pastWorked * pastWorked * 10;
      // Big bonus for people who haven't worked recent weekends
      if (pastWorked === 0) score += 120;
      else if (pastWorked === 1) score += 60;

      // 2) VARIETY — if they worked "morning" last weekend, prefer them for "night" this
      //    weekend, and vice versa. Stronger now: -70 penalty (was -40).
      const lastType = (hist.lastWeType && hist.lastWeType[ctx.emp.id]) || null;
      if (lastType && lastType === ctx.shiftId) {
        score -= 70; // same shift type as last weekend — heavier penalty
      } else if (lastType && lastType !== ctx.shiftId) {
        score += 50; // different from last weekend — bigger bonus
      }

      // 3) ROTATIONAL OFF — whoever was off recent weekends can take one now.
      const pastOff = (hist.offByEmp && hist.offByEmp[ctx.emp.id]) || 0;
      if (pastOff >= 2) score += 20;

      return { score };
    }
  },
  restBetweenShifts: {
    name: "מנוחה בין משמרות",
    enabled: true,
    check: (ctx) => {
      // Compute the actual hour gap between the END of any shift the employee had
      // "yesterday" (which may live in this week's in-progress schedule OR in last week's
      // saved schedule when today is Sunday) and the START of the shift we're evaluating.
      // Scans BOTH weekday and weekend shift definitions — the exact fix for the
      // Saturday-night → Sunday-morning case that was slipping through.
      // Same shift id can have different hours on weekend vs weekday (e.g. "morning" is
      // 07-15 on a weekday but 07-19 on a weekend day). So we look up definitions from
      // the SAME table that the schedule for that day would have used.
      // Reuses getShiftsForDate() so day-specific hour overrides (Thu-night 22:45-07:30,
      // Fri/Sat hours, etc.) apply consistently to rest-checks, not just to display.
      const dateStrForDefs = (dt) => dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
      const findDef = (id, dt) => {
        const dayDefs = getShiftsForDate(dateStrForDefs(dt));
        return dayDefs.find(sh => sh.id === id) || SHIFTS.find(sh => sh.id === id);
      };

      const thisDef = findDef(ctx.shiftId, ctx.dateObj);
      if (!thisDef) return { score: 0 };

      const startHM = (thisDef.start || "07:00").split(":").map(Number);
      const shiftStartTs = ctx.dateObj.getTime() + startHM[0]*3600000 + startHM[1]*60000;

      const yesterday = new Date(ctx.dateObj.getTime() - 86400000);
      const yStr = yesterday.getFullYear()+"-"+String(yesterday.getMonth()+1).padStart(2,"0")+"-"+String(yesterday.getDate()).padStart(2,"0");
      // dayIdx > 0 → yesterday is inside the week being scheduled.
      // dayIdx === 0 → today is Sunday, so yesterday (Saturday) lives in last week's saved schedule.
      const yShifts = (ctx.dayIdx > 0 ? (ctx.newSched[yStr] || {}) : ((ctx.S.schedule && ctx.S.schedule[yStr]) || {}));

      let minRestHours = Infinity;
      Object.keys(yShifts).forEach(prevShiftId => {
        if (!(yShifts[prevShiftId] || []).includes(ctx.emp.id)) return;
        const prevSh = findDef(prevShiftId, yesterday);
        if (!prevSh) return;
        const endHM = (prevSh.end || "00:00").split(":").map(Number);
        const startHM2 = (prevSh.start || "00:00").split(":").map(Number);
        const startMin = startHM2[0]*60 + startHM2[1];
        const endMin = endHM[0]*60 + endHM[1];
        // If end <= start, the shift rolls past midnight (night shifts).
        let endTs = yesterday.getTime() + endHM[0]*3600000 + endHM[1]*60000;
        if (endMin <= startMin) endTs += 86400000;
        const restHours = (shiftStartTs - endTs) / 3600000;
        if (restHours < minRestHours) minRestHours = restHours;
      });

      // < 7 hours: hard block
      // 7-11 hours: strong penalty (technically legal but exhausting)
      // 11-16 hours: mild penalty
      // 16+ hours: no penalty
      if (minRestHours < 7) return { blocked: true, reason: "פחות מ-7 שעות מנוחה" };
      if (minRestHours < 11) return { score: -60 };
      if (minRestHours < 16) return { score: -20 };
      return { score: 0 };
    }
  },
  consecutiveDays: {
    name: "מניעת רצף ימים",
    enabled: true,
    check: (ctx) => {
      // Check if the employee has worked BOTH of the previous two days — same person doing
      // 3 days straight (across the week boundary if needed) gets a mild penalty.
      // Reads from newSched OR S.schedule depending on whether "yesterday" is inside this
      // week or last week's saved schedule.
      const allShiftDefs = [...SHIFTS, ...WEEKEND_SHIFTS];
      const wasWorking = (dayOffset) => {
        const d = new Date(ctx.dateObj.getTime() - dayOffset*86400000);
        const dStr = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
        const source = (ctx.dayIdx - dayOffset >= 0)
          ? (ctx.newSched[dStr] || {})
          : ((ctx.S.schedule && ctx.S.schedule[dStr]) || {});
        return allShiftDefs.some(s => (source[s.id] || []).includes(ctx.emp.id));
      };
      return { score: (wasWorking(1) && wasWorking(2)) ? -25 : 0 };
    }
  },
  blockOverIdeal: {
    name: "חסימת חריגה",
    enabled: true,
    check: (ctx) => {
      const count = ctx.totalCount[ctx.emp.id] || 0;
      if (count < ctx.idealShifts + 1) return { score: 0 };
      const someoneBelow = ctx.S.employees.some(o => 
        o.id !== ctx.emp.id && (ctx.totalCount[o.id]||0) < ctx.idealShifts - 1
      );
      if (someoneBelow) return { blocked: true, reason: "אחרים מתחת לממוצע" };
      return { score: 0 };
    }
  }
};

// Run all rules and return final result
export function runRules(ctx) {
  let totalScore = 0;
  let blockedReason = null;
  for (const ruleId in RULES) {
    const rule = RULES[ruleId];
    if (!rule.enabled) continue;
    const result = rule.check(ctx);
    if (!result) continue;
    if (result.blocked) {
      blockedReason = ruleId + ": " + (result.reason || "");
      return { blocked: true, reason: blockedReason, score: 0 };
    }
    if (result.score) totalScore += result.score;
  }
  return { blocked: false, score: totalScore };
}
// Jewish Holidays 2026-2027
export const JEWISH_HOLIDAYS = {
  // 2026 (verified against hebcal.com Israel schedule)
  "2026-02-02": "ט״ו בשבט",
  "2026-03-02": "תענית אסתר",
  "2026-03-03": "פורים",
  "2026-04-01": "ערב פסח",
  "2026-04-02": "פסח",
  "2026-04-08": "שביעי של פסח",
  "2026-04-14": "יום השואה",
  "2026-04-21": "יום הזיכרון",
  "2026-04-22": "יום העצמאות",
  "2026-05-05": "ל״ג בעומר",
  "2026-05-15": "יום ירושלים",
  "2026-05-21": "ערב שבועות",
  "2026-05-22": "שבועות",
  "2026-07-02": "צום י״ז בתמוז",
  "2026-07-23": "צום תשעה באב",
  "2026-07-29": "ט״ו באב",
  "2026-09-11": "ערב ראש השנה",
  "2026-09-12": "ראש השנה א׳",
  "2026-09-13": "ראש השנה ב׳",
  "2026-09-14": "צום גדליה",
  "2026-09-20": "ערב יום כיפור",
  "2026-09-21": "יום כיפור",
  "2026-09-25": "ערב סוכות",
  "2026-09-26": "סוכות",
  "2026-10-02": "הושענא רבה",
  "2026-10-03": "שמחת תורה",
  "2026-12-05": "חנוכה",
  "2026-12-06": "חנוכה",
  "2026-12-07": "חנוכה",
  "2026-12-08": "חנוכה",
  "2026-12-09": "חנוכה",
  "2026-12-10": "חנוכה",
  "2026-12-11": "חנוכה",
  "2026-12-12": "חנוכה",
  // 2027 (verified against hebcal.com Israel schedule)
  "2027-01-23": "ט״ו בשבט",
  "2027-03-22": "תענית אסתר",
  "2027-03-23": "פורים",
  "2027-04-21": "ערב פסח",
  "2027-04-22": "פסח",
  "2027-04-28": "שביעי של פסח",
  "2027-05-04": "יום השואה",
  "2027-05-11": "יום הזיכרון",
  "2027-05-12": "יום העצמאות",
  "2027-05-25": "ל״ג בעומר",
  "2027-06-04": "יום ירושלים",
  "2027-06-10": "ערב שבועות",
  "2027-06-11": "שבועות",
  "2027-07-22": "צום י״ז בתמוז",
  "2027-08-12": "צום תשעה באב",
  "2027-08-18": "ט״ו באב",
  "2027-10-01": "ערב ראש השנה",
  "2027-10-02": "ראש השנה א׳",
  "2027-10-03": "ראש השנה ב׳",
  "2027-10-04": "צום גדליה",
  "2027-10-10": "ערב יום כיפור",
  "2027-10-11": "יום כיפור",
  "2027-10-15": "ערב סוכות",
  "2027-10-16": "סוכות",
  "2027-10-22": "הושענא רבה",
  "2027-10-23": "שמחת תורה",
  "2027-12-25": "חנוכה",
  "2027-12-26": "חנוכה",
  "2027-12-27": "חנוכה",
  "2027-12-28": "חנוכה",
  "2027-12-29": "חנוכה",
  "2027-12-30": "חנוכה",
  "2027-12-31": "חנוכה",
  "2028-01-01": "חנוכה",
};
export function getHoliday(dateStr) { return JEWISH_HOLIDAYS[dateStr] || null; }

export const EMP_COLORS = ["#3B82F6","#EC4899","#14B8A6","#F97316","#8B5CF6","#EF4444","#06B6D4","#84CC16","#F59E0B","#6366F1"];
export const ec = (idx) => EMP_COLORS[idx % EMP_COLORS.length];
