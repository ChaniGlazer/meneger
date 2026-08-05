import { useEffect, useRef, useState } from "react";
import { authedFetch } from "./api";
import Modal from "./components/Modal";
import ConfirmDialog from "./components/ConfirmDialog";
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS } from "./taskMeta";
import { EditIcon, TrashIcon, UsersIcon } from "./components/Icon";

const ROLE_LABELS = { employee: "עובדת", team_lead: "ראשת צוות", admin: "מנהלת" };

const ADMIN_TABS = [
  { key: "tasks", label: "משימות" },
  { key: "hours", label: "שעות עבודה" },
  { key: "users", label: "משתמשות", adminOnly: true },
  { key: "teams", label: "צוותים", adminOnly: true },
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

function formatTimeOnly(iso) {
  return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(clockIn, clockOut) {
  if (!clockOut) return "פתוחה";
  const hours = (new Date(clockOut) - new Date(clockIn)) / 3600000;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
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

  // One shared "⋮" row menu (keyed "task-5" / "timelog-3") for the tables
  // below, instead of a separate open/close state and effect per table.
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const rowMenuRef = useRef(null);

  useEffect(() => {
    if (openRowMenu == null) return;
    function handlePointerDown(e) {
      if (!rowMenuRef.current?.contains(e.target)) setOpenRowMenu(null);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpenRowMenu(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openRowMenu]);
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

  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(null);
  const [managingTeam, setManagingTeam] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);
  const [teamMembersError, setTeamMembersError] = useState("");
  const [addTeamMemberId, setAddTeamMemberId] = useState("");

  const [timeLogEntries, setTimeLogEntries] = useState([]);
  const [timeLogEntriesLoading, setTimeLogEntriesLoading] = useState(false);
  const [timeLogEntriesError, setTimeLogEntriesError] = useState("");
  const [editingTimeLog, setEditingTimeLog] = useState(null); // null closed, "new", or a log object
  const [timeLogForm, setTimeLogForm] = useState(null);
  const [timeLogFormError, setTimeLogFormError] = useState("");
  const [timeLogFormSaving, setTimeLogFormSaving] = useState(false);
  const [confirmDeleteTimeLog, setConfirmDeleteTimeLog] = useState(null);

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

  function fetchTeams() {
    setTeamsLoading(true);
    setTeamsError("");
    authedFetch("admin/teams")
      .then((data) => setTeams(data.teams))
      .catch((err) => setTeamsError(err.message))
      .finally(() => setTeamsLoading(false));
  }

  useEffect(() => {
    if (myRole === "admin") fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateTeam(e) {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setTeamBusy(true);
    setTeamsError("");
    try {
      await authedFetch("admin/teams", { method: "POST", body: JSON.stringify({ name }) });
      setNewTeamName("");
      fetchTeams();
    } catch (err) {
      setTeamsError(err.message);
    } finally {
      setTeamBusy(false);
    }
  }

  function handleDeleteTeam(team) {
    setConfirmDeleteTeam(team);
  }

  async function confirmDeleteTeamNow() {
    const team = confirmDeleteTeam;
    setConfirmDeleteTeam(null);
    setTeamsError("");
    try {
      await authedFetch(`admin/teams/${team.id}`, { method: "DELETE" });
      if (managingTeam?.id === team.id) closeManageTeam();
      fetchTeams();
    } catch (err) {
      setTeamsError(err.message);
    }
  }

  function openManageTeam(team) {
    setManagingTeam(team);
    setAddTeamMemberId("");
    setTeamMembersError("");
    setTeamMembersLoading(true);
    authedFetch(`admin/teams/${team.id}/members`)
      .then((data) => setTeamMembers(data.members))
      .catch((err) => setTeamMembersError(err.message))
      .finally(() => setTeamMembersLoading(false));
  }

  function closeManageTeam() {
    setManagingTeam(null);
    setTeamMembers([]);
  }

  async function handleAddTeamMember(e) {
    e.preventDefault();
    if (!addTeamMemberId) return;
    setTeamMembersError("");
    try {
      const data = await authedFetch(`admin/teams/${managingTeam.id}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(addTeamMemberId) }),
      });
      setTeamMembers(data.members);
      setAddTeamMemberId("");
      fetchTeams();
    } catch (err) {
      setTeamMembersError(err.message);
    }
  }

  async function handleRemoveTeamMember(userId) {
    setTeamMembersError("");
    try {
      const data = await authedFetch(`admin/teams/${managingTeam.id}/members/${userId}`, {
        method: "DELETE",
      });
      setTeamMembers(data.members);
      fetchTeams();
    } catch (err) {
      setTeamMembersError(err.message);
    }
  }

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

  // Guards against a fast filter change letting an older, slower response
  // overwrite the table with stale data after a newer request already won.
  const tasksRequestIdRef = useRef(0);
  function fetchTasks() {
    const requestId = ++tasksRequestIdRef.current;
    setTasksLoading(true);
    setTasksError("");
    const params = new URLSearchParams();
    if (taskAssignedTo) params.set("assigned_to", taskAssignedTo);
    if (taskStatus) params.set("status", taskStatus);
    if (taskPriority) params.set("priority", taskPriority);
    authedFetch(`admin/tasks?${params.toString()}`)
      .then((data) => {
        if (requestId === tasksRequestIdRef.current) setTasks(data.tasks);
      })
      .catch((err) => {
        if (requestId === tasksRequestIdRef.current) setTasksError(err.message);
      })
      .finally(() => {
        if (requestId === tasksRequestIdRef.current) setTasksLoading(false);
      });
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
      team_id: "",
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
      team_id: task.team_id ? String(task.team_id) : "",
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
      team_id: taskForm.team_id || null,
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

  const hoursRequestIdRef = useRef(0);
  function fetchHoursReport() {
    const requestId = ++hoursRequestIdRef.current;
    setHoursLoading(true);
    setHoursError("");
    const params = new URLSearchParams();
    if (hoursFrom) params.set("from", hoursFrom);
    if (hoursTo) params.set("to", hoursTo);
    if (hoursUserId) params.set("user_id", hoursUserId);
    authedFetch(`admin/hours-report?${params.toString()}`)
      .then((data) => {
        if (requestId === hoursRequestIdRef.current) setHoursReport(data.report);
      })
      .catch((err) => {
        if (requestId === hoursRequestIdRef.current) setHoursError(err.message);
      })
      .finally(() => {
        if (requestId === hoursRequestIdRef.current) setHoursLoading(false);
      });
  }

  useEffect(() => {
    fetchHoursReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timeLogEntriesRequestIdRef = useRef(0);
  function fetchTimeLogEntries() {
    const requestId = ++timeLogEntriesRequestIdRef.current;
    if (!hoursUserId) {
      setTimeLogEntries([]);
      return;
    }
    setTimeLogEntriesLoading(true);
    setTimeLogEntriesError("");
    const params = new URLSearchParams({ user_id: hoursUserId });
    if (hoursFrom) params.set("from", hoursFrom);
    if (hoursTo) params.set("to", hoursTo);
    authedFetch(`time-logs?${params.toString()}`)
      .then((data) => {
        if (requestId === timeLogEntriesRequestIdRef.current) setTimeLogEntries(data.timeLogs);
      })
      .catch((err) => {
        if (requestId === timeLogEntriesRequestIdRef.current) setTimeLogEntriesError(err.message);
      })
      .finally(() => {
        if (requestId === timeLogEntriesRequestIdRef.current) setTimeLogEntriesLoading(false);
      });
  }

  useEffect(() => {
    fetchTimeLogEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursUserId]);

  function openNewTimeLogForm() {
    setTimeLogFormError("");
    setEditingTimeLog("new");
    setTimeLogForm({ clock_in_date: todayIso(), clock_in_time: "09:00", clock_out_time: "17:00" });
  }

  function openEditTimeLogForm(log) {
    setTimeLogFormError("");
    setEditingTimeLog(log);
    const clockIn = new Date(log.clock_in);
    const clockOut = log.clock_out ? new Date(log.clock_out) : null;
    setTimeLogForm({
      clock_in_date: clockIn.toISOString().slice(0, 10),
      clock_in_time: clockIn.toTimeString().slice(0, 5),
      clock_out_time: clockOut ? clockOut.toTimeString().slice(0, 5) : "",
    });
  }

  function closeTimeLogForm() {
    setEditingTimeLog(null);
    setTimeLogForm(null);
    setTimeLogFormError("");
  }

  async function handleSaveTimeLog(e) {
    e.preventDefault();
    if (!timeLogForm) return;
    setTimeLogFormSaving(true);
    setTimeLogFormError("");

    const clockIn = new Date(`${timeLogForm.clock_in_date}T${timeLogForm.clock_in_time}`);
    const clockOut = timeLogForm.clock_out_time
      ? new Date(`${timeLogForm.clock_in_date}T${timeLogForm.clock_out_time}`)
      : null;
    if (clockOut && clockOut <= clockIn) {
      setTimeLogFormError("שעת היציאה חייבת להיות אחרי שעת הכניסה");
      setTimeLogFormSaving(false);
      return;
    }

    try {
      if (editingTimeLog === "new") {
        await authedFetch("time-logs", {
          method: "POST",
          body: JSON.stringify({
            user_id: hoursUserId,
            clock_in: clockIn.toISOString(),
            clock_out: clockOut ? clockOut.toISOString() : null,
          }),
        });
      } else {
        await authedFetch(`time-logs/${editingTimeLog.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            clock_in: clockIn.toISOString(),
            clock_out: clockOut ? clockOut.toISOString() : null,
          }),
        });
      }
      closeTimeLogForm();
      fetchTimeLogEntries();
      fetchHoursReport();
    } catch (err) {
      setTimeLogFormError(err.message);
    } finally {
      setTimeLogFormSaving(false);
    }
  }

  function handleDeleteTimeLog(log) {
    setConfirmDeleteTimeLog(log);
  }

  async function confirmDeleteTimeLogNow() {
    const log = confirmDeleteTimeLog;
    setConfirmDeleteTimeLog(null);
    setTimeLogEntriesError("");
    const previous = timeLogEntries;
    setTimeLogEntries((prev) => prev.filter((l) => l.id !== log.id));
    try {
      await authedFetch(`time-logs/${log.id}`, { method: "DELETE" });
      fetchHoursReport();
    } catch (err) {
      setTimeLogEntries(previous);
      setTimeLogEntriesError(err.message);
    }
  }

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

  async function handleChangeTeam(userId, teamId) {
    const previous = employees;
    setUsersError("");
    const team = teams.find((t) => String(t.id) === teamId);
    setEmployees((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, team_id: teamId ? Number(teamId) : null, team_name: team?.name ?? null } : u
      )
    );
    try {
      await authedFetch(`admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ team_id: teamId || null }),
      });
      fetchTeams();
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

              {myRole === "admin" && (
                <label>
                  צוות (אופציונלי — כל חברות הצוות יקבלו גישה למשימה)
                  <select
                    value={taskForm.team_id}
                    onChange={(e) => setTaskForm((f) => ({ ...f, team_id: e.target.value }))}
                  >
                    <option value="">ללא צוות</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

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
                <th>צוות</th>
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
                    {task.team_name
                      ? <span className="pill">{task.team_name}</span>
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
                      <div
                        className="menu-wrap"
                        ref={openRowMenu === `task-${task.id}` ? rowMenuRef : null}
                      >
                        <button
                          type="button"
                          className="menu-trigger"
                          aria-label={`פעולות על המשימה "${task.title}"`}
                          onClick={() =>
                            setOpenRowMenu((prev) => (prev === `task-${task.id}` ? null : `task-${task.id}`))
                          }
                        >
                          ⋮
                        </button>
                        {openRowMenu === `task-${task.id}` && (
                          <div className="menu-dropdown">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenRowMenu(null);
                                openEditTaskForm(task);
                              }}
                            >
                              <EditIcon /> עריכה
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenRowMenu(null);
                                handleDeleteTask(task);
                              }}
                            >
                              <TrashIcon /> מחיקה
                            </button>
                          </div>
                        )}
                      </div>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              fetchHoursReport();
              fetchTimeLogEntries();
            }}
          >
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

        {hoursUserId && (
          <>
            <div className="admin-section-head">
              <h2>רשומות נוכחות — {employees.find((e) => String(e.id) === hoursUserId)?.username}</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewTimeLogForm}>
                <span aria-hidden="true">+</span> רשומה חדשה
              </button>
            </div>

            {timeLogEntriesError && <div className="join-error">{timeLogEntriesError}</div>}

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>כניסה</th>
                    <th>יציאה</th>
                    <th>משך</th>
                    <th className="admin-table-actions-col"></th>
                  </tr>
                </thead>
                <tbody>
                  {timeLogEntries.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.clock_in).toLocaleDateString("he-IL")}</td>
                      <td>{formatTimeOnly(log.clock_in)}</td>
                      <td>{log.clock_out ? formatTimeOnly(log.clock_out) : <span className="admin-cell-muted">פתוחה</span>}</td>
                      <td>{formatDuration(log.clock_in, log.clock_out)}</td>
                      <td className="admin-task-row-actions">
                        <div
                          className="menu-wrap"
                          ref={openRowMenu === `timelog-${log.id}` ? rowMenuRef : null}
                        >
                          <button
                            type="button"
                            className="menu-trigger"
                            aria-label="פעולות על הרשומה"
                            onClick={() =>
                              setOpenRowMenu((prev) => (prev === `timelog-${log.id}` ? null : `timelog-${log.id}`))
                            }
                          >
                            ⋮
                          </button>
                          {openRowMenu === `timelog-${log.id}` && (
                            <div className="menu-dropdown">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenRowMenu(null);
                                  openEditTimeLogForm(log);
                                }}
                              >
                                <EditIcon /> עריכה
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenRowMenu(null);
                                  handleDeleteTimeLog(log);
                                }}
                              >
                                <TrashIcon /> מחיקה
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TableStates
                loading={timeLogEntriesLoading}
                empty={!timeLogEntriesLoading && timeLogEntries.length === 0}
                loadingText="בטעינת רשומות…"
                emptyText="אין רשומות נוכחות בטווח שנבחר"
              />
            </div>
          </>
        )}

        <Modal
          open={Boolean(editingTimeLog && timeLogForm)}
          onClose={closeTimeLogForm}
          onSubmit={handleSaveTimeLog}
          title={editingTimeLog === "new" ? "רשומת נוכחות חדשה" : "עריכת רשומת נוכחות"}
        >
          {timeLogForm && (
            <>
              {timeLogFormError && <div className="join-error">{timeLogFormError}</div>}
              <label>
                תאריך
                <input
                  type="date"
                  value={timeLogForm.clock_in_date}
                  onChange={(e) => setTimeLogForm((f) => ({ ...f, clock_in_date: e.target.value }))}
                  required
                  disabled={editingTimeLog !== "new"}
                />
              </label>
              <div className="admin-modal-row">
                <label>
                  שעת כניסה
                  <input
                    type="time"
                    value={timeLogForm.clock_in_time}
                    onChange={(e) => setTimeLogForm((f) => ({ ...f, clock_in_time: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  שעת יציאה
                  <input
                    type="time"
                    value={timeLogForm.clock_out_time}
                    onChange={(e) => setTimeLogForm((f) => ({ ...f, clock_out_time: e.target.value }))}
                  />
                </label>
              </div>
              <div className="admin-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeTimeLogForm} disabled={timeLogFormSaving}>
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" disabled={timeLogFormSaving}>
                  {timeLogFormSaving ? "בשמירה…" : "שמירה"}
                </button>
              </div>
            </>
          )}
        </Modal>

        <ConfirmDialog
          open={confirmDeleteTimeLog != null}
          title="מחיקת רשומת נוכחות"
          message="למחוק את הרשומה הזו? הפעולה אינה הפיכה."
          confirmLabel="מחיקה"
          danger
          onConfirm={confirmDeleteTimeLogNow}
          onCancel={() => setConfirmDeleteTimeLog(null)}
        />
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
                      aria-label={`מחיקת ההזמנה ל-${inv.email}`}
                      title="מחיקה"
                    >
                      <TrashIcon />
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
                <th>צוות</th>
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
                  <td>
                    <select
                      value={u.team_id ?? ""}
                      onChange={(e) => handleChangeTeam(u.id, e.target.value)}
                    >
                      <option value="">— ללא —</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
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

      {activeTab === "teams" && (
      <section className="admin-section">
        <div className="admin-section-head">
          <h2>צוותים</h2>
        </div>

        <p className="empty-hint">
          חברות צוות מקבלות גישה אוטומטית לכל משימה שמשויכת לצוות שלהן.
        </p>

        <form className="admin-filters" onSubmit={handleCreateTeam}>
          <input
            type="text"
            placeholder="שם צוות חדש"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            maxLength={100}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={teamBusy}>
            {teamBusy ? "ביצירה…" : "יצירת צוות"}
          </button>
        </form>

        {teamsError && <div className="join-error">{teamsError}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>שם הצוות</th>
                <th>מספר חברות</th>
                <th className="admin-table-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="admin-table-title-cell">{team.name}</td>
                  <td>{team.member_count}</td>
                  <td className="admin-task-row-actions">
                    <div
                      className="menu-wrap"
                      ref={openRowMenu === `team-${team.id}` ? rowMenuRef : null}
                    >
                      <button
                        type="button"
                        className="menu-trigger"
                        aria-label={`פעולות על הצוות "${team.name}"`}
                        onClick={() =>
                          setOpenRowMenu((prev) => (prev === `team-${team.id}` ? null : `team-${team.id}`))
                        }
                      >
                        ⋮
                      </button>
                      {openRowMenu === `team-${team.id}` && (
                        <div className="menu-dropdown">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenRowMenu(null);
                              openManageTeam(team);
                            }}
                          >
                            <UsersIcon /> ניהול חברות
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenRowMenu(null);
                              handleDeleteTeam(team);
                            }}
                          >
                            <TrashIcon /> מחיקה
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TableStates loading={teamsLoading} empty={!teamsLoading && teams.length === 0} emptyText="אין עדיין צוותים" />
        </div>

        <Modal
          open={managingTeam != null}
          onClose={closeManageTeam}
          title={managingTeam ? `ניהול חברות — ${managingTeam.name}` : ""}
        >
          {teamMembersError && <div className="join-error">{teamMembersError}</div>}

          <div className="user-list">
            {teamMembers.map((member) => (
              <div key={member.id} className="checkbox-row checkbox-row--split">
                <span dir="auto">{member.username}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => handleRemoveTeamMember(member.id)}
                >
                  הסירי
                </button>
              </div>
            ))}
            <TableStates
              loading={teamMembersLoading}
              empty={!teamMembersLoading && teamMembers.length === 0}
              emptyText="אין עדיין חברות בצוות"
            />
          </div>

          <form className="admin-filters" onSubmit={handleAddTeamMember}>
            <select value={addTeamMemberId} onChange={(e) => setAddTeamMemberId(e.target.value)}>
              <option value="">בחרי משתמשת להוספה</option>
              {employees
                .filter((emp) => !teamMembers.some((m) => m.id === emp.id))
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.username}
                  </option>
                ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={!addTeamMemberId}>
              הוספה
            </button>
          </form>
        </Modal>

        <ConfirmDialog
          open={confirmDeleteTeam != null}
          title="מחיקת צוות"
          message={
            confirmDeleteTeam
              ? `למחוק את הצוות "${confirmDeleteTeam.name}"? חברות הצוות יישארו במערכת אך יאבדו את השיוך לצוות זה.`
              : ""
          }
          confirmLabel="מחיקה"
          danger
          onConfirm={confirmDeleteTeamNow}
          onCancel={() => setConfirmDeleteTeam(null)}
        />
      </section>
      )}
    </div>
  );
}
