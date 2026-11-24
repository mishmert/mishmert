"use strict";

// helpers.js — small single-concept helpers that don't fit anywhere larger.
//
// Contents:
//  - _blockPresetBase, fmtDate                 : date formatting edge cases.
//  - empIdx, schedulableEmployees              : S.employees lookups / filters.
//  - isFeatureEnabled, SA_NAV_FEATURE_MAP,
//    filterNavByFeatures                       : super-admin per-business toggles.
//  - getNotifiedManagers                       : who gets absence/swap notifications.
//  - getTimeBasedGreeting                      : 'בוקר טוב/לילה טוב' per hour.
//  - generateSecureToken                       : 256-bit hex token from crypto.getRandomValues.
//  - isValidEmail                              : RFC-light email format check.
//
// Dependencies at call time: `S` (state.js), `israelNow()` (utils.js).



// By Saturday (Jerusalem time), "next week" is basically tomorrow, so the
// block-submission presets bump forward by one: "next week" becomes what used
// to be "in two weeks", etc.

import { S } from './state.js';
import { e, israelNow } from './utils.js';

export function _blockPresetBase() {
  return israelNow().getDay() === 6 ? 2 : 1;
}
export function fmtDate(d) { return new Date(d+"T00:00:00").toLocaleDateString("he-IL"); }
// (getEmp defined later as a cached version)
export function empIdx(id) { return S.employees.findIndex(e=>e.id===id); }
// Employees who should actually appear in the schedule / shift lists.
// Managers flagged schedule_excluded only do management work and are hidden from scheduling.
export function schedulableEmployees() { return S.employees.filter(e => !e.schedule_excluded); }

// Per-business feature toggles, controlled by the platform super admin.
export function isFeatureEnabled(key) {
  return S.business?.enabled_features?.[key] !== false;
}
export const SA_NAV_FEATURE_MAP = { qualifications: "qualifications", swaps: "swaps", swaps_nav: "swaps" };
export function filterNavByFeatures(tabsArr) {
  return tabsArr.filter(t => {
    const key = SA_NAV_FEATURE_MAP[t.id];
    return !key || isFeatureEnabled(key);
  });
}

// Returns which admins/managers should receive absence/swap/join notifications.
// The business owner can narrow this down in Settings; otherwise it's everyone with the role.
export function getNotifiedManagers() {
  const allMgrs = S.employees.filter(e => (e.role === "admin" || e.role === "manager") && e.email);
  const configured = S.business?.notified_manager_ids;
  if (Array.isArray(configured) && configured.length > 0) {
    return allMgrs.filter(m => configured.includes(m.id));
  }
  return allMgrs;
}

// Time-based greeting in Hebrew — use Israel wall-clock so someone opening the
// app from abroad still gets the greeting that matches their team's day.
export function getTimeBasedGreeting() {
  const hour = israelNow().getHours();
  if (hour >= 5 && hour < 12) return { text: "בוקר טוב", emoji: "☀️" };       // 05:00 - 11:59
  if (hour >= 12 && hour < 17) return { text: "צהריים טובים", emoji: "🌤️" };  // 12:00 - 16:59
  if (hour >= 17 && hour < 21) return { text: "ערב טוב", emoji: "🌆" };       // 17:00 - 20:59
  return { text: "לילה טוב", emoji: "🌙" };                                    // 21:00 - 04:59
}

// Generate cryptographically secure token (64 hex chars = 256 bits entropy)
export function generateSecureToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

// Validate email format
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
