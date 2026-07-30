const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { Server } = require("socket.io");
const {
  saveMessage,
  getHistory,
  updateMessage,
  deleteMessage,
  createUser,
  findUser,
  findUserById,
  listAllUsers,
  updateUserRole,
  ROLES,
  listOtherUsers,
  getOrCreateDmConversation,
  createGroupConversation,
  getConversationMembers,
  addConversationMember,
  isMember,
  listConversationsForUser,
  TASK_PRIORITIES,
  TASK_STATUSES,
  createTask,
  getTaskById,
  listTasks,
  listAllTasksForAdmin,
  updateTask,
  deleteTask,
  addTaskAttachment,
  createTimeLog,
  getTimeLogById,
  listTimeLogs,
  updateTimeLog,
  getHoursReport,
} = require("./db");
const { hashPassword, verifyPassword, createToken } = require("./auth");
const { upload, uploadsDir } = require("./upload");

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// token -> username
const sessions = new Map();
// socket.id -> { username, activeConversationId }
const clients = new Map();

function broadcastPresence(conversationId) {
  const members = getConversationMembers(conversationId);
  const online = new Set([...clients.values()].map((c) => c.username));
  io.to(conversationId).emit("presence", {
    conversationId,
    users: members.filter((m) => online.has(m)),
  });
}

function broadcastPresenceForUser(username) {
  for (const conv of listConversationsForUser(username)) {
    broadcastPresence(conv.id);
  }
}

app.post("/api/register", (req, res) => {
  const username = String(req.body?.username || "").trim().slice(0, 30);
  const password = String(req.body?.password || "");

  if (username.length < 2) {
    return res.status(400).json({ error: "שם המשתמש חייב להכיל לפחות 2 תווים" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" });
  }
  if (findUser(username)) {
    return res.status(409).json({ error: "שם המשתמש הזה כבר תפוס" });
  }

  const user = createUser(username, hashPassword(password));
  const token = createToken();
  sessions.set(token, user.username);
  res.status(201).json({ token, id: user.id, username: user.username, role: user.role });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim().slice(0, 30);
  const password = String(req.body?.password || "");

  const user = findUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "שם משתמש או סיסמה שגויים" });
  }

  const token = createToken();
  sessions.set(token, user.username);
  res.json({ token, id: user.id, username: user.username, role: user.role });
});

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ error: "לא מחובר/ת" });
  req.username = username;
  next();
}

function requireAdmin(req, res, next) {
  const user = findUser(req.username);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "אין הרשאת מנהל/ת" });
  }
  next();
}

app.get("/api/me", requireAuth, (req, res) => {
  const user = findUser(req.username);
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.get("/api/users", requireAuth, (req, res) => {
  res.json({ users: listOtherUsers(req.username) });
});

app.get("/api/conversations", requireAuth, (req, res) => {
  const rows = listConversationsForUser(req.username);
  const conversations = rows.map((row) => {
    let displayName = row.name;
    if (row.type === "dm") {
      const members = getConversationMembers(row.id);
      displayName =
        members.find((m) => m.toLowerCase() !== req.username.toLowerCase()) || "?";
    }
    return {
      id: row.id,
      type: row.type,
      name: displayName,
      isTask: row.task_id != null,
      lastMessage: row.last_text
        ? {
            id: row.last_id,
            text: row.last_text,
            username: row.last_username,
            createdAt: row.last_at,
          }
        : null,
    };
  });
  res.json({ conversations });
});

app.post("/api/groups", requireAuth, requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 50);
  const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];

  if (!name) {
    return res.status(400).json({ error: "יש להזין שם לקבוצה" });
  }

  const cleanMembers = [...new Set(rawMembers.map((m) => String(m).trim()))].filter(
    (m) => m && m.toLowerCase() !== req.username.toLowerCase()
  );

  const invalid = cleanMembers.find((m) => !findUser(m));
  if (invalid) {
    return res.status(400).json({ error: `לא נמצא משתמש בשם "${invalid}"` });
  }
  if (cleanMembers.length < 1) {
    return res.status(400).json({ error: "יש לבחור לפחות משתתף אחד נוסף לקבוצה" });
  }

  const allMembers = [req.username, ...cleanMembers];
  const id = createGroupConversation(name, allMembers);

  for (const [socketId, client] of clients) {
    if (allMembers.includes(client.username)) {
      io.sockets.sockets.get(socketId)?.join(id);
    }
  }

  res.status(201).json({ id, type: "group", name, members: allMembers });
});

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function toAttachmentJson(row) {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    url: `/uploads/${row.filename}`,
  };
}

