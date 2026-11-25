// memo.js — tiny memoization cache tied to a bumpable version counter.
// Extracted from index.html on 2026-11-24.
//
// Any caller that reads from S should look up its result through memoize(key, fn):
// the fn runs once per (key, _memoVersion.current) tuple and the result is cached
// until invalidateMemo() bumps the version. loadAll and the realtime subscribers
// call invalidateMemo() on every mutation so cross-view reads never go stale.

// ══════════════════════════════════════════════════════
// MEMOIZATION — cache expensive lookups
// ══════════════════════════════════════════════════════
"use strict";

import { S } from './state.js';
export const _memoCache = new Map();
export const _memoVersion = { current: 0 };
// Invalidate memo cache when data changes
export function invalidateMemo() { _memoVersion.current++; _memoCache.clear(); }

export function memoize(key, fn) {
  const fullKey = key + "::" + _memoVersion.current;
  if (_memoCache.has(fullKey)) return _memoCache.get(fullKey);
  const result = fn();
  _memoCache.set(fullKey, result);
  // Prevent memory leak
  if (_memoCache.size > 200) {
    const firstKey = _memoCache.keys().next().value;
    _memoCache.delete(firstKey);
  }
  return result;
}

// Get employee by ID — heavily used, worth caching
export const _empByIdCache = {};
export function getEmp(id) {
  if (_empByIdCache.id !== _memoVersion.current) {
    _empByIdCache.id = _memoVersion.current;
    _empByIdCache.map = Object.fromEntries((S.employees||[]).map(e=>[e.id,e]));
  }
  return _empByIdCache.map[id];
}

// Swap-week schedule cache (shared between swap views, audit, and history).
export const _swapWeekCache = {};
export function invalidateSwapCache() {
  for (const key in _swapWeekCache) delete _swapWeekCache[key];
}
