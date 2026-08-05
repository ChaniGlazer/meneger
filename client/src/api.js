const API_BASE = import.meta.env.VITE_API_URL || "";

// Set by App on mount so authedFetch/uploadFile can force a logout when the
// stored token is rejected (expired/invalid), instead of leaving every
// REST-backed screen stuck on a generic error forever.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export async function api(path, body) {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "שגיאה");
  return data;
}

export async function authedFetch(path, options = {}) {
  const token = localStorage.getItem("chat-token");
  const res = await fetch(`${API_BASE}/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new Error(data.error || "שגיאה");
  }
  return data;
}

// Best-effort — fire-and-forget, and deliberately not routed through
// authedFetch: a 401 here (token already invalid) must not trigger
// unauthorizedHandler, since that itself calls this and would recurse.
export function logout(token) {
  if (!token) return;
  fetch(`${API_BASE}/api/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export async function uploadFile(path, file) {
  const token = localStorage.getItem("chat-token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new Error(data.error || "שגיאה בהעלאת הקובץ");
  }
  return data;
}
