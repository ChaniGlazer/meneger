import { useEffect, useState } from "react";
import { authedFetch } from "./api";

const TASK_STATUS_LABELS = {
  todo: "לביצוע",
  in_progress: "בתהליך",
  review: "להגהה",
  done: "הושלם",
};

const TASK_PRIORITY_LABELS = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };

const ROLE_LABELS = { employee: "עובד/ת", admin: "מנהל/ת" };

const ADMIN_TABS = [
  { key: "tasks", label: "משימות" },
  { key: "hours", label: "שעות עבודה" },
  { key: "users", label: "משתמשים" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(","));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminDashboard({ myUserId }) {
  const [activeTab, setActiveTab] = useState("tasks");
  const [employees, setEmployees] = useState([]);
  const [usersError, setUsersError] = useState("");

  const [invites, setInvites] = useState([]);
  const [invitesError, setInvitesError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState("");
  const [taskAssignedTo, setTaskAssignedTo] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [taskPriority, setTaskPriority] = useState("");
  const [editingTask, setEditingTask] = useState(null); // null = closed, "new" or task object
  const [taskForm, setTaskForm] = useState(null);
  const [taskFormError, setTaskFormError] = useState("");
  const [taskFormSaving, setTaskFormSaving] = useState(false);

  const [hoursFrom, setHoursFrom] = useState(daysAgoIso(30));
  const [hoursTo, setHoursTo] = useState(todayIso());
  const [hoursUserId, setHoursUserId] = useState("");
  const [hoursReport, setHoursReport] = useState([]);
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursError, setHoursError] = useState("");

  useEffect(() => {
    authedFetch("admin/users")
      .then((data) => setEmployees(data.users))
      .catch(() => {});
  }, []);

  function fetchInvites() {
    setInvitesError("");
    authedFetch("admin/invites")
      .then((data) => setInvites(data.invites))
      .catch((err) => setInvitesError(err.message));
  }

  useEffect(fetchInvites, []);

  async function handleAddInvite(e) {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviteBusy(true);
    setInvitesError("");
    try {
      await authedFetch("admin/invites", { method: "POST", body: JSON.stringify({ email }) });
      setInviteEmail("");
      fetchInvites();
    } catch (err) {
      setInvitesError(err.message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRemoveInvite(email) {
    setInvitesError("");
    const previous = invites;
    setInvites((prev) => prev.filter((i) => i.email !== email));
    try {
      await authedFetch(`admin/invites/${encodeURIComponent(email)}`, { method: "DELETE" });
    } catch (err) {
      setInvites(previous);
      setInvitesError(err.message);
    }
  }

  function fetchTasks() {
    setTasksLoading(true);
    setTasksError("");
    const params = new URLSearchParams();
    if (taskAssignedTo) params.set("assigned_to", taskAssignedTo);
    if (taskStatus) params.set("status", taskStatus);
    if (taskPriority) params.set("priority", taskPriority);
    authedFetch(`admin/tasks?${params.toString()}`)
      .then((data) => setTasks(data.tasks))
      .catch((err) => setTasksError(err.message))
      .finally(() => setTasksLoading(false));
  }

  useEffect(fetchTasks, [taskAssignedTo, taskStatus, taskPriority]);

  function openNewTaskForm() {
    setTaskFormError("");
    setEditingTask("new");
    setTaskForm({
      title: "",
      description: "",
      due_date: "",
      priority: "medium",
      status: "todo",
      assigned_to: "",
    });
  }

  function openEditTaskForm(task) {
    setTaskFormError("");
    setEditingTask(task);
    setTaskForm({
      title: task.title || "",
      description: task.description || "",
      due_date: task.due_date || "",
      priority: task.priority || "medium",
      status: task.status || "todo",
      assigned_to: task.assigned_to != null ? String(task.assigned_to) : "",
    });
  }

  function closeTaskForm() {
    setEditingTask(null);
    setTaskForm(null);
    setTaskFormError("");
  }

  useEffect(() => {
    if (!editingTask) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") closeTaskForm();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingTask]);

  async function handleSaveTask(e) {
    e.preventDefault();
    if (!taskForm) return;
    setTaskFormSaving(true);
    setTaskFormError("");
    const payload = {
      title: taskForm.title,
      description: taskForm.description,
      due_date: taskForm.due_date || null,
      priority: taskForm.priority,
      status: taskForm.status,
      assigned_to: taskForm.assigned_to || null,
    };
    try {
      if (editingTask === "new") {
        await authedFetch("tasks", { method: "POST", body: JSON.stringify(payload) });
      } else {
        await authedFetch(`tasks/${editingTask.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      closeTaskForm();
      fetchTasks();
    } catch (err) {
      setTaskFormError(err.message);
    } finally {
      setTaskFormSaving(false);
    }
  }

  async function handleDeleteTask(task) {
    if (!window.confirm(`למחוק את המשימה "${task.title}"? הפעולה אינה הפיכה.`)) return;
    setTasksError("");
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await authedFetch(`tasks/${task.id}`, { method: "DELETE" });
    } catch (err) {
      setTasks(previous);
      setTasksError(err.message);
    }
  }

  function fetchHoursReport() {
    setHoursLoading(true);
    setHoursError("");
    const params = new URLSearchParams();
    if (hoursFrom) params.set("from", hoursFrom);
    if (hoursTo) params.set("to", hoursTo);
    if (hoursUserId) params.set("user_id", hoursUserId);
    authedFetch(`admin/hours-report?${params.toString()}`)
      .then((data) => setHoursReport(data.report))
      .catch((err) => setHoursError(err.message))
      .finally(() => setHoursLoading(false));
  }

  useEffect(() => {
    fetchHoursReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExportHoursCsv() {
    downloadCsv(
      `דוח-שעות_${hoursFrom}_${hoursTo}.csv`,
      ["עובד/ת", "סה\"כ שעות", "מספר רישומים"],
      hoursReport.map((r) => [r.username, r.total_hours.toFixed(2), r.entries])
    );
  }

  async function handleChangeRole(userId, role) {
    const previous = employees;
    setUsersError("");
    setEmployees((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    try {
      await authedFetch(`admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    } catch (err) {
      setEmployees(previous);
      setUsersError(err.message);
    }
  }

  return (
    <div className="admin-sections">
      <div className="admin-tabs" role="tablist">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "tasks" && (
      <section className="admin-section">
        <div className="admin-section-head">
          <h2>כל המשימות</h2>
          <button type="button" className="btn btn-primary" onClick={openNewTaskForm}>
            <span aria-hidden="true">+</span> משימה חדשה
          </button>
        </div>

        <div className="admin-filters">
          <select
            value={taskAssignedTo}
            onChange={(e) => setTaskAssignedTo(e.target.value)}
            aria-label="סינון לפי עובדת"
          >
            <option value="">כל העובדות/ים</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.username}
              </option>
            ))}
          </select>
          <select
            value={taskStatus}
            onChange={(e) => setTaskStatus(e.target.value)}
            aria-label="סינון לפי סטטוס"
          >
            <option value="">כל הסטטוסים</option>
            {Object.entries(TASK_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={taskPriority}
            onChange={(e) => setTaskPriority(e.target.value)}
            aria-label="סינון לפי עדיפות"
          >
            <option value="">כל העדיפויות</option>
            {Object.entries(TASK_PRIORITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {tasksError && <div className="join-error">{tasksError}</div>}

        {editingTask && taskForm && (
          <div
            className="admin-modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeTaskForm();
            }}
          >
            <form
              className="admin-modal"
              onSubmit={handleSaveTask}
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-form-title"
            >
              <div className="admin-modal-head">
                <h3 id="task-form-title">
                  {editingTask === "new" ? "משימה חדשה" : "עריכת משימה"}
                </h3>
                <button
                  type="button"
                  className="admin-modal-close"
                  onClick={closeTaskForm}
                  aria-label="סגירה"
                >
                  ✕
                </button>
              </div>

              {taskFormError && <div className="join-error">{taskFormError}</div>}

              <label>
                כותרת
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
                  autoFocus
                  required
                />
              </label>
              <label>
                תיאור
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <div className="admin-modal-row">
                <label>
                  תאריך יעד
                  <input
                    type="date"
                    value={taskForm.due_date}
                    onChange={(e) => setTaskForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </label>
                <label>
                  עדיפות
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm((f) => ({ ...f, priority: e.target.value }))}
                  >
                    {Object.entries(TASK_PRIORITY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="admin-modal-row">
                <label>
                  סטטוס
                  <select
                    value={taskForm.status}
                    onChange={(e) => setTaskForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    {Object.entries(TASK_STATUS_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  משויכת ל-
                  <select
                    value={taskForm.assigned_to}
                    onChange={(e) => setTaskForm((f) => ({ ...f, assigned_to: e.target.value }))}
                  >
                    <option value="">— ללא —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.username}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="admin-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeTaskForm} disabled={taskFormSaving}>
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" disabled={taskFormSaving}>
                  {taskFormSaving ? "שומר…" : "שמירה"}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>כותרת</th>
                <th>משויכת ל-</th>
                <th>סטטוס</th>
                <th>עדיפות</th>
                <th>יעד</th>
                <th className="admin-table-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className="admin-table-title-cell">{task.title}</td>
                  <td>{task.assigned_to_username || <span className="admin-cell-muted">—</span>}</td>
                  <td>
                    <span className={`pill status-${task.status}`}>
                      {TASK_STATUS_LABELS[task.status] || task.status}
                    </span>
                  </td>
                  <td>
                    <span className={`pill priority-${task.priority}`}>
                      {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                    </span>
                  </td>
                  <td>{task.due_date || <span className="admin-cell-muted">—</span>}</td>
                  <td className="admin-task-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditTaskForm(task)}>
                      עריכה
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDeleteTask(task)}>
                      מחיקה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasksLoading && <p className="empty-hint">טוען משימות…</p>}
          {!tasksLoading && tasks.length === 0 && (
            <p className="empty-hint">לא נמצאו משימות התואמות לסינון</p>
          )}
        </div>
      </section>
      )}

      {activeTab === "hours" && (
      <section className="admin-section">
        <div className="admin-section-head">
          <h2>דוח שעות עבודה</h2>
        </div>
        <div className="admin-filters">
          <label className="admin-filter-label">
            מ-
            <input type="date" value={hoursFrom} onChange={(e) => setHoursFrom(e.target.value)} />
          </label>
          <label className="admin-filter-label">
            עד
            <input type="date" value={hoursTo} onChange={(e) => setHoursTo(e.target.value)} />
          </label>
          <select
            value={hoursUserId}
            onChange={(e) => setHoursUserId(e.target.value)}
            aria-label="סינון לפי עובדת"
          >
            <option value="">כל העובדות/ים</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.username}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={fetchHoursReport}>
            הצג
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={handleExportHoursCsv}
            disabled={hoursReport.length === 0}
          >
            ייצוא ל-CSV
          </button>
        </div>

        {hoursError && <div className="join-error">{hoursError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>עובד/ת</th>
                <th>סה"כ שעות</th>
                <th>מספר רישומים</th>
              </tr>
            </thead>
            <tbody>
              {hoursReport.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.username}</td>
                  <td>{row.total_hours.toFixed(2)}</td>
                  <td>{row.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hoursLoading && <p className="empty-hint">טוען נתונים…</p>}
          {!hoursLoading && hoursReport.length === 0 && (
            <p className="empty-hint">אין נתוני נוכחות בטווח שנבחר</p>
          )}
        </div>
      </section>
      )}

      {activeTab === "users" && (
      <section className="admin-section">
        <div className="admin-section-head">
          <h2>הזמנת משתמשים</h2>
        </div>

        <p className="empty-hint">
          רק כתובות אימייל שהוזמנו כאן יוכלו להירשם למערכת.
        </p>

        <form className="admin-filters" onSubmit={handleAddInvite}>
          <input
            type="email"
            placeholder="כתובת אימייל להזמנה"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            maxLength={200}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={inviteBusy}>
            {inviteBusy ? "מוסיף…" : "הוספת הזמנה"}
          </button>
        </form>

        {invitesError && <div className="join-error">{invitesError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>אימייל</th>
                <th>הוזמן ב-</th>
                <th>סטטוס</th>
                <th className="admin-table-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.email}>
                  <td>{inv.email}</td>
                  <td>{formatDateTime(inv.created_at)}</td>
                  <td>
                    {inv.used_at ? (
                      <span className="pill status-done">נוצל ע"י {inv.used_by_username}</span>
                    ) : (
                      <span className="pill status-todo">ממתין</span>
                    )}
                  </td>
                  <td className="admin-task-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => handleRemoveInvite(inv.email)}
                    >
                      מחיקה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invites.length === 0 && <p className="empty-hint">אין הזמנות</p>}
        </div>

        <div className="admin-section-head">
          <h2>משתמשים</h2>
        </div>

        {usersError && <div className="join-error">{usersError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>שם משתמש</th>
                <th>תפקיד</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeRole(u.id, e.target.value)}
                      disabled={u.id === myUserId}
                      title={u.id === myUserId ? "אי אפשר לשנות את התפקיד של עצמך/ך" : undefined}
                    >
                      {Object.entries(ROLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {employees.length === 0 && <p className="empty-hint">לא נמצאו משתמשים</p>}
        </div>
      </section>
      )}
    </div>
  );
}