function serializeTask(task) {
  return { ...task, attachments: (task.attachments || []).map(toAttachmentJson) };
}

app.post("/api/tasks", requireAuth, (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 200);
  const description =
    req.body?.description != null ? String(req.body.description).slice(0, 5000) : null;
  const dueDate = req.body?.due_date ? String(req.body.due_date) : null;
  const priority = req.body?.priority ? String(req.body.priority) : "medium";
  const status = req.body?.status ? String(req.body.status) : "todo";

  if (!title) {
    return res.status(400).json({ error: "יש להזין כותרת למשימה" });
  }
  if (!TASK_PRIORITIES.includes(priority)) {
    return res
      .status(400)
      .json({ error: `עדיפות לא תקינה, חייבת להיות אחת מ: ${TASK_PRIORITIES.join(", ")}` });
  }
  if (!TASK_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `סטטוס לא תקין, חייב להיות אחד מ: ${TASK_STATUSES.join(", ")}` });
  }

  let assignedTo = null;
  let assignedToUser = null;
  if (req.body?.assigned_to != null && req.body.assigned_to !== "") {
    assignedTo = parseId(req.body.assigned_to);
    assignedToUser = assignedTo !== null ? findUserById(assignedTo) : null;
    if (!assignedToUser) {
      return res.status(400).json({ error: "משתמש לא קיים" });
    }
  }

  const chatMembers = [...new Set([req.username, assignedToUser?.username].filter(Boolean))];
  const conversationId = createGroupConversation(title.slice(0, 50), chatMembers);
  for (const [socketId, client] of clients) {
    if (chatMembers.includes(client.username)) {
      io.sockets.sockets.get(socketId)?.join(conversationId);
    }
  }

  const task = createTask({
    title,
    description,
    assigned_to: assignedTo,
    due_date: dueDate,
    conversation_id: conversationId,
    priority,
    status,
  });
  res.status(201).json({ task: serializeTask(task) });
});

app.get("/api/tasks", requireAuth, (req, res) => {
  const filters = {};
  if (req.query.assigned_to != null) {
    const assignedTo = parseId(req.query.assigned_to);
    if (assignedTo === null) {
      return res.status(400).json({ error: "assigned_to לא תקין" });
    }
    filters.assigned_to = assignedTo;
  }
  if (req.query.status) {
    if (!TASK_STATUSES.includes(req.query.status)) {
      return res
        .status(400)
        .json({ error: `סטטוס לא תקין, חייב להיות אחד מ: ${TASK_STATUSES.join(", ")}` });
    }
    filters.status = req.query.status;
  }
  if (req.query.priority) {
    if (!TASK_PRIORITIES.includes(req.query.priority)) {
      return res
        .status(400)
        .json({ error: `עדיפות לא תקינה, חייבת להיות אחת מ: ${TASK_PRIORITIES.join(", ")}` });
    }
    filters.priority = req.query.priority;
  }
  res.json({ tasks: listTasks(filters).map(serializeTask) });
});

