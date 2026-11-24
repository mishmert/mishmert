"use strict";

// roles.js — the active-identity accessors and role predicates.
//
// A single source of truth for 'who is the app currently acting as?' — centralized
// here so impersonation ('test as employee' mode) flows through one code path.
//
// Contents:
//  - getActiveEmpId()      : impersonated employee's id, else the logged-in user's.
//  - getActiveProfile()    : full profile object for the active identity.
//  - isManager()           : true if the LOGGED-IN user is admin/manager AND not
//                            in test-as-employee mode (impersonation downgrades).
//  - isAdmin()             : strict admin check (manager returns false).
//
// Dependencies at call time: `S` (state.js).

// Returns the active acting employee ID:
// - In test-as-employee mode: the viewed employee's ID
// - Otherwise: the logged-in user's ID

import { S } from './state.js';
import { e } from './utils.js';

export function getActiveEmpId() {
  return (S.testAsEmployee && S.empViewId) ? S.empViewId : S.user?.id;
}

// Returns the active acting profile object
export function getActiveProfile() {
  if (S.testAsEmployee && S.empViewId) {
    return S.employees.find(e => e.id === S.empViewId) || S.profile;
  }
  return S.profile;
}

export function isManager() {
  if (S.testAsEmployee) return false;
  return S.profile?.role === "admin" || S.profile?.role === "manager";
}
export function isAdmin() {
  return S.profile?.role === "admin";
}
