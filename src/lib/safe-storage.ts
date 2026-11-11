/**
 * Guarded localStorage/sessionStorage access (audit 2026-11-11, D19).
 * Direct `localStorage.getItem(...)` throws SecurityError when storage is
 * blocked (private mode, disabled cookies) and blanked the whole page.
 * These wrappers never throw: failures read as absent/unwritable.
 */
export function storageGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function sessionGet(key: string): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function sessionRemove(key: string): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
