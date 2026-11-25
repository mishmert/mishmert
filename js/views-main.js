// views-main.js — the primary logged-in views.
// Extracted from index.html on 2026-11-24.
//
// Contents (every function renders a top-level screen or a modal under it):
//  - viewHeader               : top navigation bar, role-aware.
//  - viewHome                 : the employee landing screen.
//  - viewSchedule             : the weekly schedule grid, desktop + mobile
//                               (viewScheduleDayMobile), cell editor
//                               (viewCellEditor), and viewWorkload sidebar.
//  - viewEmployees            : admin's employee list.
//  - viewVacations            : vacation requests + approvals, plus the
//                               'Edit / cancel approved vacations' subview.
//  - viewSwaps                : full swap-and-join-request workflow across
//                               the admin-approve and employee-peer tabs,
//                               with its own _swapWeekCache +
//                               loadScheduleForSwapWeek + invalidateSwapCache.
//  - viewEmpView              : the employee self-service surface for
//                               their shifts, blocks, swap requests, etc.
//  - Modal views              : viewConstraintsModal, viewPreviewSelectModal,
//                               viewInviteModal, viewExportModal,
//                               viewPublishModal.
//
// Dependencies at call time: `S` / `sb` / `render()` / `goto()` /
// `getEmp` / `escHtml` / `isUserBusy` / etc. (inline), all handlers from
// actions.js, the data loaders, the constants, and the pure helpers from
// utils.js. Everything resolves at call time via the shared global scope
// of classic <script>s.

// ── HEADER ──
"use strict";

