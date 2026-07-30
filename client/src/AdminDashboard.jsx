import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import Modal from "./components/Modal";
import ConfirmDialog from "./components/ConfirmDialog";
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "./taskMeta";

const ROLE_LABELS = { employee: "עובדת", team_lead: "ראשת צוות", admin: "מנהלת" };

const ADMIN_TABS = [
  { key: "tasks", label: "משימות" },
  { key: "hours", label: "שעות עבודה" },
  { key: "users", label: "משתמשות", adminOnly: true },
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

/** Ends the "table + loading text + empty text" triplication that was
    repeated four times (tasks, hours, invites, users). */
function TableStates({ loading, empty, loadingText, emptyText }) {
  if (loading) return <p className="empty-hint">{loadingText}</p>;
  if (empty) return <p className="empty-hint">{emptyText}</p>;
  return null;
}

export default function AdminDashboard({ myUserId, myRole }) {
  const visibleTabs = ADMIN_TABS.filter((tab) => !tab.adminOnly || myRole === "admin");
  const [activeTab, setActiveTab] = useState("tasks");
  const [employees, setEmployees] = useState([]);
  const [usersError, setUsersError] = useState("");

  const [invites, setInvites] = useState([]);
  const [invitesError, setInvitesError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvSummary, setCsvSummary] = useState(null);

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState("");
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null);
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
      .catch((err) => setUsersError(err.message));
  }, []);

  function fetchInvites() {
    setInvitesError("");
    authedFetch("admin/invites")
      .then((data) => setInvites(data.invites))
      .catch((err) => setInvitesError(err.message));
  }

  useEffect(() => {
    if (myRole === "admin") fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setCsvBusy(true);
    setInvitesError("");
    setCsvSummary(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || "");
      const emails = [...new Set((text.match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/g) || []).map((e) => e.toLowerCase()))];
      if (emails.length === 0) {
        setInvitesError("לא נמצאו כתובות אימייל בקובץ");
        setCsvBusy(false);
        return;
      }
      try {
        const data = await authedFetch("admin/invites/bulk", {
          method: "POST",
          body: JSON.stringify({ emails }),
        });
        setCsvSummary(data);
        fetchInvites();
      } catch (err) {
        setInvitesError(err.message);
      } finally {
        setCsvBusy(false);
      }
    };
    reader.onerror = () => {
      setInvitesError("שגיאה בקריאת הקובץ");
      setCsvBusy(false);
    };
    reader.readAsText(file, "utf-8");
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
      assigned_to: [],
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
      assigned_to: (task.assignees || []).map((a) => String(a.id)),
    });
  }

  function toggleTaskAssignee(id) {
    setTaskForm((f) => {
      const next = new Set(f.assigned_to);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, assigned_to: [...next] };
    });
  }

  function closeTaskForm() {
    setEditingTask(null);
    setTaskForm(null);
    setTaskFormError("");
  }

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
      assigned_to: taskForm.assigned_to.map(Number),
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

  function handleDeleteTask(task) {
    setConfirmDeleteTask(task);
  }

  async function confirmDeleteTaskNow() {
    const task = confirmDeleteTask;
    setConfirmDeleteTask(null);
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
      ["עובדת", "סה״כ שעות", "מספר רישומים"],
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

  async function handleChangeTeamLead(userId, teamLeadId) {
    const previous = employees;
    setUsersError("");
    setEmployees((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, team_lead_id: teamLeadId || null } : u))
    );
    try {
      await authedFetch(`admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ team_lead_id: teamLeadId || null }),
      });
    } catch (err) {
      setEmployees(previous);
      setUsersError(err.message);
    }
  }

  return (
    <div className="admin-sections">
      <div className="admin-tabs" role="tablist">
        {visibleTabs.map((tab) => (
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
            <option value="">כל העובדות</option>
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

        <Modal
          open={Boolean(editingTask && taskForm)}
          onClose={closeTaskForm}
          onSubmit={handleSaveTask}
          title={editingTask === "new" ? "משימה חדשה" : "עריכת משימה"}
          maxWidth={440}
        >
          {taskForm && (
            <>
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
                {/* Not a <label> wrapping <label>s (that made clicking the
                    heading toggle the first checkbox) - a plain heading. */}
                <div>
                  <span className="admin-filter-label">משויכת ל-</span>
                  <div className="user-list task-assignee-list">
                    {employees.map((emp) => (
                      <label key={emp.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={taskForm.assigned_to.includes(String(emp.id))}
                          onChange={() => toggleTaskAssignee(String(emp.id))}
                        />
                        {emp.username}
                      </label>
                    ))}
                    {employees.length === 0 && <p>אין עובדות זמינות</p>}
                  </div>
                </div>
              </div>

              <div className="admin-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeTaskForm} disabled={taskFormSaving}>
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" disabled={taskFormSaving}>
                  {taskFormSaving ? "בשמירה…" : "שמירה"}
                </button>
              </div>
            </>
          )}
        </Modal>

        <ConfirmDialog
          open={confirmDeleteTask != null}
          title="מחיקת משימה"
          message={confirmDeleteTask ? `למחוק את המשימה "${confirmDeleteTask.title}"? הפעולה אינה הפיכה.` : ""}
          confirmLabel="מחיקה"
          danger
          onConfirm={confirmDeleteTaskNow}
          onCancel={() => setConfirmDeleteTask(null)}
        />

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
                  <td>
                    {task.assignees?.length
                      ? task.assignees.map((a) => a.username).join(", ")
                      : <span className="admin-cell-muted">—</span>}
                  </td>
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
                    {myRole === "admin" && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditTaskForm(task)}>
                          עריכה
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDeleteTask(task)}>
                          מחיקה
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TableStates
            loading={tasksLoading}
            empty={!tasksLoading && tasks.length === 0}
            loadingText="בטעינת משימות…"
            emptyText="לא נמצאו משימות התואמות לסינון"
          />
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
            <option value="">כל העובדות</option>
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
                <th>עובדת</th>
                <th>סה״כ שעות</th>
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
          <TableStates
            loading={hoursLoading}
            empty={!hoursLoading && hoursReport.length === 0}
            loadingText="בטעינת נתונים…"
            emptyText="אין נתוני נוכחות בטווח שנבחר"
          />
        </div>
      </section>
      )}

      {activeTab === "users" && (
      <section className="admin-section">
        <div className="admin-section-head">
          <h2>הזמנת משתמשות</h2>
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
            {inviteBusy ? "בהוספה…" : "הוספת הזמנה"}
          </button>
          <label className="btn btn-secondary">
            {csvBusy ? "בהעלאה…" : "העלאת רשימה מ-CSV"}
            <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} disabled={csvBusy} hidden />
          </label>
        </form>

        {csvSummary && (
          <p className="empty-hint">
            נוספו {csvSummary.added.length} הזמנות
            {csvSummary.skipped.length > 0 && `, ${csvSummary.skipped.length} כבר היו מוזמנות`}
            {csvSummary.invalid.length > 0 && `, ${csvSummary.invalid.length} כתובות לא תקינות`}
          </p>
        )}

        {invitesError && <div className="join-error">{invitesError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>אימייל</th>
                <th>הוזמנה ב-</th>
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
                      <span className="pill status-done">מומשה ע״י {inv.used_by_username}</span>
                    ) : (
                      <span className="pill status-todo">ממתינה</span>
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
          <TableStates loading={false} empty={invites.length === 0} emptyText="אין הזמנות" />
        </div>

        <div className="admin-section-head">
          <h2>משתמשות</h2>
        </div>

        {usersError && <div className="join-error">{usersError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>שם משתמשת</th>
                <th>תפקיד</th>
                <th>ראשת צוות</th>
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
                      title={u.id === myUserId ? "אי אפשר לשנות את התפקיד של עצמך" : undefined}
                    >
                      {Object.entries(ROLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={u.team_lead_id ?? ""}
                      onChange={(e) => handleChangeTeamLead(u.id, e.target.value)}
                      disabled={u.id === myUserId}
                      title={u.id === myUserId ? "אי אפשר להקצות ראשת צוות לעצמך" : undefined}
                    >
                      <option value="">— ללא —</option>
                      {employees
                        .filter((e) => e.role === "team_lead" && e.id !== u.id)
                        .map((lead) => (
                          <option key={lead.id} value={lead.id}>
                            {lead.username}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TableStates loading={false} empty={employees.length === 0} emptyText="לא נמצאו משתמשות" />
        </div>
      </section>
      )}
    </div>
  );
}