app.get("/api/tasks/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  const task = id !== null && getTaskById(id);
  if (!task) return res.status(404).json({ error: "המשימה לא נמצאה" });
  res.json({ task: serializeTask(task) });
});

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  const existing = id !== null && getTaskById(id);
  if (!existing) return res.status(404).json({ error: "המשימה לא נמצאה" });

  const editorOnlyFields = ["title", "description", "due_date", "priority", "assigned_to"];
  const requestsEditorFields = editorOnlyFields.some((f) => req.body?.[f] !== undefined);
  if (requestsEditorFields) {
    const requestingUser = findUser(req.username);
    if (!requestingUser || requestingUser.role !== "admin") {
      return res.status(403).json({ error: "אין הרשאת מנהל/ת" });
    }
  }

  const fields = {};

  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: "כותרת לא יכולה להיות ריקה" });
    fields.title = title;
  }
  if (req.body?.description !== undefined) {
    fields.description =
      req.body.description != null ? String(req.body.description).slice(0, 5000) : null;
  }
  if (req.body?.due_date !== undefined) {
    fields.due_date = req.body.due_date != null ? String(req.body.due_date) : null;
  }
  if (req.body?.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(req.body.priority)) {
      return res
        .status(400)
        .json({ error: `עדיפות לא תקינה, חייבת להיות אחת מ: ${TASK_PRIORITIES.join(", ")}` });
    }
    fields.priority = req.body.priority;
  }
  if (req.body?.status !== undefined) {
    if (!TASK_STATUSES.includes(req.body.status)) {
      return res
        .status(400)
        .json({ error: `סטטוס לא תקין, חייב להיות אחד מ: ${TASK_STATUSES.join(", ")}` });
    }
    fields.status = req.body.status;
  }
  let newAssigneeUser = null;
  if (req.body?.assigned_to !== undefined) {
    if (req.body.assigned_to == null || req.body.assigned_to === "") {
      fields.assigned_to = null;
    } else {
      const assignedTo = parseId(req.body.assigned_to);
      newAssigneeUser = assignedTo !== null ? findUserById(assignedTo) : null;
      if (!newAssigneeUser) {
        return res.status(400).json({ error: "משתמש לא קיים" });
      }
      fields.assigned_to = assignedTo;
    }
  }

  const task = updateTask(id, fields);

  if (
    newAssigneeUser &&
    newAssigneeUser.id !== existing.assigned_to &&
    task.conversation_id &&
    !isMember(task.conversation_id, newAssigneeUser.username)
  ) {
    addConversationMember(task.conversation_id, newAssigneeUser.username);
    for (const [socketId, client] of clients) {
      if (client.username === newAssigneeUser.username) {
        io.sockets.sockets.get(socketId)?.join(task.conversation_id);
      }
    }
    broadcastPresence(task.conversation_id);
  }

  res.json({ task: serializeTask(task) });
});

app.delete("/api/tasks/:id", requireAuth, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = id !== null && getTaskById(id);
  if (!existing) return res.status(404).json({ error: "המשימה לא נמצאה" });

  for (const attachment of existing.attachments || []) {
    fs.unlink(path.join(uploadsDir, attachment.filename), () => {});
  }

  deleteTask(id);
  res.json({ ok: true });
});