import { S } from "./state.js";
import {
  _blockPresetBase,
  empIdx,
  filterNavByFeatures,
  fmtDate,
  getNotifiedManagers,
  getTimeBasedGreeting,
  isFeatureEnabled,
  schedulableEmployees,
} from "./helpers.js";
import {
  btn,
  div,
  e,
  friendlyError,
  getMonthInfo,
  getWeekDates,
  haptic,
  israelNow,
  israelTodayIso,
  israelYear,
  skeletonSchedule,
  toast,
  today,
  uiConfirm,
  uiPrompt,
} from "./utils.js";
import { render, silentRefresh } from "./main.js";
import { handleLogout, logAction, saveScheduleToDB, sendEmail } from "./audit.js";
import {
  BLOCK_SHIFTS,
  DAYS,
  DAY_SHIFT_OVERRIDES,
  SHIFTS,
  SHIFT_BY_ID,
  WEEKEND_SHIFTS,
  ec,
  getHoliday,
  getShiftsForDate,
} from "./constants.js";
import { getActiveEmpId, getActiveProfile, isManager } from "./roles.js";
import { sb } from "./sb.js";
import { _swapWeekCache, getEmp, invalidateMemo, invalidateSwapCache } from "./memo.js";
import {
  loadEmployees,
  loadInvitations,
  loadMyMonthData,
  loadSchedule,
  loadSwapRequests,
  loadVacations,
} from "./data.js";
import { runSmartSchedule } from "./scheduler.js";
import { canRedo, canUndo, pushScheduleHistory, redoSchedule, undoSchedule } from "./history.js";
import {
  addEmployee,
  checkJoinRestConflict,
  checkShiftConflict,
  checkShiftConflictAsync,
  copyInviteLink,
  createInvitation,
  deleteEmployee,
  deleteVacRequest,
  describePartialVac,
  processJoinRequest,
  publishWeek,
  renameEmployee,
  requestJoinShift,
  resendInvitation,
  resetPassword,
  revokeInvitation,
  saveConstraints,
  submitAvailability,
  toggleCellEmp,
  toggleLock,
  updateVacStatus,
} from "./actions.js";
import { viewEmpVacations } from "./views-secondary.js";
import {
  _parseNote,
  escHtml,
  exportMyShiftsToCalendar,
  exportScheduleCSV,
  exportSchedulePDF,
  exportScheduleWhatsApp,
} from "./export.js";
export function viewHeader() {
  const pendingVacs = S.vacations.filter((v) => v.status === "pending").length;
  const pendingSwaps = (S.swaps || []).filter(
    (s) => s.status === "pending_manager" || s.status === "pending_peer"
  ).length;

  const empOnly = S.profile?.role === "employee";
  const tabs = empOnly
    ? [
        { id: "empview", icon: "📋", label: "המשמרות שלי" },
        { id: "schedule", icon: "📅", label: "סידור" },
        { id: "mymonth_nav", icon: "📆", label: "החודש שלי" },
        { id: "blocks", icon: "🚫", label: "חסימות" },
        { id: "vacations", icon: "🌴", label: "היעדרויות" },
        { id: "swaps", icon: "🔄", label: "חילופים" },
        { id: "emp_settings", icon: "⚙️", label: "הגדרות" },
      ]
    : [
        { id: "home", icon: "🏠", label: "בית" },
        { id: "schedule", icon: "📅", label: "סידור" },
        { id: "calendar", icon: "🗓️", label: "חודש" },
        { id: "employees", icon: "👥", label: "עובדים" },
        { id: "manager_blocks", icon: "🚫", label: "חסימות" }, // <--- הוספנו את הטאב הזה למנהלים!
        { id: "qualifications", icon: "🎯", label: "כשירות" },
        { id: "vacations", icon: "🌴", label: "חופשות", badge: pendingVacs },
        {
          id: "swaps",
          icon: "🔄",
          label: "חילופים",
          badge: pendingSwaps,
          badgeClass: "badge-purple",
        },
        { id: "analytics", icon: "📊", label: "אנליטיקה" },
        { id: "empview", icon: "👤", label: "עובד" },
        { id: "settings", icon: "⚙️", label: "הגדרות" },
      ];
  const filteredTabs = filterNavByFeatures(tabs);
  return e("header", { class: "header" }, [
    div("header-inner", [
      div(
        "",
        [
          e("img", { src: "logo-favicon.png", style: "width:40px;height:40px;border-radius:12px" }),
          e("div", { style: "margin-right:10px" }, [
            e("div", { style: "font-weight:900;font-size:15px;color:#E2E8F0" }, "משמרת"),
          ]),
        ].map((x, i) => (i === 0 ? x : x)),
        { style: "display:flex;align-items:center;gap:10px" }
      ),
      div(
        "nav",
        filteredTabs.map((t) =>
          e(
            "button",
            {
              class: "nav-btn" + (S.view === t.id ? " active" : ""),
              title: t.label, // tooltip when label is hidden on narrow desktops
              onclick: () => {
                haptic(8); // subtle click feedback on tap
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
                ? e("span", { class: "badge " + (t.badgeClass || "") }, String(t.badge))
                : null,
              e("span", { style: "font-size:15px;line-height:1" }, t.icon),
              e("span", { class: "nav-label" }, t.label),
            ]
          )
        )
      ),
      div("user-area", [
        (function () {
          // Live "last updated" chip — reassures the user data is fresh, and gives them
          // a one-tap hard refresh when they want to force-check right now.
          const ts = S._lastDataRefresh || Date.now();
          const secs = Math.floor((Date.now() - ts) / 1000);
          // Offline overrides the "live" indicator with a clear offline chip.
          if (!S._online) {
            const ageTxt =
              S._offlineAge != null
                ? S._offlineAge < 60
                  ? "לפני " + S._offlineAge + " דק'"
                  : "לפני " + Math.floor(S._offlineAge / 60) + " ש'"
                : "";
            return e(
              "div",
              {
                title: "אין חיבור · מציג מידע שמור" + (ageTxt ? " מ" + ageTxt : ""),
                onclick: () => {
                  if (navigator.onLine) {
                    S._online = true;
                    silentRefresh();
                  } else {
                    toast("עדיין אין חיבור לרשת", "err");
                  }
                },
                style:
                  "display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:#EF444422;border:1px solid #EF444466;cursor:pointer;font-size:11px;color:#FCA5A5;font-weight:700",
              },
              [
                e("span", {
                  style:
                    "width:6px;height:6px;border-radius:50%;background:#EF4444;display:inline-block",
                }),
                e("span", {}, "לא מקוון" + (ageTxt ? " · " + ageTxt : "")),
              ]
            );
          }
          const label =
            secs < 10
              ? "חי עכשיו"
              : secs < 60
                ? "לפני " + secs + "ש"
                : "לפני " + Math.floor(secs / 60) + "ד";
          const dotColor = secs < 10 ? "#10B981" : secs < 120 ? "#3B82F6" : "#64748B";
          return e(
            "div",
            {
              title: "עדכון אחרון · לחץ לרענון",
              onclick: () => {
                S._lastDataRefresh = null;
                silentRefresh();
                toast("מרענן...");
              },
              style:
                "display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:#1E293B;border:1px solid #33415566;cursor:pointer;font-size:11px;color:#94A3B8",
            },
            [
              e("span", {
                style: `width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block`,
              }),
              e("span", {}, label),
            ]
          );
        })(),
        e("div", {}, [
          e("div", { class: "user-name" }, S.profile?.name || ""),
          e(
            "div",
            { class: "user-role-label" },
            S.profile?.role === "admin" || S.profile?.role === "manager" ? "מנהל" : "עובד"
          ),
        ]),
        btn("btn-logout", "יציאה", handleLogout),
      ]),
    ]),
  ]);
}

// ── HOME ──
export function viewHome() {
  const wd = getWeekDates(S.weekOffset);
  const weekStart = wd[0];
  const isPublished = S.publishedWeeks.has(weekStart);
  const pendingVacs = S.vacations.filter((v) => v.status === "pending").length;
  const pendingSwaps = (S.swaps || []).filter(
    (s) => s.status === "pending_manager" || s.status === "pending_peer"
  ).length;
  // Swaps specifically awaiting MANAGER approval (what the manager must act on).
  const pendingSwapsManager = (S.swaps || []).filter(
    (s) => s.status === "pending_manager" || s.status === "pending_approval"
  ).length;
  const totalAssigned = wd.reduce(
    (t, d) => t + SHIFTS.reduce((s, sh) => s + (S.schedule[d]?.[sh.id]?.length || 0), 0),
    0
  );
  const wrap = e("div");
  // Hero greeting — bigger, with a subtle gradient accent bar on the right (RTL-aware)
  {
    const g = getTimeBasedGreeting();
    const firstName = (getActiveProfile()?.name || "").split(" ")[0];
    const dayLabel = new Date().toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    wrap.appendChild(
      e("div", { style: "position:relative;margin-bottom:28px;padding:6px 0" }, [
        // Right-side accent bar (RTL)
        e("div", {
          style:
            "position:absolute;top:8px;right:-22px;bottom:8px;width:4px;border-radius:4px;background:linear-gradient(180deg,#3B82F6 0%,#A855F7 50%,#EC4899 100%);box-shadow:0 0 16px rgba(99,102,241,0.5)",
        }),
        e(
          "div",
          {
            style:
              "font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px",
          },
          dayLabel
        ),
        e(
          "div",
          {
            style:
              "font-weight:900;font-size:36px;letter-spacing:-1.3px;line-height:1.08;background:linear-gradient(180deg,#F8FAFC 0%,#CBD5E1 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text",
          },
          g.text + ", " + firstName + " " + g.emoji
        ),
      ])
    );
  }

  // KPIs
  const kpis = [
    { icon: "👥", lbl: "עובדים", val: S.employees.length, color: "#3B82F6" },
    { icon: "📅", lbl: "שיבוצים השבוע", val: totalAssigned, color: "#10B981" },
    { icon: "🌴", lbl: "חופשות ממתינות", val: pendingVacs, color: "#F59E0B" },
    { icon: "🔄", lbl: "חילופים ממתינים", val: pendingSwapsManager, color: "#A855F7" },
  ];
  const kpiGrid = div("kpi-grid");
  kpis.forEach((k) => {
    // Convert hex to rgba for the glow — creates a subtle color halo matching each KPI's tone
    const hex = k.color.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16),
      g = parseInt(hex.substring(2, 4), 16),
      b = parseInt(hex.substring(4, 6), 16);
    kpiGrid.appendChild(
      div(
        "kpi",
        [
          div("kpi-icon", [k.icon]),
          e(
            "div",
            {
              class: "kpi-val",
              style:
                "background:linear-gradient(180deg," +
                k.color +
                "," +
                k.color +
                "cc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text",
            },
            String(k.val)
          ),
          div("kpi-lbl", [k.lbl]),
        ],
        {
          style:
            "--kpi-glow:rgba(" +
            r +
            "," +
            g +
            "," +
            b +
            ",0.22);--kpi-accent:rgba(" +
            r +
            "," +
            g +
            "," +
            b +
            ",0.7);border-color:rgba(" +
            r +
            "," +
            g +
            "," +
            b +
            ",0.2)",
        }
      )
    );
  });
  wrap.appendChild(kpiGrid);

  // Preload the ACTUAL current week into S.schedule so "מי במשמרת עכשיו" works even
  // when the manager has navigated to a different week (e.g. preparing next week's
  // schedule). Runs once per minute and merges — never overwrites — other weeks.
  if (!S._nowCardPreloaded || Date.now() - S._nowCardPreloaded > 60000) {
    S._nowCardPreloaded = Date.now();
    (async () => {
      try {
        // Israel time: the real current week is Sunday–Saturday in Jerusalem,
        // not in the device's zone.
        const nowDate = israelNow();
        const dow = nowDate.getDay();
        const sunday = new Date(nowDate);
        sunday.setDate(sunday.getDate() - dow);
        const sundayStr =
          sunday.getFullYear() +
          "-" +
          String(sunday.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(sunday.getDate()).padStart(2, "0");
        const { data: sched } = await sb
          .from("schedules")
          .select("id")
          .eq("business_id", S.profile.business_id)
          .eq("week_start", sundayStr)
          .maybeSingle();
        if (!sched) return;
        const { data: assigns } = await sb
          .from("assignments")
          .select("date,shift,employee_id,custom_start,custom_end")
          .eq("schedule_id", sched.id);
        let changed = false;
        (assigns || []).forEach((a) => {
          if (!S.schedule[a.date]) S.schedule[a.date] = {};
          if (!S.schedule[a.date][a.shift]) S.schedule[a.date][a.shift] = [];
          if (!S.schedule[a.date][a.shift].includes(a.employee_id)) {
            S.schedule[a.date][a.shift].push(a.employee_id);
            changed = true;
          }
          if (a.custom_start && a.custom_end) {
            S.customHours[a.date + "|" + a.shift + "|" + a.employee_id] = {
              start: a.custom_start.slice(0, 5),
              end: a.custom_end.slice(0, 5),
            };
          }
        });
        if (changed) render();
      } catch (err) {
        console.warn("Now-card preload failed:", err);
      }
    })();
  }

  // ── מי במשמרת עכשיו ──
  // Shows who's actively working right now, plus the next shift starting soon.
  // Reads from S.schedule for today + yesterday (so a night shift that started
  // yesterday 22:45 and ends today 07:00 is correctly shown as "currently working").
  {
    // Israel time: "now" and "today" are the team's local wall-clock, not the device's.
    const nowDate = israelNow();
    const todayStr =
      nowDate.getFullYear() +
      "-" +
      String(nowDate.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(nowDate.getDate()).padStart(2, "0");
    const yesterdayDt = new Date(nowDate);
    yesterdayDt.setDate(yesterdayDt.getDate() - 1);
    const yesterdayStr =
      yesterdayDt.getFullYear() +
      "-" +
      String(yesterdayDt.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(yesterdayDt.getDate()).padStart(2, "0");
    const nowMs = nowDate.getTime();
    const nowHM = nowDate.getHours() * 60 + nowDate.getMinutes();

    // Convert a "HH:MM" string on a given date to a Date object. For a shift that
    // crosses midnight (end <= start), the end is the next day.
    const shiftWindow = (dateStr, sh) => {
      const d = new Date(dateStr + "T00:00:00");
      const [sh1, sm1] = (sh.start || "00:00").split(":").map(Number);
      const [eh1, em1] = (sh.end || "00:00").split(":").map(Number);
      const startMs = d.getTime() + sh1 * 3600000 + sm1 * 60000;
      const startMin = sh1 * 60 + sm1;
      const endMin = eh1 * 60 + em1;
      let endMs = d.getTime() + eh1 * 3600000 + em1 * 60000;
      if (endMin <= startMin) endMs += 86400000;
      return { startMs, endMs };
    };

    const currentShifts = []; // {date, sh, empIds, endMs}
    const upcomingShifts = []; // {date, sh, empIds, startMs, minsUntil}
    const scanDays = [yesterdayStr, todayStr];
    scanDays.forEach((dateStr) => {
      const dayShifts = getShiftsForDate(dateStr);
      dayShifts.forEach((sh) => {
        const empIds = S.schedule[dateStr]?.[sh.id] || [];
        if (empIds.length === 0) return;
        const win = shiftWindow(dateStr, sh);
        if (nowMs >= win.startMs && nowMs < win.endMs) {
          currentShifts.push({ dateStr, sh, empIds, endMs: win.endMs });
        } else if (win.startMs > nowMs && win.startMs - nowMs < 12 * 3600000) {
          upcomingShifts.push({ dateStr, sh, empIds, startMs: win.startMs });
        }
      });
    });
    // Earliest upcoming only
    upcomingShifts.sort((a, b) => a.startMs - b.startMs);
    const nextShift = upcomingShifts[0];

    const nowCard = div("card", [
      e("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:14px" }, [
        e("span", { style: "font-size:20px" }, "🟢"),
        e("div", { style: "flex:1" }, [
          e("div", { style: "font-weight:800;font-size:15px;color:#E2E8F0" }, "מי במשמרת עכשיו"),
          e(
            "div",
            { style: "font-size:11px;color:#64748B;margin-top:2px" },
            nowDate.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) +
              " · " +
              nowDate.toLocaleDateString("he-IL", {
                weekday: "long",
                day: "numeric",
                month: "numeric",
              })
          ),
        ]),
      ]),
    ]);

    if (currentShifts.length === 0) {
      nowCard.appendChild(
        e(
          "div",
          { style: "text-align:center;padding:16px;color:#64748B;font-size:13px" },
          "אין משמרת פעילה כרגע"
        )
      );
    } else {
      currentShifts.forEach((cs) => {
        const minsLeft = Math.round((cs.endMs - nowMs) / 60000);
        const hoursLeft = Math.floor(minsLeft / 60);
        const remMins = minsLeft % 60;
        const timeLeftStr = hoursLeft > 0 ? `${hoursLeft}ש' ${remMins}דק'` : `${remMins} דק'`;

        const shiftBlock = e(
          "div",
          {
            style: `background:#0F172A;border:1px solid ${cs.sh.color}44;border-radius:12px;padding:12px;margin-bottom:8px`,
          },
          [
            e(
              "div",
              {
                style:
                  "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px",
              },
              [
                e("div", { style: "display:flex;align-items:center;gap:8px" }, [
                  e("span", {
                    style:
                      "display:inline-block;width:10px;height:10px;border-radius:50%;background:" +
                      cs.sh.color +
                      ";box-shadow:0 0 8px " +
                      cs.sh.color,
                  }),
                  e(
                    "span",
                    { style: `font-weight:800;font-size:14px;color:${cs.sh.color}` },
                    cs.sh.label
                  ),
                  e(
                    "span",
                    { style: "direction:ltr;font-size:11px;color:#94A3B8" },
                    cs.sh.start + "-" + cs.sh.end
                  ),
                ]),
                e(
                  "span",
                  {
                    style:
                      "font-size:11px;background:#10B98122;color:#10B981;border:1px solid #10B98144;border-radius:6px;padding:3px 8px;font-weight:700",
                  },
                  "עוד " + timeLeftStr
                ),
              ]
            ),
            e(
              "div",
              { style: "display:flex;flex-wrap:wrap;gap:6px" },
              cs.empIds
                .map((id) => {
                  const emp = getEmp(id);
                  if (!emp) return null;
                  const col = ec(empIdx(id));
                  const chKey = cs.dateStr + "|" + cs.sh.id + "|" + id;
                  const ch = S.customHours[chKey];
                  return e(
                    "div",
                    {
                      style: `background:${col}22;border:1px solid ${col}66;border-radius:10px;padding:5px 11px;display:flex;align-items:center;gap:6px`,
                    },
                    [
                      e(
                        "span",
                        { style: `font-weight:700;font-size:12px;color:${col}` },
                        emp.name.split(" ")[0]
                      ),
                      ch
                        ? e(
                            "span",
                            { style: "direction:ltr;font-size:10px;color:#94A3B8" },
                            "(" + ch.start + "-" + ch.end + ")"
                          )
                        : null,
                    ]
                  );
                })
                .filter(Boolean)
            ),
          ]
        );
        nowCard.appendChild(shiftBlock);
      });
    }

    // Next shift coming up (within 12h)
    if (nextShift) {
      const minsUntil = Math.round((nextShift.startMs - nowMs) / 60000);
      const hUntil = Math.floor(minsUntil / 60);
      const mUntil = minsUntil % 60;
      const untilStr = hUntil > 0 ? `${hUntil}ש' ${mUntil}דק'` : `${mUntil} דק'`;
      nowCard.appendChild(
        e(
          "div",
          {
            style: `background:${nextShift.sh.color}08;border:1px dashed ${nextShift.sh.color}44;border-radius:10px;padding:10px 12px;margin-top:10px`,
          },
          [
            e(
              "div",
              {
                style:
                  "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px",
              },
              [
                e(
                  "span",
                  { style: "font-size:11px;color:#94A3B8;font-weight:700" },
                  "⏳ הבא: " + nextShift.sh.label + " (" + nextShift.sh.start + ")"
                ),
                e(
                  "span",
                  { style: "font-size:11px;color:" + nextShift.sh.color + ";font-weight:700" },
                  "בעוד " + untilStr
                ),
              ]
            ),
            e(
              "div",
              { style: "display:flex;flex-wrap:wrap;gap:4px" },
              nextShift.empIds
                .map((id) => {
                  const emp = getEmp(id);
                  if (!emp) return null;
                  return e(
                    "span",
                    { style: "font-size:11px;color:#CBD5E1" },
                    emp.name.split(" ")[0]
                  );
                })
                .filter(Boolean)
                .reduce((acc, el, i) => {
                  if (i > 0) acc.push(e("span", { style: "color:#475569" }, " · "));
                  acc.push(el);
                  return acc;
                }, [])
            ),
          ]
        )
      );
    }

    wrap.appendChild(nowCard);
  }

  // Week snapshot
  const snap = div("card", [
    div(
      "",
      [
        e("div", { style: "font-weight:700;font-size:14px;color:#E2E8F0" }, "📅 השבוע הנוכחי"),
        e(
          "div",
          { style: "font-size:12px;color:#64748B;margin-top:2px" },
          fmtDate(wd[0]) + " — " + fmtDate(wd[6])
        ),
      ].map((x) => x),
      { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px" }
    ),
    isPublished
      ? div("", [
          div("published-banner", ["📢 פורסם לעובדים"]),
          btn(
            "btn-sm btn-sm-gray",
            "🔁 יש עדכון? פרסם שוב",
            () => {
              S.showPublishModal = true;
              render();
            },
            { style: "width:100%;margin-top:8px" }
          ),
        ])
      : totalAssigned > 0
        ? btn(
            "btn-purple",
            "📢 פרסם סידור לעובדים",
            () => {
              S.showPublishModal = true;
              render();
            },
            { style: "width:100%" }
          )
        : e(
            "div",
            { style: "color:#64748B;font-size:13px;text-align:center" },
            "אין שיבוצים השבוע"
          ),
  ]);
  wrap.appendChild(snap);

  // Alerts
  const alerts = [];
  if (pendingVacs > 0)
    alerts.push({
      class: "alert-warn",
      icon: "🌴",
      msg: `${pendingVacs} בקשות חופשה ממתינות לאישור`,
      view: "vacations",
    });
  if (pendingSwapsManager > 0)
    alerts.push({
      class: "alert-warn",
      icon: "🔄",
      msg: `${pendingSwapsManager} בקשות חילוף ממתינות לאישורך`,
      view: "swaps",
    });
  if (alerts.length > 0) {
    const alertCard = div("card", [
      e(
        "div",
        { style: "font-weight:700;font-size:14px;color:#E2E8F0;margin-bottom:10px" },
        "🔔 דורש טיפול"
      ),
    ]);
    alerts.forEach((a) =>
      alertCard.appendChild(
        e(
          "div",
          {
            class: "alert " + a.class,
            style: "cursor:pointer",
            onclick: () => {
              S.view = a.view;
              render();
            },
          },
          [
            e("span", { style: "flex-shrink:0" }, a.icon),
            e("span", { style: "flex:1" }, a.msg),
            e("span", {}, "←"),
          ]
        )
      )
    );
    wrap.appendChild(alertCard);
  }

  // Quick nav
  const quick = div("quick-grid");
  [
    { icon: "📅", lbl: "סידור עבודה", sub: "שיבוץ השבוע", v: "schedule" },
    { icon: "👥", lbl: "עובדים", sub: `${S.employees.length} עובדים`, v: "employees" },
    { icon: "🌴", lbl: "חופשות", sub: `${pendingVacs} ממתינות`, v: "vacations" },
  ].forEach((it) =>
    quick.appendChild(
      e(
        "button",
        {
          class: "quick-btn",
          onclick: () => {
            S.view = it.v;
            render();
          },
        },
        [div("q-icon", [it.icon]), div("q-label", [it.lbl]), div("q-sub", [it.sub])]
      )
    )
  );
  wrap.appendChild(quick);
  return wrap;
}

// ── SCHEDULE ──
export function viewSchedule() {
  const wd = getWeekDates(S.weekOffset);
  const wdDisplay = wd;
  const weekStart = wd[0];
  const isPublished = S.publishedWeeks.has(weekStart);
  const isInitial = S.publishedInitial?.has(weekStart);
  const hasPublish = isPublished || isInitial || S.schedPublishType?.[weekStart];
  const wrap = e("div");

  // Employee: block unpublished schedules — or expired (visible_until passed)
  if (!isManager() && (!hasPublish || S.scheduleExpired)) {
    wrap.appendChild(
      div("card", [
        e("div", { style: "text-align:center;padding:40px" }, [
          e("div", { style: "font-size:48px;margin-bottom:12px" }, S.scheduleExpired ? "⏳" : "🔒"),
          e(
            "div",
            { style: "font-weight:800;font-size:18px;color:#94A3B8;margin-bottom:8px" },
            S.scheduleExpired ? "הסידור בהכנה" : "הסידור טרם פורסם"
          ),
          e(
            "div",
            { style: "font-size:13px;color:#64748B" },
            S.scheduleExpired
              ? "הסידור הסופי יפורסם בקרוב — נעדכן אותך"
              : "הסידור יהיה זמין לצפייה לאחר פרסום"
          ),
          e("div", { style: "display:flex;gap:8px;justify-content:center;margin-top:20px" }, [
            btn("btn-sm btn-sm-gray", "→", () => {
              S.weekOffset--;
              loadSchedule().then(() => render());
            }),
            btn("btn-sm btn-sm-blue", "השבוע", () => {
              S.weekOffset = 0;
              loadSchedule().then(() => render());
            }),
            btn("btn-sm btn-sm-gray", "←", () => {
              S.weekOffset++;
              loadSchedule().then(() => render());
            }),
          ]),
        ]),
      ])
    );
    return wrap;
  }

  // Header
  const hdr = div("section-header", [
    e("div", {}, [
      div("page-title", ["📅 סידור שבועי"]),
      e(
        "div",
        { style: "font-size:13px;color:#64748B;margin-top:2px" },
        fmtDate(wd[0]) + " — " + fmtDate(wd[6])
      ),
      isPublished ? div("published-banner", ["📢 פורסם"]) : null,
    ]),
    e("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
      btn("btn-sm btn-sm-gray", "→", () => {
        S.weekOffset--;
        S.selectedCell = null;
        loadSchedule().then(() => render());
      }),
      btn("btn-sm btn-sm-blue", "השבוע", () => {
        S.weekOffset = 0;
        S.selectedCell = null;
        loadSchedule().then(() => render());
      }),
      !isManager() &&
      S.weekOffset >= 0 &&
      !S.publishedInitial?.has(getWeekDates(S.weekOffset + 1)[0]) &&
      !S.publishedWeeks.has(getWeekDates(S.weekOffset + 1)[0])
        ? null
        : btn("btn-sm btn-sm-gray", "←", () => {
            S.weekOffset++;
            S.selectedCell = null;
            loadSchedule().then(() => render());
          }),
      isManager() ? btn("btn-green", "⚡ שיבוץ אוטומטי", runSmartSchedule) : null,
      isManager()
        ? btn(
            canUndo() ? "btn-orange" : "btn-sm btn-sm-gray",
            "↶ בטל",
            canUndo() ? undoSchedule : () => toast("אין מה לבטל", "err"),
            { title: "בטל פעולה אחרונה (Ctrl+Z)", style: canUndo() ? "" : "opacity:0.4" }
          )
        : null,
      isManager()
        ? btn(
            canRedo() ? "btn-orange" : "btn-sm btn-sm-gray",
            "↷ חזור",
            canRedo() ? redoSchedule : () => toast("אין מה לחזור", "err"),
            { title: "חזור על פעולה (Ctrl+Y)", style: canRedo() ? "" : "opacity:0.4" }
          )
        : null,
      isManager()
        ? btn("btn-sm btn-sm-red", "🗑️ נקה שבוע", async () => {
            if (
              !(await uiConfirm({
                title: "לנקות את השבוע?",
                message: "כל השיבוצים בשבוע הנוכחי יימחקו. הפעולה ניתנת לביטול עם ↶.",
                tone: "warn",
                okLabel: "נקה שבוע",
              }))
            )
              return;
            const wd2 = getWeekDates(S.weekOffset);
            wd2.forEach((d) => {
              if (S.schedule[d])
                SHIFTS.forEach((sh) => {
                  S.schedule[d][sh.id] = [];
                });
            });
            saveScheduleToDB();
            toast("השבוע נוקה ✓");
            render();
          })
        : null,
      isManager()
        ? isPublished
          ? btn("btn-sm btn-sm-gray", "🔁 פרסם שוב", () => {
              S.showPublishModal = true;
              render();
            })
          : btn("btn-purple", "📢 פרסם", () => {
              S.showPublishModal = true;
              render();
            })
        : null,
    ]),
  ]);
  wrap.appendChild(hdr);

  // Employee blocks + notes for this week (managers only)
  if (isManager()) {
    const weekSubsForNotes = (S.availSubmissions || []).filter(
      (s) =>
        s.week_start === weekStart &&
        getEmp(s.employee_id) &&
        ((s.slots || []).length > 0 || (s.note || "").trim())
    );
    if (weekSubsForNotes.length > 0) {
      const notesBtn = e(
        "button",
        {
          style:
            "width:100%;background:#F59E0B18;border:1px solid #F59E0B44;color:#FCD34D;border-radius:12px;padding:12px 16px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center",
          onclick: () => {
            S.showWeekNotes = !S.showWeekNotes;
            render();
          },
        },
        [
          e("span", {}, "🚫 חסימות והערות עובדים לשבוע זה (" + weekSubsForNotes.length + ")"),
          e("span", { style: "font-size:11px" }, S.showWeekNotes ? "▲ הסתר" : "▼ הצג"),
        ]
      );
      wrap.appendChild(notesBtn);

      if (S.showWeekNotes) {
        const notesCard = div("card", [], {
          style: "margin-bottom:12px;border:1px solid #F59E0B33;background:#F59E0B08",
        });
        weekSubsForNotes.forEach((sub) => {
          const emp = getEmp(sub.employee_id);
          const idx = empIdx(sub.employee_id);
          const col = ec(idx);
          const row = e(
            "div",
            { style: "display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #33415544" },
            [
              e(
                "div",
                {
                  style:
                    "width:32px;height:32px;border-radius:8px;background:" +
                    col +
                    "22;border:1px solid " +
                    col +
                    "44;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:" +
                    col +
                    ";flex-shrink:0",
                },
                emp.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
              ),
              e("div", { style: "flex:1" }),
            ]
          );
          const infoCol = row.lastChild;
          infoCol.appendChild(
            e(
              "div",
              { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:4px" },
              emp.name
            )
          );

          // Show the actual blocked shifts (slots), if any
          // Sort by date first, then by shift chronologically (morning → morning2 → afternoon → night)
          const SHIFT_ORDER = { morning: 0, morning2: 1, afternoon: 2, night: 3 };
          const slots = (sub.slots || []).slice().sort((a, b) => {
            const dateCmp = (a.date || "").localeCompare(b.date || "");
            if (dateCmp !== 0) return dateCmp;
            return (SHIFT_ORDER[a.shift] ?? 99) - (SHIFT_ORDER[b.shift] ?? 99);
          });
          if (slots.length > 0) {
            const slotsGrid = e("div", {
              style: "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px",
            });
            slots.forEach((sl) => {
              const sh = SHIFT_BY_ID[sl.shift];
              const dt = sl.date ? new Date(sl.date + "T00:00:00") : null;
              const dayLabel = dt
                ? DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1)
                : "יום " + (DAYS[sl.day] || sl.day);
              slotsGrid.appendChild(
                e(
                  "div",
                  {
                    style:
                      "background:#0F172A;border:1px solid " +
                      (sh?.color || "#64748B") +
                      "44;border-radius:6px;padding:3px 8px;font-size:10px",
                  },
                  [
                    e(
                      "span",
                      { style: "font-weight:700;color:" + (sh?.color || "#94A3B8") },
                      dayLabel + " · " + (sh?.label || sl.shift)
                    ),
                  ]
                )
              );
            });
            infoCol.appendChild(slotsGrid);
          }

          if ((sub.note || "").trim()) {
            infoCol.appendChild(
              e(
                "div",
                { style: "font-size:12px;color:#FCD34D;font-style:italic" },
                "💬 " + sub.note
              )
            );
          }

          notesCard.appendChild(row);
        });
        wrap.appendChild(notesCard);
      }
    }
  }

  // Mobile view toggle (week / day)
  const isDayMode = S.schedMobileView === "day";
  const mobileToggle = e("div", { class: "sched-mobile-toggle" }, [
    e(
      "button",
      {
        class: !isDayMode ? "active" : "",
        onclick: () => {
          S.schedMobileView = "week";
          render();
        },
      },
      "📅 שבוע"
    ),
    e(
      "button",
      {
        class: isDayMode ? "active" : "",
        onclick: () => {
          S.schedMobileView = "day";
          if (S.schedDayIdx == null) {
            // Default: today if in this week, else first day
            const todayIdx = wd.findIndex((d) => d === today());
            S.schedDayIdx = todayIdx >= 0 ? todayIdx : 0;
          }
          render();
        },
      },
      "📆 יום"
    ),
  ]);
  wrap.appendChild(mobileToggle);

  // Mobile day view (only shown when toggle is on day, hidden on desktop via CSS)
  if (isDayMode) {
    wrap.appendChild(viewScheduleDayMobile(wd));
    return wrap;
  }

  // Grid
  const gridCard = div("card", [], { style: "padding:8px;overflow:hidden;max-width:100%" });
  const gridWrap = div("sched-wrap");
  // Scroll hint on mobile
  gridWrap.appendChild(
    e(
      "div",
      {
        style: "font-size:10px;color:#475569;text-align:center;margin-bottom:4px;display:none",
        class: "scroll-hint",
      },
      "← גלול לצדדים לראות את כל הימים →"
    )
  );
  const tbl = e("table", { class: "sched-table" });
  const thead = e("thead");
  const hrow = e("tr", [e("th", { style: "width:90px" }, "משמרת")]);
  wdDisplay.forEach((date) => {
    const dt = new Date(date + "T00:00:00");
    const isToday = date === today();
    hrow.appendChild(
      e(
        "th",
        {
          class: "day-header" + (isToday ? " is-today" : ""),
          style: isToday ? "color:#60A5FA" : "",
        },
        [
          e("div", { style: "font-size:11px" }, DAYS[dt.getDay()]),
          e(
            "div",
            { style: "font-size:18px;font-weight:900;color:" + (isToday ? "#60A5FA" : "#E2E8F0") },
            String(dt.getDate())
          ),
          getHoliday(date)
            ? e(
                "div",
                {
                  style:
                    "font-size:8px;color:#FCD34D;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px",
                },
                "✡️ " + getHoliday(date)
              )
            : null,
        ]
      )
    );
  });
  thead.appendChild(hrow);
  tbl.appendChild(thead);

  const tbody = e("tbody");

  // ── שורת העדרויות ──
  if (isManager()) {
    const absRow = e("tr");
    absRow.appendChild(
      e("td", { style: "border-right:2px solid #F59E0B44;padding-right:12px" }, [
        e("div", { style: "font-weight:700;font-size:12px;color:#F59E0B" }, "🌴 היעדרויות"),
        e("div", { style: "font-size:9px;color:#475569" }, "חופשה / מילואים"),
      ])
    );
    wdDisplay.forEach((date) => {
      const td = e("td", { style: "vertical-align:top;padding:4px 2px" });
      const dayAbs = S.vacations.filter(
        (v) =>
          v.status === "approved" && v.type !== "exam" && date >= v.start_date && date <= v.end_date
      );
      const dayExams = S.vacations.filter(
        (v) =>
          v.type === "exam" && v.status === "approved" && date >= v.start_date && date <= v.end_date
      );
      const dayBlocks = (S.availSubmissions || []).filter((b) => b.date === date);

      if (dayAbs.length === 0 && dayExams.length === 0 && dayBlocks.length === 0) {
        td.appendChild(
          e("div", { style: "font-size:10px;color:#334155;text-align:center;padding:4px" }, "—")
        );
      } else {
        dayAbs.forEach((v) => {
          const emp = getEmp(v.employee_id);
          if (!emp) return;
          const icon = v.type === "reserve" ? "🎖️" : "🌴";
          td.appendChild(
            e(
              "div",
              {
                style:
                  "font-size:10px;font-weight:700;color:#F59E0B;white-space:nowrap;margin-bottom:1px",
              },
              icon + " " + emp.name.split(" ")[0]
            )
          );
        });
        dayExams.forEach((v) => {
          const emp = getEmp(v.employee_id);
          if (!emp) return;
          td.appendChild(
            e(
              "div",
              {
                style:
                  "font-size:10px;font-weight:700;color:#10B981;white-space:nowrap;margin-bottom:1px",
              },
              "📝 " + emp.name.split(" ")[0]
            )
          );
        });
        dayBlocks.forEach((b) => {
          const emp = getEmp(b.employee_id);
          const sh = SHIFT_BY_ID[b.shift];
          if (!emp) return;
          td.appendChild(
            e(
              "div",
              { style: "font-size:9px;color:#EF4444;white-space:nowrap;margin-bottom:1px" },
              "🚫 " + emp.name.split(" ")[0] + (sh ? " " + sh.label : "")
            )
          );
        });
      }
      absRow.appendChild(td);
    });
    tbody.appendChild(absRow);
  }

  SHIFTS.forEach((shift) => {
    const row = e("tr");
    row.appendChild(
      e("td", { style: "border-right:2px solid " + shift.color + "44;padding-right:12px" }, [
        e("div", { style: "font-weight:700;font-size:13px;color:" + shift.color }, shift.label),
        e(
          "div",
          { style: "font-size:10px;color:#475569;direction:ltr;text-align:right" },
          shift.start + "–" + shift.end
        ),
      ])
    );
    wdDisplay.forEach((date) => {
      const dayNum = new Date(date + "T00:00:00").getDay();
      const isWeekendDay = dayNum === 5 || dayNum === 6;
      // On Fri/Sat skip afternoon
      if (isWeekendDay && (shift.id === "afternoon" || shift.id === "morning2")) {
        row.appendChild(
          e("td", { style: "background:#0F172A44;cursor:default" }, [
            e(
              "div",
              { style: "font-size:9px;color:#334155;text-align:center;padding:10px 0" },
              "—"
            ),
          ])
        );
        return;
      }
      const empIds = S.schedule[date]?.[shift.id] || [];
      const isSel = S.selectedCell?.date === date && S.selectedCell?.shift === shift.id;
      const canEdit = isManager();
      const _isTouchDev = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const tdProps = {
        class: isSel ? "selected" : "",
        style: "--shift-color:" + shift.color + (canEdit ? ";cursor:pointer" : ";cursor:default"),
        onclick: () => {
          if (!canEdit) return;
          S.selectedCell = isSel ? null : { date, shift: shift.id };
          render();
        },
      };
      // Drag & drop target (desktop only)
      if (canEdit && !_isTouchDev) {
        tdProps.ondragover = (ev) => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          ev.currentTarget.style.background = shift.color + "22";
          ev.currentTarget.style.outline = "2px dashed " + shift.color;
        };
        tdProps.ondragleave = (ev) => {
          // Only clear if leaving the cell entirely (not entering child element)
          if (!ev.currentTarget.contains(ev.relatedTarget)) {
            ev.currentTarget.style.background = "";
            ev.currentTarget.style.outline = "";
          }
        };
        tdProps.ondrop = async (ev) => {
          ev.preventDefault();
          ev.currentTarget.style.background = "";
          ev.currentTarget.style.outline = "";
          try {
            const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
            const { empId, fromDate, fromShift } = data;
            // Same cell - do nothing
            if (fromDate === date && fromShift === shift.id) return;
            // Check if employee is already in target cell
            const targetIds = S.schedule[date]?.[shift.id] || [];
            if (targetIds.includes(empId)) {
              toast("העובד כבר משובץ למשמרת הזאת", "err");
              return;
            }

            const empName = getEmp(empId)?.name || "העובד";
            const targetShiftLabel = shift.label;

            // CHECK 1: Block check - did this employee block this shift?
            const blockShiftId = shift.id === "morning2" ? "morning" : shift.id;
            const empBlocked = S.availSubmissions.some(
              (s) =>
                s.employee_id === empId &&
                (s.slots || []).some((sl) => {
                  if (sl.date && sl.date === date)
                    return sl.shift === blockShiftId || sl.shift === shift.id;
                  return false;
                })
            );
            if (empBlocked) {
              if (
                !(await uiConfirm({
                  title: "העובד חסם משמרת זו",
                  message: empName + " חסם את " + targetShiftLabel + " ביום זה.",
                  tone: "warn",
                  okLabel: "שבץ בכל זאת",
                }))
              )
                return;
            }

            // CHECK 2: Vacation/reserve/exam
            const vac = S.vacations.find(
              (v) =>
                v.employee_id === empId &&
                v.status === "approved" &&
                date >= v.start_date &&
                date <= v.end_date
            );
            if (vac) {
              const vacLabel =
                vac.type === "reserve" ? "מילואים" : vac.type === "exam" ? "מבחן" : "חופש";
              if (
                !(await uiConfirm({
                  title: "העובד בהיעדרות",
                  message: empName + " ב" + vacLabel + " בתאריך זה.",
                  tone: "warn",
                  okLabel: "שבץ בכל זאת",
                }))
              )
                return;
            }

            // CHECK 3: Cross-week rest (night yesterday → morning today)
            const crossConflict = await checkShiftConflictAsync(
              date,
              shift.id,
              empId,
              fromDate,
              fromShift
            );
            if (crossConflict) {
              if (
                !(await uiConfirm({
                  title: "התנגשות שעות",
                  message: crossConflict,
                  tone: "warn",
                  okLabel: "שבץ בכל זאת",
                }))
              )
                return;
            }

            // Snapshot for undo (any manual move should be undoable, just like click-assign).
            const dragEmpName = getEmp(empId)?.name?.split(" ")[0] || "עובד";
            pushScheduleHistory("העברת " + dragEmpName);

            // Remove from source
            if (S.schedule[fromDate] && S.schedule[fromDate][fromShift]) {
              S.schedule[fromDate][fromShift] = S.schedule[fromDate][fromShift].filter(
                (id) => id !== empId
              );
            }
            // Also drop the source's lock, if any — the manual decision moved with the chip.
            const oldLockKeyDrag = fromDate + "|" + fromShift;
            if (S.lockedSlots[oldLockKeyDrag]) S.lockedSlots[oldLockKeyDrag].delete(empId);
            // Add to target
            if (!S.schedule[date]) S.schedule[date] = {};
            if (!S.schedule[date][shift.id]) S.schedule[date][shift.id] = [];
            S.schedule[date][shift.id].push(empId);
            // Auto-lock: dragging is a manual assignment, protect from auto-schedule reset.
            const newLockKeyDrag = date + "|" + shift.id;
            if (!S.lockedSlots[newLockKeyDrag]) S.lockedSlots[newLockKeyDrag] = new Set();
            S.lockedSlots[newLockKeyDrag].add(empId);

            // Move custom hours and notes if exist
            const oldChKey = fromDate + "|" + fromShift + "|" + empId;
            const newChKey = date + "|" + shift.id + "|" + empId;
            if (S.customHours[oldChKey]) {
              S.customHours[newChKey] = S.customHours[oldChKey];
              delete S.customHours[oldChKey];
            }
            const oldNoteKey = fromDate + "|" + fromShift + "|" + empId;
            const newNoteKey = date + "|" + shift.id + "|" + empId;
            if (S.assignmentNotes[oldNoteKey]) {
              S.assignmentNotes[newNoteKey] = S.assignmentNotes[oldNoteKey];
              delete S.assignmentNotes[oldNoteKey];
            }

            invalidateMemo && invalidateMemo();
            render();
            saveScheduleToDB();
            if (typeof logAction === "function") {
              logAction("drag_drop_move", {
                empId,
                from: { date: fromDate, shift: fromShift },
                to: { date, shift: shift.id },
              });
            }
            toast("הועבר ✓");
          } catch (err) {
            console.error("Drag drop error:", err);
            toast("שגיאה בגרירה: " + (err?.message || err), "err");
          }
        };
      }
      const td = e("td", tdProps);
      if (empIds.length === 0) {
        td.appendChild(div("cell-empty", ["ריק"]));
      } else {
        empIds.forEach((empId) => {
          const emp = getEmp(empId);
          if (!emp) return;
          const i = empIdx(empId);
          const col = ec(i);
          const ch = S.customHours[date + "|" + shift.id + "|" + empId];
          const isFilteredOut = S.schedFilter && S.schedFilter !== empId;
          const isHighlighted = S.schedFilter && S.schedFilter === empId;
          const chipProps = {
            class: "emp-chip",
            style: `background:${isHighlighted ? col + "44" : col + "22"};border:${isHighlighted ? "2px" : "1px"} solid ${isHighlighted ? col : col + "44"};color:${col};opacity:${isFilteredOut ? "0.2" : "1"};${isHighlighted ? "box-shadow:0 0 8px " + col + "44;" : ""};cursor:${isManager() ? "grab" : "default"}`,
          };
          // Drag & drop only on desktop (not touch devices)
          const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
          if (isManager() && !isTouchDevice) {
            chipProps.draggable = "true";
            chipProps.ondragstart = (ev) => {
              ev.dataTransfer.setData(
                "text/plain",
                JSON.stringify({ empId: empId, fromDate: date, fromShift: shift.id })
              );
              ev.dataTransfer.effectAllowed = "move";
              ev.dataTransfer.dropEffect = "move";
              setTimeout(() => {
                if (ev.target.style) ev.target.style.opacity = "0.3";
              }, 0);
            };
            chipProps.ondragend = (ev) => {
              ev.target.style.opacity = "";
            };
          }
          // Parse note for tags and free text
          const noteKey = date + "|" + shift.id + "|" + empId;
          const rawNote = S.assignmentNotes[noteKey] || "";
          let chipTags = [];
          let chipNoteText = "";
          if (rawNote.startsWith("🏷️ ")) {
            const parts = rawNote.split(" | ");
            chipTags = parts[0]
              .replace("🏷️ ", "")
              .split(", ")
              .map((t) => t.trim())
              .filter(Boolean);
            chipNoteText = parts.slice(1).join(" | ");
          } else if (rawNote) {
            chipNoteText = rawNote;
          }

          // Always show hours: custom-per-employee if set, otherwise the shift's default.
          // Uses DAY_SHIFT_OVERRIDES so day-specific hours (Thu night 22:45-07:30,
          // Fri/Sat mornings with their own times) show correctly on each chip.
          const dowForChip = new Date(date + "T00:00:00").getDay();
          const overridesForChip = DAY_SHIFT_OVERRIDES[dowForChip];
          const shiftForHours =
            (overridesForChip && overridesForChip.find((s) => s.id === shift.id)) || shift;
          const displayStart = ch?.start || shiftForHours.start;
          const displayEnd = ch?.end || shiftForHours.end;
          const hasCustom = !!ch;

          const chip = e("div", chipProps, [
            // Name row with color dot
            e("div", { class: "emp-chip-row" }, [
              e(
                "span",
                { style: `width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0` },
                ""
              ),
              e("span", { style: "font-weight:700" }, emp.name.split(" ")[0]),
            ]),
            // Hours row — always visible. direction:ltr keeps "07:00-15:00" from reversing
            // to "15:00-07:00" inside the RTL app frame.
            e(
              "div",
              {
                class: "emp-chip-hours",
                style: "direction:ltr;text-align:center;color:#F59E0B;font-weight:700",
              },
              [e("span", { style: "margin-left:3px" }, "⏰"), displayStart + "–" + displayEnd]
            ),
            // System tags
            chipTags.length > 0
              ? e(
                  "div",
                  { class: "emp-chip-tags" },
                  chipTags.map((t) => e("span", { class: "emp-chip-tag" }, "🏷️ " + t))
                )
              : null,
            // Free-text note
            chipNoteText ? e("div", { class: "emp-chip-note" }, "📝 " + chipNoteText) : null,
          ]);
          td.appendChild(chip);
        });
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  tbl.appendChild(tbody);
  gridWrap.appendChild(tbl);
  gridCard.appendChild(gridWrap);
  wrap.appendChild(gridCard);

  // Cell editor
  if (S.selectedCell) {
    wrap.appendChild(viewCellEditor(S.selectedCell.date, S.selectedCell.shift));
  }

  // Workload
  wrap.appendChild(viewWorkload(wd));
  return wrap;
}

export function viewScheduleDayMobile(wd) {
  const wrap = e("div", { class: "sched-day-view", style: "display:block" });
  if (S.schedDayIdx == null || S.schedDayIdx < 0 || S.schedDayIdx > 6) S.schedDayIdx = 0;
  const date = wd[S.schedDayIdx];
  const dt = new Date(date + "T00:00:00");
  const isToday = date === today();
  const holiday = getHoliday(date);

  // Swipe navigation — swipe right → previous day, swipe left → next day.
  // Keeps the finger interaction natural on a phone: pull the calendar in the direction you want.
  let touchStartX = null,
    touchStartY = null;
  wrap.ontouchstart = (ev) => {
    if (ev.touches.length !== 1) {
      touchStartX = null;
      return;
    }
    touchStartX = ev.touches[0].clientX;
    touchStartY = ev.touches[0].clientY;
  };
  wrap.ontouchend = (ev) => {
    if (touchStartX == null) return;
    const endX = (ev.changedTouches[0] || {}).clientX;
    const endY = (ev.changedTouches[0] || {}).clientY;
    if (endX == null) return;
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;
    touchStartX = null;
    // Threshold: 60px horizontal and mostly horizontal, otherwise ignore.
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    haptic(10);
    // In RTL the natural swipe: right → previous day, left → next day.
    if (dx > 0) {
      // Swipe right — previous day
      if (S.schedDayIdx > 0) {
        S.schedDayIdx--;
        render();
      } else {
        S.weekOffset--;
        S.schedDayIdx = 6;
        loadSchedule().then(() => render());
      }
    } else {
      // Swipe left — next day
      if (S.schedDayIdx < 6) {
        S.schedDayIdx++;
        render();
      } else {
        S.weekOffset++;
        S.schedDayIdx = 0;
        loadSchedule().then(() => render());
      }
    }
  };

  // Navigation row
  const navRow = e("div", { class: "sched-day-nav" }, [
    btn("btn-sm btn-sm-gray", "→", () => {
      haptic(8);
      if (S.schedDayIdx > 0) {
        S.schedDayIdx--;
        render();
      } else {
        // Go to previous week's Saturday
        S.weekOffset--;
        S.schedDayIdx = 6;
        loadSchedule().then(() => render());
      }
    }),
    e("div", { style: "flex:1;text-align:center" }, [
      e(
        "div",
        { style: "font-weight:800;font-size:15px;color:" + (isToday ? "#60A5FA" : "#E2E8F0") },
        DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1) + "/" + dt.getFullYear()
      ),
      isToday
        ? e("div", { style: "font-size:10px;color:#60A5FA;font-weight:700;margin-top:2px" }, "היום")
        : null,
      holiday
        ? e(
            "div",
            { style: "font-size:10px;color:#FCD34D;font-weight:700;margin-top:2px" },
            "✡️ " + holiday
          )
        : null,
    ]),
    btn("btn-sm btn-sm-gray", "←", () => {
      haptic(8);
      if (S.schedDayIdx < 6) {
        S.schedDayIdx++;
        render();
      } else {
        // Go to next week's Sunday
        S.weekOffset++;
        S.schedDayIdx = 0;
        loadSchedule().then(() => render());
      }
    }),
  ]);
  wrap.appendChild(navRow);

  // Today shortcut
  if (!isToday) {
    wrap.appendChild(
      e("div", { style: "text-align:center;margin-bottom:10px" }, [
        btn("btn-sm btn-sm-blue", "← היום", () => {
          const todayStr = today();
          const todayDt = new Date(todayStr + "T00:00:00");
          const curWeekStart = new Date(wd[0] + "T00:00:00");
          // Calculate offset from current week
          const diffMs = todayDt - curWeekStart;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays < 7) {
            // In this week
            S.schedDayIdx = diffDays;
            render();
          } else {
            S.weekOffset = 0;
            S.schedDayIdx = todayDt.getDay();
            loadSchedule().then(() => render());
          }
        }),
      ])
    );
  }

  // Day card with shifts
  const dayCard = e("div", { class: "sched-day-card" });

  // Get absences for this day (managers only)
  if (isManager()) {
    const dayAbs = S.vacations.filter(
      (v) =>
        v.status === "approved" && v.type !== "exam" && date >= v.start_date && date <= v.end_date
    );
    const dayExams = S.vacations.filter(
      (v) =>
        v.type === "exam" && v.status === "approved" && date >= v.start_date && date <= v.end_date
    );
    const dayBlocks = (S.availSubmissions || []).filter((b) =>
      (b.slots || []).some((sl) => sl.date === date)
    );

    if (dayAbs.length > 0 || dayExams.length > 0 || dayBlocks.length > 0) {
      const absSection = e("div", {
        style: "padding:10px 14px;background:#F59E0B11;border-bottom:1px solid #334155",
      });
      absSection.appendChild(
        e(
          "div",
          { style: "font-weight:700;font-size:12px;color:#F59E0B;margin-bottom:6px" },
          "🌴 היעדרויות וחסימות"
        )
      );
      dayAbs.forEach((v) => {
        const emp = getEmp(v.employee_id);
        if (!emp) return;
        const icon = v.type === "reserve" ? "🎖️" : "🌴";
        absSection.appendChild(
          e(
            "div",
            { style: "font-size:11px;color:#F59E0B;margin-bottom:2px" },
            icon + " " + emp.name
          )
        );
      });
      dayExams.forEach((v) => {
        const emp = getEmp(v.employee_id);
        if (!emp) return;
        absSection.appendChild(
          e("div", { style: "font-size:11px;color:#10B981;margin-bottom:2px" }, "📝 " + emp.name)
        );
      });
      dayBlocks.forEach((b) => {
        (b.slots || [])
          .filter((sl) => sl.date === date)
          .forEach((sl) => {
            const emp = getEmp(b.employee_id);
            const sh = SHIFT_BY_ID[sl.shift];
            if (!emp || !sh) return;
            absSection.appendChild(
              e(
                "div",
                { style: "font-size:11px;color:#EF4444;margin-bottom:2px" },
                "🚫 " + emp.name + " — " + sh.label
              )
            );
          });
      });
      dayCard.appendChild(absSection);
    }
  }

  // Shifts for this day
  const dayShifts = getShiftsForDate(date);
  dayShifts.forEach((shift) => {
    const empIds = S.schedule[date]?.[shift.id] || [];
    const isSel = S.selectedCell?.date === date && S.selectedCell?.shift === shift.id;

    const shiftRow = e("div", {
      class: "sched-day-shift-row",
      style:
        "padding:12px 14px;cursor:" +
        (isManager() ? "pointer" : "default") +
        ";border-bottom:1px solid #0F172A;background:" +
        (isSel ? "rgba(59,130,246,0.08)" : "transparent") +
        ";border-right:3px solid " +
        (isSel ? shift.color : "transparent"),
      onclick: () => {
        if (!isManager()) return;
        S.selectedCell = isSel ? null : { date, shift: shift.id };
        render();
      },
    });

    // Shift label + hours
    shiftRow.appendChild(
      e("div", { class: "sched-day-shift-label", style: "color:" + shift.color }, [
        e("div", {}, shift.label),
        e(
          "div",
          { class: "sched-day-shift-hours", style: "direction:ltr;text-align:right" },
          shift.start + "–" + shift.end
        ),
      ])
    );

    // Employees in this shift
    const empsDiv = e("div", { class: "sched-day-shift-emps" });
    if (empIds.length === 0) {
      empsDiv.appendChild(
        e("div", { style: "color:#475569;font-size:12px;font-style:italic" }, "— ריק —")
      );
    } else {
      empIds.forEach((empId) => {
        const emp = getEmp(empId);
        if (!emp) return;
        const idx = empIdx(empId);
        const col = ec(idx);
        const ch = S.customHours[date + "|" + shift.id + "|" + empId];
        const noteKey = date + "|" + shift.id + "|" + empId;
        const rawNote = S.assignmentNotes[noteKey] || "";
        let chipTags = [];
        let chipNoteText = "";
        if (rawNote.startsWith("🏷️ ")) {
          const parts = rawNote.split(" | ");
          chipTags = parts[0]
            .replace("🏷️ ", "")
            .split(", ")
            .map((t) => t.trim())
            .filter(Boolean);
          chipNoteText = parts.slice(1).join(" | ");
        } else if (rawNote) {
          chipNoteText = rawNote;
        }

        empsDiv.appendChild(
          e(
            "div",
            {
              style:
                "background:" +
                col +
                "18;border:1px solid " +
                col +
                "44;border-radius:8px;padding:8px 10px",
            },
            [
              e("div", { style: "display:flex;align-items:center;gap:6px" }, [
                e(
                  "span",
                  {
                    style:
                      "width:8px;height:8px;border-radius:50%;background:" + col + ";flex-shrink:0",
                  },
                  ""
                ),
                e("span", { style: "font-weight:700;font-size:13px;color:" + col }, emp.name),
              ]),
              ch
                ? e(
                    "div",
                    {
                      style:
                        "direction:ltr;text-align:center;font-size:11px;color:#F59E0B;font-weight:700;margin-top:3px",
                    },
                    "⏰ " + ch.start + "–" + ch.end
                  )
                : null,
              chipTags.length > 0
                ? e(
                    "div",
                    { style: "display:flex;flex-wrap:wrap;gap:3px;margin-top:4px" },
                    chipTags.map((t) =>
                      e(
                        "span",
                        {
                          style:
                            "background:rgba(255,255,255,0.08);font-size:10px;padding:2px 7px;border-radius:6px;color:#E2E8F0",
                        },
                        "🏷️ " + t
                      )
                    )
                  )
                : null,
              chipNoteText
                ? e(
                    "div",
                    { style: "font-size:10px;color:#F59E0B;margin-top:3px;font-style:italic" },
                    "📝 " + chipNoteText
                  )
                : null,
            ]
          )
        );
      });
    }
    shiftRow.appendChild(empsDiv);
    dayCard.appendChild(shiftRow);
  });
  wrap.appendChild(dayCard);

  // Cell editor (if a cell is selected)
  if (S.selectedCell && S.selectedCell.date === date) {
    wrap.appendChild(viewCellEditor(S.selectedCell.date, S.selectedCell.shift));
  }

  return wrap;
}

export function viewCellEditor(date, shiftId) {
  const shift = SHIFT_BY_ID[shiftId];
  const assignedIds = S.schedule[date]?.[shiftId] || [];
  const editor = div("cell-editor");
  editor.appendChild(
    e("div", { class: "cell-editor-title" }, `✏️ ${shift.label} — ${fmtDate(date)}`)
  );

  const btnWrap = e("div");
  schedulableEmployees().forEach((emp, idx) => {
    const col = ec(idx);
    const vac = S.vacations.find(
      (v) =>
        v.employee_id === emp.id &&
        v.status === "approved" &&
        date >= v.start_date &&
        date <= v.end_date
    );
    const onVac = !!vac;
    const vacIcon = vac?.type === "reserve" ? "🎖️" : vac?.type === "exam" ? "📝" : "🌴";
    const vacLabel = vac?.type === "reserve" ? "מילואים" : vac?.type === "exam" ? "מבחן" : "חופש";
    const isAssigned = assignedIds.includes(emp.id);
    const locked = S.lockedSlots[date + "|" + shiftId]?.has(emp.id);

    // Also dim employees who blocked this exact shift on this exact date, so at a glance
    // the manager sees who's available vs who chose not to. Kept clickable with a confirm.
    const blockShiftId = shiftId === "morning2" ? "morning" : shiftId;
    const isBlocked = S.availSubmissions.some(
      (s) =>
        s.employee_id === emp.id &&
        (s.slots || []).some(
          (sl) => sl.date === date && (sl.shift === blockShiftId || sl.shift === shiftId)
        )
    );

    // Rest-between-shifts check: does the employee's previous shift (in this week's schedule
    // OR the previous week's, for Sun mornings after a Sat night) collide with this shift?
    // Same time-based logic the auto-scheduler uses — 8 hours is the legal floor.
    let restViolation = null;
    {
      // Reuses getShiftsForDate() so day-specific hour overrides (Thu-night 22:45-07:30,
      // Fri/Sat hours, etc.) apply consistently to rest-checks, not just to display.
      const dateStrForDefs = (dt) =>
        dt.getFullYear() +
        "-" +
        String(dt.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(dt.getDate()).padStart(2, "0");
      const findDef = (id, dt) => {
        const dayDefs = getShiftsForDate(dateStrForDefs(dt));
        return dayDefs.find((sh) => sh.id === id) || SHIFTS.find((sh) => sh.id === id);
      };
      const dObj = new Date(date + "T00:00:00");
      const thisDef = findDef(shiftId, dObj);
      if (thisDef) {
        const startHM = (thisDef.start || "07:00").split(":").map(Number);
        const shiftStartTs = dObj.getTime() + startHM[0] * 3600000 + startHM[1] * 60000;

        // Scan yesterday, today, AND tomorrow. We need tomorrow because: if I'm placing
        // "night" today, the END of my night (next morning ~07:00) may conflict with a
        // morning/morning2 shift tomorrow that was already assigned to this employee.
        const yesterday = new Date(dObj.getTime() - 86400000);
        const tomorrow = new Date(dObj.getTime() + 86400000);
        const daysToScan = [
          [yesterday, -1],
          [dObj, 0],
          [tomorrow, 1],
        ];

        // Also compute THIS shift's end time for forward rest check
        const endHMThis = (thisDef.end || "00:00").split(":").map(Number);
        const endMinThis = endHMThis[0] * 60 + endHMThis[1];
        const startMinThis = startHM[0] * 60 + startHM[1];
        let shiftEndTs = dObj.getTime() + endHMThis[0] * 3600000 + endHMThis[1] * 60000;
        if (endMinThis <= startMinThis) shiftEndTs += 86400000; // this shift crosses midnight

        let minRest = Infinity;
        daysToScan.forEach(([d, _offset]) => {
          const dStr =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0");
          const daySched = S.schedule[dStr] || {};
          Object.keys(daySched).forEach((prevShiftId) => {
            if (!(daySched[prevShiftId] || []).includes(emp.id)) return;
            if (dStr === date && prevShiftId === shiftId) return; // this exact slot doesn't count
            const prevSh = findDef(prevShiftId, d);
            if (!prevSh) return;
            const endHM = (prevSh.end || "00:00").split(":").map(Number);
            const startHM2 = (prevSh.start || "00:00").split(":").map(Number);
            const startMin = startHM2[0] * 60 + startHM2[1];
            const endMin = endHM[0] * 60 + endHM[1];
            let otherStartTs = d.getTime() + startHM2[0] * 3600000 + startHM2[1] * 60000;
            let otherEndTs = d.getTime() + endHM[0] * 3600000 + endHM[1] * 60000;
            if (endMin <= startMin) otherEndTs += 86400000; // other shift crosses midnight

            // Two measurements, keep the smaller:
            //   1) BACKWARD: rest between other shift ending and this one starting
            //   2) FORWARD:  rest between this shift ending and other one starting
            // The smaller of the two is the real violation if any.
            const restBackward = (shiftStartTs - otherEndTs) / 3600000;
            const restForward = (otherStartTs - shiftEndTs) / 3600000;
            // Only consider shifts within 24h window on either side
            if (restBackward >= 0 && restBackward < 24 && restBackward < minRest)
              minRest = restBackward;
            if (restForward >= 0 && restForward < 24 && restForward < minRest)
              minRest = restForward;
            // Overlap case (either direction < 0 means overlap)
            if (restBackward < 0 && restBackward > -24) minRest = Math.min(minRest, restBackward);
            if (restForward < 0 && restForward > -24) minRest = Math.min(minRest, restForward);
          });
        });

        // Round to one decimal before comparing — protects against float precision issues
        // where 7.0h could compute to 6.9999… and false-trigger the warning.
        const restRounded = Math.round(minRest * 10) / 10;
        if (minRest < 0 && minRest !== Infinity) {
          restViolation = "כבר משובץ למשמרת חופפת";
        } else if (restRounded < 7 && minRest !== Infinity) {
          restViolation = "פחות מ-7 שעות מנוחה (" + restRounded + " שעות)";
        }
        // 7 hours and above is legitimate — no warning at all.
      }
    }

    // Combined "dimmed" state — vacation, blocked shift, OR insufficient rest.
    const dimmedBecause = onVac
      ? vacLabel
      : isBlocked
        ? "חסם משמרת זו"
        : restViolation
          ? restViolation
          : null;
    const showDimmed = !!dimmedBecause && !isAssigned;

    const chip = e(
      "button",
      {
        class: "cell-emp-btn" + (isAssigned ? " assigned" : ""),
        style: `background:${isAssigned ? col + "33" : "#0F172A"};border:1px solid ${isAssigned ? col : col + "44"};color:${col};opacity:${showDimmed ? 0.45 : 1}`,
        title: dimmedBecause ? emp.name + " — " + dimmedBecause : "",
        onclick: async () => {
          // If employee is on vacation/reserve/exam, ask for confirmation before assigning
          if (onVac && !isAssigned) {
            if (
              !(await uiConfirm({
                title: "העובד בהיעדרות",
                message: emp.name + " ב" + vacLabel + " בתאריך " + fmtDate(date),
                tone: "warn",
                okLabel: "שבץ בכל זאת",
              }))
            )
              return;
          }
          // Same for a shift they explicitly blocked
          if (isBlocked && !isAssigned) {
            if (
              !(await uiConfirm({
                title: "העובד חסם משמרת זו",
                message: emp.name + " ביקש לא לעבוד במשמרת זו.",
                tone: "warn",
                okLabel: "שבץ בכל זאת",
              }))
            )
              return;
          }
          // Same for insufficient rest between shifts
          if (restViolation && !isAssigned) {
            if (
              !(await uiConfirm({
                title: "בעיית מנוחה בין משמרות",
                message: emp.name + ": " + restViolation,
                tone: "warn",
                okLabel: "שבץ בכל זאת",
              }))
            )
              return;
          }
          toggleCellEmp(date, shiftId, emp.id);
        },
      },
      [
        e("span", { style: `width:7px;height:7px;border-radius:50%;background:${col}` }, ""),
        e("span", {}, emp.name),
        onVac ? e("span", { style: "font-size:11px", title: vacLabel }, vacIcon) : null,
        isBlocked && !onVac
          ? e("span", { style: "font-size:11px", title: "חסם משמרת זו" }, "🚫")
          : null,
        restViolation && !onVac && !isBlocked
          ? e("span", { style: "font-size:11px", title: restViolation }, "⏰")
          : null,
        locked ? e("span", {}, "🔒") : null,
      ]
    );
    btnWrap.appendChild(chip);

    if (isAssigned) {
      // Lock button
      const lockBtn = e(
        "button",
        {
          class: "btn-icon",
          title: locked ? "שחרר נעילה" : "נעל שיבוץ",
          style: "margin-right:-8px;margin-left:4px",
          onclick: (ev) => {
            ev.stopPropagation();
            toggleLock(date, shiftId, emp.id);
          },
        },
        locked ? "🔒" : "🔓"
      );
      btnWrap.appendChild(lockBtn);

      // Custom hours button
      const chKey = date + "|" + shiftId + "|" + emp.id;
      const existingCh = S.customHours[chKey];
      // Note button
      const noteKey = date + "|" + shiftId + "|" + emp.id;
      const existingNote = S.assignmentNotes[noteKey];
      const noteBtn = e(
        "button",
        {
          class: "btn-icon",
          title: "הערה",
          style:
            "margin-right:-8px;margin-left:4px;font-size:12px;color:" +
            (existingNote ? "#F59E0B" : "#475569"),
          onclick: (ev) => {
            ev.stopPropagation();
            const editorId = "note-editor-" + noteKey.replace(/[|]/g, "_");
            const existingEditor = document.getElementById(editorId);
            if (existingEditor) {
              existingEditor.remove();
              return;
            }

            // Parse existing note - separate system tags from free text
            // Format: "🏷️ Sys1, Sys2 | free text" or just plain
            let existingTags = [];
            let existingText = "";
            if (existingNote) {
              const parts = existingNote.split(" | ");
              if (parts[0].startsWith("🏷️ ")) {
                existingTags = parts[0]
                  .replace("🏷️ ", "")
                  .split(", ")
                  .filter((x) => x.trim());
                existingText = parts.slice(1).join(" | ");
              } else {
                existingText = existingNote;
              }
            }

            const selectedTags = new Set(existingTags);
            const editorDiv = e("div", {
              id: editorId,
              style:
                "display:flex;flex-direction:column;gap:8px;background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px;margin:4px;width:100%;max-width:380px",
            });

            // System chips picker
            const systems = S.systems || [];
            if (systems.length > 0) {
              editorDiv.appendChild(
                e(
                  "div",
                  { style: "font-size:10px;color:#64748B;font-weight:700" },
                  "🏷️ בחר מערכות:"
                )
              );
              const chipsRow = e("div", { style: "display:flex;flex-wrap:wrap;gap:4px" });
              systems.forEach((sys) => {
                const isSel = selectedTags.has(sys);
                const chipBtn = e(
                  "button",
                  {
                    "data-sys": sys,
                    style: `padding:4px 10px;border-radius:14px;border:1px solid ${isSel ? "#3B82F6" : "#334155"};background:${isSel ? "#3B82F644" : "#1E293B"};color:${isSel ? "#60A5FA" : "#94A3B8"};font-size:11px;font-weight:600;cursor:pointer;font-family:inherit`,
                    onclick: (ev2) => {
                      ev2.stopPropagation();
                      if (selectedTags.has(sys)) selectedTags.delete(sys);
                      else selectedTags.add(sys);
                      // Re-style this chip
                      const newSel = selectedTags.has(sys);
                      ev2.target.style.background = newSel ? "#3B82F644" : "#1E293B";
                      ev2.target.style.color = newSel ? "#60A5FA" : "#94A3B8";
                      ev2.target.style.borderColor = newSel ? "#3B82F6" : "#334155";
                    },
                  },
                  sys
                );
                chipsRow.appendChild(chipBtn);
              });
              editorDiv.appendChild(chipsRow);
            } else {
              editorDiv.appendChild(
                e(
                  "div",
                  { style: "font-size:10px;color:#475569;font-style:italic" },
                  "💡 הוסף מערכות בהגדרות לבחירה מהירה"
                )
              );
            }

            // Free text input
            editorDiv.appendChild(
              e(
                "div",
                { style: "font-size:10px;color:#64748B;font-weight:700;margin-top:4px" },
                "💬 הערה חופשית:"
              )
            );
            const textInp = e("input", {
              type: "text",
              value: existingText,
              placeholder: "הערה (אופציונלי)",
              style:
                "background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:13px;padding:6px 10px;font-family:inherit;width:100%;box-sizing:border-box",
              id: "note-inp-" + noteKey.replace(/[|]/g, "_"),
            });
            editorDiv.appendChild(textInp);

            // Action buttons
            const btnRow = e("div", { style: "display:flex;gap:6px" });
            btnRow.appendChild(
              e(
                "button",
                {
                  style:
                    "flex:1;background:#10B98122;border:1px solid #10B98144;color:#10B981;border-radius:6px;padding:6px 12px;font-size:12px;font-family:inherit;font-weight:700;cursor:pointer",
                  onclick: (ev2) => {
                    ev2.stopPropagation();
                    const txt = document
                      .getElementById("note-inp-" + noteKey.replace(/[|]/g, "_"))
                      .value.trim();
                    const tags = Array.from(selectedTags);
                    let combined = "";
                    if (tags.length > 0 && txt) combined = "🏷️ " + tags.join(", ") + " | " + txt;
                    else if (tags.length > 0) combined = "🏷️ " + tags.join(", ");
                    else combined = txt;
                    if (combined) S.assignmentNotes[noteKey] = combined;
                    else delete S.assignmentNotes[noteKey];
                    saveScheduleToDB();
                    toast("הערה נשמרה ✓");
                    render();
                  },
                },
                "💾 שמור"
              )
            );
            btnRow.appendChild(
              e(
                "button",
                {
                  style:
                    "background:#EF444422;border:1px solid #EF444444;color:#EF4444;border-radius:6px;padding:6px 12px;font-size:12px;font-family:inherit;font-weight:700;cursor:pointer",
                  onclick: (ev2) => {
                    ev2.stopPropagation();
                    delete S.assignmentNotes[noteKey];
                    saveScheduleToDB();
                    toast("הערה הוסרה");
                    render();
                  },
                },
                "מחק"
              )
            );
            btnRow.appendChild(
              e(
                "button",
                {
                  style:
                    "background:#64748B22;border:1px solid #64748B44;color:#94A3B8;border-radius:6px;padding:6px 12px;font-size:12px;font-family:inherit;font-weight:700;cursor:pointer",
                  onclick: (ev2) => {
                    ev2.stopPropagation();
                    document.getElementById(editorId)?.remove();
                  },
                },
                "ביטול"
              )
            );
            editorDiv.appendChild(btnRow);

            btnWrap.appendChild(editorDiv);
          },
        },
        existingNote ? "📝" : "💬"
      );
      btnWrap.appendChild(noteBtn);

      const hoursBtn = e(
        "button",
        {
          class: "btn-icon",
          title: "ערוך שעות",
          style: "margin-right:-8px;margin-left:4px;font-size:12px;color:#94A3B8",
          onclick: (ev) => {
            ev.stopPropagation();
            // Use day-specific shift definition — Thu-night, Fri and Sat have different
            // hours than the generic weekday defaults.
            const sh = getShiftsForDate(date).find((s) => s.id === shiftId) || SHIFT_BY_ID[shiftId];
            const curStart = existingCh?.start || sh.start;
            const curEnd = existingCh?.end || sh.end;
            // Show inline editor
            const existingEditor = document.getElementById(
              "hours-editor-" + chKey.replace(/[|]/g, "_")
            );
            if (existingEditor) {
              existingEditor.remove();
              return;
            }
            const editorDiv = e(
              "div",
              {
                id: "hours-editor-" + chKey.replace(/[|]/g, "_"),
                style:
                  "display:inline-flex;align-items:center;gap:6px;background:#0F172A;border:1px solid #334155;border-radius:8px;padding:6px 10px;margin:4px",
              },
              [
                e("span", { style: "font-size:11px;color:#94A3B8" }, emp.name.split(" ")[0] + ":"),
                e("input", {
                  type: "time",
                  value: curStart,
                  class: "fi",
                  style: "font-size:12px;padding:6px 8px;border-radius:6px",
                  id: "ch-start-" + chKey.replace(/[|]/g, "_"),
                }),
                e("span", { style: "color:#475569;font-size:11px" }, "—"),
                e("input", {
                  type: "time",
                  value: curEnd,
                  class: "fi",
                  style: "font-size:12px;padding:6px 8px;border-radius:6px",
                  id: "ch-end-" + chKey.replace(/[|]/g, "_"),
                }),
                e(
                  "button",
                  {
                    style:
                      "background:#10B98122;border:1px solid #10B98144;color:#10B981;border-radius:6px;padding:3px 8px;font-size:11px;font-family:inherit;font-weight:700",
                    onclick: (ev2) => {
                      ev2.stopPropagation();
                      const s = document.getElementById(
                        "ch-start-" + chKey.replace(/[|]/g, "_")
                      ).value;
                      const en = document.getElementById(
                        "ch-end-" + chKey.replace(/[|]/g, "_")
                      ).value;
                      if (s && en) {
                        S.customHours[chKey] = { start: s, end: en };
                        saveScheduleToDB();
                        toast("שעות עודכנו ✓");
                        render();
                      }
                    },
                  },
                  "שמור"
                ),
                e(
                  "button",
                  {
                    style:
                      "background:#EF444422;border:1px solid #EF444444;color:#EF4444;border-radius:6px;padding:3px 8px;font-size:11px;font-family:inherit;font-weight:700",
                    onclick: (ev2) => {
                      ev2.stopPropagation();
                      delete S.customHours[chKey];
                      saveScheduleToDB();
                      toast("שעות אופסו");
                      render();
                    },
                  },
                  "אפס"
                ),
              ]
            );
            btnWrap.appendChild(editorDiv);
          },
        },
        "⏰"
      );
      btnWrap.appendChild(hoursBtn);
    }
  });
  editor.appendChild(btnWrap);
  return editor;
}

export function viewWorkload(wd) {
  const counts = {};
  S.employees.forEach((emp) => {
    counts[emp.id] = 0;
  });
  wd.forEach((d) =>
    SHIFTS.forEach((sh) => {
      (S.schedule[d]?.[sh.id] || []).forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
      });
    })
  );

  if (!S.schedFilter) S.schedFilter = null;
  const card = div("card", [
    e(
      "div",
      { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px" },
      [
        e("div", { class: "card-title", style: "margin-bottom:0" }, "עומס עובדים — השבוע"),
        S.schedFilter
          ? btn("btn-sm btn-sm-gray", "✕ הסר פילטר", () => {
              S.schedFilter = null;
              render();
            })
          : null,
      ]
    ),
  ]);
  schedulableEmployees().forEach((emp, idx) => {
    const count = counts[emp.id] || 0;
    const max = emp.max_shifts_per_week || 5;
    const pct = Math.min(Math.round((count / max) * 100), 100);
    const over = count > max;
    const col = ec(idx);
    const barColor = over ? "#EF4444" : pct > 80 ? "#F59E0B" : "#10B981";
    const isFiltered = S.schedFilter === emp.id;
    card.appendChild(
      div("workload-row", [
        div("workload-info", [
          e(
            "div",
            {
              style: "display:flex;align-items:center;gap:7px;cursor:pointer",
              onclick: () => {
                S.schedFilter = isFiltered ? null : emp.id;
                render();
              },
            },
            [
              e("span", { style: `width:8px;height:8px;border-radius:50%;background:${col}` }, ""),
              e(
                "span",
                {
                  style:
                    "font-size:13px;font-weight:" +
                    (isFiltered ? "800" : "600") +
                    ";color:" +
                    (isFiltered ? "#60A5FA" : "#E2E8F0"),
                },
                emp.name
              ),
              isFiltered
                ? e(
                    "span",
                    {
                      style:
                        "font-size:10px;background:#3B82F622;color:#60A5FA;border:1px solid #3B82F644;border-radius:4px;padding:1px 5px",
                    },
                    "מסונן"
                  )
                : null,
              over
                ? e(
                    "span",
                    {
                      style:
                        "font-size:10px;background:#EF444422;color:#EF4444;border:1px solid #EF444444;border-radius:4px;padding:1px 5px",
                    },
                    "חריגה!"
                  )
                : null,
            ]
          ),
          e(
            "span",
            { style: "font-size:12px;color:" + (over ? "#EF4444" : "#94A3B8") },
            `${count}/${max}`
          ),
        ]),
        div("workload-bar-bg", [
          e("div", {
            class: "workload-bar-fill",
            style: `width:${pct}%;background:${isFiltered ? "#3B82F6" : barColor}`,
          }),
        ]),
      ])
    );
  });
  return card;
}

// ── EMPLOYEES ──
export function viewEmployees() {
  const wrap = e("div");
  wrap.appendChild(
    div("section-header", [
      div("page-title", ["👥 עובדים"]),
      e("div", { style: "display:flex;gap:8px;align-items:center" }, [
        btn("btn-add", "✉️ הזמן עובד", () => {
          S.showInviteModal = true;
          S.newInvitation = { name: "", email: "", role: "employee" };
          loadInvitations().then(() => render());
        }),
      ]),
    ])
  );

  // Invitations modal
  if (S.showInviteModal) {
    wrap.appendChild(viewInviteModal());
  }

  // Pending invitations list
  const pendingInvs = (S.invitations || []).filter((i) => i.status === "pending");
  if (pendingInvs.length > 0) {
    const invCard = div("card", [
      e(
        "div",
        { style: "font-weight:700;font-size:14px;color:#60A5FA;margin-bottom:12px" },
        "✉️ הזמנות פתוחות (" + pendingInvs.length + ")"
      ),
    ]);
    pendingInvs.forEach((inv) => {
      const expDate = new Date(inv.expires_at);
      const isExpiringSoon = expDate - new Date() < 12 * 60 * 60 * 1000; // < 12h
      invCard.appendChild(
        e(
          "div",
          {
            style:
              "background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px 14px;margin-bottom:8px",
          },
          [
            e(
              "div",
              {
                style:
                  "display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap",
              },
              [
                e("div", { style: "flex:1;min-width:180px" }, [
                  e(
                    "div",
                    { style: "font-weight:700;font-size:13px;color:#E2E8F0" },
                    inv.name || inv.email
                  ),
                  e(
                    "div",
                    { style: "font-size:11px;color:#94A3B8;margin-top:2px" },
                    "📧 " + inv.email
                  ),
                  e("div", { style: "font-size:11px;color:#64748B;margin-top:2px" }, [
                    "תפקיד: " + (inv.role === "admin" || inv.role === "manager" ? "מנהל" : "עובד"),
                    " · ",
                    e(
                      "span",
                      { style: "color:" + (isExpiringSoon ? "#F59E0B" : "#64748B") },
                      "פג: " +
                        expDate.toLocaleString("he-IL", {
                          day: "numeric",
                          month: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                    ),
                  ]),
                ]),
                e("div", { style: "display:flex;gap:4px;flex-wrap:wrap" }, [
                  btn("btn-sm btn-sm-blue", "📋", () => copyInviteLink(inv), {
                    title: "העתק לינק",
                  }),
                  btn("btn-sm btn-sm-gray", "📧", () => resendInvitation(inv), {
                    title: "שלח מחדש",
                  }),
                  btn("btn-sm btn-sm-red", "✕", () => revokeInvitation(inv.id), { title: "בטל" }),
                ]),
              ]
            ),
          ]
        )
      );
    });
    wrap.appendChild(invCard);
  }

  // Add form
  if (S.showAddEmp) {
    const form = div("card", [div("card-title", ["עובד חדש"])]);
    const r1 = div("form-row", [
      div("form-col", [
        e("label", { class: "form-label" }, "שם מלא *"),
        e("input", {
          class: "fi",
          placeholder: "ישראל ישראלי",
          value: S.newEmp.name,
          oninput: (ev) => {
            S.newEmp.name = ev.target.value;
          },
        }),
      ]),
      div("form-col", [
        e("label", { class: "form-label" }, "אימייל"),
        e("input", {
          class: "fi",
          type: "email",
          placeholder: "name@example.com",
          value: S.newEmp.email,
          oninput: (ev) => {
            S.newEmp.email = ev.target.value;
          },
        }),
      ]),
    ]);
    const r2 = div("form-row", [
      div("form-col", [
        e("label", { class: "form-label" }, "תעודת זהות"),
        e("input", {
          class: "fi",
          placeholder: "000000000",
          value: S.newEmp.idNumber,
          oninput: (ev) => {
            S.newEmp.idNumber = ev.target.value;
          },
        }),
      ]),
      div("form-col", [
        e("label", { class: "form-label" }, "תפקיד"),
        e(
          "select",
          {
            class: "fi",
            onchange: (ev) => {
              S.newEmp.role = ev.target.value;
            },
          },
          [
            e(
              "option",
              { value: "employee", selected: S.newEmp.role === "employee" ? "selected" : null },
              "עובד"
            ),
            e(
              "option",
              { value: "admin", selected: S.newEmp.role === "admin" ? "selected" : null },
              "מנהל"
            ),
          ]
        ),
      ]),
    ]);
    form.appendChild(r1);
    form.appendChild(r2);
    form.appendChild(
      div("form-actions", [
        btn("btn-add", "שמור עובד", addEmployee, { style: "flex:1" }),
        btn("btn-sm btn-sm-gray", "ביטול", () => {
          S.showAddEmp = false;
          render();
        }),
      ])
    );
    wrap.appendChild(form);
  }

  // List
  if (S.employees.length === 0) {
    wrap.appendChild(
      div("card", [
        e("div", { style: "text-align:center;padding:40px;color:#64748B" }, ["אין עובדים עדיין"]),
      ])
    );
  } else {
    const card = div("card");
    const tbl = e("table", { class: "emp-table" }, [
      e("thead", [
        e("tr", [
          e("th", {}, "שם"),
          e("th", {}, "אימייל"),
          e("th", {}, "ת.ז."),
          e("th", {}, "תפקיד"),
          e("th", {}, ""),
        ]),
      ]),
    ]);
    const tbody = e("tbody");
    S.employees.forEach((emp, idx) => {
      const col = ec(idx);
      const tr = e("tr", [
        e("td", { style: "font-weight:700" }, [
          e(
            "span",
            {
              style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-left:8px`,
            },
            ""
          ),
          e(
            "span",
            {
              style: "cursor:pointer;border-bottom:1px dashed transparent;transition:all 0.2s",
              onmouseover: (ev) => {
                ev.target.style.borderBottomColor = "#3B82F6";
                ev.target.style.color = "#60A5FA";
              },
              onmouseout: (ev) => {
                ev.target.style.borderBottomColor = "transparent";
                ev.target.style.color = "";
              },
              onclick: () => renameEmployee(emp),
              title: "לחץ לעריכת השם",
            },
            emp.name
          ),
          e("span", { style: "font-size:10px;color:#475569;margin-right:4px" }, "✏️"),
        ]),
        e("td", { style: "color:#94A3B8" }, emp.email || "—"),
        e("td", { style: "color:#64748B" }, emp.id_number || "—"),
        e("td", {}, [
          e("span", {}, emp.role === "admin" || emp.role === "manager" ? "מנהל" : "עובד"),
          emp.schedule_excluded
            ? e(
                "span",
                {
                  style:
                    "display:inline-block;background:#A855F722;color:#C084FC;border:1px solid #A855F744;border-radius:5px;padding:1px 6px;font-size:9px;font-weight:700;margin-right:6px",
                },
                "👔 ניהול בלבד"
              )
            : null,
        ]),
        e("td", {}, [
          btn(
            "btn-sm btn-sm-blue",
            "✏️ הגבלות",
            () => {
              S.constraintsEmp = emp;
              render();
            },
            { style: "margin-left:4px" }
          ),
          emp.id !== S.user.id
            ? e(
                "select",
                {
                  style:
                    "background:#0F172A;border:1px solid #334155;border-radius:6px;color:#94A3B8;font-size:11px;padding:3px 6px;font-family:inherit;margin-left:4px",
                  onchange: async (ev) => {
                    const newRole = ev.target.value;
                    await sb.from("profiles").update({ role: newRole }).eq("id", emp.id);
                    await loadEmployees();
                    toast("תפקיד עודכן ✓");
                    render();
                  },
                },
                [
                  e(
                    "option",
                    { value: "employee", selected: emp.role === "employee" ? "selected" : null },
                    "עובד"
                  ),
                  e(
                    "option",
                    {
                      value: "admin",
                      selected: emp.role === "admin" || emp.role === "manager" ? "selected" : null,
                    },
                    "מנהל"
                  ),
                ]
              )
            : e("span", { style: "font-size:11px;color:#F59E0B;margin-left:4px" }, ""),
          emp.role === "admin" || emp.role === "manager"
            ? btn(
                emp.schedule_excluded ? "btn-sm btn-sm-purple" : "btn-sm btn-sm-gray",
                emp.schedule_excluded ? "👔 ניהול בלבד" : "👔 שבץ בסידור",
                async () => {
                  const newVal = !emp.schedule_excluded;
                  const { error } = await sb
                    .from("profiles")
                    .update({ schedule_excluded: newVal })
                    .eq("id", emp.id);
                  if (error) {
                    toast(friendlyError(error), "err");
                    return;
                  }
                  await loadEmployees();
                  toast(
                    newVal
                      ? emp.name + " מוסתר מהסידור — ניהול בלבד ✓"
                      : emp.name + " יופיע בסידור ✓"
                  );
                  render();
                },
                {
                  style: "margin-left:4px",
                  title: emp.schedule_excluded
                    ? "כרגע מנהל בלבד — לחץ כדי להחזיר לסידור"
                    : "לחץ כדי להסתיר מהסידור (ניהול בלבד)",
                }
              )
            : null,
          emp.email && emp.id !== S.user.id
            ? btn("btn-sm btn-sm-gray", "🔑", () => resetPassword(emp), {
                style: "margin-left:4px",
                title: "שליחת איפוס סיסמה",
              })
            : null,
          emp.id !== S.user.id
            ? btn("btn-sm btn-sm-red", "🗑️", () => deleteEmployee(emp.id))
            : null,
        ]),
      ]);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    card.appendChild(tbl);
    wrap.appendChild(card);
  }

  return wrap;
}

// ── VACATIONS ──
export function viewVacations() {
  const wrap = e("div");
  wrap.appendChild(div("page-title", ["🌴 היעדרויות"], { style: "margin-bottom:16px" }));

  const icons = { vacation: "🌴", reserve: "🎖️", exam: "📝" };
  const names = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
  const colors = { vacation: "#10B981", reserve: "#6366F1", exam: "#F59E0B" };

  // Manager tabs
  if (!S.mgrVacTab) S.mgrVacTab = "approve";
  const vacTabRow = e("div", { style: "display:flex;gap:6px;margin-bottom:14px" });
  [
    { id: "mine", label: "🌴 ההיעדרויות שלי" },
    { id: "approve", label: "👥 אישור בקשות" },
  ].forEach((t) => {
    const isActive = S.mgrVacTab === t.id;
    vacTabRow.appendChild(
      e(
        "button",
        {
          style:
            "flex:1;padding:10px;border-radius:10px;border:1px solid " +
            (isActive ? "#3B82F6" : "#334155") +
            ";background:" +
            (isActive ? "#3B82F622" : "#1E293B") +
            ";color:" +
            (isActive ? "#60A5FA" : "#64748B") +
            ";font-family:inherit;font-weight:700;font-size:13px",
          onclick: () => {
            S.mgrVacTab = t.id;
            render();
          },
        },
        t.label
      )
    );
  });
  wrap.appendChild(vacTabRow);

  // Manager personal vacations
  if (S.mgrVacTab === "mine") {
    wrap.appendChild(viewEmpVacations());
    return wrap;
  }

  // ── בקשות הצטרפות למשמרת ממתינות ──
  const pendingJoins = (S.joinRequests || []).filter(
    (r) => r.status === "pending" && getEmp(r.employee_id)
  );
  if (pendingJoins.length > 0) {
    const jCard = div("card", [
      e(
        "div",
        { style: "font-weight:800;font-size:15px;color:#F59E0B;margin-bottom:14px" },
        `➕ בקשות הצטרפות למשמרת (${pendingJoins.length})`
      ),
    ]);
    pendingJoins.forEach((req) => {
      const emp = getEmp(req.employee_id);
      const sh = SHIFT_BY_ID[req.shift];
      const dt = new Date(req.date + "T00:00:00");
      const dateLabel = DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1);
      jCard.appendChild(
        e(
          "div",
          {
            style: `background:#0F172A;border:1px solid #F59E0B44;border-radius:14px;padding:14px;margin-bottom:10px`,
          },
          [
            e("div", { style: "margin-bottom:10px" }, [
              e(
                "div",
                { style: "font-weight:700;font-size:14px;color:#E2E8F0" },
                emp?.name || "עובד"
              ),
              e(
                "div",
                {
                  style: `font-size:13px;color:${sh?.color || "#94A3B8"};font-weight:700;margin-top:4px`,
                },
                "מבקש להצטרף: " + dateLabel + " · " + (sh?.label || req.shift)
              ),
              req.note
                ? e(
                    "div",
                    { style: "font-size:12px;color:#94A3B8;font-style:italic;margin-top:4px" },
                    `"${req.note}"`
                  )
                : null,
            ]),
            div("form-actions", [
              btn("btn-green", "✓ אשר ושבץ", () => processJoinRequest(req, true), {
                style: "flex:1",
              }),
              btn("btn-sm btn-sm-red", "✗ דחה", () => processJoinRequest(req, false), {
                style: "flex:1",
              }),
            ]),
          ]
        )
      );
    });
    wrap.appendChild(jCard);
  }

  // ── הוספת היעדרות ישירה (למנהל) — מוסיף היעדרות מאושרת ישירות, בלי צורך באישור ──
  const addCard = div("card");
  addCard.appendChild(
    btn(
      S.showMgrAddVac ? "btn-sm btn-sm-gray" : "btn-add",
      S.showMgrAddVac ? "✕ ביטול" : "➕ הוסף היעדרות לעובד",
      () => {
        S.showMgrAddVac = !S.showMgrAddVac;
        if (S.showMgrAddVac) {
          S.newVac = {
            type: "vacation",
            startDate: "",
            endDate: "",
            reason: "",
            employeeId: "",
            startDayShifts: null,
            endDayShifts: null,
          };
        }
        render();
      },
      { style: "width:100%;padding:14px;font-weight:800" }
    )
  );

  if (S.showMgrAddVac) {
    const typeIcons = { vacation: "🌴", reserve: "🎖️", exam: "📝" };
    const typeNames = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
    const typeColors = { vacation: "#10B981", reserve: "#6366F1", exam: "#F59E0B" };

    addCard.appendChild(
      e(
        "div",
        {
          style:
            "background:#10B98111;border:1px solid #10B98133;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;color:#10B981;margin:14px 0",
        },
        "ℹ️ הוספה ישירה — מאושרת אוטומטית, לא ממתינה לאישור"
      )
    );

    // Employee picker
    const empSel = e("select", {
      class: "fi",
      style: "width:100%;margin-bottom:14px",
      onchange: (ev) => {
        S.newVac.employeeId = ev.target.value;
        render();
      },
    });
    empSel.appendChild(
      e("option", { value: "", selected: !S.newVac.employeeId ? "selected" : null }, "— בחר עובד —")
    );
    S.employees
      .filter((em) => em.id !== S.user.id)
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .forEach((em) => {
        empSel.appendChild(
          e(
            "option",
            { value: em.id, selected: S.newVac.employeeId === em.id ? "selected" : null },
            em.name
          )
        );
      });
    addCard.appendChild(e("label", { class: "form-label" }, "עובד *"));
    addCard.appendChild(empSel);

    // Type selector
    const typeSel = e("div", {
      style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px",
    });
    ["vacation", "reserve", "exam"].forEach((type) => {
      const sel = (S.newVac.type || "vacation") === type;
      typeSel.appendChild(
        e(
          "button",
          {
            style: `padding:12px 8px;border-radius:12px;border:2px solid ${sel ? typeColors[type] : typeColors[type] + "44"};background:${sel ? typeColors[type] + "22" : "#0F172A"};color:${sel ? typeColors[type] : "#64748B"};font-family:inherit;font-weight:800;font-size:13px;cursor:pointer`,
            onclick: () => {
              S.newVac.type = type;
              render();
            },
          },
          [
            e("div", { style: "font-size:20px;margin-bottom:4px" }, typeIcons[type]),
            e("div", {}, typeNames[type]),
          ]
        )
      );
    });
    addCard.appendChild(typeSel);

    // Clamp dates to a sane window: last 30 days (for retroactive sick-day entry)
    // through 2 years ahead. Prevents the iOS wheel from drifting back to 1950.
    const _vacMin = (() => {
      // Build the ISO string from the Israel-wall-clock Date's own fields —
      // never via .toISOString(), which reinterprets the Date as UTC and can
      // round back a day for times near Israel midnight.
      const d = israelNow();
      d.setDate(d.getDate() - 30);
      return (
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
      );
    })();
    const _vacMax = israelYear() + 2 + "-12-31";
    addCard.appendChild(
      div("form-row", [
        div("form-col", [
          e("label", { class: "form-label" }, "מתאריך *"),
          e("input", {
            type: "date",
            class: "fi",
            min: _vacMin,
            max: _vacMax,
            value: S.newVac.startDate || "",
            onchange: (ev) => {
              S.newVac.startDate = ev.target.value;
              // Auto-fill end date = start date if empty — most vacations are single-day,
              // and this prevents the user from leaving endDate blank or picking the wrong year.
              if (!S.newVac.endDate || S.newVac.endDate < ev.target.value) {
                S.newVac.endDate = ev.target.value;
              }
              render();
            },
          }),
        ]),
        div("form-col", [
          e("label", { class: "form-label" }, "עד תאריך *"),
          e("input", {
            type: "date",
            class: "fi",
            min: S.newVac.startDate || _vacMin,
            max: _vacMax,
            value: S.newVac.endDate || "",
            onchange: (ev) => {
              S.newVac.endDate = ev.target.value;
              render();
            },
          }),
        ]),
      ])
    );

    // Live day-count indicator — shows the number of days and flags overlong ranges.
    if (S.newVac.startDate && S.newVac.endDate) {
      const dayDiff =
        Math.round(
          (new Date(S.newVac.endDate + "T00:00:00") - new Date(S.newVac.startDate + "T00:00:00")) /
            86400000
        ) + 1;
      const tooLong = dayDiff > 90;
      const weirdYear =
        S.newVac.endDate.slice(0, 4) !== S.newVac.startDate.slice(0, 4) && dayDiff > 180;
      addCard.appendChild(
        e(
          "div",
          {
            style: `padding:8px 12px;border-radius:8px;margin-bottom:10px;font-size:13px;font-weight:600;background:${tooLong ? "#EF444422" : "#10B98122"};color:${tooLong ? "#FCA5A5" : "#86EFAC"};border:1px solid ${tooLong ? "#EF444466" : "#10B98144"}`,
          },
          tooLong
            ? `⚠️ טווח חריג: ${dayDiff} ימים${weirdYear ? " (חוצה שנה — בדוק שהשנה נכונה!)" : ""}`
            : `✓ ${dayDiff} ${dayDiff === 1 ? "יום" : "ימים"}`
        )
      );
    }

    addCard.appendChild(
      e(
        "label",
        { class: "form-label", style: "margin-top:10px;display:block" },
        "הערה (אופציונלי)"
      )
    );
    addCard.appendChild(
      e("input", {
        class: "fi",
        placeholder: "סיבה / פרטים",
        style: "margin-bottom:14px",
        value: S.newVac.reason || "",
        oninput: (ev) => {
          S.newVac.reason = ev.target.value;
        },
      })
    );

    addCard.appendChild(
      btn(
        "btn-green",
        "✓ הוסף היעדרות מאושרת",
        async () => {
          if (!S.newVac.employeeId) return toast("נא לבחור עובד", "err");
          if (!S.newVac.startDate || !S.newVac.endDate) return toast("נא למלא תאריכים", "err");
          if (S.newVac.endDate < S.newVac.startDate) return toast("תאריך סיום לפני התחלה", "err");

          // Sanity check: anything over 90 days is almost always a data-entry error (wrong year
          // in the picker wheel). Prompt the manager to confirm before inserting the row.
          const dayDiff =
            Math.round(
              (new Date(S.newVac.endDate + "T00:00:00") -
                new Date(S.newVac.startDate + "T00:00:00")) /
                86400000
            ) + 1;
          if (dayDiff > 90) {
            const empName = getEmp(S.newVac.employeeId)?.name || "העובד";
            const confirmLong = await uiConfirm({
              title: "היעדרות ארוכה — לאשר?",
              message: `אתה עומד להוסיף ${dayDiff} ימים (${fmtDate(S.newVac.startDate)} עד ${fmtDate(S.newVac.endDate)}) ל${empName}. בטוח שזה נכון? זה עלול להיות טעות של שנה או חודש בלוח התאריכים.`,
              tone: "warn",
              okLabel: "כן, זה נכון",
            });
            if (!confirmLong) return;
          }

          const type = S.newVac.type || "vacation";
          const payload = {
            employee_id: S.newVac.employeeId,
            business_id: S.profile.business_id,
            start_date: S.newVac.startDate,
            end_date: S.newVac.endDate,
            type,
            status: "approved", // Direct manager-added — approved immediately
            reason: S.newVac.reason || null,
          };
          const { data: inserted, error } = await sb
            .from("vacations")
            .insert([payload])
            .select("id")
            .maybeSingle();
          if (error) {
            toast(friendlyError(error), "err");
            return;
          }

          // Notify the employee by email
          const empObj = getEmp(S.newVac.employeeId);
          if (empObj?.email) {
            sendEmail("vacation_approved", empObj.email, {
              empName: empObj.name,
              startDate: S.newVac.startDate,
              endDate: S.newVac.endDate,
              vacationType: type,
            });
          }

          toast("היעדרות נוספה ואושרה ✓");
          S.showMgrAddVac = false;
          S.newVac = { type: "vacation", startDate: "", endDate: "", reason: "" };
          await loadVacations();
          render();
        },
        { style: "width:100%;padding:12px" }
      )
    );
  }

  wrap.appendChild(addCard);

  // ── בקשות ממתינות לאישור ──
  const pending = S.vacations.filter((v) => v.status === "pending" && getEmp(v.employee_id));
  if (pending.length > 0) {
    const pCard = div("card", [
      e(
        "div",
        { style: "font-weight:800;font-size:15px;color:#F59E0B;margin-bottom:14px" },
        `⏳ ממתינות לאישור (${pending.length})`
      ),
    ]);
    pending.forEach((vac) => {
      const emp = getEmp(vac.employee_id);
      const col = colors[vac.type] || "#10B981";
      const icon = icons[vac.type] || "🌴";
      const name = names[vac.type] || "חופשה";
      const isExam = vac.type === "exam";

      pCard.appendChild(
        e(
          "div",
          {
            style: `background:#0F172A;border:1px solid ${col}44;border-radius:14px;padding:14px;margin-bottom:10px`,
          },
          [
            e(
              "div",
              {
                style:
                  "display:flex;justify-content:space-between;align-items:start;margin-bottom:10px",
              },
              [
                e("div", {}, [
                  e(
                    "div",
                    { style: `font-weight:800;font-size:15px;color:${col}` },
                    `${icon} ${name}`
                  ),
                  e(
                    "div",
                    { style: "font-weight:700;font-size:14px;color:#E2E8F0;margin-top:4px" },
                    emp?.name || "עובד"
                  ),
                  e(
                    "div",
                    { style: "font-size:12px;color:#64748B;margin-top:2px" },
                    fmtDate(vac.start_date) +
                      (vac.start_date !== vac.end_date ? " — " + fmtDate(vac.end_date) : "")
                  ),
                  vac.reason
                    ? e(
                        "div",
                        { style: "font-size:12px;color:#94A3B8;font-style:italic;margin-top:4px" },
                        `"${vac.reason}"`
                      )
                    : null,
                ]),
                isExam
                  ? e(
                      "div",
                      {
                        style:
                          "background:#F59E0B22;border:1px solid #F59E0B44;border-radius:8px;padding:4px 8px;font-size:10px;color:#FCD34D;font-weight:700",
                      },
                      "לא חוסם"
                    )
                  : null,
              ]
            ),
            div("form-actions", [
              btn("btn-green", "✓ אשר", () => updateVacStatus(vac.id, "approved"), {
                style: "flex:1",
              }),
              btn(
                "btn-sm btn-sm-red",
                "✗ דחה",
                async () => {
                  const reason = await uiPrompt({
                    title: "סיבת דחייה",
                    message: "סיבת הדחייה (אופציונלי, ישלח לעובד)",
                    placeholder: "למשל: אין מספיק כיסוי",
                  });
                  if (reason === null) return; // cancelled
                  updateVacStatus(vac.id, "rejected", reason);
                },
                { style: "flex:1" }
              ),
            ]),
          ]
        )
      );
    });
    wrap.appendChild(pCard);
  } else {
    wrap.appendChild(
      div("card", [
        e(
          "div",
          { style: "text-align:center;padding:20px;color:#64748B;font-size:13px" },
          "אין בקשות ממתינות לאישור ✓"
        ),
      ])
    );
  }

  // ── חופשות מאושרות (עם אפשרות עריכה/ביטול) ──
  const approved = S.vacations.filter((v) => v.status === "approved" && getEmp(v.employee_id));
  if (approved.length > 0) {
    const appCard = div("card", [
      e(
        "div",
        { style: "font-weight:800;font-size:15px;color:#10B981;margin-bottom:14px" },
        `✅ העדרויות מאושרות (${approved.length})`
      ),
    ]);
    approved
      .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""))
      .forEach((vac) => {
        const emp = getEmp(vac.employee_id);
        const col = colors[vac.type] || "#10B981";
        const icon = icons[vac.type] || "🌴";
        const name = names[vac.type] || "חופשה";
        const isPast = vac.end_date < today();

        appCard.appendChild(
          e(
            "div",
            {
              style: `background:#0F172A;border:1px solid ${col}44;border-radius:12px;padding:12px;margin-bottom:10px;opacity:${isPast ? 0.6 : 1}`,
            },
            [
              e(
                "div",
                {
                  style:
                    "display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap",
                },
                [
                  e("div", { style: "flex:1;min-width:160px" }, [
                    e(
                      "div",
                      { style: `font-weight:700;font-size:13px;color:${col}` },
                      `${icon} ${name}`
                    ),
                    e(
                      "div",
                      { style: "font-weight:700;font-size:14px;color:#E2E8F0;margin-top:3px" },
                      emp?.name || "עובד"
                    ),
                    e(
                      "div",
                      { style: "font-size:11px;color:#94A3B8;margin-top:2px" },
                      fmtDate(vac.start_date) +
                        (vac.start_date !== vac.end_date ? " — " + fmtDate(vac.end_date) : "")
                    ),
                    vac.reason
                      ? e(
                          "div",
                          {
                            style: "font-size:11px;color:#64748B;font-style:italic;margin-top:3px",
                          },
                          `"${vac.reason}"`
                        )
                      : null,
                    isPast
                      ? e(
                          "div",
                          { style: "font-size:10px;color:#64748B;margin-top:3px" },
                          "⏳ הסתיים"
                        )
                      : null,
                  ]),
                  e("div", { style: "display:flex;gap:4px;flex-wrap:wrap" }, [
                    !isPast
                      ? btn("btn-sm btn-sm-blue", "✏️ ערוך", () => editApprovedVacation(vac), {
                          title: "ערוך תאריכים/סיבה",
                        })
                      : null,
                    btn("btn-sm btn-sm-red", "✕ בטל", () => cancelApprovedVacation(vac), {
                      title: "בטל את ההעדרות",
                    }),
                  ]),
                ]
              ),
            ]
          )
        );
      });
    wrap.appendChild(appCard);

    wrap.appendChild(
      div(
        "form-actions",
        [
          btn(
            "btn-green",
            "📤 ייצוא CSV",
            () => {
              const icons = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
              let csv =
                "\u05E9\u05DD,\u05E1\u05D5\u05D2,\u05DE\u05EA\u05D0\u05E8\u05D9\u05DA,\u05E2\u05D3 \u05EA\u05D0\u05E8\u05D9\u05DA,\u05E1\u05D8\u05D8\u05D5\u05E1,\u05E1\u05D9\u05D1\u05D4" +
                String.fromCharCode(10);
              approved.forEach((v) => {
                const emp = getEmp(v.employee_id);
                csv +=
                  '"' +
                  (emp?.name || "?") +
                  '"' +
                  "," +
                  '"' +
                  (icons[v.type] || "חופשה") +
                  '"' +
                  "," +
                  v.start_date +
                  "," +
                  v.end_date +
                  "," +
                  "מאושר" +
                  "," +
                  '"' +
                  (v.reason || "") +
                  '"' +
                  String.fromCharCode(10);
              });
              const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "absences_approved.csv";
              a.click();
              URL.revokeObjectURL(url);
              toast("קובץ CSV הורד ✓");
            },
            { style: "flex:1" }
          ),
          btn(
            "btn-sm btn-sm-blue",
            "🖨️ הדפסה",
            () => {
              const icons = { vacation: "🌴 חופשה", reserve: "🎖️ מילואים", exam: "📝 מבחן" };
              // Every interpolated value is escHtml()-wrapped to prevent HTML injection from
              // user-controlled fields (names, reasons).
              let html =
                "<!DOCTYPE html><html dir=rtl lang=he><head><meta charset=UTF-8><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th{background:#1E293B;color:white;padding:8px;text-align:right}td{padding:6px 8px;border:1px solid #ddd}</style></head><body>";
              html += "<h1>היעדרויות מאושרות — " + escHtml(S.business?.name || "") + "</h1>";
              html +=
                "<table><tr><th>שם</th><th>סוג</th><th>מתאריך</th><th>עד תאריך</th><th>סיבה</th></tr>";
              approved.forEach((v) => {
                const emp = getEmp(v.employee_id);
                html +=
                  "<tr><td>" +
                  escHtml(emp?.name || "?") +
                  "</td><td>" +
                  escHtml(icons[v.type] || "חופשה") +
                  "</td><td>" +
                  escHtml(v.start_date || "") +
                  "</td><td>" +
                  escHtml(v.end_date || "") +
                  "</td><td>" +
                  escHtml(v.reason || "") +
                  "</td></tr>";
              });
              html += "</table></body></html>";
              const win = window.open("", "_blank");
              if (win) {
                win.document.write(html);
                win.document.close();
                setTimeout(() => win.print(), 500);
              }
              toast("פותח להדפסה ✓");
            },
            { style: "flex:1" }
          ),
        ],
        { style: "margin-bottom:14px" }
      )
    );
  }

  // ── היסטוריה ──
  const history = S.vacations.filter((v) => v.status !== "pending" && getEmp(v.employee_id));
  if (history.length > 0) {
    const hCard = div("card", [
      e(
        "div",
        { style: "font-weight:700;font-size:14px;color:#94A3B8;margin-bottom:14px" },
        "📜 היסטוריה"
      ),
    ]);
    history
      .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
      .forEach((vac) => {
        const emp = getEmp(vac.employee_id);
        const isApp = vac.status === "approved";
        const col = colors[vac.type] || "#10B981";
        const icon = icons[vac.type] || "🌴";

        hCard.appendChild(
          e(
            "div",
            {
              style:
                "display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #0F172A",
            },
            [
              e("div", {}, [
                e("div", { style: "font-weight:700;font-size:13px;color:#E2E8F0" }, [
                  e("span", { style: `color:${col};margin-left:6px` }, icon),
                  emp?.name || "עובד",
                ]),
                e(
                  "div",
                  { style: "font-size:11px;color:#64748B;margin-top:2px" },
                  fmtDate(vac.start_date) +
                    (vac.start_date !== vac.end_date ? " — " + fmtDate(vac.end_date) : "")
                ),
              ]),
              e("div", { style: "display:flex;align-items:center;gap:6px" }, [
                e(
                  "span",
                  { class: "status-badge status-" + (isApp ? "approved" : "rejected") },
                  isApp ? "אושר" : "נדחה"
                ),
                vac.reject_reason
                  ? e(
                      "div",
                      { style: "font-size:10px;color:#FCA5A5;margin-top:2px" },
                      "סיבה: " + vac.reject_reason
                    )
                  : null,
                describePartialVac(vac)
                  ? e(
                      "div",
                      { style: "font-size:10px;color:#C084FC;margin-top:2px" },
                      "🕐 " + describePartialVac(vac)
                    )
                  : null,
                btn("btn-sm btn-sm-red", "🗑️", () => deleteVacRequest(vac.id), {
                  style: "padding:4px 6px",
                }),
              ]),
            ]
          )
        );
      });
    wrap.appendChild(hCard);
  }

  return wrap;
}

// ── Edit / cancel approved vacations ──
export async function editApprovedVacation(vac) {
  const types = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
  const emp = getEmp(vac.employee_id);
  const empName = emp?.name || "עובד";

  // Prompt for new dates
  const newStart = await uiPrompt({
    title: "עריכת תאריך התחלה",
    message: "עובד: " + empName + "\nסוג: " + (types[vac.type] || "חופשה"),
    defaultValue: vac.start_date,
    placeholder: "YYYY-MM-DD",
  });
  if (!newStart) return;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newStart)) {
    toast("פורמט תאריך לא תקין", "err");
    return;
  }

  const newEnd = await uiPrompt({
    title: "עריכת תאריך סיום",
    defaultValue: vac.end_date,
    placeholder: "YYYY-MM-DD",
  });
  if (!newEnd) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEnd)) {
    toast("פורמט תאריך לא תקין", "err");
    return;
  }

  if (newEnd < newStart) {
    toast("תאריך סיום חייב להיות אחרי תאריך התחלה", "err");
    return;
  }

  const newReason = await uiPrompt({
    title: "סיבה / הערה",
    message: "טקסט חופשי (אופציונלי)",
    defaultValue: vac.reason || "",
  });
  if (newReason === null) return; // cancelled

  // Update in DB
  const { error } = await sb
    .from("vacations")
    .update({
      start_date: newStart,
      end_date: newEnd,
      reason: newReason || null,
    })
    .eq("id", vac.id);

  if (error) {
    toast("עדכון נכשל — " + friendlyError(error), "err");
    return;
  }

  if (typeof logAction === "function") {
    logAction("vacation_edited", {
      vacation_id: vac.id,
      employee_id: vac.employee_id,
      old_dates: vac.start_date + " — " + vac.end_date,
      new_dates: newStart + " — " + newEnd,
    });
  }

  await loadVacations();
  toast("✓ ההעדרות עודכנה");
  render();
}

export async function cancelApprovedVacation(vac) {
  const types = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
  const emp = getEmp(vac.employee_id);
  const empName = emp?.name || "עובד";
  const typeLabel = types[vac.type] || "חופשה";

  if (
    !(await uiConfirm({
      title: `לבטל ${typeLabel}?`,
      message:
        empName +
        "\nתאריכים: " +
        fmtDate(vac.start_date) +
        (vac.start_date !== vac.end_date ? " — " + fmtDate(vac.end_date) : "") +
        "\n\nההיעדרות תימחק מהמערכת.",
      tone: "danger",
      okLabel: "בטל היעדרות",
    }))
  )
    return;

  // Delete from DB
  const { error } = await sb.from("vacations").delete().eq("id", vac.id);

  if (error) {
    toast("ביטול נכשל — " + friendlyError(error), "err");
    return;
  }

  if (typeof logAction === "function") {
    logAction("vacation_cancelled", {
      vacation_id: vac.id,
      employee_id: vac.employee_id,
      type: vac.type,
      dates: vac.start_date + " — " + vac.end_date,
    });
  }

  await loadVacations();
  toast("✓ ההעדרות בוטלה");
  render();
}

// ── SWAPS ──
export async function processManagerDecision(swap, isApproved, rejectReason) {
  if (isApproved) {
    // אימות אחרון לפני אישור בסידור
    if (swap.target_date && swap.giver_id) {
      // חילוף הדדי
      // מקבל המשמרת (העובד השני) מקבל את המשמרת שלך, ומתעלמים מהמשמרת שהוא מוסר
      const c1 = checkShiftConflict(
        swap.date,
        swap.shift,
        swap.taker_id,
        swap.target_date,
        swap.target_shift
      );
      // אתה (מוסר המשמרת) מקבל את המשמרת שלו, ומתעלמים מהמשמרת שאתה מוסר
      const c2 = checkShiftConflict(
        swap.target_date,
        swap.target_shift,
        swap.giver_id,
        swap.date,
        swap.shift
      );

      if (c1) {
        toast("לא ניתן לאשר: " + c1, "err");
        return;
      }
      if (c2) {
        toast("לא ניתן לאשר: " + c2, "err");
        return;
      }

      const empsA = S.schedule[swap.date]?.[swap.shift];
      if (empsA) {
        const i = empsA.indexOf(swap.giver_id);
        if (i > -1) empsA[i] = swap.taker_id;
      }
      const empsB = S.schedule[swap.target_date]?.[swap.target_shift];
      if (empsB) {
        const i = empsB.indexOf(swap.taker_id);
        if (i > -1) empsB[i] = swap.giver_id;
      }
    } else if (swap.giver_id) {
      // מסירת משמרת
      const c = checkShiftConflict(swap.date, swap.shift, swap.taker_id);
      if (c) {
        toast("לא ניתן לאשר: " + c, "err");
        return;
      }
      const emps = S.schedule[swap.date]?.[swap.shift];
      if (emps) {
        const i = emps.indexOf(swap.giver_id);
        if (i > -1) emps[i] = swap.taker_id;
      }
    } else {
      // הצטרפות למשמרת
      const c = checkShiftConflict(swap.date, swap.shift, swap.taker_id);
      if (c) {
        toast("לא ניתן לאשר: " + c, "err");
        return;
      }
      const emps = S.schedule[swap.date]?.[swap.shift];
      if (emps && !emps.includes(swap.taker_id)) emps.push(swap.taker_id);
    }
    saveScheduleToDB();
  }

  const swapUpdate = { status: isApproved ? "approved" : "rejected" };
  if (rejectReason) swapUpdate.reject_reason = rejectReason;
  const { data: swUpd, error: swErr } = await sb
    .from("swaps")
    .update(swapUpdate)
    .eq("id", swap.id)
    .select("id,status")
    .maybeSingle();
  if (swErr || !swUpd || swUpd.status !== swapUpdate.status) {
    toast("❌ הפעולה נכשלה: " + (swErr?.message || "לא ניתן לאמת את העדכון"), "err");
    return;
  }
  if (typeof logAction === "function") {
    logAction(isApproved ? "swap_approved" : "swap_rejected", {
      swap_id: swap.id,
      giver_id: swap.giver_id,
      taker_id: swap.taker_id,
      date: swap.date,
      shift: swap.shift,
      target_date: swap.target_date || null,
      target_shift: swap.target_shift || null,
      reject_reason: rejectReason || null,
    });
  }

  const taker = getEmp(swap.taker_id);
  if (taker?.email) {
    const sh = SHIFT_BY_ID[swap.shift];
    sendEmail("swap_decision", taker.email, {
      empName: taker.name,
      targetDate: swap.target_date
        ? fmtDate(swap.date) + " ⇆ " + fmtDate(swap.target_date)
        : fmtDate(swap.date),
      shiftLabel: sh?.label || swap.shift,
      statusText: isApproved ? "אושרה" : "נדחתה",
      isApproved: isApproved,
      rejectReason: rejectReason || "",
    });
  }

  toast(isApproved ? "✓ אושר ועודכן בסידור" : "נדחה");
  await loadSwapRequests();
  render();
  silentRefresh();
}

// ── אישור/דחייה של העובד השני (Peer) ──
export async function processPeerDecision(swap, isApproved) {
  const newStatus = isApproved ? "pending_manager" : "rejected";
  const { error } = await sb.from("swaps").update({ status: newStatus }).eq("id", swap.id);
  if (error) {
    toast(friendlyError(error), "err");
    return;
  }
  if (typeof logAction === "function") {
    logAction(isApproved ? "swap_peer_approved" : "swap_peer_rejected", {
      swap_id: swap.id,
      giver_id: swap.giver_id,
      taker_id: swap.taker_id,
      date: swap.date,
      shift: swap.shift,
    });
  }

  // אם העובד אישר, עכשיו שולחים את המייל למנהל!
  if (isApproved) {
    const allMgrs = getNotifiedManagers();
    const giverEmp = getEmp(swap.giver_id);
    const takerEmp = getEmp(swap.taker_id);
    const sh = SHIFT_BY_ID[swap.shift];
    const tSh = SHIFT_BY_ID[swap.target_shift];

    allMgrs.forEach((adminEmp) => {
      let shiftLabel = "";
      let tDateStr = fmtDate(swap.date);

      if (swap.target_date) {
        shiftLabel = "החלפה הדדית בין " + giverEmp?.name + " ל-" + takerEmp?.name;
        tDateStr =
          fmtDate(swap.date) +
          " (" +
          sh?.label +
          ") ⇆ " +
          fmtDate(swap.target_date) +
          " (" +
          tSh?.label +
          ")";
      } else {
        shiftLabel = sh?.label + " — מסירה מ-" + giverEmp?.name + " ל-" + takerEmp?.name;
      }

      let emailTitle = swap.target_date ? "🔄 בקשת החלפה הדדית" : "📤 בקשת מסירת משמרת";
      sendEmail("swap_request", adminEmp.email, {
        title: emailTitle, // <--- הוספנו כותרת
        requesterName: "הודעת מערכת",
        targetDate: tDateStr,
        shiftLabel: shiftLabel,
        note: swap.note || "",
      });
    });
    toast("אישרת את הבקשה! הועבר לאישור מנהל ✓");
  } else {
    toast("דחית את הבקשה");
  }

  await loadSwapRequests();
  render();
  silentRefresh();
}

// Cache for schedule data loaded for swap weeks (other than current)

export async function loadScheduleForSwapWeek(weekOffset) {
  const wd = getWeekDates(weekOffset);
  const weekStart = wd[0];

  // If it's the current week being viewed in schedule, just use S.schedule
  if (weekOffset === S.weekOffset) {
    return S.schedule;
  }

  // Check cache
  if (_swapWeekCache[weekStart]) {
    return _swapWeekCache[weekStart];
  }

  // Load from DB
  try {
    const { data: sched } = await sb
      .from("schedules")
      .select("id")
      .eq("business_id", S.profile.business_id)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (!sched) {
      _swapWeekCache[weekStart] = {};
      return {};
    }

    const { data: assigns } = await sb.from("assignments").select("*").eq("schedule_id", sched.id);

    const result = {};
    (assigns || []).forEach((a) => {
      if (!result[a.date]) result[a.date] = {};
      if (!result[a.date][a.shift]) result[a.date][a.shift] = [];
      result[a.date][a.shift].push(a.employee_id);
    });

    _swapWeekCache[weekStart] = result;
    return result;
  } catch (err) {
    console.warn("Could not load swap week:", err);
    return {};
  }
}

export function viewSwaps(forceEmployee) {
  const wrap = e("div");
  wrap.appendChild(div("page-title", ["🔄 חילופים והצטרפות"], { style: "margin-bottom:16px" }));

  const todayStr = today();
  if (!S.swaps) S.swaps = [];

  const myEmpId = getActiveEmpId();

  // ══ מנהל: טאבים — שלי / אישור בקשות ══
  if (isManager() && !forceEmployee) {
    if (!S.mgrSwapsTab) S.mgrSwapsTab = "approve";
    const swapTabRow = e("div", { style: "display:flex;gap:6px;margin-bottom:14px" });
    [
      { id: "mine", label: "🔄 החילופים שלי" },
      { id: "approve", label: "👥 אישור בקשות" },
    ].forEach((t) => {
      const isActive = S.mgrSwapsTab === t.id;
      swapTabRow.appendChild(
        e(
          "button",
          {
            style:
              "flex:1;padding:10px;border-radius:10px;border:1px solid " +
              (isActive ? "#3B82F6" : "#334155") +
              ";background:" +
              (isActive ? "#3B82F622" : "#1E293B") +
              ";color:" +
              (isActive ? "#60A5FA" : "#64748B") +
              ";font-family:inherit;font-weight:700;font-size:13px",
            onclick: () => {
              S.mgrSwapsTab = t.id;
              render();
            },
          },
          t.label
        )
      );
    });
    wrap.appendChild(swapTabRow);

    // Manager's personal swaps tab
    if (S.mgrSwapsTab === "mine") {
      // Render the employee swap view for the manager
      const mgrSwapContent = viewSwaps(true);
      // Copy children from the returned element
      while (mgrSwapContent.firstChild) {
        // Skip the title (already have it)
        const child = mgrSwapContent.firstChild;
        mgrSwapContent.removeChild(child);
        if (child.classList?.contains("page-title")) continue;
        wrap.appendChild(child);
      }
      return wrap;
    }

    // Approval tab (existing code continues)
    const pending = S.swaps.filter(
      (s) =>
        (s.status === "pending_manager" || s.status === "pending_approval") &&
        (getEmp(s.taker_id) || getEmp(s.giver_id))
    );

    if (pending.length === 0) {
      wrap.appendChild(
        div("card", [
          e(
            "div",
            { style: "text-align:center;padding:30px;color:#64748B" },
            "אין בקשות ממתינות לאישור"
          ),
        ])
      );
    } else {
      const mCard = div("card", [
        e(
          "div",
          { style: "font-weight:800;font-size:14px;color:#F59E0B;margin-bottom:14px" },
          "⏳ ממתינות לאישורך (" + pending.length + ")"
        ),
      ]);

      pending.forEach((s) => {
        const giver = getEmp(s.giver_id);
        const taker = getEmp(s.taker_id);
        const giverShift = SHIFT_BY_ID[s.shift];
        const takerShift = SHIFT_BY_ID[s.target_shift];
        const isSwap = !!s.target_date;
        const isJoin = !s.giver_id;

        mCard.appendChild(
          e(
            "div",
            {
              style:
                "background:#0F172A;border:1px solid #334155;border-radius:14px;padding:14px;margin-bottom:10px",
            },
            [
              e(
                "div",
                { style: "font-weight:800;font-size:14px;color:#E2E8F0;margin-bottom:10px" },
                isJoin
                  ? "➕ " + (taker?.name || "?") + " מבקש להצטרף למשמרת"
                  : isSwap
                    ? "🔄 החלפה הדדית"
                    : "📤 מסירת משמרת"
              ),
              isSwap
                ? e(
                    "div",
                    {
                      style:
                        "display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:12px",
                    },
                    [
                      e(
                        "div",
                        {
                          style:
                            "background:" +
                            (giverShift?.color || "#3B82F6") +
                            "18;border:1px solid " +
                            (giverShift?.color || "#3B82F6") +
                            "44;border-radius:10px;padding:10px;text-align:center",
                        },
                        [
                          e(
                            "div",
                            { style: "font-size:11px;color:#64748B;margin-bottom:2px" },
                            "מוסר"
                          ),
                          e(
                            "div",
                            {
                              style:
                                "font-weight:800;font-size:13px;color:" +
                                (giverShift?.color || "#E2E8F0"),
                            },
                            giver?.name || "?"
                          ),
                          e("div", { style: "font-size:11px;color:#94A3B8" }, fmtDate(s.date)),
                          e(
                            "div",
                            {
                              style:
                                "font-size:11px;font-weight:700;color:" +
                                (giverShift?.color || "#E2E8F0"),
                            },
                            giverShift?.label || s.shift
                          ),
                        ]
                      ),
                      e("div", { style: "font-size:20px;text-align:center" }, "⇆"),
                      e(
                        "div",
                        {
                          style:
                            "background:" +
                            (takerShift?.color || "#3B82F6") +
                            "18;border:1px solid " +
                            (takerShift?.color || "#3B82F6") +
                            "44;border-radius:10px;padding:10px;text-align:center",
                        },
                        [
                          e(
                            "div",
                            { style: "font-size:11px;color:#64748B;margin-bottom:2px" },
                            "מקבל"
                          ),
                          e(
                            "div",
                            {
                              style:
                                "font-weight:800;font-size:13px;color:" +
                                (takerShift?.color || "#E2E8F0"),
                            },
                            taker?.name || "?"
                          ),
                          e(
                            "div",
                            { style: "font-size:11px;color:#94A3B8" },
                            fmtDate(s.target_date)
                          ),
                          e(
                            "div",
                            {
                              style:
                                "font-size:11px;font-weight:700;color:" +
                                (takerShift?.color || "#E2E8F0"),
                            },
                            takerShift?.label || s.target_shift
                          ),
                        ]
                      ),
                    ]
                  )
                : e(
                    "div",
                    {
                      style:
                        "background:" +
                        (giverShift?.color || "#3B82F6") +
                        "18;border:1px solid " +
                        (giverShift?.color || "#3B82F6") +
                        "44;border-radius:10px;padding:10px;margin-bottom:12px;display:flex;gap:10px;align-items:center",
                    },
                    [
                      e("div", { style: "flex:1" }, [
                        e(
                          "div",
                          { style: "font-size:12px;color:#64748B" },
                          isJoin ? "מצטרף" : "מוסר"
                        ),
                        e(
                          "div",
                          { style: "font-weight:800;font-size:14px" },
                          isJoin ? taker?.name : giver?.name
                        ),
                        !isJoin
                          ? e(
                              "div",
                              { style: "font-size:12px;color:#94A3B8" },
                              "← מועבר אל " + (taker?.name || "?")
                            )
                          : null,
                      ]),
                      e("div", { style: "text-align:left" }, [
                        e("div", { style: "font-size:12px;color:#94A3B8" }, fmtDate(s.date)),
                        e(
                          "div",
                          {
                            style:
                              "font-weight:700;font-size:13px;color:" +
                              (giverShift?.color || "#3B82F6"),
                          },
                          giverShift?.label || s.shift
                        ),
                      ]),
                    ]
                  ),
              s.note
                ? e(
                    "div",
                    { style: "font-size:12px;color:#64748B;font-style:italic;margin-bottom:10px" },
                    '"' + s.note + '"'
                  )
                : null,
              div("form-actions", [
                btn("btn-green", "✓ אשר בסידור", () => processManagerDecision(s, true), {
                  style: "flex:1",
                }),
                btn(
                  "btn-sm btn-sm-red",
                  "✗ דחה",
                  async () => {
                    const reason = await uiPrompt({
                      title: "סיבת דחייה",
                      message: "סיבת הדחייה (אופציונלי, ישלח לעובד)",
                      placeholder: "למשל: אין מספיק כיסוי",
                    });
                    if (reason === null) return;
                    processManagerDecision(s, false, reason);
                  },
                  { style: "flex:1" }
                ),
              ]),
            ]
          )
        );
      });
      wrap.appendChild(mCard);
    }

    const done = S.swaps
      .filter(
        (s) =>
          (s.status === "approved" || s.status === "rejected") &&
          (getEmp(s.taker_id) || getEmp(s.giver_id))
      )
      .slice(0, 5);
    if (done.length > 0) {
      const hCard = div("card", [
        e(
          "div",
          { style: "font-weight:700;font-size:13px;color:#64748B;margin-bottom:10px" },
          "היסטוריה אחרונה"
        ),
      ]);
      done.forEach((s) => {
        const giver = getEmp(s.giver_id);
        const taker = getEmp(s.taker_id);
        const isApp = s.status === "approved";
        hCard.appendChild(
          e(
            "div",
            {
              style:
                "display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #0F172A",
            },
            [
              e(
                "div",
                { style: "font-size:12px;color:#94A3B8" },
                (taker?.name || "?") +
                  " · " +
                  fmtDate(s.date) +
                  " · " +
                  (SHIFT_BY_ID[s.shift]?.label || s.shift)
              ),
              e(
                "span",
                { class: "status-badge status-" + (isApp ? "approved" : "rejected") },
                isApp ? "אושר" : "נדחה"
              ),
            ]
          )
        );
      });
      wrap.appendChild(hCard);
    }
    return wrap;
  }

  // ══ עובד: בקשות הממתינות לאישור שלי (Peer) ══
  const incomingReqs = S.swaps.filter(
    (s) => s.status === "pending_peer" && s.taker_id === myEmpId && getEmp(s.giver_id)
  );
  if (incomingReqs.length > 0) {
    const incCard = div(
      "card",
      [
        e("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:14px" }, [
          e("span", { style: "font-size:20px" }, "📥"),
          e(
            "div",
            { style: "font-weight:800;font-size:15px;color:#60A5FA" },
            "בקשות שממתינות לאישורך (" + incomingReqs.length + ")"
          ),
        ]),
      ],
      { style: "border:1px solid #3B82F644;background:#1E3A5F22" }
    );

    incomingReqs.forEach((s) => {
      const giver = getEmp(s.giver_id);
      const giverShift = SHIFT_BY_ID[s.shift];
      const takerShift = SHIFT_BY_ID[s.target_shift];
      const isSwap = !!s.target_date;

      incCard.appendChild(
        e(
          "div",
          {
            style:
              "background:#0F172A;border:1px solid #334155;border-radius:12px;padding:12px;margin-bottom:10px",
          },
          [
            e(
              "div",
              { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
              isSwap
                ? (giver?.name || "?") + " מציע החלפה הדדית:"
                : (giver?.name || "?") + " רוצה למסור לך משמרת:"
            ),
            e("div", { style: "font-size:12px;color:#94A3B8;margin-bottom:10px" }, [
              e(
                "div",
                {},
                "📅 המשמרת שתקבל: " + fmtDate(s.date) + " — " + (giverShift?.label || "?")
              ),
              isSwap
                ? e(
                    "div",
                    { style: "margin-top:4px" },
                    "📅 המשמרת שתיתן: " +
                      fmtDate(s.target_date) +
                      " — " +
                      (takerShift?.label || "?")
                  )
                : null,
            ]),
            div("form-actions", [
              btn("btn-green", "✓ אשר (העבר למנהל)", () => processPeerDecision(s, true), {
                style: "flex:1",
              }),
              btn("btn-sm btn-sm-red", "✗ דחה", () => processPeerDecision(s, false), {
                style: "flex:1",
              }),
            ]),
          ]
        )
      );
    });
    wrap.appendChild(incCard);
  }

  // ══ עובד: הגשת בקשות ══
  if (!S.empSwapTab) S.empSwapTab = "swap";
  if (S.swapWeekOffset == null) S.swapWeekOffset = 0;

  // Week navigator
  const swapWd = getWeekDates(S.swapWeekOffset);
  const navRow = e("div", {
    style:
      "display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px 14px",
  });
  navRow.appendChild(
    btn("btn-sm btn-sm-gray", "→", () => {
      S.swapWeekOffset--;
      render();
    })
  );
  navRow.appendChild(
    e("div", { style: "flex:1;text-align:center" }, [
      e(
        "div",
        { style: "font-size:13px;font-weight:700;color:#E2E8F0" },
        S.swapWeekOffset === 0
          ? "השבוע"
          : S.swapWeekOffset === 1
            ? "שבוע הבא"
            : "עוד " + S.swapWeekOffset + " שבועות"
      ),
      e(
        "div",
        { style: "font-size:11px;color:#64748B;margin-top:2px" },
        fmtDate(swapWd[0]) + " — " + fmtDate(swapWd[6])
      ),
    ])
  );
  navRow.appendChild(
    btn("btn-sm btn-sm-blue", "היום", () => {
      S.swapWeekOffset = 0;
      render();
    })
  );
  navRow.appendChild(
    btn("btn-sm btn-sm-gray", "←", () => {
      S.swapWeekOffset++;
      render();
    })
  );
  wrap.appendChild(navRow);

  // Trigger loading of schedule data for the selected swap week (if different from current)
  const swapTargetWeek = swapWd[0];
  if (S.swapWeekOffset !== S.weekOffset && !_swapWeekCache[swapTargetWeek]) {
    loadScheduleForSwapWeek(S.swapWeekOffset).then(() => render());
    // Show loading state
    wrap.appendChild(skeletonSchedule());
    return wrap;
  }

  const tabs = div("", [], { style: "display:flex;gap:6px;margin-bottom:14px" });
  [
    { id: "swap", label: "🔄 החלפה" },
    { id: "handover", label: "📤 מסירה" },
    { id: "join", label: "➕ הצטרפות" },
  ].forEach((t) => {
    const isActive = S.empSwapTab === t.id;
    tabs.appendChild(
      e(
        "button",
        {
          style:
            "flex:1;padding:10px;border-radius:10px;border:1px solid " +
            (isActive ? "#3B82F6" : "#334155") +
            ";background:" +
            (isActive ? "#3B82F622" : "#1E293B") +
            ";color:" +
            (isActive ? "#60A5FA" : "#64748B") +
            ";font-family:inherit;font-weight:700;font-size:13px",
          onclick: () => {
            S.empSwapTab = t.id;
            render();
          },
        },
        t.label
      )
    );
  });
  wrap.appendChild(tabs);

  // Date range for filtering shifts to this week only (and future)
  const swapWeekStart = swapWd[0];
  const swapWeekEnd = swapWd[6];
  const minDate = todayStr > swapWeekStart ? todayStr : swapWeekStart;
  const inSwapWeek = (d) => d >= minDate && d <= swapWeekEnd;

  // Use the correct schedule data — either current S.schedule or cached for other weeks
  const swapSched =
    S.swapWeekOffset === S.weekOffset ? S.schedule : _swapWeekCache[swapWeekStart] || {};

  // ── החלפה הדדית ──
  if (S.empSwapTab === "swap") {
    const card = div("card", [e("div", { class: "card-title" }, "🔄 בקשת החלפה הדדית")]);
    card.appendChild(
      e(
        "div",
        { style: "font-size:13px;color:#64748B;margin-bottom:14px" },
        "בחר את המשמרת שתרצה לתת, ואת המשמרת שתרצה לקבל."
      )
    );

    const myFutureShifts = [];
    Object.keys(swapSched)
      .filter((d) => inSwapWeek(d))
      .sort()
      .forEach((date) => {
        const mfDt = new Date(date + "T00:00:00");
        const mfIsWeekend = mfDt.getDay() === 5 || mfDt.getDay() === 6;
        SHIFTS.filter(
          (sh) => !(mfIsWeekend && (sh.id === "afternoon" || sh.id === "morning2"))
        ).forEach((sh) => {
          if ((swapSched[date]?.[sh.id] || []).includes(myEmpId)) {
            myFutureShifts.push({ date, shift: sh });
          }
        });
      });

    if (myFutureShifts.length === 0) {
      card.appendChild(
        e(
          "div",
          { style: "text-align:center;padding:20px;color:#64748B;font-size:13px" },
          "אין לך משמרות בשבוע זה."
        )
      );
      wrap.appendChild(card);
    } else {
      card.appendChild(
        e(
          "div",
          { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
          "1️⃣ איזו משמרת שלך תרצה לתת?"
        )
      );
      const myGrid = e("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px" });
      myFutureShifts.forEach(({ date, shift }) => {
        const key = date + "|" + shift.id;
        const sel = S.swapMyShift === key;
        myGrid.appendChild(
          e(
            "button",
            {
              style:
                "padding:8px 12px;border-radius:10px;border:1px solid " +
                (sel ? shift.color : shift.color + "44") +
                ";background:" +
                (sel ? shift.color + "33" : "#0F172A") +
                ";color:" +
                (sel ? shift.color : "#94A3B8") +
                ";font-family:inherit;font-size:12px;font-weight:700",
              onclick: () => {
                S.swapMyShift = sel ? null : key;
                S.swapTargetShift = null;
                render();
              },
            },
            [
              e(
                "div",
                {},
                DAYS[new Date(date + "T00:00:00").getDay()] +
                  " " +
                  new Date(date + "T00:00:00").getDate()
              ),
              e("div", { style: "font-size:10px;opacity:0.8" }, shift.label),
            ]
          )
        );
      });
      card.appendChild(myGrid);

      if (S.swapMyShift) {
        card.appendChild(
          e(
            "div",
            { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
            "2️⃣ איזו משמרת תרצה לקבל?"
          )
        );
        const otherShifts = [];
        Object.keys(swapSched)
          .filter((d) => inSwapWeek(d))
          .sort()
          .forEach((date) => {
            SHIFTS.forEach((sh) => {
              const empIds = swapSched[date]?.[sh.id] || [];
              empIds.forEach((empId) => {
                if (empId !== myEmpId) {
                  const [myDate, myShiftId] = S.swapMyShift.split("|");
                  if (checkShiftConflict(date, sh.id, myEmpId, myDate, myShiftId)) return;
                  if (checkShiftConflict(myDate, myShiftId, empId, date, sh.id)) return;
                  otherShifts.push({ date, shift: sh, empId });
                }
              });
            });
          });

        if (otherShifts.length === 0) {
          card.appendChild(
            e(
              "div",
              { style: "color:#64748B;font-size:13px;padding:10px 0" },
              "אין משמרות פנויות להחלפה ללא התנגשויות."
            )
          );
        } else {
          const targetGrid = e("div", {
            style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px",
          });
          otherShifts.forEach(({ date, shift, empId }) => {
            const key = date + "|" + shift.id + "|" + empId;
            const sel = S.swapTargetShift === key;
            const emp = getEmp(empId);
            const col = ec(empIdx(empId));
            targetGrid.appendChild(
              e(
                "button",
                {
                  style:
                    "padding:8px 12px;border-radius:10px;border:1px solid " +
                    (sel ? col : col + "44") +
                    ";background:" +
                    (sel ? col + "33" : "#0F172A") +
                    ";color:" +
                    (sel ? col : "#94A3B8") +
                    ";font-family:inherit;font-size:12px;font-weight:700",
                  onclick: () => {
                    S.swapTargetShift = sel ? null : key;
                    render();
                  },
                },
                [
                  e(
                    "div",
                    { style: "font-size:10px;color:" + col },
                    emp?.name.split(" ")[0] || "?"
                  ),
                  e(
                    "div",
                    {},
                    DAYS[new Date(date + "T00:00:00").getDay()] +
                      " " +
                      new Date(date + "T00:00:00").getDate()
                  ),
                  e("div", { style: "font-size:10px;opacity:0.8" }, shift.label),
                ]
              )
            );
          });
          card.appendChild(targetGrid);
        }
      }

      if (S.swapMyShift && S.swapTargetShift) {
        const noteInp = e("input", {
          class: "fi",
          placeholder: "הערה לבקשה (אופציונלי)",
          style: "margin-bottom:12px",
        });
        card.appendChild(noteInp);
        card.appendChild(
          btn(
            "btn-add",
            "📤 שלח בקשה לעובד השני",
            async () => {
              if (!S.swapMyShift || !S.swapTargetShift) return; // הגנה
              const [myDate, myShiftId] = S.swapMyShift.split("|");
              const [tDate, tShiftId, tEmpId] = S.swapTargetShift.split("|");

              const { error } = await sb.from("swaps").insert([
                {
                  business_id: S.profile.business_id,
                  giver_id: myEmpId,
                  taker_id: tEmpId,
                  date: myDate,
                  shift: myShiftId,
                  target_date: tDate,
                  target_shift: tShiftId,
                  note: noteInp.value || null,
                  status: "pending_peer",
                },
              ]);

              if (error) {
                toast(friendlyError(error), "err");
                return;
              }
              S.swapMyShift = null;
              S.swapTargetShift = null;
              invalidateSwapCache();
              await loadSwapRequests();

              const takerEmp = getEmp(tEmpId);
              if (takerEmp?.email) {
                const viewingEmp = getActiveProfile();
                sendEmail("swap_request", takerEmp.email, {
                  title: "🔄 בקשת החלפה הדדית",
                  requesterName: viewingEmp?.name || "עובד",
                  targetDate: "החלפה: " + fmtDate(myDate) + " ⇆ " + fmtDate(tDate),
                  shiftLabel: "יש לך בקשה הממתינה לאישור באפליקציה",
                  note: noteInp.value || "",
                });
              }
              toast("הבקשה נשלחה לעובד ✓");
              render();
            },
            { style: "width:100%" }
          )
        );
      }
      wrap.appendChild(card);
    }
  }

  // ── מסירת משמרת ──
  if (S.empSwapTab === "handover") {
    const card = div("card", [e("div", { class: "card-title" }, "📤 מסירת משמרת")]);
    card.appendChild(
      e(
        "div",
        { style: "font-size:13px;color:#64748B;margin-bottom:14px" },
        "בחר משמרת למסירה, ואז בחר עובד. הבקשה תעבור לאישורו ואז למנהל."
      )
    );

    const myHandoverShifts = [];
    Object.keys(swapSched)
      .filter((d) => inSwapWeek(d))
      .sort()
      .forEach((date) => {
        const hoDt = new Date(date + "T00:00:00");
        const hoIsWeekend = hoDt.getDay() === 5 || hoDt.getDay() === 6;
        SHIFTS.filter(
          (sh) => !(hoIsWeekend && (sh.id === "afternoon" || sh.id === "morning2"))
        ).forEach((sh) => {
          if ((swapSched[date]?.[sh.id] || []).includes(myEmpId)) {
            myHandoverShifts.push({ date, shift: sh });
          }
        });
      });

    if (myHandoverShifts.length === 0) {
      card.appendChild(
        e(
          "div",
          { style: "text-align:center;padding:20px;color:#64748B" },
          "אין לך משמרות בשבוע זה למסירה"
        )
      );
    } else {
      card.appendChild(
        e(
          "div",
          { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
          "1️⃣ איזו משמרת למסור?"
        )
      );
      const myGrid = e("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px" });
      myHandoverShifts.forEach(({ date, shift }) => {
        const key = date + "|" + shift.id;
        const sel = S.handoverShift === key;
        const dt = new Date(date + "T00:00:00");
        myGrid.appendChild(
          e(
            "button",
            {
              style:
                "padding:8px 12px;border-radius:10px;border:1px solid " +
                (sel ? shift.color : shift.color + "44") +
                ";background:" +
                (sel ? shift.color + "33" : "#0F172A") +
                ";color:" +
                (sel ? shift.color : "#94A3B8") +
                ";font-family:inherit;font-size:12px;font-weight:700",
              onclick: () => {
                S.handoverShift = sel ? null : key;
                S.handoverTarget = null;
                render();
              },
            },
            [
              e("div", {}, DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1)),
              e("div", { style: "font-size:10px;opacity:0.8" }, shift.label),
            ]
          )
        );
      });
      card.appendChild(myGrid);

      if (S.handoverShift) {
        const [hDate, hShiftId] = S.handoverShift.split("|");
        card.appendChild(
          e(
            "div",
            { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
            "2️⃣ למי למסור? (רק למי שפנוי)"
          )
        );

        const eligible = schedulableEmployees().filter((emp) => {
          if (emp.id === myEmpId) return false;
          return !checkShiftConflict(hDate, hShiftId, emp.id);
        });

        if (eligible.length === 0) {
          card.appendChild(
            e(
              "div",
              { style: "color:#64748B;font-size:13px;padding:10px 0" },
              "אין עובדים פנויים לקחת את המשמרת הזו"
            )
          );
        } else {
          const empGrid = e("div", {
            style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px",
          });
          eligible.forEach((emp) => {
            const col = ec(empIdx(emp.id));
            const sel = S.handoverTarget === emp.id;
            empGrid.appendChild(
              e(
                "button",
                {
                  style:
                    "padding:8px 14px;border-radius:10px;border:1px solid " +
                    (sel ? col : col + "44") +
                    ";background:" +
                    (sel ? col + "33" : "#0F172A") +
                    ";color:" +
                    (sel ? col : "#94A3B8") +
                    ";font-family:inherit;font-size:13px;font-weight:700",
                  onclick: () => {
                    S.handoverTarget = sel ? null : emp.id;
                    render();
                  },
                },
                emp.name
              )
            );
          });
          card.appendChild(empGrid);
        }
      }

      if (S.handoverShift && S.handoverTarget) {
        const noteInp2 = e("input", {
          class: "fi",
          placeholder: "הערה (אופציונלי)",
          style: "margin-bottom:12px",
        });
        card.appendChild(noteInp2);
        card.appendChild(
          btn(
            "btn-add",
            "📤 שלח לאישור העובד",
            async () => {
              if (!S.handoverShift || !S.handoverTarget) return; // הגנה
              const [hDate, hShiftId] = S.handoverShift.split("|");
              const { error } = await sb.from("swaps").insert([
                {
                  business_id: S.profile.business_id,
                  giver_id: myEmpId,
                  taker_id: S.handoverTarget,
                  date: hDate,
                  shift: hShiftId,
                  note: noteInp2.value || null,
                  status: "pending_peer",
                },
              ]);
              if (error) {
                toast(friendlyError(error), "err");
                return;
              }

              const takerEmp = getEmp(S.handoverTarget);
              if (takerEmp?.email) {
                const viewingEmp = getActiveProfile();
                sendEmail("swap_request", takerEmp.email, {
                  title: "📤 בקשת מסירת משמרת",
                  requesterName: viewingEmp?.name || "עובד",
                  targetDate: fmtDate(hDate),
                  shiftLabel: "ממתין לאישורך באפליקציה",
                  note: noteInp2.value || "",
                });
              }
              S.handoverShift = null;
              S.handoverTarget = null;
              await loadSwapRequests();
              toast("הבקשה נשלחה לעובד ✓");
              render();
            },
            { style: "width:100%" }
          )
        );
      }
    }
    wrap.appendChild(card);
  }

  // ── הצטרפות למשמרת (ישירות למנהל) ──
  if (S.empSwapTab === "join") {
    const card = div("card", [e("div", { class: "card-title" }, "➕ הצטרפות למשמרת")]);
    card.appendChild(
      e(
        "div",
        { style: "font-size:13px;color:#64748B;margin-bottom:14px" },
        "כל המשמרות שאתה לא משובץ אליהן — לחץ על אחת כדי לבקש להצטרף."
      )
    );

    const availableShifts = [];
    Object.keys(S.schedule)
      .filter((d) => inSwapWeek(d))
      .sort()
      .forEach((date) => {
        const joinDt = new Date(date + "T00:00:00");
        const joinIsWeekend = joinDt.getDay() === 5 || joinDt.getDay() === 6;
        SHIFTS.filter(
          (sh) => !(joinIsWeekend && (sh.id === "afternoon" || sh.id === "morning2"))
        ).forEach((sh) => {
          const empIds = S.schedule[date]?.[sh.id] || [];
          if (!empIds.includes(myEmpId)) {
            if (checkShiftConflict(date, sh.id, myEmpId)) return;
            availableShifts.push({ date, shift: sh, empIds });
          }
        });
      });

    if (availableShifts.length === 0) {
      card.appendChild(
        e(
          "div",
          { style: "text-align:center;padding:30px;color:#64748B" },
          "אין משמרות זמינות להצטרפות בשבוע זה."
        )
      );
    } else {
      availableShifts.forEach(({ date, shift, empIds }) => {
        const dt = new Date(date + "T00:00:00");
        card.appendChild(
          e(
            "div",
            {
              style:
                "background:#0F172A;border:1px solid " +
                shift.color +
                "33;border-radius:12px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center",
            },
            [
              e("div", {}, [
                e(
                  "div",
                  { style: "font-weight:800;font-size:14px;color:" + shift.color },
                  DAYS[dt.getDay()] + " " + dt.getDate() + " — " + shift.label
                ),
                e(
                  "div",
                  { style: "font-size:11px;color:#64748B;margin-top:3px" },
                  empIds.length > 0
                    ? "משובצים: " +
                        empIds.map((id) => getEmp(id)?.name.split(" ")[0] || "?").join(", ")
                    : "אין משובצים"
                ),
              ]),
              btn("btn-sm btn-sm-blue", "+ הצטרף", async () => {
                const conflict = checkShiftConflict(date, shift.id, myEmpId);
                if (conflict) {
                  toast(conflict, "err");
                  return;
                }

                const { error } = await sb.from("swaps").insert([
                  {
                    business_id: S.profile.business_id,
                    taker_id: myEmpId,
                    giver_id: null,
                    date,
                    shift: shift.id,
                    status: "pending_manager",
                  },
                ]);
                if (error) {
                  toast(friendlyError(error), "err");
                  return;
                }
                await loadSwapRequests();
                getNotifiedManagers().forEach((adminEmp2) => {
                  const viewingEmp = getActiveProfile();
                  sendEmail("swap_request", adminEmp2.email, {
                    title: "➕ בקשת הצטרפות למשמרת",
                    requesterName: viewingEmp?.name || "עובד",
                    targetDate: fmtDate(date),
                    shiftLabel: shift.label + " (" + shift.start + "–" + shift.end + ")",
                    note: "",
                  });
                });
                toast("הבקשה נשלחה למנהל ✓");
                render();
              }),
            ]
          )
        );
      });
    }
    wrap.appendChild(card);
  }

  // ── סטטוס הבקשות שהגשתי ──
  const myReqs = S.swaps.filter((s) => s.giver_id === myEmpId || s.taker_id === myEmpId);
  if (myReqs.length > 0) {
    const sCard = div("card", [
      e(
        "div",
        { style: "font-weight:700;font-size:13px;color:#64748B;margin-bottom:10px" },
        "⏳ הבקשות שלי"
      ),
    ]);
    myReqs.slice(0, 10).forEach((s) => {
      const sh = SHIFT_BY_ID[s.shift];

      let badgeClass = "pending";
      let badgeText = "ממתין";
      if (s.status === "approved") {
        badgeClass = "approved";
        badgeText = "אושר";
      } else if (s.status === "rejected") {
        badgeClass = "rejected";
        badgeText = "נדחה";
      } else if (s.status === "pending_peer") {
        badgeClass = "pending";
        badgeText = "ממתין לעובד";
      } else if (s.status === "pending_manager") {
        badgeClass = "pending";
        badgeText = "ממתין למנהל";
      }

      sCard.appendChild(
        e(
          "div",
          {
            style:
              "display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #0F172A",
          },
          [
            e(
              "div",
              { style: "font-size:12px;color:#94A3B8" },
              fmtDate(s.date) + " · " + (sh?.label || s.shift)
            ),
            e("span", { class: "status-badge status-" + badgeClass }, badgeText),
          ]
        )
      );
    });
    wrap.appendChild(sCard);
  }

  return wrap;
}

// ── SUPER ADMIN — cross-business management (platform level) ──
export const SA_FEATURE_LABELS = {
  qualifications: "🎯 כשירות והסמכות",
  chat: "💬 צ'אט משמרת",
  swaps: "🔄 חילופי משמרות",
  calendar_export: "📆 ייצוא ליומן",
  push_notifications: "🔔 התראות Push",
};

// ── EMPLOYEE VIEW ──
export function viewEmpView() {
  const wrap = e("div", { style: "width:100%" });
  const selfOnly = S.profile?.role === "employee" || S.testAsEmployee;

  // If employee, force self view
  if (selfOnly && !S.empViewId) S.empViewId = S.user.id;

  if (selfOnly) {
    // Employee sees only their own data — no picker
    wrap.appendChild(div("page-title", ["📋 המשמרות שלי"], { style: "margin-bottom:14px" }));
  } else {
    // Manager sees picker for all employees + test mode toggle
    wrap.appendChild(
      div(
        "section-header",
        [
          div("page-title", ["👤 תצוגת עובד"]),
          e("div", { style: "display:flex;align-items:center;gap:8px" }, [
            e("span", { style: "font-size:12px;color:#64748B" }, "מצב בדיקה:"),
            e(
              "button",
              {
                style: `padding:6px 14px;border-radius:8px;border:1px solid ${S.testAsEmployee ? "#10B981aa" : "#334155"};background:${S.testAsEmployee ? "#10B98122" : "#1E293B"};color:${S.testAsEmployee ? "#10B981" : "#64748B"};font-family:inherit;font-size:12px;font-weight:700`,
                onclick: () => {
                  S.testAsEmployee = !S.testAsEmployee;
                  if (S.testAsEmployee && !S.empViewId) S.empViewId = S.employees[0]?.id;
                  render();
                },
              },
              S.testAsEmployee ? "✅ פעיל — לחץ לביטול" : "הפעל"
            ),
          ]),
        ],
        { style: "margin-bottom:14px" }
      )
    );
    const picker = e("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px" });
    S.employees.forEach((emp, idx) => {
      const col = ec(idx);
      const sel = S.empViewId === emp.id;
      picker.appendChild(
        btn(
          "",
          emp.name.split(" ")[0],
          () => {
            S.empViewId = emp.id;
            S.empViewTab = "shifts";
            render();
          },
          {
            style: `padding:7px 14px;border-radius:10px;border:1px solid ${sel ? col + "cc" : col + "44"};background:${sel ? col + "33" : "#1E293B"};color:${sel ? col : "#94A3B8"};font-family:inherit;font-weight:${sel ? "700" : "500"};font-size:13px`,
          }
        )
      );
    });
    wrap.appendChild(picker);
  }

  const emp = S.employees.find((e) => e.id === S.empViewId);
  if (!emp) {
    wrap.appendChild(
      div("card", [
        e("div", { style: "text-align:center;padding:40px;color:#64748B" }, ["בחר עובד לצפייה"]),
      ])
    );
    return wrap;
  }

  const idx = empIdx(emp.id);
  const col = ec(idx);
  const wd = getWeekDates(S.weekOffset);
  const weekStart = wd[0];
  const isPublished = S.publishedWeeks.has(weekStart);

  // Emp card
  wrap.appendChild(
    e(
      "div",
      {
        style: `background:#1E293B;border:1px solid ${col}44;border-radius:16px;padding:18px;margin-bottom:14px`,
      },
      [
        e("div", { style: "display:flex;align-items:center;gap:14px" }, [
          e(
            "div",
            {
              style: `width:48px;height:48px;border-radius:14px;background:${col}22;border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:${col};flex-shrink:0`,
            },
            emp.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
          ),
          e("div", { style: "flex:1" }, [
            e("div", { style: "font-weight:800;font-size:17px;color:#E2E8F0" }, emp.name),
            e(
              "div",
              { style: "font-size:12px;color:#64748B;margin-top:2px" },
              emp.role === "admin" || emp.role === "manager" ? "מנהל" : "עובד"
            ),
            emp.email
              ? e(
                  "div",
                  { style: "font-size:11px;color:#475569;margin-top:2px" },
                  "✉️ " + emp.email
                )
              : null,
          ]),
        ]),
      ]
    )
  );

  // Test mode banner
  if (S.testAsEmployee) {
    wrap.appendChild(
      e(
        "div",
        {
          style:
            "background:#F59E0B18;border:1px solid #F59E0B44;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px",
        },
        [
          e("div", { style: "display:flex;align-items:center;gap:8px" }, [
            e("span", {}, "⚠️"),
            e(
              "span",
              { style: "font-size:13px;color:#FCD34D;font-weight:600" },
              "מצב בדיקה — רואה כמו עובד"
            ),
          ]),
          btn("btn-sm btn-sm-gray", "צא", () => {
            S.testAsEmployee = false;
            render();
          }),
        ]
      )
    );
  }

  // ═══ In-app deadline banner ═══
  // Replaces the "I'll check the email when I remember" problem. Shows an urgent
  // banner on the employee home screen when the blocks deadline is within 24 hours
  // AND this user hasn't submitted yet for the upcoming week.
  try {
    const dlDay = S.business?.deadline_day;
    const dlTime = S.business?.deadline_time || "20:00";
    if (dlDay != null && selfOnly) {
      // Deadline is business-local (Israel). Compare "now" and the upcoming
      // deadline in Israel's wall clock so an employee abroad sees the correct
      // countdown — the business's Thursday 20:00, not their device's.
      const now = israelNow();
      const [dlH, dlM] = dlTime.split(":").map(Number);
      const upcoming = israelNow();
      const daysUntil = (parseInt(dlDay) - now.getDay() + 7) % 7;
      upcoming.setDate(now.getDate() + daysUntil);
      upcoming.setHours(dlH || 0, dlM || 0, 0, 0);
      if (upcoming <= now) upcoming.setDate(upcoming.getDate() + 7);
      const hoursToDeadline = (upcoming - now) / 3600000;
      // Only show when deadline is within 24 hours
      if (hoursToDeadline > 0 && hoursToDeadline < 24) {
        // Target week = Sunday of the week after the deadline
        const targetSun = new Date(upcoming);
        targetSun.setDate(targetSun.getDate() + ((7 - upcoming.getDay()) % 7));
        if (upcoming.getDay() !== 0)
          targetSun.setDate(upcoming.getDate() + ((0 - upcoming.getDay() + 7) % 7 || 7));
        // Build the ISO string from Israel-local fields — .toISOString() would
        // reinterpret the Israel-wall-clock Date as UTC and can round to the
        // previous day for times near midnight, aiming at the wrong week.
        const targetSunStr =
          targetSun.getFullYear() +
          "-" +
          String(targetSun.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(targetSun.getDate()).padStart(2, "0");
        const hasSubmitted = (S.availSubmissions || []).some(
          (a) => a.employee_id === emp.id && a.week_start === targetSunStr
        );
        if (!hasSubmitted) {
          const hrsLeft = Math.floor(hoursToDeadline);
          const minsLeft = Math.floor((hoursToDeadline - hrsLeft) * 60);
          const urgency = hoursToDeadline < 3;
          wrap.appendChild(
            e(
              "div",
              {
                style: `background:${urgency ? "#EF444422" : "#F59E0B22"};border:1px solid ${urgency ? "#EF444466" : "#F59E0B66"};border-radius:12px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer`,
                onclick: () => {
                  S.empViewTab = "avail";
                  render();
                },
              },
              [
                e("div", { style: "display:flex;align-items:center;gap:10px;flex:1" }, [
                  e("span", { style: "font-size:24px" }, urgency ? "🚨" : "⏰"),
                  e("div", {}, [
                    e(
                      "div",
                      {
                        style: `font-weight:800;font-size:14px;color:${urgency ? "#FCA5A5" : "#FCD34D"}`,
                      },
                      urgency
                        ? "דחוף! עוד " + hrsLeft + "ש " + minsLeft + "ד"
                        : "דדליין חסימות עוד " + hrsLeft + " שעות"
                    ),
                    e(
                      "div",
                      { style: "font-size:12px;color:#94A3B8;margin-top:2px" },
                      "עדיין לא הגשת חסימות לשבוע הבא"
                    ),
                  ]),
                ]),
                e(
                  "span",
                  {
                    style:
                      "font-size:13px;color:" +
                      (urgency ? "#FCA5A5" : "#FCD34D") +
                      ";font-weight:700",
                  },
                  "הגש עכשיו ←"
                ),
              ]
            )
          );
        }
      }
    }
  } catch (_) {}

  // Tabs
  const tabs = [
    ["shifts", "📋 המשמרות שלי"],
    ["schedule", "📅 סידור"],
    ["mymonth", "📆 החודש שלי"],
    ["avail", "🚫 חסימה"],
    ["vacation", "🌴 היעדרויות"],
    ["swaps_emp", "🔄 חילופים"],
  ];
  wrap.appendChild(
    e(
      "div",
      { class: "emp-view-tabs" },
      tabs.map(([id, lbl]) =>
        btn("ev-tab" + (S.empViewTab === id ? " active" : ""), lbl, () => {
          S.empViewTab = id;
          render();
        })
      )
    )
  );

  if (S.empViewTab === "shifts") {
    // Preload the current + next week into S.schedule (merge, never overwrite other weeks)
    // so the "Next Shift" countdown card has access to the real upcoming shifts even when
    // the user navigates to a different week-offset. Runs once per tab-open, then caches.
    if (!S._nextShiftPreloaded || Date.now() - S._nextShiftPreloaded > 60000) {
      S._nextShiftPreloaded = Date.now();
      (async () => {
        try {
          const needDates = [getWeekDates(0)[0], getWeekDates(1)[0]];
          const { data: scheds } = await sb
            .from("schedules")
            .select("id,week_start")
            .eq("business_id", S.profile.business_id)
            .eq("published", true)
            .in("week_start", needDates);
          const schedIds = (scheds || []).map((s) => s.id);
          if (schedIds.length === 0) return;
          const { data: assigns } = await sb
            .from("assignments")
            .select("date,shift,employee_id,custom_start,custom_end")
            .in("schedule_id", schedIds)
            .eq("employee_id", emp.id);
          let changed = false;
          (assigns || []).forEach((a) => {
            if (!S.schedule[a.date]) S.schedule[a.date] = {};
            if (!S.schedule[a.date][a.shift]) S.schedule[a.date][a.shift] = [];
            if (!S.schedule[a.date][a.shift].includes(a.employee_id)) {
              S.schedule[a.date][a.shift].push(a.employee_id);
              changed = true;
            }
            if (a.custom_start && a.custom_end) {
              S.customHours[a.date + "|" + a.shift + "|" + a.employee_id] = {
                start: a.custom_start.slice(0, 5),
                end: a.custom_end.slice(0, 5),
              };
            }
          });
          if (changed) render();
        } catch (err) {
          console.warn("Next-shift preload failed:", err);
        }
      })();
    }

    // Hero greeting — with gradient accent bar (RTL)
    {
      const g = getTimeBasedGreeting();
      const firstName = (getActiveProfile()?.name || "").split(" ")[0];
      const dayLabel = new Date().toLocaleDateString("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      wrap.appendChild(
        e("div", { style: "position:relative;margin-bottom:24px;padding:4px 0" }, [
          e("div", {
            style:
              "position:absolute;top:6px;right:-22px;bottom:6px;width:4px;border-radius:4px;background:linear-gradient(180deg,#3B82F6 0%,#A855F7 50%,#EC4899 100%);box-shadow:0 0 16px rgba(99,102,241,0.5)",
          }),
          e(
            "div",
            {
              style:
                "font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px",
            },
            dayLabel
          ),
          e(
            "div",
            {
              style:
                "font-weight:900;font-size:32px;letter-spacing:-1.1px;line-height:1.1;background:linear-gradient(180deg,#F8FAFC 0%,#CBD5E1 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text",
            },
            g.text + ", " + firstName + " " + g.emoji
          ),
        ])
      );
    }

    // Per-employee calendar reminder preference. When the final schedule is published,
    // an .ics file is attached to the email; this picks whether/how early the device
    // alarm should fire before each shift. Saved to profiles.shift_reminder_minutes.
    {
      const myEmpForPref = typeof getActiveProfile === "function" ? getActiveProfile() : emp;
      if (myEmpForPref) {
        const currentMin = myEmpForPref.shift_reminder_minutes ?? null;
        const options = [
          { val: "", lbl: "ללא תזכורת" },
          { val: "15", lbl: "15 דק' לפני" },
          { val: "30", lbl: "30 דק' לפני" },
          { val: "60", lbl: "שעה לפני" },
          { val: "120", lbl: "שעתיים לפני" },
          { val: "1440", lbl: "יום לפני" },
        ];
        const sel = e("select", {
          class: "fi",
          style: "flex:1",
          onchange: async (ev) => {
            const v = ev.target.value;
            const newVal = v === "" ? null : parseInt(v);
            const { error } = await sb
              .from("profiles")
              .update({ shift_reminder_minutes: newVal })
              .eq("id", myEmpForPref.id);
            if (error) {
              toast(friendlyError(error), "err");
              return;
            }
            myEmpForPref.shift_reminder_minutes = newVal;
            const empInList = S.employees.find((e2) => e2.id === myEmpForPref.id);
            if (empInList) empInList.shift_reminder_minutes = newVal;
            toast("נשמר ✓");
            render();
          },
        });
        options.forEach((o) => {
          sel.appendChild(
            e(
              "option",
              { value: o.val, selected: String(currentMin ?? "") === o.val ? "selected" : null },
              o.lbl
            )
          );
        });
        wrap.appendChild(
          div("card", [
            e("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
              e("span", { style: "font-size:18px" }, "🔔"),
              e(
                "div",
                { style: "font-weight:700;font-size:14px;color:#E2E8F0" },
                "תזכורת ליומן לפני משמרת"
              ),
            ]),
            e(
              "div",
              { style: "font-size:11px;color:#64748B;margin-bottom:10px;line-height:1.5" },
              "כשסידור סופי מפורסם, מצורף למייל קובץ ליומן. הגדר אם תרצה להוסיף תזכורת אוטומטית לכל משמרת."
            ),
            e("div", { style: "display:flex;align-items:center;gap:10px" }, [sel]),
          ])
        );
      }
    }

    // Check if published for employee
    const weekStartMyShifts = wd[0];
    const isPublishedMyShifts =
      S.publishedWeeks.has(weekStartMyShifts) ||
      S.publishedInitial?.has(weekStartMyShifts) ||
      S.schedPublishType?.[weekStartMyShifts];
    const isRealEmp2 = S.profile?.role === "employee" || S.testAsEmployee;

    // My shifts this week
    const myShifts = [];
    if (!isRealEmp2 || isPublishedMyShifts) {
      wd.forEach((date) => {
        const dayShifts = getShiftsForDate(date);
        dayShifts.forEach((sh) => {
          if ((S.schedule[date]?.[sh.id] || []).includes(emp.id)) {
            const ch = S.customHours[date + "|" + sh.id + "|" + emp.id];
            myShifts.push({ date, shift: sh, ch });
          }
        });
      });
    }

    // ── "Next Shift" hero card — countdown to upcoming shift ──
    // IMPORTANT: look at ALL dates in S.schedule (every loaded week), not just the
    // currently-viewed week — so if the user navigates to a future week, they still
    // see the real next shift coming up (today/tomorrow), not a shift 4 days away.
    {
      const nowMs = Date.now();
      const upcomingAll = [];
      Object.keys(S.schedule || {}).forEach((dateStr) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
        const dayShifts = getShiftsForDate(dateStr);
        dayShifts.forEach((sh) => {
          if (!(S.schedule[dateStr]?.[sh.id] || []).includes(emp.id)) return;
          const ch = S.customHours[dateStr + "|" + sh.id + "|" + emp.id];
          const [sh1, sm1] = (ch?.start || sh.start).split(":").map(Number);
          const [eh1, em1] = (ch?.end || sh.end).split(":").map(Number);
          const dt = new Date(dateStr + "T00:00:00");
          const startMs = dt.getTime() + sh1 * 3600000 + sm1 * 60000;
          const startMin = sh1 * 60 + sm1;
          const endMin = eh1 * 60 + em1;
          let endMs = dt.getTime() + eh1 * 3600000 + em1 * 60000;
          if (endMin <= startMin) endMs += 86400000;
          upcomingAll.push({ date: dateStr, shift: sh, ch, startMs, endMs });
        });
      });
      const upcoming = upcomingAll
        .filter((s) => s.endMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs);

      const next = upcoming[0];
      if (next) {
        const isActive = nowMs >= next.startMs && nowMs < next.endMs;
        const minsUntil = Math.round((next.startMs - nowMs) / 60000);
        const minsLeft = Math.round((next.endMs - nowMs) / 60000);
        const hUntil = Math.floor(minsUntil / 60);
        const mUntil = minsUntil % 60;
        const hLeft = Math.floor(minsLeft / 60);
        const mLeft = minsLeft % 60;
        const dt = new Date(next.date + "T00:00:00");
        const dispStart = next.ch?.start || next.shift.start;
        const dispEnd = next.ch?.end || next.shift.end;

        // Hex → rgba helper
        const hex = next.shift.color.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const heroCard = e(
          "div",
          {
            style: `position:relative;background:linear-gradient(135deg,rgba(${r},${g},${b},0.18),rgba(${r},${g},${b},0.06));border:1px solid rgba(${r},${g},${b},0.35);border-radius:22px;padding:22px;margin-bottom:18px;overflow:hidden;box-shadow:0 20px 50px -20px rgba(${r},${g},${b},0.4),0 1px 0 rgba(255,255,255,0.08) inset`,
          },
          [
            // Decorative blob
            e("div", {
              style: `position:absolute;top:-80px;left:-80px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(${r},${g},${b},0.35) 0%,transparent 70%);pointer-events:none`,
            }),
            // Status label
            e(
              "div",
              {
                style:
                  "display:flex;align-items:center;gap:8px;margin-bottom:12px;position:relative",
              },
              [
                isActive
                  ? e(
                      "div",
                      {
                        style:
                          "display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(16,185,129,0.22);border:1px solid rgba(16,185,129,0.4);color:#34D399;font-size:11px;font-weight:800;letter-spacing:0.3px",
                      },
                      [
                        e("span", {
                          style:
                            "display:inline-block;width:6px;height:6px;border-radius:50%;background:#34D399;animation:todayPulse 1.8s ease-in-out infinite",
                        }),
                        "במשמרת כרגע",
                      ]
                    )
                  : e(
                      "div",
                      {
                        style: `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(${r},${g},${b},0.22);border:1px solid rgba(${r},${g},${b},0.4);color:${next.shift.color};font-size:11px;font-weight:800;letter-spacing:0.3px`,
                      },
                      "המשמרת הבאה"
                    ),
              ]
            ),
            // Day + shift name
            e(
              "div",
              {
                style:
                  "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;position:relative",
              },
              [
                e("div", {}, [
                  e(
                    "div",
                    { style: "font-size:13px;color:#94A3B8;font-weight:600;letter-spacing:-0.1px" },
                    DAYS[dt.getDay()] + " · " + dt.getDate() + "/" + (dt.getMonth() + 1)
                  ),
                  e(
                    "div",
                    {
                      style: `font-weight:900;font-size:28px;color:${next.shift.color};letter-spacing:-0.8px;line-height:1.1;margin-top:4px`,
                    },
                    next.shift.label
                  ),
                ]),
                e("div", { style: "text-align:center" }, [
                  e(
                    "div",
                    {
                      style: `font-weight:900;font-size:26px;color:#F8FAFC;letter-spacing:-0.5px;direction:ltr`,
                    },
                    dispStart + "–" + dispEnd
                  ),
                  e(
                    "div",
                    {
                      style:
                        "font-size:11px;color:#64748B;margin-top:2px;letter-spacing:0.3px;text-transform:uppercase",
                    },
                    "שעות"
                  ),
                ]),
              ]
            ),
            // Countdown
            e(
              "div",
              {
                style: `background:rgba(2,6,23,0.4);border:1px solid rgba(${r},${g},${b},0.2);border-radius:14px;padding:14px;display:flex;align-items:center;justify-content:space-between;position:relative`,
              },
              [
                e(
                  "div",
                  { style: "font-size:12px;color:#94A3B8;font-weight:600" },
                  isActive ? "⏱️ נשאר למשמרת" : "⏳ מתחיל בעוד"
                ),
                e(
                  "div",
                  {
                    style: `font-weight:900;font-size:22px;color:${next.shift.color};letter-spacing:-0.5px;direction:ltr`,
                  },
                  isActive
                    ? hLeft > 0
                      ? hLeft + ":" + String(mLeft).padStart(2, "0") + " שעות"
                      : mLeft + " דקות"
                    : minsUntil > 1440
                      ? Math.round(minsUntil / 1440) + " ימים"
                      : hUntil > 0
                        ? hUntil + ":" + String(mUntil).padStart(2, "0") + " שעות"
                        : mUntil + " דקות"
                ),
              ]
            ),
          ]
        );
        wrap.appendChild(heroCard);
      }
    }

    // ── Week summary mini-stats ──
    if (myShifts.length > 0) {
      const totalHours =
        myShifts.reduce((sum, s) => {
          const [sh1, sm1] = (s.ch?.start || s.shift.start).split(":").map(Number);
          const [eh1, em1] = (s.ch?.end || s.shift.end).split(":").map(Number);
          let dur = eh1 * 60 + em1 - (sh1 * 60 + sm1);
          if (dur <= 0) dur += 24 * 60;
          return sum + dur;
        }, 0) / 60;
      const byType = { morning: 0, morning2: 0, afternoon: 0, night: 0 };
      myShifts.forEach((s) => {
        if (byType[s.shift.id] !== undefined) byType[s.shift.id]++;
      });

      wrap.appendChild(
        e(
          "div",
          { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px" },
          [
            e(
              "div",
              {
                style:
                  "background:linear-gradient(180deg,rgba(59,130,246,0.14),rgba(59,130,246,0.04));border:1px solid rgba(59,130,246,0.25);border-radius:14px;padding:14px 10px;text-align:center",
              },
              [
                e(
                  "div",
                  {
                    style:
                      "font-size:26px;font-weight:900;color:#60A5FA;letter-spacing:-0.8px;line-height:1",
                  },
                  String(myShifts.length)
                ),
                e(
                  "div",
                  {
                    style:
                      "font-size:10px;color:#94A3B8;margin-top:6px;letter-spacing:0.3px;text-transform:uppercase;font-weight:600",
                  },
                  "משמרות השבוע"
                ),
              ]
            ),
            e(
              "div",
              {
                style:
                  "background:linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04));border:1px solid rgba(16,185,129,0.25);border-radius:14px;padding:14px 10px;text-align:center",
              },
              [
                e(
                  "div",
                  {
                    style:
                      "font-size:26px;font-weight:900;color:#34D399;letter-spacing:-0.8px;line-height:1",
                  },
                  String(Math.round(totalHours))
                ),
                e(
                  "div",
                  {
                    style:
                      "font-size:10px;color:#94A3B8;margin-top:6px;letter-spacing:0.3px;text-transform:uppercase;font-weight:600",
                  },
                  "שעות"
                ),
              ]
            ),
            e(
              "div",
              {
                style:
                  "background:linear-gradient(180deg,rgba(99,102,241,0.14),rgba(99,102,241,0.04));border:1px solid rgba(99,102,241,0.25);border-radius:14px;padding:14px 10px;text-align:center",
              },
              [
                e(
                  "div",
                  {
                    style:
                      "font-size:26px;font-weight:900;color:#A5B4FC;letter-spacing:-0.8px;line-height:1",
                  },
                  String(byType.night)
                ),
                e(
                  "div",
                  {
                    style:
                      "font-size:10px;color:#94A3B8;margin-top:6px;letter-spacing:0.3px;text-transform:uppercase;font-weight:600",
                  },
                  "לילות"
                ),
              ]
            ),
          ]
        )
      );
    }

    const card = div("card", [
      e(
        "div",
        {
          style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px",
        },
        [
          e(
            "div",
            { style: "font-weight:800;font-size:15px;color:#F1F5F9;letter-spacing:-0.2px" },
            "🗓️ השבוע"
          ),
          e(
            "div",
            { style: "font-size:11px;color:#64748B;font-weight:600" },
            fmtDate(wd[0]) + " — " + fmtDate(wd[6])
          ),
        ]
      ),
    ]);

    // Add-to-calendar button (only if there are shifts to add)
    if (myShifts.length > 0 && isFeatureEnabled("calendar_export")) {
      card.appendChild(
        e(
          "button",
          {
            style:
              "width:100%;padding:10px;margin-bottom:12px;background:linear-gradient(135deg,#3B82F6,#6366F1);color:white;border:none;border-radius:10px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px",
            onclick: () => {
              exportMyShiftsToCalendar(emp.id, S.weekOffset);
            },
          },
          "🗓️ הוסף את המשמרות שלי ליומן"
        )
      );
    }

    if (myShifts.length === 0) {
      card.appendChild(
        e("div", { style: "text-align:center;padding:24px;color:#64748B" }, "לא שובצת השבוע")
      );
    } else {
      myShifts.forEach(({ date, shift, ch }) => {
        const dt = new Date(date + "T00:00:00");
        const isToday = date === today();
        const others = (S.schedule[date]?.[shift.id] || [])
          .filter((id) => id !== emp.id)
          .map((id) => getEmp(id)?.name.split(" ")[0])
          .filter(Boolean);

        // Show overlap from morning2 if I'm in morning, or from morning if I'm in morning2
        let overlapShiftId = null;
        let overlapLabel = "";
        if (shift.id === "morning") {
          overlapShiftId = "morning2";
          overlapLabel = "בוקר ב׳";
        } else if (shift.id === "morning2") {
          overlapShiftId = "morning";
          overlapLabel = "בוקר";
        }
        const overlapEmps = overlapShiftId
          ? (S.schedule[date]?.[overlapShiftId] || [])
              .filter((id) => id !== emp.id)
              .map((id) => getEmp(id)?.name.split(" ")[0])
              .filter(Boolean)
          : [];

        card.appendChild(
          e(
            "div",
            {
              style: `display:flex;align-items:center;gap:12px;background:#0F172A;border-radius:12px;padding:12px 14px;margin-bottom:8px;border:1px solid ${isToday ? "#3B82F6" : shift.color + "33"}`,
            },
            [
              e(
                "div",
                {
                  style: `width:46px;height:54px;border-radius:12px;background:${shift.color}18;border:1px solid ${shift.color}33;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0`,
                },
                [
                  e(
                    "div",
                    { style: "font-size:9px;color:" + shift.color + "99;font-weight:600" },
                    DAYS[dt.getDay()]
                  ),
                  e(
                    "div",
                    { style: "font-size:20px;font-weight:900;color:" + shift.color },
                    String(dt.getDate())
                  ),
                ]
              ),
              e("div", { style: "flex:1" }, [
                e("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:2px" }, [
                  e(
                    "span",
                    { style: "font-weight:800;font-size:15px;color:" + shift.color },
                    shift.label
                  ),
                  isToday
                    ? e(
                        "span",
                        {
                          style:
                            "font-size:10px;background:#3B82F622;color:#60A5FA;border-radius:5px;padding:1px 6px",
                        },
                        "היום"
                      )
                    : null,
                  getHoliday(date)
                    ? e(
                        "span",
                        {
                          style:
                            "font-size:9px;background:#FCD34D22;color:#FCD34D;border-radius:5px;padding:1px 6px",
                        },
                        "✡️ " + getHoliday(date)
                      )
                    : null,
                ]),
                (() => {
                  // Resolve the display hours using the day-specific override (Thu-night, Fri, Sat all have special hours).
                  const overridesForDay = DAY_SHIFT_OVERRIDES[dt.getDay()];
                  const shForHours =
                    (overridesForDay && overridesForDay.find((s) => s.id === shift.id)) || shift;
                  const dispStart = ch ? ch.start : shForHours.start;
                  const dispEnd = ch ? ch.end : shForHours.end;
                  return e(
                    "div",
                    {
                      style:
                        "font-weight:700;font-size:13px;color:#E2E8F0;direction:ltr;text-align:right",
                    },
                    dispStart + " – " + dispEnd
                  );
                })(),
                others.length > 0
                  ? e(
                      "div",
                      { style: "font-size:11px;color:#64748B;margin-top:3px" },
                      "יחד עם: " + others.join(", ")
                    )
                  : null,
                overlapEmps.length > 0
                  ? e(
                      "div",
                      { style: "font-size:11px;color:#94A3B8;margin-top:2px" },
                      "👥 ב" + overlapLabel + ": " + overlapEmps.join(", ")
                    )
                  : null,
                S.assignmentNotes[date + "|" + shift.id + "|" + emp.id]
                  ? e(
                      "div",
                      {
                        style:
                          "font-size:11px;color:#F59E0B;margin-top:3px;background:#F59E0B11;border-radius:6px;padding:2px 8px",
                      },
                      "📝 " + S.assignmentNotes[date + "|" + shift.id + "|" + emp.id]
                    )
                  : null,
              ]),
              e("div", { style: "display:flex;flex-direction:column;align-items:center;gap:6px" }, [
                e(
                  "span",
                  { style: "font-size:20px" },
                  isToday ? "🔔" : date < today() ? "✅" : "📌"
                ),
              ]),
            ]
          )
        );
      });
    }
    wrap.appendChild(card);
  } else if (S.empViewTab === "schedule") {
    // Read-only week grid
    // Check if schedule is published for this week
    const weekStartRO = wd[0];
    const isPublishedRO =
      S.publishedWeeks.has(weekStartRO) ||
      S.publishedInitial?.has(weekStartRO) ||
      S.schedPublishType?.[weekStartRO];
    const isRealEmployee = S.profile?.role === "employee" || S.testAsEmployee;

    if (
      isRealEmployee &&
      (!isPublishedRO || S.scheduleExpired) &&
      (Object.keys(S.schedule).length > 0 || S.scheduleExpired)
    ) {
      const card = div("card", [
        e("div", { style: "text-align:center;padding:30px" }, [
          e("div", { style: "font-size:40px;margin-bottom:12px" }, S.scheduleExpired ? "⏳" : "🔒"),
          e(
            "div",
            { style: "font-weight:800;font-size:16px;color:#94A3B8" },
            S.scheduleExpired ? "הסידור בהכנה" : "הסידור טרם פורסם"
          ),
          e(
            "div",
            { style: "font-size:13px;color:#64748B;margin-top:8px" },
            S.scheduleExpired
              ? "הסידור הסופי יפורסם בקרוב — נעדכן אותך"
              : "הסידור יהיה זמין לצפייה לאחר פרסום ראשוני או סופי"
          ),
        ]),
      ]);
      wrap.appendChild(card);
      // Still show navigation arrows
      wrap.appendChild(
        e("div", { style: "display:flex;gap:8px;justify-content:center;margin-top:12px" }, [
          btn("btn-sm btn-sm-gray", "→", () => {
            S.weekOffset--;
            loadSchedule().then(() => render());
          }),
          btn("btn-sm btn-sm-blue", "השבוע", () => {
            S.weekOffset = 0;
            loadSchedule().then(() => render());
          }),
          btn("btn-sm btn-sm-gray", "←", () => {
            S.weekOffset++;
            loadSchedule().then(() => render());
          }),
        ])
      );
    } else {
      const card = div("card", [
        e(
          "div",
          { style: "font-weight:700;font-size:14px;color:#E2E8F0;margin-bottom:14px" },
          "📅 סידור שבועי — קריאה בלבד"
        ),
      ]);

      // Export buttons at the TOP — only for a published week
      card.appendChild(
        e(
          "div",
          {
            style:
              "display:flex;gap:8px;justify-content:center;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #1E293B;flex-wrap:wrap",
          },
          [
            btn(
              "btn-sm btn-sm-green",
              "🖨️ ייצוא PDF",
              () => {
                exportSchedulePDF(S.weekOffset);
              },
              { title: "ייצוא הסידור כ-PDF" }
            ),
            e(
              "button",
              {
                style:
                  "padding:6px 14px;background:#25D366;color:white;border:none;border-radius:8px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer",
                onclick: () => {
                  exportScheduleWhatsApp(S.weekOffset);
                },
              },
              "📲 שלח כתמונה"
            ),
          ]
        )
      );

      // Filter by employee name — tap a name to show only that employee's shifts
      const filterEmp = S.empScheduleFilter ? getEmp(S.empScheduleFilter) : null;
      const filterBar = e(
        "div",
        { style: "margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #1E293B" },
        [
          e(
            "div",
            { style: "font-size:11px;color:#64748B;margin-bottom:8px;font-weight:600" },
            "🔍 סינון לפי עובד"
          ),
          e("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, [
            btn(
              "",
              filterEmp ? "↩️ הצג הכל" : "✅ הכל",
              () => {
                S.empScheduleFilter = null;
                render();
              },
              {
                style: `padding:6px 13px;border-radius:10px;border:1px solid ${!filterEmp ? "#3B82F6cc" : "#334155"};background:${!filterEmp ? "#3B82F633" : "#1E293B"};color:${!filterEmp ? "#60A5FA" : "#94A3B8"};font-family:inherit;font-weight:${!filterEmp ? "700" : "500"};font-size:13px`,
              }
            ),
            ...schedulableEmployees().map((e2) => {
              const c2 = ec(empIdx(e2.id));
              const sel2 = S.empScheduleFilter === e2.id;
              return btn(
                "",
                e2.name.split(" ")[0],
                () => {
                  S.empScheduleFilter = sel2 ? null : e2.id;
                  render();
                },
                {
                  style: `padding:6px 13px;border-radius:10px;border:1px solid ${sel2 ? c2 + "cc" : c2 + "44"};background:${sel2 ? c2 + "33" : "#1E293B"};color:${sel2 ? c2 : "#94A3B8"};font-family:inherit;font-weight:${sel2 ? "700" : "500"};font-size:13px`,
                }
              );
            }),
          ]),
        ]
      );
      card.appendChild(filterBar);

      const gridWrap = div("sched-wrap");
      const tbl = e("table", { class: "sched-table" });
      const thead = e("thead");
      const hrow = e("tr", [e("th", { style: "width:80px" }, "")]);
      wd.forEach((date) => {
        const dt = new Date(date + "T00:00:00");
        const isToday = date === today();
        const fullDate = dt.getDate() + "/" + (dt.getMonth() + 1);
        hrow.appendChild(
          e(
            "th",
            {
              class: "day-header" + (isToday ? " is-today" : ""),
              style: isToday ? "color:#60A5FA" : "",
            },
            [
              e("div", { style: "font-size:11px;font-weight:600" }, DAYS[dt.getDay()]),
              e("div", { style: "font-size:16px;font-weight:900" }, String(dt.getDate())),
              e("div", { style: "font-size:9px;color:#64748B" }, fullDate),
              getHoliday(date)
                ? e("div", { style: "font-size:8px;color:#FCD34D;font-weight:600" }, "✡️")
                : null,
            ]
          )
        );
      });
      thead.appendChild(hrow);
      tbl.appendChild(thead);
      const tbody = e("tbody");
      SHIFTS.forEach((sh) => {
        const row = e("tr");
        row.appendChild(
          e("td", { style: "font-weight:700;font-size:11px;color:" + sh.color }, sh.label)
        );
        wd.forEach((date) => {
          const dayNum2 = new Date(date + "T00:00:00").getDay();
          if ((dayNum2 === 5 || dayNum2 === 6) && (sh.id === "afternoon" || sh.id === "morning2")) {
            row.appendChild(
              e("td", { style: "background:#0F172A44" }, [
                e("div", { style: "font-size:9px;color:#334155" }, "—"),
              ])
            );
            return;
          }
          const empIdsAll = S.schedule[date]?.[sh.id] || [];
          const empIds = S.empScheduleFilter
            ? empIdsAll.filter((id) => id === S.empScheduleFilter)
            : empIdsAll;
          const isMe = empIds.includes(emp.id);
          const td = e("td", { style: isMe ? "background:" + sh.color + "18" : "" });
          empIds.forEach((id) => {
            const e2 = getEmp(id);
            if (!e2) return;
            const c = ec(empIdx(id));
            const isSelf = id === emp.id;
            const cellKey = date + "|" + sh.id + "|" + id;
            const ch = S.customHours[cellKey];
            const noteInfo = _parseNote(S.assignmentNotes[cellKey]);
            // Show hours ALWAYS — custom if set, otherwise the shift's day-specific default.
            // Uses DAY_SHIFT_OVERRIDES so Thu-night 22:45-07:30, Fri/Sat hours all render correctly.
            const overridesForDay = DAY_SHIFT_OVERRIDES[dayNum2];
            const shForHours =
              (overridesForDay && overridesForDay.find((s) => s.id === sh.id)) || sh;
            const dispStart = ch?.start || shForHours.start;
            const dispEnd = ch?.end || shForHours.end;
            const hasCust = !!ch;
            const empBlock = e(
              "div",
              {
                style: `margin-bottom:4px;padding-bottom:3px;text-align:center;${empIds.length > 1 ? "border-bottom:1px dashed #1E293B" : ""}`,
              },
              [
                e(
                  "div",
                  {
                    style: `font-size:10px;color:${isSelf ? sh.color : c};font-weight:${isSelf ? "900" : "600"};white-space:nowrap;text-align:center`,
                  },
                  e2.name.split(" ")[0]
                ),
                e(
                  "div",
                  {
                    style:
                      "direction:ltr;text-align:center;font-size:8px;color:#F59E0B;font-weight:700;white-space:nowrap",
                  },
                  [e("span", { style: "margin-left:2px" }, "⏰"), dispStart + "-" + dispEnd]
                ),
                noteInfo.tags.length > 0
                  ? e(
                      "div",
                      { style: "display:flex;flex-wrap:wrap;gap:2px;margin-top:1px" },
                      noteInfo.tags.map((t) =>
                        e(
                          "span",
                          {
                            style:
                              "background:#3B82F622;color:#60A5FA;border-radius:3px;padding:0px 3px;font-size:7px;white-space:nowrap",
                          },
                          "🏷️" + t
                        )
                      )
                    )
                  : null,
                noteInfo.text
                  ? e(
                      "div",
                      {
                        style:
                          "font-size:7px;color:#FCD34D;font-style:italic;white-space:normal;line-height:1.2",
                      },
                      "📝 " + noteInfo.text
                    )
                  : null,
              ]
            );
            td.appendChild(empBlock);
          });
          // When filtering by a specific employee, cells where someone else is scheduled
          // (but not the filtered employee) should just look empty — not offer "join" actions.
          if (S.empScheduleFilter && empIdsAll.length > 0 && empIds.length === 0) {
            td.style.background = "";
            row.appendChild(td);
            return;
          }
          if (empIds.length === 0) {
            // Unfilled shift — highlight it and let the employee request to join.
            const myReq = (S.joinRequests || []).find(
              (r) =>
                r.employee_id === emp.id &&
                r.date === date &&
                r.shift === sh.id &&
                r.status !== "rejected"
            );
            td.style.background = "#F59E0B12";
            td.style.border = "1px dashed #F59E0B55";
            if (myReq) {
              // Already requested
              td.appendChild(
                e(
                  "div",
                  {
                    style:
                      "font-size:8px;color:#F59E0B;font-weight:700;text-align:center;line-height:1.3",
                  },
                  myReq.status === "approved" ? "✅ אושר" : "⏳ ממתין לאישור"
                )
              );
            } else {
              // Check if joining this shift would break rest rules — if so, show it as unavailable
              const restConflict =
                typeof checkJoinRestConflict === "function"
                  ? checkJoinRestConflict(emp.id, date, sh.id)
                  : null;
              if (restConflict) {
                td.style.background = "#0F172A";
                td.style.border = "1px dashed #33415566";
                td.appendChild(
                  e(
                    "div",
                    {
                      style:
                        "font-size:7px;color:#475569;text-align:center;line-height:1.3;cursor:not-allowed",
                      title: restConflict,
                    },
                    [e("div", { style: "font-size:11px" }, "🚫"), e("div", {}, "לא זמין")]
                  )
                );
              } else {
                const joinBtn = e(
                  "button",
                  {
                    style:
                      "width:100%;background:transparent;border:none;cursor:pointer;font-family:inherit;padding:4px 2px;color:#F59E0B;font-size:8px;font-weight:700;text-align:center;line-height:1.3",
                    onclick: () => requestJoinShift(emp.id, date, sh.id, sh.label),
                  },
                  [e("div", { style: "font-size:13px" }, "➕"), e("div", {}, "הצטרף")]
                );
                td.appendChild(joinBtn);
              }
            }
          }
          row.appendChild(td);
        });
        tbody.appendChild(row);
      });
      tbl.appendChild(tbody);
      gridWrap.appendChild(tbl);
      card.appendChild(gridWrap);
      card.appendChild(
        e(
          "div",
          { style: "font-size:11px;color:#475569;text-align:center;margin-top:8px" },
          "👁 תצוגה בלבד"
        )
      );

      // Navigation arrows for past weeks
      card.appendChild(
        e("div", { style: "display:flex;gap:8px;justify-content:center;margin-top:12px" }, [
          btn("btn-sm btn-sm-gray", "→", () => {
            S.weekOffset--;
            loadSchedule().then(() => render());
          }),
          btn("btn-sm btn-sm-blue", "השבוע", () => {
            S.weekOffset = 0;
            loadSchedule().then(() => render());
          }),
          btn("btn-sm btn-sm-gray", "←", () => {
            S.weekOffset++;
            loadSchedule().then(() => render());
          }),
        ])
      );

      wrap.appendChild(card);
    } // end else (published)
  } else if (S.empViewTab === "mymonth") {
    const monthInfo = getMonthInfo(S.myMonthOffset);
    const cacheKey = emp.id + "|" + monthInfo.year + "-" + monthInfo.month;

    wrap.appendChild(
      e(
        "div",
        {
          style:
            "display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px",
        },
        [
          btn("btn-sm btn-sm-gray", "→", () => {
            S.myMonthOffset--;
            S.myMonthData = null;
            render();
          }),
          e(
            "div",
            {
              style:
                "font-weight:800;font-size:16px;color:#E2E8F0;min-width:120px;text-align:center",
            },
            monthInfo.label
          ),
          btn("btn-sm btn-sm-gray", "←", () => {
            S.myMonthOffset++;
            S.myMonthData = null;
            render();
          }),
        ]
      )
    );
    if (S.myMonthOffset !== 0) {
      wrap.appendChild(
        e("div", { style: "text-align:center;margin-bottom:16px;margin-top:-8px" }, [
          btn("btn-sm btn-sm-blue", "החודש הנוכחי", () => {
            S.myMonthOffset = 0;
            S.myMonthData = null;
            render();
          }),
        ])
      );
    }

    if (S.myMonthKey !== cacheKey) {
      loadMyMonthData(emp.id, monthInfo).then((data) => {
        S.myMonthData = data;
        S.myMonthKey = cacheKey;
        render();
      });
      wrap.appendChild(skeletonSchedule());
      return wrap;
    }

    const md = S.myMonthData;

    // Summary card
    wrap.appendChild(
      e(
        "div",
        { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px" },
        [
          e(
            "div",
            {
              style:
                "background:#1E293B;border:1px solid #33415566;border-radius:14px;padding:14px 8px;text-align:center",
            },
            [
              e(
                "div",
                { style: "font-size:22px;font-weight:900;color:#60A5FA" },
                String(md.shifts.length)
              ),
              e("div", { style: "font-size:11px;color:#64748B;margin-top:2px" }, "משמרות"),
            ]
          ),
          e(
            "div",
            {
              style:
                "background:#1E293B;border:1px solid #33415566;border-radius:14px;padding:14px 8px;text-align:center",
            },
            [
              e(
                "div",
                { style: "font-size:22px;font-weight:900;color:#34D399" },
                Math.round(md.totalHours * 10) / 10 + ""
              ),
              e("div", { style: "font-size:11px;color:#64748B;margin-top:2px" }, "שעות"),
            ]
          ),
          e(
            "div",
            {
              style:
                "background:#1E293B;border:1px solid #33415566;border-radius:14px;padding:14px 8px;text-align:center",
            },
            [
              e(
                "div",
                { style: "font-size:22px;font-weight:900;color:#FCD34D" },
                String(md.vacationDays)
              ),
              e("div", { style: "font-size:11px;color:#64748B;margin-top:2px" }, "ימי חופש"),
            ]
          ),
        ]
      )
    );

    // Breakdown by shift type
    if (md.shifts.length > 0) {
      const breakdown = div("card", [
        e(
          "div",
          { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:10px" },
          "פילוח לפי סוג משמרת"
        ),
      ]);
      const row = e("div", { style: "display:flex;flex-wrap:wrap;gap:8px" });
      SHIFTS.forEach((sh) => {
        const cnt = md.byShift[sh.id] || 0;
        if (cnt === 0) return;
        row.appendChild(
          e(
            "div",
            {
              style: `background:${sh.color}18;border:1px solid ${sh.color}44;border-radius:10px;padding:6px 12px;display:flex;align-items:center;gap:6px`,
            },
            [
              e("span", { style: "font-weight:700;font-size:12px;color:" + sh.color }, sh.label),
              e("span", { style: "font-size:12px;color:#94A3B8" }, "× " + cnt),
            ]
          )
        );
      });
      breakdown.appendChild(row);
      wrap.appendChild(breakdown);
    }

    // Full shift list for the month
    const listCard = div("card", [
      e(
        "div",
        { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:10px" },
        "כל המשמרות בחודש"
      ),
    ]);
    if (md.shifts.length === 0) {
      listCard.appendChild(
        e(
          "div",
          { style: "text-align:center;padding:24px;color:#64748B" },
          "אין משמרות מפורסמות בחודש זה"
        )
      );
    } else {
      md.shifts.forEach((s) => {
        const dt = new Date(s.date + "T00:00:00");
        listCard.appendChild(
          e(
            "div",
            {
              style: `display:flex;align-items:center;gap:12px;background:#0F172A;border-radius:10px;padding:10px 12px;margin-bottom:6px;border:1px solid ${s.color}33`,
            },
            [
              e(
                "div",
                {
                  style: `width:40px;height:44px;border-radius:10px;background:${s.color}18;border:1px solid ${s.color}33;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0`,
                },
                [
                  e(
                    "div",
                    { style: "font-size:8px;color:" + s.color + "99;font-weight:600" },
                    DAYS[dt.getDay()]
                  ),
                  e(
                    "div",
                    { style: "font-size:16px;font-weight:900;color:" + s.color },
                    String(dt.getDate())
                  ),
                ]
              ),
              e("div", { style: "flex:1" }, [
                e("div", { style: "font-weight:700;font-size:13px;color:" + s.color }, s.label),
                e(
                  "div",
                  { style: "font-size:11px;color:#94A3B8" },
                  (s.start || "") +
                    " – " +
                    (s.end || "") +
                    "  ·  " +
                    Math.round(s.hours * 10) / 10 +
                    " שעות"
                ),
              ]),
            ]
          )
        );
      });
    }
    wrap.appendChild(listCard);
  } else if (S.empViewTab === "avail") {
    const presetBase = _blockPresetBase(); // 1 normally, 2 from Saturday onward
    // Check deadline — relative to the TARGET week being submitted for.
    const dlDay = S.business?.deadline_day;
    const dlTime = S.business?.deadline_time || "20:00";
    // Israel wall-clock — deadline is set by the business and is business-local,
    // so "past deadline" for a traveler must compare against Jerusalem, not their device.
    const now = israelNow();
    // The week the employee is currently submitting blocks for:
    const _targetOffsetForDeadline =
      S.availTargetOffset !== null && S.availTargetOffset !== undefined
        ? S.availTargetOffset
        : presetBase;
    const _targetWeekDates = getWeekDates(_targetOffsetForDeadline);
    const _targetSunday = new Date(_targetWeekDates[0] + "T00:00:00"); // Sunday of target week
    let isPastDeadline = false;
    if (dlDay !== null && dlDay !== undefined) {
      // Deadline is dlDay of the week BEFORE the target week, at dlTime.
      // dlDay: 0=Sunday..6=Saturday. The target week starts on Sunday (_targetSunday).
      // Days back from target Sunday to the deadline day:
      // e.g. deadline Thursday(4) → 7 - 4 = 3 days before Sunday = previous Thursday.
      const daysBefore = 7 - dlDay;
      const deadlineDate = new Date(_targetSunday.getTime() - daysBefore * 86400000);
      const [dlH, dlM] = dlTime.split(":").map(Number);
      deadlineDate.setHours(dlH || 0, dlM || 0, 0, 0);
      isPastDeadline = now > deadlineDate;
    }

    if (isPastDeadline) {
      const card = div("card", [
        e("div", { style: "text-align:center;padding:30px" }, [
          e("div", { style: "font-size:40px;margin-bottom:12px" }, "⏰"),
          e(
            "div",
            { style: "font-weight:800;font-size:18px;color:#EF4444;margin-bottom:8px" },
            "הדדליין עבר!"
          ),
          e(
            "div",
            { style: "font-size:13px;color:#64748B" },
            "לא ניתן להגיש חסימות אחרי יום " + DAYS[dlDay] + " בשעה " + dlTime
          ),
          e(
            "div",
            { style: "font-size:12px;color:#475569;margin-top:10px" },
            "לבקשות מיוחדות — פנה למנהל"
          ),
        ]),
      ]);
      wrap.appendChild(card);
    } else {
      const targetOffset =
        S.availTargetOffset !== null && S.availTargetOffset !== undefined
          ? S.availTargetOffset
          : presetBase;
      const targetDates = getWeekDates(targetOffset);
      const targetStart = targetDates[0];
      const blockLimits = emp.block_limits || {
        weekday: { morning: 3, afternoon: 3, night: 1 },
        weekend: { morning: 1, afternoon: 1, night: 1 },
      };
      const rawAllowed = emp.allowed_block_slots || {};
      const noConfig = Object.keys(rawAllowed).length === 0;
      const allowedSlots = noConfig
        ? Object.fromEntries(DAYS.map((d) => [d, SHIFTS.map((s) => s.id)]))
        : rawAllowed;

      // Count used blocks per shift per day group
      function getBlockCount(shiftId, isWeekend) {
        let count = 0;
        Object.entries(S.availDraft).forEach(([key, val]) => {
          if (!val) return;
          const [di, sid] = key.split("|");
          if (sid !== shiftId) return;
          const dt = new Date(targetDates[parseInt(di)] + "T00:00:00");
          const isWE = dt.getDay() === 5 || dt.getDay() === 6;
          if (isWE === isWeekend) count++;
        });
        return count;
      }
      const totalUsed = Object.values(S.availDraft).filter(Boolean).length;

      const card = div("card");

      card.appendChild(
        e("div", { style: "display:flex;gap:6px;margin-bottom:14px" }, [
          e(
            "button",
            {
              onclick: () => {
                S.availTargetOffset = presetBase;
                S.availDraft = {};
                S._draftWeek = null;
                S._draftCleared = false;
                render();
              },
              style: `flex:1;padding:10px;border-radius:10px;border:1px solid ${targetOffset === presetBase ? "#EF4444aa" : "#334155"};background:${targetOffset === presetBase ? "#EF444422" : "#1E293B"};color:${targetOffset === presetBase ? "#EF4444" : "#94A3B8"};font-family:inherit;cursor:pointer`,
            },
            [
              e("div", { style: "font-size:13px;font-weight:700" }, "שבוע הבא"),
              e(
                "div",
                { style: "font-size:10px;opacity:0.8;margin-top:2px" },
                fmtDate(getWeekDates(presetBase)[0]) + " — " + fmtDate(getWeekDates(presetBase)[6])
              ),
            ]
          ),
          e(
            "button",
            {
              onclick: () => {
                S.availTargetOffset = presetBase + 1;
                S.availDraft = {};
                S._draftWeek = null;
                S._draftCleared = false;
                render();
              },
              style: `flex:1;padding:10px;border-radius:10px;border:1px solid ${targetOffset === presetBase + 1 ? "#EF4444aa" : "#334155"};background:${targetOffset === presetBase + 1 ? "#EF444422" : "#1E293B"};color:${targetOffset === presetBase + 1 ? "#EF4444" : "#94A3B8"};font-family:inherit;cursor:pointer`,
            },
            [
              e("div", { style: "font-size:13px;font-weight:700" }, "עוד שבועיים"),
              e(
                "div",
                { style: "font-size:10px;opacity:0.8;margin-top:2px" },
                fmtDate(getWeekDates(presetBase + 1)[0]) +
                  " — " +
                  fmtDate(getWeekDates(presetBase + 1)[6])
              ),
            ]
          ),
        ])
      );

      card.appendChild(
        e(
          "div",
          {
            style:
              "display:flex;gap:6px;margin-bottom:14px;justify-content:center;align-items:center",
          },
          [
            btn("btn-sm btn-sm-gray", "→", () => {
              S.availTargetOffset = Math.max(targetOffset - 1, -4);
              S.availDraft = {};
              S._draftWeek = null;
              S._draftCleared = false;
              render();
            }),
            e(
              "span",
              { style: "font-size:12px;color:#64748B;min-width:80px;text-align:center" },
              targetOffset <= 0
                ? "שבוע " + (targetOffset === 0 ? "נוכחי" : "קודם")
                : "שבוע הבא" + (targetOffset > 1 ? " +" + targetOffset : "")
            ),
            btn("btn-sm btn-sm-gray", "←", () => {
              S.availTargetOffset = targetOffset + 1;
              S.availDraft = {};
              S._draftWeek = null;
              S._draftCleared = false;
              render();
            }),
          ]
        )
      );

      card.appendChild(
        e(
          "div",
          { style: "font-size:12px;color:#64748B;margin-bottom:12px;text-align:center" },
          fmtDate(targetDates[0]) + " — " + fmtDate(targetDates[6])
        )
      );

      // Quota display per shift type
      const quotaCard = e("div", {
        style:
          "background:#1E293B;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:14px",
      });
      quotaCard.appendChild(
        e(
          "div",
          { style: "font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px" },
          "🚫 מכסת חסימות"
        )
      );
      quotaCard.appendChild(
        e("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:8px" }, [
          e("div", { style: "background:#0F172A;border-radius:8px;padding:8px" }, [
            e(
              "div",
              { style: "font-size:11px;color:#3B82F6;font-weight:700;margin-bottom:6px" },
              "ראשון — חמישי"
            ),
            ...BLOCK_SHIFTS.map((sh) => {
              const lim = blockLimits.weekday?.[sh.id] ?? 3;
              const used = getBlockCount(sh.id, false);
              return e(
                "div",
                {
                  style: "display:flex;justify-content:space-between;font-size:11px;padding:2px 0",
                },
                [
                  e("span", { style: "color:" + sh.color }, sh.label),
                  e(
                    "span",
                    { style: `font-weight:700;color:${used >= lim ? "#EF4444" : "#94A3B8"}` },
                    `${used}/${lim}`
                  ),
                ]
              );
            }),
          ]),
          e("div", { style: "background:#0F172A;border-radius:8px;padding:8px" }, [
            e(
              "div",
              { style: "font-size:11px;color:#A855F7;font-weight:700;margin-bottom:6px" },
              "שישי — שבת"
            ),
            ...BLOCK_SHIFTS.filter((sh) => sh.id !== "afternoon").map((sh) => {
              const lim = blockLimits.weekend?.[sh.id] ?? 1;
              const used = getBlockCount(sh.id, true);
              return e(
                "div",
                {
                  style: "display:flex;justify-content:space-between;font-size:11px;padding:2px 0",
                },
                [
                  e("span", { style: "color:" + sh.color }, sh.label),
                  e(
                    "span",
                    { style: `font-weight:700;color:${used >= lim ? "#EF4444" : "#94A3B8"}` },
                    `${used}/${lim}`
                  ),
                ]
              );
            }),
          ]),
        ])
      );
      card.appendChild(quotaCard);

      {
        // Default blocks: prefer the DB-stored defaults (survive device changes and
        // enable server-side auto-apply after the deadline). Fall back to legacy localStorage.
        const defaultKey = "blockDefaults_" + emp.id;
        let savedDefaults = emp.default_blocks || null;
        if (!savedDefaults) {
          try {
            savedDefaults = JSON.parse(localStorage.getItem(defaultKey) || "null");
          } catch (_) {
            localStorage.removeItem(defaultKey);
          }
        }

        card.appendChild(
          e("div", { style: "display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap" }, [
            savedDefaults
              ? btn("btn-sm btn-sm-blue", "📥 טען ברירת מחדל", () => {
                  S.availDraft = {};
                  // Map saved defaults to current week dates
                  (savedDefaults || []).forEach((def) => {
                    targetDates.forEach((date, di) => {
                      const dt = new Date(date + "T00:00:00");
                      if (dt.getDay() === def.day) {
                        S.availDraft[di + "|" + def.shift] = true;
                      }
                    });
                  });
                  toast("ברירת מחדל נטענה ✓");
                  render();
                })
              : null,
            e(
              "div",
              { style: "font-size:11px;color:#475569;display:flex;align-items:center" },
              savedDefaults
                ? "✓ יש ברירת מחדל — תופעל אוטומטית אם לא תגיש עד יום ראשון 16:00"
                : "אין ברירת מחדל — חסום ולחץ ׳שמור כברירת מחדל׳"
            ),
          ])
        );

        card.appendChild(
          e(
            "div",
            { style: "font-size:13px;color:#94A3B8;margin-bottom:12px" },
            "לחץ על משמרות שאתה לא יכול לעבוד:"
          )
        );

        targetDates.forEach((date, di) => {
          const dt = new Date(date + "T00:00:00");
          const dayName = DAYS[dt.getDay()];
          const dayAllowed = allowedSlots[dayName] || [];
          if (dayAllowed.length === 0) return;

          const dayCard = e("div", {
            style:
              "background:#0F172A;border:1px solid #334155;border-radius:12px;padding:12px;margin-bottom:10px",
          });
          const dateStr = dt.getDate() + "/" + (dt.getMonth() + 1) + "/" + dt.getFullYear();
          dayCard.appendChild(
            e(
              "div",
              {
                style:
                  "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px",
              },
              [
                e("div", { style: "font-weight:800;font-size:15px;color:#E2E8F0" }, dayName),
                e("div", { style: "font-size:13px;color:#64748B" }, dateStr),
              ]
            )
          );

          const shiftsRow = e("div", {
            style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px",
          });
          const isWeekendDay = dt.getDay() === 5 || dt.getDay() === 6;
          (isWeekendDay ? WEEKEND_SHIFTS : BLOCK_SHIFTS).forEach((sh) => {
            const key = di + "|" + sh.id;
            const canBlock = dayAllowed.includes(sh.id);
            const picked = !!S.availDraft[key];
            const isWeekend = isWeekendDay;
            const shiftLimit = isWeekend
              ? (blockLimits.weekend?.[sh.id] ?? 1)
              : (blockLimits.weekday?.[sh.id] ?? 3);
            const shiftUsed = getBlockCount(sh.id, isWeekend);
            const atLimit = !picked && shiftUsed >= shiftLimit;

            if (!canBlock) {
              shiftsRow.appendChild(
                e(
                  "div",
                  {
                    style:
                      "padding:14px 8px;border-radius:10px;background:#1E293B;color:#475569;text-align:center;font-size:11px",
                  },
                  [
                    e("div", {}, sh.label),
                    e("div", { style: "font-size:9px;margin-top:2px" }, "לא ניתן"),
                  ]
                )
              );
              return;
            }

            shiftsRow.appendChild(
              e(
                "button",
                {
                  disabled: atLimit && !picked,
                  style: picked
                    ? `padding:14px 8px;border-radius:10px;background:#EF444433;border:2px solid #EF4444;color:#EF4444;font-weight:800;cursor:pointer;font-family:inherit`
                    : atLimit
                      ? `padding:14px 8px;border-radius:10px;background:#0F172A;border:1px solid #1E293B;color:#1E293B;cursor:not-allowed;font-family:inherit`
                      : `padding:14px 8px;border-radius:10px;background:#1E293B;border:1px solid ${sh.color}44;color:${sh.color};font-weight:700;cursor:pointer;font-family:inherit`,
                  onclick: () => {
                    S.availDraft[key] = !S.availDraft[key];
                    render();
                  },
                },
                [
                  e("div", { style: "font-size:13px" }, picked ? "🚫 " + sh.label : sh.label),
                  e(
                    "div",
                    {
                      style:
                        "direction:ltr;text-align:center;font-size:9px;opacity:0.8;margin-top:2px",
                    },
                    sh.start + "-" + sh.end
                  ),
                ]
              )
            );
          });
          dayCard.appendChild(shiftsRow);
          card.appendChild(dayCard);
        });

        const selKeys = Object.entries(S.availDraft)
          .filter(([, v]) => v)
          .map(([k]) => k);

        // Single note field for all blocks
        card.appendChild(
          e("div", { style: "margin-top:14px;border-top:1px solid #334155;padding-top:12px" }, [
            e(
              "div",
              { style: "font-weight:700;font-size:13px;color:#F59E0B;margin-bottom:8px" },
              "💬 פירוט / הערה (אופציונלי)"
            ),
            e("textarea", {
              class: "fi",
              placeholder: "למשל: מבחן ביום ראשון, אירוע משפחתי בשישי...",
              style: "min-height:70px;resize:vertical",
              id: "block-special-request",
            }),
          ])
        );

        card.appendChild(
          div(
            "form-actions",
            [
              btn("btn-sm btn-sm-blue", "💾 שמור כברירת מחדל", async () => {
                const selKeys2 = Object.entries(S.availDraft)
                  .filter(([, v]) => v)
                  .map(([k]) => k);
                if (!selKeys2.length) {
                  toast("בחר לפחות משמרת אחת", "err");
                  return;
                }
                const defaults = selKeys2.map((k) => {
                  const [di, shId] = k.split("|");
                  const dt = new Date(targetDates[parseInt(di)] + "T00:00:00");
                  return { day: dt.getDay(), shift: shId };
                });
                // Save to the DB so other devices and the server-side auto-apply cron can use it.
                // Keep writing to localStorage too as a cache + legacy fallback.
                try {
                  const { error } = await sb
                    .from("profiles")
                    .update({ default_blocks: defaults })
                    .eq("id", emp.id);
                  if (error) throw error;
                  emp.default_blocks = defaults;
                  localStorage.setItem("blockDefaults_" + emp.id, JSON.stringify(defaults));
                  toast("ברירת מחדל נשמרה ✓ תופעל אוטומטית בכל יום ראשון 16:00 אם לא תגיש");
                  render();
                } catch (err) {
                  toast(friendlyError(err), "err");
                }
              }),
              btn(
                "btn-sm btn-sm-red",
                "📤 שלח / עדכן חסימות",
                async () => {
                  if (
                    !selKeys.length &&
                    !document.getElementById("block-special-request")?.value?.trim()
                  ) {
                    toast("בחר משמרת או כתוב הודעה", "err");
                    return;
                  }
                  const specialMsg =
                    document.getElementById("block-special-request")?.value?.trim() || "";
                  // Always save the submission to the DB — even if it's a note-only submission with no specific shifts.
                  // (Previously a note-only submission only emailed the manager and was never stored, so it never
                  //  appeared in the blocks panel.)
                  const slots = selKeys.map((k) => {
                    const [di, shId] = k.split("|");
                    return {
                      day: new Date(targetDates[parseInt(di)] + "T00:00:00").getDay(),
                      shift: shId,
                      date: targetDates[parseInt(di)],
                      reason: "",
                    };
                  });
                  await submitAvailability(emp.id, targetStart, slots, specialMsg || "חסימות");
                  S.availDraft = {};
                  S.blockReasons = {};
                  toast("נשלח בהצלחה ✓");
                  render();
                },
                { style: "flex:1" }
              ),
              btn("btn-sm btn-sm-gray", "נקה", () => {
                S.availDraft = {};
                S.blockReasons = {};
                S._draftCleared = true;
                render();
              }),
            ],
            { style: "margin-top:12px" }
          )
        );
      }

      wrap.appendChild(card);
    } // end deadline else

    // History — all past submissions
    const myPastSubs = (S.availSubmissions || []).filter((b) => b.employee_id === emp.id);
    const myPastBlocks = myPastSubs;
    if (myPastSubs.length > 0) {
      const histCard = div("card", [
        e(
          "div",
          { style: "font-weight:800;font-size:14px;color:#94A3B8;margin-bottom:12px" },
          "📜 חסימות שהגשת בעבר"
        ),
      ]);

      myPastSubs
        .sort((a, b) => (b.week_start || "").localeCompare(a.week_start || ""))
        .forEach((sub) => {
          const wk = sub.week_start;
          histCard.appendChild(
            e(
              "div",
              {
                style:
                  "font-weight:700;font-size:12px;color:#60A5FA;margin-bottom:6px;margin-top:10px",
              },
              "שבוע " + (wk ? fmtDate(wk) : "לא ידוע")
            )
          );

          const slotsGrid = e("div", {
            style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px",
          });
          const SHIFT_ORDER_PAST = { morning: 0, morning2: 1, afternoon: 2, night: 3 };
          (sub.slots || [])
            .slice()
            .sort((a, b) => {
              const dateCmp = (a.date || "").localeCompare(b.date || "");
              if (dateCmp !== 0) return dateCmp;
              return (SHIFT_ORDER_PAST[a.shift] ?? 99) - (SHIFT_ORDER_PAST[b.shift] ?? 99);
            })
            .forEach((sl) => {
              const sh = SHIFT_BY_ID[sl.shift];
              const dt = sl.date ? new Date(sl.date + "T00:00:00") : null;
              const dayLabel = dt
                ? DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1)
                : "יום " + (DAYS[sl.day] || sl.day);
              slotsGrid.appendChild(
                e(
                  "div",
                  {
                    style:
                      "background:#1E293B;border:1px solid " +
                      (sh?.color || "#64748B") +
                      "44;border-radius:8px;padding:6px 10px",
                  },
                  [
                    e(
                      "div",
                      { style: "font-weight:700;font-size:11px;color:" + (sh?.color || "#94A3B8") },
                      dayLabel
                    ),
                    e(
                      "div",
                      { style: "font-size:10px;color:" + (sh?.color || "#64748B") },
                      sh?.label || sl.shift
                    ),
                    sl.reason
                      ? e(
                          "div",
                          { style: "font-size:9px;color:#FCA5A5;margin-top:2px" },
                          "💬 " + sl.reason
                        )
                      : null,
                  ]
                )
              );
            });
          histCard.appendChild(slotsGrid);

          if (sub.note) {
            histCard.appendChild(
              e(
                "div",
                { style: "font-size:11px;color:#F59E0B;font-style:italic;margin-bottom:8px" },
                "📩 " + sub.note
              )
            );
          }
        });
      wrap.appendChild(histCard);
    }
  } else if (S.empViewTab === "vacation") {
    wrap.appendChild(viewEmpVacations());
  } else if (S.empViewTab === "swaps_emp") {
    wrap.appendChild(viewSwaps(true));
  }

  return wrap;
}

// ── CONSTRAINTS MODAL ──
export function viewConstraintsModal() {
  const emp = S.constraintsEmp;
  if (!emp) return null;

  const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי"];
  const WEEKEND = ["שישי", "שבת"];

  let localDC = JSON.parse(JSON.stringify(emp.day_constraints || {}));
  let localMax = emp.max_shifts_per_week || 5;
  let localPerShift = JSON.parse(JSON.stringify(emp.max_per_shift || {}));
  let localAvail = [...(emp.availability || DAYS)];
  let localPref = [...(emp.preferred_shifts || [])];
  let localActiveDays = [...(emp.active_days || [0, 1, 2, 3, 4, 5, 6])]; // 0=Sun..6=Sat
  let localWorkShifts = [...(emp.allowed_shifts || SHIFTS.map((s) => s.id))];
  let localFixedShifts = JSON.parse(JSON.stringify(emp.fixed_shifts || {}));
  let localExcludeFrom = emp.exclude_from || null;
  let localExcludeTo = emp.exclude_to || null;
  let localExcludeReason = emp.exclude_reason || "";
  let localMaxBlocks = emp.max_blocks_per_week ?? 99;
  let localBlockLimits = JSON.parse(
    JSON.stringify(
      emp.block_limits || {
        weekday: { morning: 3, afternoon: 3, night: 1 },
        weekend: { morning: 1, afternoon: 1, night: 1 },
      }
    )
  );
  let localAllowedBlocks = JSON.parse(JSON.stringify(emp.allowed_block_slots || {}));

  const modal = div("modal");
  const mh = div("modal-header", [
    div("modal-title", [`הגבלות — ${emp.name}`]),
    btn("modal-close", "✕", () => {
      S.constraintsEmp = null;
      render();
    }),
  ]);
  modal.appendChild(mh);

  function rebuildModal() {
    // Clear and rebuild
    while (modal.childNodes.length > 1) modal.removeChild(modal.lastChild);

    // Max shifts
    const r1 = div(
      "card",
      [
        e("div", { class: "form-label", style: "margin-bottom:6px" }, "מקסימום משמרות בשבוע"),
        e("div", { style: "display:flex;align-items:center;gap:10px" }, [
          e("input", {
            class: "fi",
            type: "number",
            min: 1,
            max: 21,
            value: localMax,
            style: "width:80px;text-align:center",
            oninput: (ev) => {
              localMax = parseInt(ev.target.value) || 1;
            },
          }),
          e("span", { style: "font-size:13px;color:#64748B" }, "משמרות"),
        ]),
      ],
      { style: "margin-bottom:12px" }
    );
    modal.appendChild(r1);

    // ── Active days ──
    const daysCard = div(
      "card",
      [
        e("div", { class: "form-label", style: "margin-bottom:10px" }, "📅 ימים פעילים"),
        e(
          "div",
          { style: "font-size:11px;color:#475569;margin-bottom:10px" },
          "בחר באילו ימים העובד עובד — ימים לא פעילים לא יישובצו אוטומטית"
        ),
      ],
      { style: "margin-bottom:12px" }
    );
    const daysGrid = e("div", { style: "display:flex;flex-wrap:wrap;gap:6px" });
    DAYS.forEach((dayName, dayIdx) => {
      const isActive = localActiveDays.includes(dayIdx);
      daysGrid.appendChild(
        e(
          "button",
          {
            style: `padding:10px 14px;border-radius:10px;border:1px solid ${isActive ? "#10B981" : "#334155"};background:${isActive ? "#10B98122" : "#0F172A"};color:${isActive ? "#10B981" : "#475569"};font-family:inherit;font-weight:700;font-size:13px;cursor:pointer`,
            onclick: () => {
              if (isActive) localActiveDays = localActiveDays.filter((d) => d !== dayIdx);
              else localActiveDays.push(dayIdx);
              rebuildModal();
            },
          },
          isActive ? "✓ " + dayName : dayName
        )
      );
    });
    daysCard.appendChild(daysGrid);
    modal.appendChild(daysCard);

    // ── Allowed shifts ──
    const shiftsCard = div(
      "card",
      [
        e("div", { class: "form-label", style: "margin-bottom:10px" }, "🕐 משמרות מותרות"),
        e(
          "div",
          { style: "font-size:11px;color:#475569;margin-bottom:10px" },
          "למשל: עובד שעובד רק בוקר — בטל את הסימון מצהריים ולילה"
        ),
      ],
      { style: "margin-bottom:12px" }
    );
    const shiftsGrid = e("div", { style: "display:flex;gap:8px" });
    SHIFTS.forEach((sh) => {
      const isAllowed = localWorkShifts.includes(sh.id);
      shiftsGrid.appendChild(
        e(
          "button",
          {
            style: `flex:1;padding:14px 10px;border-radius:12px;border:2px solid ${isAllowed ? sh.color : sh.color + "33"};background:${isAllowed ? sh.color + "22" : "#0F172A"};color:${isAllowed ? sh.color : "#475569"};font-family:inherit;font-weight:800;font-size:14px;cursor:pointer;text-align:center`,
            onclick: () => {
              if (isAllowed) localWorkShifts = localWorkShifts.filter((s) => s !== sh.id);
              else localWorkShifts.push(sh.id);
              rebuildModal();
            },
          },
          [
            e("div", { style: "font-size:20px;margin-bottom:4px" }, isAllowed ? "✓" : "✗"),
            e("div", {}, sh.label),
          ]
        )
      );
    });
    shiftsCard.appendChild(shiftsGrid);
    modal.appendChild(shiftsCard);

    // ── Fixed schedule ──
    const fixedCard = div(
      "card",
      [
        e("div", { class: "form-label", style: "margin-bottom:10px" }, "📌 שיבוץ קבוע"),
        e(
          "div",
          { style: "font-size:11px;color:#475569;margin-bottom:10px" },
          "העובד ישובץ אוטומטית בימים ובמשמרות שתבחר — תמיד, בכל שבוע"
        ),
      ],
      { style: "margin-bottom:12px" }
    );
    if (!localFixedShifts) localFixedShifts = {};
    // Day-by-day cards layout (mobile friendly)
    const FIXED_SHIFTS = [
      { id: "morning", label: "בוקר", color: "#F59E0B" },
      { id: "afternoon", label: "צהריים", color: "#10B981" },
      { id: "night", label: "לילה", color: "#6366F1" },
    ];
    DAYS.forEach((dayName, dayIdx) => {
      const isWE = dayIdx >= 5;
      const dayShifts = isWE ? FIXED_SHIFTS.filter((sh) => sh.id !== "afternoon") : FIXED_SHIFTS;
      const dayRow = e("div", {
        style:
          "background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between",
      });
      dayRow.appendChild(
        e(
          "div",
          {
            style:
              "font-weight:700;font-size:13px;color:" +
              (isWE ? "#A855F7" : "#E2E8F0") +
              ";min-width:50px",
          },
          dayName
        )
      );
      const btnsWrap = e("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
      dayShifts.forEach((sh) => {
        // "morning" button controls both morning and morning2
        const key = dayIdx + "_" + sh.id;
        const key2 = sh.id === "morning" ? dayIdx + "_morning2" : null;
        const isFixed = !!localFixedShifts[key] || (key2 && !!localFixedShifts[key2]);
        btnsWrap.appendChild(
          e(
            "button",
            {
              style:
                "padding:8px 14px;border-radius:8px;border:1px solid " +
                (isFixed ? sh.color : sh.color + "33") +
                ";background:" +
                (isFixed ? sh.color + "22" : "#1E293B") +
                ";color:" +
                (isFixed ? sh.color : "#475569") +
                ";font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap",
              onclick: () => {
                if (isFixed) {
                  delete localFixedShifts[key];
                  if (key2) delete localFixedShifts[key2];
                } else {
                  localFixedShifts[key] = true;
                  if (key2) localFixedShifts[key2] = true;
                }
                rebuildModal();
              },
            },
            (isFixed ? "✓ " : "") + sh.label
          )
        );
      });
      dayRow.appendChild(btnsWrap);
      fixedCard.appendChild(dayRow);
    });
    const fixedCount = Object.values(localFixedShifts).filter(Boolean).length;
    if (fixedCount > 0) {
      fixedCard.appendChild(
        e(
          "div",
          { style: "margin-top:8px;font-size:11px;color:#10B981;font-weight:700" },
          "📌 " + fixedCount + " משמרות קבועות הוגדרו"
        )
      );
    }
    modal.appendChild(fixedCard);

    // ── Temporary exclusion ──
    const exCard = div(
      "card",
      [
        e("div", { class: "form-label", style: "margin-bottom:10px" }, "🚑 השעיה זמנית מהסידור"),
        e(
          "div",
          { style: "font-size:11px;color:#475569;margin-bottom:10px" },
          "העובד לא יישובץ בתאריכים אלו (מחלה, חל״ת, וכו׳)"
        ),
      ],
      { style: "margin-bottom:12px" }
    );
    // Date limits: today through 2 years ahead. Picker opens on today when both
    // inputs are empty, so a stale saved value from a past exclusion doesn't drag
    // the iOS picker back to that old month.
    const _todayIso = israelTodayIso();
    const _dateMin = _todayIso;
    const _dateMax = israelYear() + 2 + "-12-31";
    // If the previously saved exclusion range already ended, treat it as stale
    // and present a blank form so the picker opens on today instead of jumping
    // back half a year to the old value.
    if (localExcludeTo && localExcludeTo < _todayIso) {
      localExcludeFrom = null;
      localExcludeTo = null;
      localExcludeReason = "";
    }
    // Live summary element — a reference we mutate on every input change so the
    // red "מושעה" banner reflects what the user just typed without waiting for a
    // full modal rebuild.
    const _exSummaryEl = e(
      "div",
      {
        style:
          "margin-top:10px;background:#EF444418;border:1px solid #EF444433;border-radius:8px;padding:8px 12px;font-size:12px;color:#FCA5A5;display:none",
      },
      ""
    );
    const _refreshExSummary = () => {
      if (localExcludeFrom && localExcludeTo) {
        _exSummaryEl.textContent =
          "🚑 מושעה: " +
          fmtDate(localExcludeFrom) +
          " — " +
          fmtDate(localExcludeTo) +
          (localExcludeReason ? " (" + localExcludeReason + ")" : "");
        _exSummaryEl.style.display = "";
      } else {
        _exSummaryEl.textContent = "";
        _exSummaryEl.style.display = "none";
      }
    };
    exCard.appendChild(
      div("form-row", [
        div("form-col", [
          e("label", { class: "form-label" }, "מתאריך"),
          e("input", {
            class: "fi",
            type: "date",
            min: _dateMin,
            max: _dateMax,
            value: localExcludeFrom || "",
            oninput: (ev) => {
              localExcludeFrom = ev.target.value || null;
              _refreshExSummary();
            },
          }),
        ]),
        div("form-col", [
          e("label", { class: "form-label" }, "עד תאריך"),
          e("input", {
            class: "fi",
            type: "date",
            min: _dateMin,
            max: _dateMax,
            value: localExcludeTo || "",
            oninput: (ev) => {
              localExcludeTo = ev.target.value || null;
              _refreshExSummary();
            },
          }),
        ]),
      ])
    );
    exCard.appendChild(
      e("input", {
        class: "fi",
        placeholder: "סיבה (מחלה, חל״ת...)",
        value: localExcludeReason,
        style: "margin-top:8px",
        oninput: (ev) => {
          localExcludeReason = ev.target.value;
          _refreshExSummary();
        },
      })
    );
    exCard.appendChild(_exSummaryEl);
    _refreshExSummary();
    exCard.appendChild(
      btn(
        "btn-sm btn-sm-gray",
        "נקה השעיה",
        () => {
          localExcludeFrom = null;
          localExcludeTo = null;
          localExcludeReason = "";
          rebuildModal();
        },
        { style: "margin-top:8px" }
      )
    );
    modal.appendChild(exCard);

    // Per shift limits removed - handled by block_limits

    // ── Block limits per day group ──
    const limCard = div(
      "card",
      [
        e(
          "div",
          { class: "form-label", style: "margin-bottom:10px" },
          "🚫 כמות חסימות מותרת לעובד"
        ),
      ],
      { style: "margin-bottom:12px" }
    );

    // Weekday limits (Sun-Thu)
    limCard.appendChild(
      e(
        "div",
        { style: "font-weight:700;font-size:13px;color:#3B82F6;margin-bottom:8px" },
        "ראשון — חמישי"
      )
    );
    limCard.appendChild(
      e(
        "div",
        { style: "display:flex;gap:10px;margin-bottom:14px" },
        BLOCK_SHIFTS.map((sh) =>
          div("form-col", [
            e("label", { style: "font-size:11px;font-weight:700;color:" + sh.color }, sh.label),
            e("input", {
              class: "fi",
              type: "number",
              min: 0,
              max: 5,
              value: localBlockLimits.weekday?.[sh.id] ?? 3,
              style: "text-align:center",
              oninput: (ev) => {
                if (!localBlockLimits.weekday) localBlockLimits.weekday = {};
                localBlockLimits.weekday[sh.id] = parseInt(ev.target.value) || 0;
              },
            }),
          ])
        )
      )
    );

    // Weekend limits (Fri-Sat) — only morning + night (no afternoon)
    limCard.appendChild(
      e(
        "div",
        { style: "font-weight:700;font-size:13px;color:#A855F7;margin-bottom:8px" },
        "שישי — שבת"
      )
    );
    limCard.appendChild(
      e(
        "div",
        { style: "display:flex;gap:10px;margin-bottom:8px" },
        BLOCK_SHIFTS.filter((sh) => sh.id !== "afternoon").map((sh) =>
          div("form-col", [
            e("label", { style: "font-size:11px;font-weight:700;color:" + sh.color }, sh.label),
            e("input", {
              class: "fi",
              type: "number",
              min: 0,
              max: 2,
              value: localBlockLimits.weekend?.[sh.id] ?? 1,
              style: "text-align:center",
              oninput: (ev) => {
                if (!localBlockLimits.weekend) localBlockLimits.weekend = {};
                localBlockLimits.weekend[sh.id] = parseInt(ev.target.value) || 0;
              },
            }),
          ])
        )
      )
    );
    limCard.appendChild(e("div", { style: "font-size:11px;color:#475569" }, "0 = אסור לחסום כלל"));
    modal.appendChild(limCard);

    // Block slots are now controlled by block_limits above

    // Actions
    modal.appendChild(
      div("form-actions", [
        btn(
          "btn-add",
          "שמור הגבלות",
          async () => {
            await saveConstraints(emp.id, {
              maxShifts: localMax,
              blockLimits: localBlockLimits,
              activeDays: localActiveDays,
              allowedShifts: localWorkShifts,
              excludeFrom: localExcludeFrom,
              excludeTo: localExcludeTo,
              excludeReason: localExcludeReason,
              fixedShifts: localFixedShifts,
            });
          },
          { style: "flex:1" }
        ),
        btn("btn-sm btn-sm-gray", "ביטול", () => {
          S.constraintsEmp = null;
          render();
        }),
      ])
    );
  }

  rebuildModal();
  return div("modal-bg", [modal], {
    onclick: (ev) => {
      if (ev.target.classList.contains("modal-bg")) {
        S.constraintsEmp = null;
        render();
      }
    },
  });
}

// ── INVITATION MODAL ──
export function viewPreviewSelectModal() {
  const managers = S.employees.filter(
    (e) => (e.role === "admin" || e.role === "manager") && e.email
  );

  return div(
    "modal-bg",
    [
      div("modal", [
        div("modal-header", [
          div("modal-title", ["📝 בחר מנהלים לשליחת ניסיון"]),
          btn("modal-close", "✕", () => {
            S.showPreviewSelectModal = false;
            S.previewSelectedMgrs = null;
            S.previewConfirmed = false;
            render();
          }),
        ]),
        e(
          "div",
          { style: "color:#64748B;font-size:13px;margin-bottom:14px" },
          "בחר אילו מנהלים יקבלו את הסידור הניסיוני במייל:"
        ),

        // Quick select buttons
        e("div", { style: "display:flex;gap:6px;margin-bottom:14px" }, [
          btn(
            "btn-sm btn-sm-blue",
            "✓ בחר הכל",
            () => {
              S.previewSelectedMgrs = new Set(managers.map((m) => m.id));
              render();
            },
            { style: "flex:1" }
          ),
          btn(
            "btn-sm btn-sm-gray",
            "✕ נקה",
            () => {
              S.previewSelectedMgrs = new Set();
              render();
            },
            { style: "flex:1" }
          ),
        ]),

        // Manager list with checkboxes
        e(
          "div",
          { style: "max-height:400px;overflow-y:auto;margin-bottom:14px" },
          managers.map((mgr, idx) => {
            const col = ec(empIdx(mgr.id));
            const isSelected = S.previewSelectedMgrs?.has(mgr.id);
            const isSelf = mgr.id === S.user.id;
            return e(
              "label",
              {
                style: `display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0F172A;border:1px solid ${isSelected ? col + "66" : "#334155"};border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all 0.15s`,
              },
              [
                e("input", {
                  type: "checkbox",
                  checked: isSelected ? "checked" : null,
                  style: "width:18px;height:18px;cursor:pointer;accent-color:" + col,
                  onchange: (ev) => {
                    if (!S.previewSelectedMgrs) S.previewSelectedMgrs = new Set();
                    if (ev.target.checked) S.previewSelectedMgrs.add(mgr.id);
                    else S.previewSelectedMgrs.delete(mgr.id);
                    render();
                  },
                }),
                e(
                  "div",
                  {
                    style: `width:34px;height:34px;border-radius:10px;background:${col}22;border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:${col};flex-shrink:0`,
                  },
                  mgr.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                ),
                e("div", { style: "flex:1" }, [
                  e("div", { style: "font-weight:700;font-size:13px;color:#E2E8F0" }, [
                    mgr.name,
                    isSelf
                      ? e(
                          "span",
                          {
                            style:
                              "font-size:10px;color:#60A5FA;margin-right:6px;background:#3B82F622;border-radius:5px;padding:1px 6px",
                          },
                          "אני"
                        )
                      : null,
                  ]),
                  e(
                    "div",
                    { style: "font-size:11px;color:#64748B;margin-top:2px" },
                    "📧 " + mgr.email
                  ),
                ]),
              ]
            );
          })
        ),

        // Footer with action buttons
        e(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:center;gap:10px" },
          [
            e(
              "div",
              { style: "font-size:12px;color:#64748B" },
              `נבחרו: ${S.previewSelectedMgrs?.size || 0} / ${managers.length}`
            ),
            e("div", { style: "display:flex;gap:6px" }, [
              btn("btn-sm btn-sm-gray", "ביטול", () => {
                S.showPreviewSelectModal = false;
                S.previewSelectedMgrs = null;
                S.previewConfirmed = false;
                render();
              }),
              btn("btn-add", "📤 שלח", () => {
                if (!S.previewSelectedMgrs || S.previewSelectedMgrs.size === 0) {
                  toast("בחר לפחות מנהל אחד", "err");
                  return;
                }
                // Mark that the user confirmed selection, then run the publish flow
                S.previewConfirmed = true;
                S.showPreviewSelectModal = false;
                publishWeek("preview");
              }),
            ]),
          ]
        ),
      ]),
    ],
    {
      onclick: (ev) => {
        if (ev.target.classList.contains("modal-bg")) {
          S.showPreviewSelectModal = false;
          S.previewSelectedMgrs = null;
          render();
        }
      },
    }
  );
}

export function viewInviteModal() {
  return div(
    "modal-bg",
    [
      div("modal", [
        div("modal-header", [
          div("modal-title", ["✉️ הזמנת עובד חדש"]),
          btn("modal-close", "✕", () => {
            S.showInviteModal = false;
            render();
          }),
        ]),
        e(
          "div",
          { style: "color:#64748B;font-size:13px;margin-bottom:16px" },
          "תישלח הזמנה במייל עם לינק חד-פעמי. הלינק תקף 48 שעות."
        ),

        div(
          "form-col",
          [
            e("label", { class: "form-label" }, "שם מלא (אופציונלי)"),
            e("input", {
              class: "fi",
              placeholder: "ישראל ישראלי",
              value: S.newInvitation.name,
              oninput: (ev) => {
                S.newInvitation.name = ev.target.value;
              },
            }),
          ],
          { style: "margin-bottom:12px" }
        ),

        div(
          "form-col",
          [
            e("label", { class: "form-label" }, "אימייל *"),
            e("input", {
              class: "fi",
              type: "email",
              placeholder: "name@example.com",
              value: S.newInvitation.email,
              oninput: (ev) => {
                S.newInvitation.email = ev.target.value;
              },
            }),
          ],
          { style: "margin-bottom:12px" }
        ),

        div(
          "form-col",
          [
            e("label", { class: "form-label" }, "תפקיד"),
            e(
              "select",
              {
                class: "fi",
                onchange: (ev) => {
                  S.newInvitation.role = ev.target.value;
                },
              },
              [
                e(
                  "option",
                  {
                    value: "employee",
                    selected: S.newInvitation.role === "employee" ? "selected" : null,
                  },
                  "👤 עובד"
                ),
                e(
                  "option",
                  {
                    value: "admin",
                    selected: S.newInvitation.role === "admin" ? "selected" : null,
                  },
                  "👑 מנהל"
                ),
              ]
            ),
          ],
          { style: "margin-bottom:16px" }
        ),

        div("form-actions", [
          btn("btn-add", "📤 שלח הזמנה", createInvitation, { style: "flex:1" }),
          btn("btn-sm btn-sm-gray", "ביטול", () => {
            S.showInviteModal = false;
            render();
          }),
        ]),
      ]),
    ],
    {
      onclick: (ev) => {
        if (ev.target.classList.contains("modal-bg")) {
          S.showInviteModal = false;
          render();
        }
      },
    }
  );
}

// ── PUBLISH MODAL ──
export function viewExportModal() {
  const exportType = S.showExportModal; // "pdf", "csv", or "whatsapp"
  const currentOffset = S.weekOffset;
  // Show options: -2, -1, 0, +1, +2 weeks
  const offsets = [-3, -2, -1, 0, 1, 2];
  const exportTypeLabel = exportType === "pdf" ? "PDF" : exportType === "csv" ? "CSV" : "WhatsApp";

  return div(
    "modal-bg",
    [
      div("modal", [
        div("modal-header", [
          div("modal-title", [
            (exportType === "whatsapp" ? "📲" : "📤") + ` שליחה ל-${exportTypeLabel} — בחר שבוע`,
          ]),
          btn("modal-close", "✕", () => {
            S.showExportModal = null;
            render();
          }),
        ]),
        e(
          "div",
          { style: "color:#64748B;font-size:13px;margin-bottom:16px" },
          "אפשר לייצא גם סידור שעוד עובדים עליו"
        ),

        e(
          "div",
          { style: "display:flex;flex-direction:column;gap:8px;margin-bottom:16px" },
          offsets.map((off) => {
            const wd = getWeekDates(off);
            const isCurrent = off === currentOffset;
            const isPast = off < 0;
            const isFuture = off > 0;
            let label = "";
            if (off === 0) label = "השבוע הזה";
            else if (off === -1) label = "שבוע שעבר";
            else if (off === 1) label = "שבוע הבא";
            else if (off < 0) label = `לפני ${Math.abs(off)} שבועות`;
            else label = `עוד ${off} שבועות`;

            return e(
              "button",
              {
                style: `width:100%;text-align:right;padding:14px;background:${isCurrent ? "#3B82F622" : "#0F172A"};border:1px solid ${isCurrent ? "#3B82F6" : "#334155"};border-radius:12px;color:#E2E8F0;font-family:inherit;cursor:pointer;font-size:14px;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s`,
                onmouseover: (ev) => {
                  ev.currentTarget.style.borderColor = "#60A5FA";
                  ev.currentTarget.style.background = "#3B82F611";
                },
                onmouseout: (ev) => {
                  ev.currentTarget.style.borderColor = isCurrent ? "#3B82F6" : "#334155";
                  ev.currentTarget.style.background = isCurrent ? "#3B82F622" : "#0F172A";
                },
                onclick: async () => {
                  S.showExportModal = null;
                  render();
                  if (exportType === "pdf") await exportSchedulePDF(off);
                  else if (exportType === "csv") await exportScheduleCSV(off);
                  else await exportScheduleWhatsApp(off);
                },
              },
              [
                e("div", {}, [
                  e("div", { style: "font-weight:700;margin-bottom:2px" }, [
                    label,
                    isCurrent
                      ? e(
                          "span",
                          {
                            style:
                              "font-size:10px;background:#3B82F644;color:#60A5FA;border-radius:4px;padding:2px 6px;margin-right:6px",
                          },
                          "נוכחי"
                        )
                      : null,
                  ]),
                  e(
                    "div",
                    { style: "font-size:11px;color:#64748B" },
                    `${fmtDate(wd[0])} — ${fmtDate(wd[6])}`
                  ),
                ]),
                e("span", { style: "font-size:18px;color:#64748B" }, "←"),
              ]
            );
          })
        ),

        btn(
          "btn-sm btn-sm-gray",
          "ביטול",
          () => {
            S.showExportModal = null;
            render();
          },
          { style: "width:100%" }
        ),
      ]),
    ],
    {
      onclick: (ev) => {
        if (ev.target.classList.contains("modal-bg")) {
          S.showExportModal = null;
          render();
        }
      },
    }
  );
}

export function viewPublishModal() {
  const wd = getWeekDates(S.weekOffset);
  const weekStart = wd[0];
  const currentType = S.schedPublishType?.[weekStart];
  const isInitialPublished = S.publishedInitial?.has(weekStart);
  const isFinalPublished = S.publishedWeeks.has(weekStart);

  return div(
    "modal-bg",
    [
      div("modal", [
        div("modal-header", [
          div("modal-title", ["📢 פרסום סידור"]),
          btn("modal-close", "✕", () => {
            S.showPublishModal = false;
            render();
          }),
        ]),
        e(
          "div",
          { style: "color:#64748B;font-size:13px;margin-bottom:16px" },
          `שבוע ${fmtDate(wd[0])} — ${fmtDate(wd[6])}`
        ),

        // Preview card (managers only)
        e(
          "div",
          {
            style:
              "background:#A855F708;border:1px solid #A855F744;border-radius:14px;padding:16px;margin-bottom:12px",
          },
          [
            e("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
              e("span", { style: "font-size:22px" }, "📝"),
              e("div", {}, [
                e(
                  "div",
                  { style: "font-weight:800;font-size:15px;color:#E2E8F0" },
                  "שליחה ניסיונית"
                ),
                e(
                  "div",
                  { style: "font-size:12px;color:#64748B" },
                  "רק למנהלים — לבדיקה לפני פרסום רשמי"
                ),
              ]),
            ]),
            btn("btn-purple", "📝 שלח למנהלים לבדיקה", () => publishWeek("preview"), {
              style: "width:100%",
            }),
          ]
        ),

        // Initial publish card — with optional "visible until" deadline so employees stop
        // seeing it when the manager starts tweaking the schedule for the final version.
        e(
          "div",
          {
            style: `background:#1E3A5F22;border:1px solid ${isInitialPublished ? "#3B82F6" : "#334155"};border-radius:14px;padding:16px;margin-bottom:12px`,
          },
          [
            e("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
              e("span", { style: "font-size:22px" }, "📋"),
              e("div", {}, [
                e("div", { style: "font-weight:800;font-size:15px;color:#E2E8F0" }, "סידור ראשוני"),
                e(
                  "div",
                  { style: "font-size:12px;color:#64748B" },
                  "ניתן לשינוי לאחר פרסום · עובדים יקבלו מייל עם הערה"
                ),
              ]),
              isInitialPublished
                ? e(
                    "span",
                    {
                      style:
                        "font-size:11px;background:#3B82F622;color:#60A5FA;border:1px solid #3B82F644;border-radius:6px;padding:2px 8px",
                    },
                    "פורסם"
                  )
                : null,
            ]),
            // Visibility deadline picker — if set, employees stop seeing the schedule after this
            // time, so when the manager starts working on the final version there's no "spoiler".
            e(
              "div",
              {
                style:
                  "background:#0F172A66;border:1px solid #334155;border-radius:10px;padding:10px;margin-bottom:10px",
              },
              [
                e(
                  "label",
                  {
                    style:
                      "display:flex;align-items:center;gap:8px;font-size:12px;color:#94A3B8;cursor:pointer;margin-bottom:6px",
                  },
                  [
                    e("input", {
                      type: "checkbox",
                      checked: !!S.publishVisibleUntil,
                      onchange: (ev) => {
                        if (ev.target.checked) {
                          // Default: Thursday 20:00 of this week
                          const def = new Date(wd[4] + "T20:00:00");
                          const pad = (n) => String(n).padStart(2, "0");
                          S.publishVisibleUntil =
                            def.getFullYear() +
                            "-" +
                            pad(def.getMonth() + 1) +
                            "-" +
                            pad(def.getDate()) +
                            "T" +
                            pad(def.getHours()) +
                            ":" +
                            pad(def.getMinutes());
                        } else {
                          S.publishVisibleUntil = null;
                        }
                        render();
                      },
                    }),
                    e("span", {}, "⏰ זמין לצפייה רק עד תאריך/שעה מסוימים"),
                  ]
                ),
                S.publishVisibleUntil
                  ? e("input", {
                      class: "fi",
                      type: "datetime-local",
                      value: S.publishVisibleUntil,
                      style: "width:100%;font-size:13px",
                      oninput: (ev) => {
                        S.publishVisibleUntil = ev.target.value;
                      },
                    })
                  : null,
                S.publishVisibleUntil
                  ? e(
                      "div",
                      { style: "font-size:10px;color:#64748B;margin-top:4px;line-height:1.4" },
                      'אחרי הזמן הזה, העובדים יראו "הסידור בהכנה — יפורסם בקרוב" עד שתפרסם סופית.'
                    )
                  : null,
              ]
            ),
            btn(
              "btn-add",
              isInitialPublished ? "📋 פרסם מחדש (ראשוני)" : "📋 פרסם ראשוני",
              () => publishWeek("initial"),
              { style: "width:100%" }
            ),
          ]
        ),

        // Final publish card
        e(
          "div",
          {
            style: `background:#10B98108;border:1px solid ${isFinalPublished ? "#10B981" : "#334155"};border-radius:14px;padding:16px;margin-bottom:16px`,
          },
          [
            e("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
              e("span", { style: "font-size:22px" }, "📢"),
              e("div", {}, [
                e("div", { style: "font-weight:800;font-size:15px;color:#E2E8F0" }, "סידור סופי"),
                e(
                  "div",
                  { style: "font-size:12px;color:#64748B" },
                  "נעול · עובדים יקבלו מייל סופי"
                ),
              ]),
              isFinalPublished
                ? e(
                    "span",
                    {
                      style:
                        "font-size:11px;background:#10B98122;color:#10B981;border:1px solid #10B98144;border-radius:6px;padding:2px 8px",
                    },
                    "פורסם"
                  )
                : null,
            ]),
            btn(
              "btn-green",
              isFinalPublished ? "📢 פרסם מחדש (סופי)" : "📢 פרסם סופי",
              () => publishWeek("final"),
              { style: "width:100%" }
            ),
          ]
        ),

        btn(
          "btn-sm btn-sm-gray",
          "ביטול",
          () => {
            S.showPublishModal = false;
            render();
          },
          { style: "width:100%" }
        ),
      ]),
    ],
    {
      onclick: (ev) => {
        if (ev.target.classList.contains("modal-bg")) {
          S.showPublishModal = false;
          render();
        }
      },
    }
  );
}
