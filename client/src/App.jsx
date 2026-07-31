import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, authedFetch, uploadFile } from "./api";
import TimeClock from "./TimeClock";
import AdminDashboard from "./AdminDashboard";
import Sidebar from "./Sidebar";
import Inbox from "./Inbox";
import Modal from "./components/Modal";
import ConfirmDialog from "./components/ConfirmDialog";
import EmojiText from "./components/EmojiText";
import EmojiPicker from "./components/EmojiPicker";
import { TASK_STATUS_COLUMNS, TASK_PRIORITY_LABELS } from "./taskMeta";

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
      <span className="attachment-file-name" dir="auto">{attachment.originalName}</span>
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

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function groupReactions(reactions) {
  const map = new Map();
  for (const r of reactions || []) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.username);
  }
  return [...map.entries()].map(([emoji, usernames]) => ({ emoji, usernames }));
}

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
  const [uploadingTaskId, setUploadingTaskId] = useState(null);

  // Lifted out of TimeClock.jsx so the inbox home screen and the top bar
  // can both reflect the same shift without owning two copies of the state.
  const [timeClockOpenLog, setTimeClockOpenLog] = useState(null);
  const [timeClockLoading, setTimeClockLoading] = useState(true);
  const [timeClockBusy, setTimeClockBusy] = useState(false);
  const [timeClockError, setTimeClockError] = useState("");
  const [timeClockNow, setTimeClockNow] = useState(Date.now());
  const [timeClockHasWorkedToday, setTimeClockHasWorkedToday] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [registeredUsersError, setRegisteredUsersError] = useState("");

  const [showNewChat, setShowNewChat] = useState(false);
  const [partnerInput, setPartnerInput] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [formError, setFormError] = useState("");

  const [showManageGroup, setShowManageGroup] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  const [addMemberName, setAddMemberName] = useState("");
  const [manageGroupBusy, setManageGroupBusy] = useState(false);
  const [manageGroupError, setManageGroupError] = useState("");

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [changePasswordBusy, setChangePasswordBusy] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState("");
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);

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
  const [confirmDeleteMessage, setConfirmDeleteMessage] = useState(null);
  const [removedNotice, setRemovedNotice] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [messageMenuFor, setMessageMenuFor] = useState(null);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);

  const bottomRef = useRef(null);
  const activeIdRef = useRef(null);
  const usernameRef = useRef("");
  const toastTimerRef = useRef(null);
  const typingSentRef = useRef(false);
  const typingStopTimerRef = useRef(null);
  const typingExpiryTimersRef = useRef(new Map());
  const reactionPickerRef = useRef(null);
  const messageMenuRef = useRef(null);
  const composerEmojiRef = useRef(null);
  const draftTextareaRef = useRef(null);

  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active]);

  // Close the open reaction picker on outside click or Escape.
  useEffect(() => {
    if (reactionPickerFor == null) return;

    function handlePointerDown(e) {
      if (!reactionPickerRef.current?.contains(e.target)) {
        setReactionPickerFor(null);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setReactionPickerFor(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [reactionPickerFor]);

  // Same pattern for the per-message "⋮" menu (edit/delete).
  useEffect(() => {
    if (messageMenuFor == null) return;

    function handlePointerDown(e) {
      if (!messageMenuRef.current?.contains(e.target)) {
        setMessageMenuFor(null);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setMessageMenuFor(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [messageMenuFor]);

  // Same pattern for the composer's emoji picker.
  useEffect(() => {
    if (!showComposerEmoji) return;

    function handlePointerDown(e) {
      if (!composerEmojiRef.current?.contains(e.target)) {
        setShowComposerEmoji(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setShowComposerEmoji(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showComposerEmoji]);

  function insertEmojiIntoDraft(char) {
    const el = draftTextareaRef.current;
    if (!el) {
      handleDraftChange(draft + char);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + char + draft.slice(end);
    handleDraftChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + char.length;
      el.setSelectionRange(caret, caret);
    });
  }

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) מערכת ניהול עובדות` : "מערכת ניהול עובדות";
  }, [unreadCounts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function fetchConversations() {
    authedFetch("conversations")
      .then((data) => setConversations(data.conversations))
      .catch(() => setConversationsError("לא ניתן היה לטעון את רשימת השיחות"))
      .finally(() => setConversationsLoading(false));
  }

  function fetchUsers() {
    setRegisteredUsersError("");
    authedFetch("users")
      .then((data) => setRegisteredUsers(data.users))
      .catch(() => setRegisteredUsersError("לא ניתן היה לטעון את רשימת המשתמשות"));
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

  function fetchTimeClockStatus() {
    setTimeClockLoading(true);
    setTimeClockError("");
    const todayStr = new Date().toISOString().slice(0, 10);
    Promise.all([
      authedFetch("time-logs?open=true"),
      // Distinguishes "never started today" from "on a break between shifts" -
      // both used to render the same "עוד לא התחלת לעבוד" text.
      authedFetch(`time-logs?from=${todayStr}&to=${todayStr}`),
    ])
      .then(([openData, todayData]) => {
        setTimeClockOpenLog(openData.timeLogs[0] || null);
        setTimeClockHasWorkedToday(todayData.timeLogs.some((log) => log.clock_out));
      })
      .catch(() => setTimeClockError("שגיאה בטעינת שעון הנוכחות"))
      .finally(() => setTimeClockLoading(false));
  }

  useEffect(() => {
    if (!timeClockOpenLog) return;
    const timer = setInterval(() => setTimeClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timeClockOpenLog]);

  async function handleClockIn() {
    setTimeClockBusy(true);
    setTimeClockError("");
    try {
      const data = await authedFetch("time-logs", { method: "POST", body: JSON.stringify({}) });
      setTimeClockOpenLog(data.timeLog);
      setTimeClockNow(Date.now());
    } catch (err) {
      setTimeClockError(err.message);
    } finally {
      setTimeClockBusy(false);
    }
  }

  async function handleClockOut() {
    if (!timeClockOpenLog) return;
    setTimeClockBusy(true);
    setTimeClockError("");
    try {
      await authedFetch(`time-logs/${timeClockOpenLog.id}`, {
        method: "PATCH",
        body: JSON.stringify({ clock_out: new Date().toISOString() }),
      });
      setTimeClockOpenLog(null);
      setTimeClockHasWorkedToday(true);
    } catch (err) {
      setTimeClockError(err.message);
    } finally {
      setTimeClockBusy(false);
    }
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
    setUploadingTaskId(taskId);
    try {
      const data = await uploadFile(`tasks/${taskId}/attachments`, file);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, attachments: [...(t.attachments || []), data.attachment] } : t
        )
      );
    } catch (err) {
      setTasksError(err.message);
    } finally {
      setUploadingTaskId(null);
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

  function enterInbox(userId = myUserId) {
    setStage("inbox");
    setActive(null);
    setMessages([]);
    fetchConversations();
    fetchUsers();
    fetchTimeClockStatus();
    if (userId != null) fetchTasks(userId);
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
        enterInbox(id);
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

    socket.on("message-reactions", ({ id, reactions } = {}) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, reactions } : m)));
    });

    socket.on("edit-error", (message) => setMessageActionError(message));
    socket.on("delete-error", (message) => setMessageActionError(message));

    socket.on("added-to-conversation", () => {
      fetchConversations();
    });

    socket.on("removed-from-conversation", ({ id } = {}) => {
      fetchConversations();
      if (id === activeIdRef.current) {
        setRemovedNotice(true);
        enterInbox();
      }
    });

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
      socket.off("message-reactions");
      socket.off("edit-error");
      socket.off("delete-error");
      socket.off("added-to-conversation");
      socket.off("removed-from-conversation");
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
      enterInbox(data.id);
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
    if (selectedMembers.size < 1) return setFormError("יש לבחור לפחות משתתפת אחת נוספת");

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

  function openManageGroup() {
    if (!active?.id) return;
    setManageGroupError("");
    setAddMemberName("");
    setShowManageGroup(true);
    authedFetch(`conversations/${active.id}/members`)
      .then((data) => setGroupMembers(data.members))
      .catch((err) => setManageGroupError(err.message));
  }

  function closeManageGroup() {
    setShowManageGroup(false);
    setGroupMembers([]);
  }

  async function handleAddGroupMember(e) {
    e.preventDefault();
    const clean = addMemberName.trim();
    if (!clean || !active?.id) return;
    setManageGroupBusy(true);
    setManageGroupError("");
    try {
      const data = await authedFetch(`conversations/${active.id}/members`, {
        method: "POST",
        body: JSON.stringify({ username: clean }),
      });
      setGroupMembers(data.members);
      setAddMemberName("");
    } catch (err) {
      setManageGroupError(err.message);
    } finally {
      setManageGroupBusy(false);
    }
  }

  async function handleRemoveGroupMember(member) {
    if (!active?.id) return;
    setManageGroupBusy(true);
    setManageGroupError("");
    try {
      const data = await authedFetch(`conversations/${active.id}/members/${encodeURIComponent(member)}`, {
        method: "DELETE",
      });
      setGroupMembers(data.members);
    } catch (err) {
      setManageGroupError(err.message);
    } finally {
      setManageGroupBusy(false);
    }
  }

  function openChangePassword() {
    setCurrentPasswordInput("");
    setNewPasswordInput("");
    setChangePasswordError("");
    setChangePasswordSuccess(false);
    setShowChangePassword(true);
  }

  function closeChangePassword() {
    setShowChangePassword(false);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setChangePasswordBusy(true);
    setChangePasswordError("");
    setChangePasswordSuccess(false);
    try {
      await authedFetch("change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setChangePasswordSuccess(true);
    } catch (err) {
      setChangePasswordError(err.message);
    } finally {
      setChangePasswordBusy(false);
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
    setMessageMenuFor(null);
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
    setConfirmDeleteMessage(msg);
    setMessageMenuFor(null);
  }

  function confirmDeleteMessageNow() {
    setMessageActionError("");
    socket.emit("delete-message", { id: confirmDeleteMessage.id });
    setConfirmDeleteMessage(null);
  }

  function handleToggleReaction(messageId, emoji) {
    socket.emit("toggle-reaction", { id: messageId, emoji });
    setReactionPickerFor(null);
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
    return (
      <div className="screen">
        <div className="app-spinner" role="status" aria-label="טוענת..." />
      </div>
    );
  }

  if (stage === "auth") {
    return (
      <div className="screen">
        <form className="join-card" onSubmit={handleAuthSubmit}>
          <img className="join-card-logo" src="/brand/codebloom.svg" alt="" aria-hidden="true" />
          <h1>מערכת ניהול עובדות</h1>
          <p className="join-card-subtitle">משימות, נוכחות ותקשורת צוותית במקום אחד</p>
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "login"}
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
              role="tab"
              aria-selected={authMode === "register"}
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
            placeholder="שם משתמשת"
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
            {authBusy
              ? authMode === "login" ? "מתחברת…" : "נרשמת…"
              : authMode === "login" ? "התחברי" : "הירשמי"}
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
            const headingId = `tasks-column-${col.key}-heading`;
            return (
              <section key={col.key} className="tasks-column" aria-labelledby={headingId}>
                <div className="tasks-column-header">
                  <span id={headingId}>{col.label}</span>
                  <span className="tasks-column-count">{columnTasks.length}</span>
                </div>
                <div className="tasks-column-body">
                  {columnTasks.map((task) => {
                    const isOverdue =
                      task.status !== "done" &&
                      task.due_date &&
                      new Date(task.due_date) < new Date(new Date().toDateString());
                    return (
                      <div key={task.id} className="task-card">
                        <span className={`task-priority priority-${task.priority}`}>
                          {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                        </span>
                        <div className="task-title" dir="auto">
                          {task.title}
                        </div>
                        {task.description && (
                          <div className="task-description" dir="auto">
                            {task.description}
                          </div>
                        )}
                        {task.due_date && (
                          <div className={`task-due${isOverdue ? " overdue" : ""}`}>
                            יעד: {task.due_date}
                          </div>
                        )}
                        {task.attachments?.length > 0 && (
                          <div className="task-attachments">
                            {task.attachments.map((att) => (
                              <AttachmentView key={att.id} attachment={att} />
                            ))}
                          </div>
                        )}
                        <label className="attach-button task-attach-button">
                          {uploadingTaskId === task.id ? "מעלה…" : "צרפי קובץ"}
                          <input
                            type="file"
                            hidden
                            disabled={uploadingTaskId === task.id}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) handleUploadTaskAttachment(task.id, file);
                            }}
                          />
                        </label>
                        <select
                          className="task-status-select"
                          aria-label={`סטטוס המשימה "${task.title}"`}
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
                            className="btn btn-secondary task-chat-button"
                            onClick={() =>
                              openConversation({
                                id: task.conversation_id,
                                type: "group",
                                name: task.title,
                                isTask: true,
                              })
                            }
                          >
                            פתיחת שיחת משימה
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {columnTasks.length === 0 && !tasksLoading && (
                    <p className="empty-hint">אין משימות</p>
                  )}
                </div>
              </section>
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
          <div className={`presence${online.length > 0 ? " online" : ""}`}>
            {online.length > 0
              ? `מחוברות כעת: ${online.join(", ")}`
              : "אין משתמשות מחוברות"}
          </div>
          {active?.type === "group" && myRole === "admin" && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={openManageGroup}>
              ניהול קבוצה
            </button>
          )}
        </header>

        {messageActionError && (
          <div className="join-error composer-error">{messageActionError}</div>
        )}

        <main className="messages" role="log" aria-live="polite">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.username === username ? "mine" : "theirs"}${
                m.deleted_at ? " deleted" : ""
              }`}
            >
              {active?.type === "group" && !m.deleted_at && (
                <div className="bubble-name">{m.username}</div>
              )}

              {m.deleted_at ? (
                <div className="bubble-text bubble-deleted-text">ההודעה נמחקה</div>
              ) : editingMessageId === m.id ? (
                <form className="bubble-edit-form" onSubmit={handleSaveEditedMessage}>
                  <textarea
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEditedMessage(e);
                      }
                    }}
                    maxLength={2000}
                    rows={1}
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
                  {m.text && (
                    <div className="bubble-text" dir="auto">
                      <EmojiText text={m.text} />
                    </div>
                  )}
                </>
              )}

              {!m.deleted_at && editingMessageId !== m.id && (
                <div className="bubble-reactions" ref={m.id === reactionPickerFor ? reactionPickerRef : null}>
                  {groupReactions(m.reactions).map(({ emoji, usernames }) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`reaction-chip${usernames.includes(username) ? " mine" : ""}`}
                      title={usernames.join(", ")}
                      onClick={() => handleToggleReaction(m.id, emoji)}
                    >
                      <EmojiText text={emoji} /> {usernames.length}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="reaction-add"
                    aria-label="הוספת ריאקציה"
                    onClick={() =>
                      setReactionPickerFor((prev) => (prev === m.id ? null : m.id))
                    }
                  >
                    <EmojiText text="😊" />+
                  </button>
                  {reactionPickerFor === m.id && (
                    <div className="reaction-picker">
                      {REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={emoji}
                          onClick={() => handleToggleReaction(m.id, emoji)}
                        >
                          <EmojiText text={emoji} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {editingMessageId !== m.id && (
                <div className="bubble-footer">
                  <span className="bubble-time">
                    {formatTime(m.created_at)}
                    {m.edited_at && !m.deleted_at && (
                      <span className="bubble-edited"> · נערך</span>
                    )}
                  </span>
                  {!m.deleted_at && m.username === username && (
                    <div
                      className="menu-wrap bubble-menu-wrap"
                      ref={m.id === messageMenuFor ? messageMenuRef : null}
                    >
                      <button
                        type="button"
                        className="menu-trigger"
                        aria-label="פעולות נוספות על ההודעה"
                        onClick={() =>
                          setMessageMenuFor((prev) => (prev === m.id ? null : m.id))
                        }
                      >
                        ⋮
                      </button>
                      {messageMenuFor === m.id && (
                        <div className="menu-dropdown">
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
                  )}
                </div>
              )}
            </div>
          ))}
          {typingUsers.length > 0 && (
            <div className="typing-indicator">
              {typingUsers.length === 1
                ? `${typingUsers[0]} מקלידה`
                : `${typingUsers.join(", ")} מקלידות`}
              <span className="typing-dots" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        {attachmentError && <div className="join-error composer-error">{attachmentError}</div>}

        {pendingAttachment && (
          <div className="pending-attachment">
            <span className="pending-attachment-name">{pendingAttachment.originalName}</span>
            <button type="button" onClick={handleRemovePendingAttachment}>
              הסירי
            </button>
          </div>
        )}

        <form className="composer" onSubmit={handleSend}>
          <label className="attach-button">
            {attachmentUploading ? "..." : "צרפי קובץ"}
            <input
              type="file"
              onChange={handleAttachmentSelect}
              disabled={attachmentUploading}
              hidden
            />
          </label>
          <div className="menu-wrap composer-emoji-wrap" ref={composerEmojiRef}>
            <button
              type="button"
              className="emoji-trigger"
              aria-label="הוספת אימוג'י"
              onClick={() => setShowComposerEmoji((prev) => !prev)}
            >
              <EmojiText text="😊" />
            </button>
            {showComposerEmoji && (
              <div className="emoji-picker-panel">
                <EmojiPicker
                  onSelect={(char) => {
                    insertEmojiIntoDraft(char);
                    setShowComposerEmoji(false);
                  }}
                />
              </div>
            )}
          </div>
          <textarea
            ref={draftTextareaRef}
            placeholder="הקלידי הודעה..."
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            maxLength={2000}
            rows={1}
          />
          <button type="submit">שלחי</button>
        </form>
      </div>
    );
  } else {
    mainContent = (
      <div className="panel inbox-panel">
        <Inbox
          username={username}
          myRole={myRole}
          tasks={tasks}
          tasksLoading={tasksLoading}
          conversations={conversations}
          conversationsLoading={conversationsLoading}
          unreadCounts={unreadCounts}
          timeClockOpenLog={timeClockOpenLog}
          timeClockLoading={timeClockLoading}
          timeClockBusy={timeClockBusy}
          timeClockError={timeClockError}
          timeClockHasWorkedToday={timeClockHasWorkedToday}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          onSelectConversation={openConversation}
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
        />
      </div>
    );
  }

  return (
    <>
      <TimeClock
        openLog={timeClockOpenLog}
        loading={timeClockLoading}
        busy={timeClockBusy}
        error={timeClockError}
        now={timeClockNow}
        hasWorkedToday={timeClockHasWorkedToday}
        onClockIn={handleClockIn}
        onClockOut={handleClockOut}
      />
      <div className="app-shell with-time-clock">
        <Sidebar
          username={username}
          myRole={myRole}
          stage={stage}
          activeConversationId={active?.id ?? null}
          conversations={conversations}
          conversationsLoading={conversationsLoading}
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
          onOpenChangePassword={openChangePassword}
          onLogout={handleLogout}
        />

        <div className="app-content">
          {toast && (
            <div className="toast" role="status" aria-live="polite">
              <button type="button" className="toast-body" onClick={handleToastClick}>
                הודעה חדשה מ-{toast.username}: {toast.text}
              </button>
              <button
                type="button"
                className="toast-close"
                aria-label="סגירה"
                onClick={(e) => {
                  e.stopPropagation();
                  setToast(null);
                }}
              >
                ✕
              </button>
            </div>
          )}
          {removedNotice && (
            <div className="banner" role="status">
              הוסרת מהקבוצה הזו{" "}
              <button
                type="button"
                className="toast-close"
                aria-label="סגירה"
                onClick={() => setRemovedNotice(false)}
              >
                ✕
              </button>
            </div>
          )}
          {mainContent}
        </div>
      </div>

      <Modal open={showNewChat} onClose={() => setShowNewChat(false)} onSubmit={handleStartDm} title="שיחה חדשה">
        <input
          autoFocus
          type="text"
          placeholder="שם המשתמשת של הצד השני"
          value={partnerInput}
          onChange={(e) => setPartnerInput(e.target.value)}
          maxLength={30}
        />
        {formError && <div className="join-error">{formError}</div>}
        {registeredUsersError && <div className="join-error">{registeredUsersError}</div>}
        <button type="submit" className="btn btn-primary">
          התחילי שיחה
        </button>
        {registeredUsers.length > 0 && (
          <div className="user-list">
            <p className="user-list-title">או בחרי מהמשתמשות הרשומות:</p>
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
      </Modal>

      <Modal open={showNewGroup} onClose={() => setShowNewGroup(false)} onSubmit={handleCreateGroup} title="קבוצה חדשה">
        <input
          autoFocus
          type="text"
          placeholder="שם הקבוצה"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          maxLength={50}
        />
        <p className="user-list-title">בחרי משתתפות:</p>
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
          {registeredUsers.length === 0 && <p>אין עוד משתמשות רשומות.</p>}
        </div>
        {formError && <div className="join-error">{formError}</div>}
        {registeredUsersError && <div className="join-error">{registeredUsersError}</div>}
        <button type="submit" className="btn btn-primary">
          צרי קבוצה
        </button>
      </Modal>

      <Modal open={showManageGroup} onClose={closeManageGroup} title="ניהול חברות בקבוצה">
        {manageGroupError && <div className="join-error">{manageGroupError}</div>}

        <div className="user-list">
          {groupMembers.map((name) => (
            <div key={name} className="checkbox-row checkbox-row--split">
              <span dir="auto">{name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                disabled={manageGroupBusy}
                onClick={() => handleRemoveGroupMember(name)}
              >
                הסירי
              </button>
            </div>
          ))}
          {groupMembers.length === 0 && <p>אין עדיין חברות בקבוצה.</p>}
        </div>

        <form className="admin-filters" onSubmit={handleAddGroupMember}>
          <input
            type="text"
            list="registered-users-list"
            placeholder="שם משתמשת להוספה"
            value={addMemberName}
            onChange={(e) => setAddMemberName(e.target.value)}
            maxLength={30}
          />
          <datalist id="registered-users-list">
            {registeredUsers
              .filter((name) => !groupMembers.includes(name))
              .map((name) => (
                <option key={name} value={name} />
              ))}
          </datalist>
          <button type="submit" className="btn btn-primary" disabled={manageGroupBusy}>
            הוספה
          </button>
        </form>
      </Modal>

      <Modal
        open={showChangePassword}
        onClose={closeChangePassword}
        onSubmit={handleChangePassword}
        title="שינוי סיסמה"
      >
        <input
          autoFocus
          type="password"
          placeholder="סיסמה נוכחית"
          value={currentPasswordInput}
          onChange={(e) => setCurrentPasswordInput(e.target.value)}
          maxLength={100}
        />
        <input
          type="password"
          placeholder="סיסמה חדשה (לפחות 6 תווים)"
          value={newPasswordInput}
          onChange={(e) => setNewPasswordInput(e.target.value)}
          maxLength={100}
        />
        {changePasswordError && <div className="join-error">{changePasswordError}</div>}
        {changePasswordSuccess && (
          <div className="alert alert-success">הסיסמה עודכנה בהצלחה</div>
        )}
        <button type="submit" className="btn btn-primary" disabled={changePasswordBusy}>
          {changePasswordBusy ? "מעדכנת..." : "עדכני סיסמה"}
        </button>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteMessage != null}
        title="מחיקת הודעה"
        message="למחוק את ההודעה? הפעולה אינה הפיכה."
        confirmLabel="מחיקה"
        danger
        onConfirm={confirmDeleteMessageNow}
        onCancel={() => setConfirmDeleteMessage(null)}
      />
    </>
  );
}
