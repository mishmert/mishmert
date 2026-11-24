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

const _memoCache = new Map();
const _memoVersion = { current: 0 };
// Invalidate memo cache when data changes
function invalidateMemo() { _memoVersion.current++; _memoCache.clear(); }

function memoize(key, fn) {
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
const _empByIdCache = {};
function getEmp(id) {
  if (_empByIdCache.id !== _memoVersion.current) {
    _empByIdCache.id = _memoVersion.current;
    _empByIdCache.map = Object.fromEntries((S.employees||[]).map(e=>[e.id,e]));
  }
  return _empByIdCache.map[id];
}
