'use strict';

/**
 * In-memory rate limiter for password reset requests.
 * Tracks by IP address AND by account email independently.
 * Max 3 attempts per hour per IP, 3 attempts per hour per email.
 * No external dependency required.
 */

const store = new Map(); // key → { count, resetAt }

const MAX_REQUESTS = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getEntry(key) {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }
  return entry;
}

/**
 * Check if the request is allowed and increment the counter.
 * Returns { allowed: bool, remaining: number, resetAt: Date }
 */
function checkLimit(ip, email) {
  const ipEntry    = getEntry('ip:' + ip);
  const emailEntry = getEntry('email:' + (email || 'unknown').toLowerCase());

  if (ipEntry.count >= MAX_REQUESTS || emailEntry.count >= MAX_REQUESTS) {
    const resetAt = new Date(Math.max(ipEntry.resetAt, emailEntry.resetAt));
    const minutes = Math.ceil((resetAt - Date.now()) / 60000);
    return { allowed: false, minutes };
  }

  ipEntry.count++;
  emailEntry.count++;

  const remaining = MAX_REQUESTS - Math.max(ipEntry.count, emailEntry.count);
  return { allowed: true, remaining };
}

/** Reset limits for an account (e.g. after successful reset) */
function resetLimit(ip, email) {
  store.delete('ip:' + ip);
  store.delete('email:' + (email || '').toLowerCase());
}

// Prune expired entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = { checkLimit, resetLimit };
