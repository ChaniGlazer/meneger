const API_BASE = import.meta.env.VITE_API_URL || "";

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
  if (!res.ok) throw new Error(data.error || "שגיאה");
  return data;
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
  if (!res.ok) throw new Error(data.error || "שגיאה בהעלאת הקובץ");
  return data;
}