function toAttachmentResponse(file) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/uploads/${file.filename}`,
  };
}

app.post("/api/uploads", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "לא נבחר קובץ" });
  }
  res.status(201).json({ attachment: toAttachmentResponse(req.file) });
});

app.post("/api/tasks/:id/attachments", requireAuth, upload.single("file"), (req, res) => {
  const id = parseId(req.params.id);
  const task = id !== null && getTaskById(id);
  if (!task) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "המשימה לא נמצאה" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "לא נבחר קובץ" });
  }

  const attachment = addTaskAttachment({
    task_id: id,
    filename: req.file.filename,
    original_name: req.file.originalname,
    mime_type: req.file.mimetype,
    size: req.file.size,
    uploaded_by: req.username,
  });
  res.status(201).json({ attachment: toAttachmentJson(attachment) });
});

app.post("/api/time-logs", requireAuth, (req, res) => {
  const currentUser = findUser(req.username);

  let userId = currentUser.id;
  if (req.body?.user_id != null && req.body.user_id !== "") {
    userId = parseId(req.body.user_id);
    if (userId === null || !findUserById(userId)) {
      return res.status(400).json({ error: "משתמש לא קיים" });
    }
  }

  const clockIn = req.body?.clock_in ? String(req.body.clock_in) : new Date().toISOString();
  const clockOut = req.body?.clock_out ? String(req.body.clock_out) : null;

  let taskId = null;
  if (req.body?.task_id != null && req.body.task_id !== "") {
    taskId = parseId(req.body.task_id);
    if (taskId === null || !getTaskById(taskId)) {
      return res.status(400).json({ error: "המשימה לא נמצאה" });
    }
  }

  const timeLog = createTimeLog({ user_id: userId, clock_in: clockIn, clock_out: clockOut, task_id: taskId });
  res.status(201).json({ timeLog });
});

app.get("/api/time-logs", requireAuth, (req, res) => {
  const filters = {};
  if (req.query.user_id != null) {
    const userId = parseId(req.query.user_id);
    if (userId === null) {
      return res.status(400).json({ error: "user_id לא תקין" });
    }
    filters.user_id = userId;
  }
  if (req.query.task_id != null) {
    const taskId = parseId(req.query.task_id);
    if (taskId === null) {
      return res.status(400).json({ error: "task_id לא תקין" });
    }
    filters.task_id = taskId;
  }
  if (req.query.open === "true") {
    filters.open = true;
  }
  res.json({ timeLogs: listTimeLogs(filters) });
});

app.get("/api/time-logs/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  const timeLog = id !== null && getTimeLogById(id);
  if (!timeLog) return res.status(404).json({ error: "רשומת השעון לא נמצאה" });
  res.json({ timeLog });
});

app.patch("/api/time-logs/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  const existing = id !== null && getTimeLogById(id);
  if (!existing) return res.status(404).json({ error: "רשומת השעון לא נמצאה" });

  const fields = {};

  if (req.body?.clock_in !== undefined) {
    fields.clock_in = String(req.body.clock_in);
  }
  if (req.body?.clock_out !== undefined) {
    fields.clock_out = req.body.clock_out != null ? String(req.body.clock_out) : null;
  }
  if (req.body?.task_id !== undefined) {
    if (req.body.task_id == null || req.body.task_id === "") {
      fields.task_id = null;
    } else {
      const taskId = parseId(req.body.task_id);
      if (taskId === null || !getTaskById(taskId)) {
        return res.status(400).json({ error: "המשימה לא נמצאה" });
      }
      fields.task_id = taskId;
    }
  }
  if (req.body?.user_id !== undefined) {
    const userId = parseId(req.body.user_id);
    if (userId === null || !findUserById(userId)) {
      return res.status(400).json({ error: "משתמש לא קיים" });
    }
    fields.user_id = userId;
  }

  const timeLog = updateTimeLog(id, fields);
  res.json({ timeLog });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) => {
  res.json({ users: listAllUsers() });
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const target = id !== null && findUserById(id);
  if (!target) {
    return res.status(404).json({ error: "משתמש/ת לא נמצא/ה" });
  }

  if (req.body?.role === undefined) {
    return res.json({ user: target });
  }
  if (!ROLES.includes(req.body.role)) {
    return res.status(400).json({ error: `תפקיד לא תקין, חייב להיות אחד מ: ${ROLES.join(", ")}` });
  }

  const requestingUser = findUser(req.username);
  if (requestingUser.id === id && req.body.role !== "admin") {
    return res.status(400).json({ error: "אי אפשר לשלול הרשאת מנהל/ת מעצמך/ך" });
  }

  const user = updateUserRole(id, req.body.role);
  res.json({ user });
});

app.get("/api/admin/tasks", requireAuth, requireAdmin, (req, res) => {
  const filters = {};
  if (req.query.assigned_to != null) {
    const assignedTo = parseId(req.query.assigned_to);
    if (assignedTo === null) {
      return res.status(400).json({ error: "assigned_to לא תקין" });
    }
    filters.assigned_to = assignedTo;
  }
  if (req.query.status) {
    if (!TASK_STATUSES.includes(req.query.status)) {
      return res
        .status(400)
        .json({ error: `סטטוס לא תקין, חייב להיות אחד מ: ${TASK_STATUSES.join(", ")}` });
    }
    filters.status = req.query.status;
  }
  if (req.query.priority) {
    if (!TASK_PRIORITIES.includes(req.query.priority)) {
      return res
        .status(400)
        .json({ error: `עדיפות לא תקינה, חייבת להיות אחת מ: ${TASK_PRIORITIES.join(", ")}` });
    }
    filters.priority = req.query.priority;
  }
  res.json({ tasks: listAllTasksForAdmin(filters).map(serializeTask) });
});

app.get("/api/admin/hours-report", requireAuth, requireAdmin, (req, res) => {
  const filters = {};
  if (req.query.from) {
    if (!DATE_RE.test(req.query.from)) {
      return res.status(400).json({ error: "תאריך התחלה לא תקין" });
    }
    filters.from = `${req.query.from}T00:00:00.000Z`;
  }
  if (req.query.to) {
    if (!DATE_RE.test(req.query.to)) {
      return res.status(400).json({ error: "תאריך סיום לא תקין" });
    }
    filters.to = `${req.query.to}T23:59:59.999Z`;
  }
  if (req.query.user_id != null) {
    const userId = parseId(req.query.user_id);
    if (userId === null) {
      return res.status(400).json({ error: "user_id לא תקין" });
    }
    filters.user_id = userId;
  }
  res.json({ report: getHoursReport(filters) });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "הקובץ גדול מדי (מקסימום 10MB)" });
    }
    return res.status(400).json({ error: "שגיאה בהעלאת הקובץ" });
  }
  next(err);
});

io.on("connection", (socket) => {
  socket.on("authenticate", ({ token } = {}) => {
    const username = sessions.get(String(token || ""));
    if (!username) {
      socket.emit("auth-error", "יש להתחבר מחדש");
      return;
    }

    clients.set(socket.id, { username, activeConversationId: null });
    for (const conv of listConversationsForUser(username)) {
      socket.join(conv.id);
    }
    socket.join(`user:${username}`);

    socket.emit("authenticated", { username });
    broadcastPresenceForUser(username);
  });

  socket.on("open-conversation", ({ conversationId } = {}) => {
    const client = clients.get(socket.id);
    if (!client) {
      socket.emit("auth-error", "יש להתחבר מחדש");
      return;
    }
    if (!isMember(conversationId, client.username)) {
      socket.emit("open-error", "אין לך גישה לשיחה הזו");
      return;
    }

    // The conversation may have been created after this socket's last
    // authenticate() call (e.g. someone just started a DM/group with this
    // user), so it might not have joined this Socket.IO room yet.
    socket.join(conversationId);
    client.activeConversationId = conversationId;
    socket.emit("opened", { id: conversationId });
    socket.emit("history", getHistory(conversationId));
    broadcastPresence(conversationId);
  });

  socket.on("start-dm", ({ partner } = {}) => {
    const client = clients.get(socket.id);
    if (!client) {
      socket.emit("auth-error", "יש להתחבר מחדש");
      return;
    }

    const cleanPartner = String(partner || "").trim().slice(0, 30);
    if (!cleanPartner) return;

    if (cleanPartner.toLowerCase() === client.username.toLowerCase()) {
      socket.emit("open-error", "אי אפשר לפתוח שיחה עם עצמך");
      return;
    }
    if (!findUser(cleanPartner)) {
      socket.emit("open-error", `לא נמצא משתמש בשם "${cleanPartner}"`);
      return;
    }

    const id = getOrCreateDmConversation(client.username, cleanPartner);
    socket.join(id);
    client.activeConversationId = id;

    socket.emit("opened", { id, type: "dm", name: cleanPartner });
    socket.emit("history", getHistory(id));
    broadcastPresence(id);
  });

  socket.on("message", ({ text, attachment } = {}) => {
    const client = clients.get(socket.id);
    const clean = String(text || "").trim();
    const safeAttachment =
      attachment && attachment.filename
        ? {
            filename: String(attachment.filename),
            originalName: String(attachment.originalName || attachment.filename).slice(0, 255),
            mimeType: String(attachment.mimeType || "application/octet-stream").slice(0, 100),
            size: Number(attachment.size) || 0,
          }
        : null;
    if (!client || !client.activeConversationId || (!clean && !safeAttachment)) return;

    const saved = saveMessage(
      client.activeConversationId,
      client.username,
      clean.slice(0, 2000),
      safeAttachment
    );
    io.to(client.activeConversationId).emit("message", saved);
  });

  socket.on("edit-message", ({ id, text } = {}) => {
    const client = clients.get(socket.id);
    if (!client) return;
    const messageId = Number(id);
    const clean = String(text || "").trim();
    if (!Number.isInteger(messageId) || !clean) return;

    const updated = updateMessage(messageId, client.username, clean.slice(0, 2000));
    if (!updated) {
      socket.emit("edit-error", "לא ניתן לערוך הודעה זו");
      return;
    }
    io.to(updated.room).emit("message-edited", updated);
  });

  socket.on("delete-message", ({ id } = {}) => {
    const client = clients.get(socket.id);
    if (!client) return;
    const messageId = Number(id);
    if (!Number.isInteger(messageId)) return;

    const deleted = deleteMessage(messageId, client.username);
    if (!deleted) {
      socket.emit("delete-error", "לא ניתן למחוק הודעה זו");
      return;
    }
    io.to(deleted.room).emit("message-deleted", deleted);
  });

  socket.on("typing", ({ isTyping } = {}) => {
    const client = clients.get(socket.id);
    if (!client || !client.activeConversationId) return;
    socket.to(client.activeConversationId).emit("typing", {
      conversationId: client.activeConversationId,
      username: client.username,
      isTyping: !!isTyping,
    });
  });

  socket.on("disconnect", () => {
    const client = clients.get(socket.id);
    clients.delete(socket.id);
    if (client) broadcastPresenceForUser(client.username);
  });
});

server.listen(PORT, () => {
  console.log(`שרת הצ'אט פועל על פורט ${PORT}`);
});
