import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, authedFetch, uploadFile } from "./api";
import TimeClock from "./TimeClock";
import AdminDashboard from "./AdminDashboard";
import Sidebar from "./Sidebar";

const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { autoConnect: false });

function formatTime(iso) {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentView({ attachment }) {
  if (!attachment) return null;
  const isImage = attachment.mimeType?.startsWith("image/");

  if (isImage) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="attachment-image-link"
      >
        <img src={attachment.url} alt={attachment.originalName} className="attachment-image" />
      </a>
    );
  }

  return (
    <a href={attachment.url} download={attachment.originalName} className="attachment-file">
      <span className="attachment-file-name">{attachment.originalName}</span>
      {attachment.size != null && (
        <span className="attachment-file-size">{formatFileSize(attachment.size)}</span>
      )}
    </a>
  );
}

function loadLastSeen() {
  try {
    return JSON.parse(localStorage.getItem("chat-last-seen") || "{}");
  } catch {
    return {};
  }
}

function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // audio not available; notification still shows visually
  }
}

const TASK_STATUS_COLUMNS = [
  { key: "todo", label: "לביצוע" },
  { key: "in_progress", label: "בתהליך" },
  { key: "review", label: "להגהה" },
  { key: "done", label: "הושלם" },
];

const TASK_PRIORITY_LABELS = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };

export default function App() {
  // "auth" | "inbox" | "chat" | "tasks" | "admin"
  const [stage, setStage] = useState("auth");
  const [checkingSession, setCheckingSession] = useState(true);

  const [username, setUsername] = useState("");
  const [myUserId, setMyUserId] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [conversationsError, setConversationsError] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [registeredUsers, setRegisteredUsers] = useState([]);

  const [showNewChat, setShowNewChat] = useState(false);
  const [partnerInput, setPartnerInput] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [formError, setFormError] = useState("");

  const [active, setActive] = useState(null); // { id, type, name }
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [toast, setToast] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [messageActionError, setMessageActionError] = useState("");

  const bottomRef = useRef(null);
  const activeIdRef = useRef(null);
  const usernameRef = useRef("");
  const toastTimerRef = useRef(null);
  const typingSentRef = useRef(false);
  const typingStopTimerRef = useRef(null);
  const typingExpiryTimersRef = useRef(new Map());

  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) מערכת ניהול עובדים` : "מערכת ניהול עובדים";
  }, [unreadCounts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function fetchConversations() {
    authedFetch("conversations")
      .then((data) => setConversations(data.conversations))
      .catch(() => setConversationsError("לא ניתן היה לטעון את רשימת השיחות"));
  }

  function fetchUsers() {
    authedFetch("users")
      .then((data) => setRegisteredUsers(data.users))
      .catch(() => {});
  }

  function fetchTasks(userId) {
    setTasksLoading(true);
    setTasksError("");
    authedFetch(`tasks?assigned_to=${userId}`)
      .then((data) => setTasks(data.tasks))
      .catch(() => setTasksError("לא ניתן היה לטעון את המשימות"))
      .finally(() => setTasksLoading(false));
  }

  function enterTasks() {
    setStage("tasks");
    fetchTasks(myUserId);
  }

  function enterAdmin() {
    setStage("admin");
  }

  async function handleUpdateTaskStatus(taskId, status) {
    const previous = tasks;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await authedFetch(`tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      setTasks(previous);
      setTasksError(err.message);
    }
  }

  async function handleUploadTaskAttachment(taskId, file) {
    setTasksError("");
    try {
      const data = await uploadFile(`tasks/${taskId}/attachments`, file);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, attachments: [...(t.attachments || []), data.attachment] } : t
        )
      );
    } catch (err) {
      setTasksError(err.message);
    }
  }

  function markSeen(conversationId, messageId) {
    if (!messageId) return;
    const seen = loadLastSeen();
    seen[conversationId] = messageId;
    localStorage.setItem("chat-last-seen", JSON.stringify(seen));
    setUnreadCounts((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }

  function enterInbox() {
    setStage("inbox");
    setActive(null);
    setMessages([]);
    fetchConversations();
    fetchUsers();
  }

  // Validate any stored session on load
  useEffect(() => {
    const token = localStorage.getItem("chat-token");
    if (!token) {
      setCheckingSession(false);
      return;
    }
    fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ id, username, role }) => {
        setUsername(username);
        setMyUserId(id);
        setMyRole(role);
        socket.connect();
        socket.emit("authenticate", { token });
        enterInbox();
      })
      .catch(() => {
        localStorage.removeItem("chat-token");
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    socket.on("auth-error", () => {
      localStorage.removeItem("chat-token");
      setUsername("");
      setConversations([]);
      setActive(null);
      setMessages([]);
      setStage("auth");
    });

    socket.on("open-error", (message) => setFormError(message));

    socket.on("opened", ({ id, type, name }) => {
      setActive((prev) => ({
        id,
        type: type || prev?.type,
        name: name || prev?.name,
        isTask: prev?.isTask ?? false,
      }));
      setStage("chat");
      setFormError("");
    });

    socket.on("history", (history) => {
      setMessages(history);
      setTypingUsers([]);
      const lastId = history.length ? history[history.length - 1].id : null;
      if (activeIdRef.current && lastId) markSeen(activeIdRef.current, lastId);
    });

    socket.on("message", (msg) => {
      const isActive = msg.room === activeIdRef.current;

      if (isActive) {
        setMessages((prev) => [...prev, msg]);
        markSeen(msg.room, msg.id);
      } else {
        setUnreadCounts((prev) => ({ ...prev, [msg.room]: (prev[msg.room] || 0) + 1 }));
        if (msg.username !== usernameRef.current) {
          setToast({ conversationId: msg.room, username: msg.username, text: msg.text });
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setToast(null), 4000);
          playPing();
        }
      }

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.room);
        if (idx === -1) {
          fetchConversations();
          return prev;
        }
        const updated = {
          ...prev[idx],
          lastMessage: { id: msg.id, text: msg.text, username: msg.username, createdAt: msg.created_at },
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });
    });

    socket.on("presence", ({ conversationId, users }) => {
      if (conversationId === activeIdRef.current) setOnline(users);
    });

    socket.on("typing", ({ conversationId, username: typer, isTyping }) => {
      if (conversationId !== activeIdRef.current || typer === usernameRef.current) return;

      const timers = typingExpiryTimersRef.current;
      clearTimeout(timers.get(typer));

      if (isTyping) {
        setTypingUsers((prev) => (prev.includes(typer) ? prev : [...prev, typer]));
        timers.set(
          typer,
          setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u !== typer));
          }, 4000)
        );
      } else {
        timers.delete(typer);
        setTypingUsers((prev) => prev.filter((u) => u !== typer));
      }
    });

    socket.on("message-edited", (msg) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === msg.room && c.lastMessage?.id === msg.id
            ? { ...c, lastMessage: { ...c.lastMessage, text: msg.text } }
            : c
        )
      );
    });

    socket.on("message-deleted", (msg) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    });

    socket.on("edit-error", (message) => setMessageActionError(message));
    socket.on("delete-error", (message) => setMessageActionError(message));

    return () => {
      socket.off("auth-error");
      socket.off("open-error");
      socket.off("opened");
      socket.off("history");
      socket.off("message");
      socket.off("presence");
      socket.off("typing");
      socket.off("message-edited");
      socket.off("message-deleted");
      socket.off("edit-error");
      socket.off("delete-error");
    };
  }, []);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    try {
      const data = await api(authMode, {
        username: authName.trim(),
        password: authPassword,
        ...(authMode === "register" ? { email: authEmail.trim() } : {}),
      });
      localStorage.setItem("chat-token", data.token);
      setUsername(data.username);
      setMyUserId(data.id);
      setMyRole(data.role);
      socket.connect();
      socket.emit("authenticate", { token: data.token });
      enterInbox();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthBusy(false);
    }
  }

  function openConversation(row) {
    setFormError("");
    setActive({ id: row.id, type: row.type, name: row.name, isTask: !!row.isTask });
    setMessages([]);
    setPendingAttachment(null);
    setAttachmentError("");
    setShowNewChat(false);
    setShowNewGroup(false);
    setTypingUsers([]);
    setEditingMessageId(null);
    setMessageActionError("");
    socket.emit("open-conversation", { conversationId: row.id });
  }

  function handleStartDm(e) {
    e.preventDefault();
    const clean = partnerInput.trim();
    if (!clean) return;
    setFormError("");
    setActive({ id: null, type: "dm", name: clean });
    setMessages([]);
    setPendingAttachment(null);
    setAttachmentError("");
    setShowNewChat(false);
    setPartnerInput("");
    setTypingUsers([]);
    setEditingMessageId(null);
    setMessageActionError("");
    socket.emit("start-dm", { partner: clean });
  }

  function toggleMember(name) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    setFormError("");
    const cleanName = groupName.trim();
    if (!cleanName) return setFormError("יש להזין שם לקבוצה");
    if (selectedMembers.size < 1) return setFormError("יש לבחור לפחות משתתף אחד נוסף");

    try {
      const data = await authedFetch("groups", {
        method: "POST",
        body: JSON.stringify({ name: cleanName, members: [...selectedMembers] }),
      });
      setShowNewGroup(false);
      setGroupName("");
      setSelectedMembers(new Set());
      openConversation({ id: data.id, type: "group", name: data.name });
    } catch (err) {
      setFormError(err.message);
    }
  }

  function handleBackToInbox() {
    stopTypingNow();
    enterInbox();
  }

  async function handleAttachmentSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachmentError("");
    setAttachmentUploading(true);
    try {
      const data = await uploadFile("uploads", file);
      setPendingAttachment(data.attachment);
    } catch (err) {
      setAttachmentError(err.message);
    } finally {
      setAttachmentUploading(false);
    }
  }

  function handleRemovePendingAttachment() {
    setPendingAttachment(null);
  }

  function stopTypingNow() {
    clearTimeout(typingStopTimerRef.current);
    if (typingSentRef.current) {
      typingSentRef.current = false;
      socket.emit("typing", { isTyping: false });
    }
  }

  function handleDraftChange(value) {
    setDraft(value);
    if (!activeIdRef.current) return;

    if (!typingSentRef.current) {
      typingSentRef.current = true;
      socket.emit("typing", { isTyping: true });
    }
    clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(stopTypingNow, 2000);
  }

  function handleSend(e) {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean && !pendingAttachment) return;
    stopTypingNow();
    socket.emit("message", { text: clean, attachment: pendingAttachment });
    setDraft("");
    setPendingAttachment(null);
  }

  function startEditingMessage(msg) {
    setMessageActionError("");
    setEditingMessageId(msg.id);
    setEditingText(msg.text || "");
  }

  function cancelEditingMessage() {
    setEditingMessageId(null);
    setEditingText("");
  }

  function handleSaveEditedMessage(e) {
    e.preventDefault();
    const clean = editingText.trim();
    if (!clean || editingMessageId == null) return;
    socket.emit("edit-message", { id: editingMessageId, text: clean });
    setEditingMessageId(null);
    setEditingText("");
  }

  function handleDeleteMessage(msg) {
    if (!window.confirm("למחוק את ההודעה?")) return;
    setMessageActionError("");
    socket.emit("delete-message", { id: msg.id });
  }

  function handleLogout() {
    stopTypingNow();
    socket.disconnect();
    localStorage.removeItem("chat-token");
    setUsername("");
    setMyUserId(null);
    setMyRole(null);
    setConversations([]);
    setActive(null);
    setMessages([]);
    setUnreadCounts({});
    setTasks([]);
    setStage("auth");
  }

  function handleToastClick() {
    if (!toast) return;
    const row = conversations.find((c) => c.id === toast.conversationId);
    setToast(null);
    if (row) openConversation(row);
  }

  if (checkingSession) {
    return <div className="screen" />;
  }

  if (stage === "auth") {
    return (
      <div className="screen">
        <form className="join-card" onSubmit={handleAuthSubmit}>
          <h1>מערכת ניהול עובדים</h1>
          <p className="join-card-subtitle">משימות, נוכחות ותקשורת צוותית במקום אחד</p>
          <div className="auth-tabs">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              התחברות
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              הרשמה
            </button>
          </div>
          <input
            autoFocus
            type="text"
            placeholder="שם משתמש"
            value={authName}
            onChange={(e) => setAuthName(e.target.value)}
            maxLength={30}
          />
          {authMode === "register" && (
            <input
              type="email"
              placeholder="כתובת אימייל (שהוזמנה למערכת)"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              maxLength={200}
              required
            />
          )}
          <input
            type="password"
            placeholder="סיסמה"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            maxLength={100}
          />
          {authError && <div className="join-error">{authError}</div>}
          <button type="submit" disabled={authBusy}>
            {authMode === "login" ? "התחבר/י" : "הרשמ/י"}
          </button>
        </form>
      </div>
    );
  }

  let mainContent = null;

  if (stage === "tasks") {
    mainContent = (
      <div className="panel tasks-panel">
        <header className="panel-header">
          <h1>המשימות שלי</h1>
        </header>

        {tasksError && <div className="join-error tasks-error">{tasksError}</div>}

        <main className="tasks-board">
          {TASK_STATUS_COLUMNS.map((col) => {
            const columnTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="tasks-column">
                <div className="tasks-column-header">
                  <span>{col.label}</span>
                  <span className="tasks-column-count">{columnTasks.length}</span>
                </div>
                <div className="tasks-column-body">
                  {columnTasks.map((task) => (
                    <div key={task.id} className="task-card">
                      <span className={`task-priority priority-${task.priority}`}>
                        {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                      </span>
                      <div className="task-title">{task.title}</div>
                      {task.description && (
                        <div className="task-description">{task.description}</div>
                      )}
                      {task.due_date && <div className="task-due">יעד: {task.due_date}</div>}
                      {task.attachments?.length > 0 && (
                        <div className="task-attachments">
                          {task.attachments.map((att) => (
                            <AttachmentView key={att.id} attachment={att} />
                          ))}
                        </div>
                      )}
                      <label className="attach-button task-attach-button">
                        צרף קובץ
                        <input
                          type="file"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) handleUploadTaskAttachment(task.id, file);
                          }}
                        />
                      </label>
                      <select
                        className="task-status-select"
                        value={task.status}
                        onChange={(e) => handleUpdateTaskStatus(task.id, e.target.value)}
                      >
                        {TASK_STATUS_COLUMNS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      {task.conversation_id && (
                        <button
                          type="button"
                          className="task-chat-button"
                          onClick={() =>
                            openConversation({
                              id: task.conversation_id,
                              type: "group",
                              name: task.title,
                              isTask: true,
                            })
                          }
                        >
                          פתח שיחת משימה
                        </button>
                      )}
                    </div>
                  ))}
                  {columnTasks.length === 0 && !tasksLoading && (
                    <p className="empty-hint">אין משימות</p>
                  )}
                </div>
              </div>
            );
          })}
        </main>
      </div>
    );
  } else if (stage === "admin") {
    mainContent = (
      <div className="panel admin-panel">
        <header className="panel-header">
          <h1>{myRole === "admin" ? "מסך ניהול" : "ניהול הצוות"}</h1>
        </header>
        <AdminDashboard myUserId={myUserId} myRole={myRole} />
      </div>
    );
  } else if (stage === "chat") {
    mainContent = (
      <div className="panel chat-panel">
        <header className="panel-header">
          <h1>
            {active?.isTask ? (
              <span className="conv-type-tag task-tag">משימה</span>
            ) : (
              active?.type === "group" && <span className="conv-type-tag">קבוצה</span>
            )}
            {active?.name}
          </h1>
          <div className="presence">
            {online.length > 0
              ? `מחוברים כעת: ${online.join(", ")}`
              : "אין משתמשים מחוברים"}
          </div>
        </header>

        {messageActionError && (
          <div className="join-error composer-error">{messageActionError}</div>
        )}

        <main className="messages">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.username === username ? "mine" : "theirs"}${
                m.deleted_at ? " deleted" : ""
              }`}
            >
              <div className="bubble-meta">
                <span className="bubble-name">{m.username}</span>
                <span className="bubble-time">
                  {formatTime(m.created_at)}
                  {m.edited_at && !m.deleted_at && (
                    <span className="bubble-edited"> · נערך</span>
                  )}
                </span>
              </div>

              {m.deleted_at ? (
                <div className="bubble-text bubble-deleted-text">ההודעה נמחקה</div>
              ) : editingMessageId === m.id ? (
                <form className="bubble-edit-form" onSubmit={handleSaveEditedMessage}>
                  <input
                    type="text"
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    maxLength={2000}
                  />
                  <div className="bubble-edit-actions">
                    <button type="submit">שמירה</button>
                    <button type="button" onClick={cancelEditingMessage}>
                      ביטול
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {m.attachment && <AttachmentView attachment={m.attachment} />}
                  {m.text && <div className="bubble-text">{m.text}</div>}
                </>
              )}

              {!m.deleted_at && m.username === username && editingMessageId !== m.id && (
                <div className="bubble-actions">
                  {m.text && !m.attachment && (
                    <button type="button" onClick={() => startEditingMessage(m)}>
                      עריכה
                    </button>
                  )}
                  <button type="button" onClick={() => handleDeleteMessage(m)}>
                    מחיקה
                  </button>
                </div>
              )}
            </div>
          ))}
          {typingUsers.length > 0 && (
            <div className="typing-indicator">
              {typingUsers.length === 1
                ? `${typingUsers[0]} מקליד/ה...`
                : `${typingUsers.join(", ")} מקלידים...`}
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        {attachmentError && <div className="join-error composer-error">{attachmentError}</div>}

        {pendingAttachment && (
          <div className="pending-attachment">
            <span className="pending-attachment-name">{pendingAttachment.originalName}</span>
            <button type="button" onClick={handleRemovePendingAttachment}>
              הסר
            </button>
          </div>
        )}

        <form className="composer" onSubmit={handleSend}>
          <label className="attach-button">
            {attachmentUploading ? "..." : "צרף קובץ"}
            <input
              type="file"
              onChange={handleAttachmentSelect}
              disabled={attachmentUploading}
              hidden
            />
          </label>
          <input
            type="text"
            placeholder="הקלד/י הודעה..."
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            maxLength={2000}
          />
          <button type="submit">שלח</button>
        </form>
      </div>
    );
  } else {
    mainContent = (
      <div className="panel inbox-panel">
        <div className="inbox-empty">
          <h1>שלום, {username}</h1>
        </div>
      </div>
    );
  }

  return (
    <>
      <TimeClock />
      <div className="app-shell with-time-clock">
        <Sidebar
          username={username}
          myRole={myRole}
          stage={stage}
          activeConversationId={active?.id ?? null}
          conversations={conversations}
          conversationsError={conversationsError}
          unreadCounts={unreadCounts}
          onSelectConversation={openConversation}
          onEnterInbox={enterInbox}
          onEnterTasks={enterTasks}
          onEnterAdmin={enterAdmin}
          onOpenNewChat={() => {
            setShowNewChat(true);
            setShowNewGroup(false);
            setFormError("");
          }}
          onOpenNewGroup={() => {
            setShowNewGroup(true);
            setShowNewChat(false);
            setFormError("");
          }}
          onLogout={handleLogout}
        />

        <div className="app-content">
          {toast && (
            <div className="system-notice toast" onClick={handleToastClick}>
              הודעה חדשה מ-{toast.username}: {toast.text}
            </div>
          )}
          {mainContent}
        </div>
      </div>

      {showNewChat && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowNewChat(false);
          }}
        >
          <form className="modal-panel" onSubmit={handleStartDm}>
            <div className="modal-head">
              <h3>שיחה חדשה</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowNewChat(false)}
                aria-label="סגירה"
              >
                ✕
              </button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="שם המשתמש של הצד השני"
              value={partnerInput}
              onChange={(e) => setPartnerInput(e.target.value)}
              maxLength={30}
            />
            {formError && <div className="join-error">{formError}</div>}
            <button type="submit" className="btn btn-primary">
              התחל/י שיחה
            </button>
            {registeredUsers.length > 0 && (
              <div className="user-list">
                <p className="user-list-title">או בחר/י מהמשתמשים הרשומים:</p>
                {registeredUsers.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="user-list-item"
                    onClick={() => {
                      setPartnerInput(name);
                      setActive({ id: null, type: "dm", name });
                      setMessages([]);
                      setShowNewChat(false);
                      socket.emit("start-dm", { partner: name });
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      )}

      {showNewGroup && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowNewGroup(false);
          }}
        >
          <form className="modal-panel" onSubmit={handleCreateGroup}>
            <div className="modal-head">
              <h3>קבוצה חדשה</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowNewGroup(false)}
                aria-label="סגירה"
              >
                ✕
              </button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="שם הקבוצה"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={50}
            />
            <p className="user-list-title">בחר/י משתתפים:</p>
            <div className="user-list">
              {registeredUsers.map((name) => (
                <label key={name} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(name)}
                    onChange={() => toggleMember(name)}
                  />
                  {name}
                </label>
              ))}
              {registeredUsers.length === 0 && <p>אין עוד משתמשים רשומים.</p>}
            </div>
            {formError && <div className="join-error">{formError}</div>}
            <button type="submit" className="btn btn-primary">
              צור/י קבוצה
            </button>
          </form>
        </div>
      )}
    </>
  );
}
