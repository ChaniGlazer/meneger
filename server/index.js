require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");
const {
  init,
  saveMessage,
  getHistory,
  updateMessage,
  deleteMessage,
  toggleReaction,
  getMessageRoom,
  registerUser,
  findUser,
  updateUserPassword,
  findUserById,
  listAllUsers,
  listTeamMembers,
  updateUserRole,
  updateUserTeamLead,
  listTeams,
  createTeam,
  renameTeam,
  deleteTeam,
  getTeamMembers,
  setUserTeamId,
  addInvite,
  listInvites,
  removeInvite,
  findUserByEmail,
  createPasswordReset,
  findPasswordReset,
  markPasswordResetUsed,
  ROLES,
  listOtherUsers,
  getOrCreateDmConversation,
  createGroupConversation,
  getConversationById,
  getConversationMembers,
  addConversationMember,
  removeConversationMember,
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
  deleteTimeLog,
  getHoursReport,
} = require("./db");
const { hashPassword, verifyPassword, createToken } = require("./auth");
const { upload, saveToStorage, deleteFromStorage, getPublicUrl } = require("./upload");
const { sendEmail } = require("./mailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const PORT = process.env.PORT || 4000;

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json());

// Login/register/forgot-password/reset-password are the only endpoints an
// attacker can hit without already having a valid token, which makes them
// the ones worth throttling against brute-force/spam — everything else
// requires requireAuth first.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "יותר מדי ניסיונות, נסי שוב בעוד כמה דקות" },
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Wraps an async Express handler/middleware so a rejected promise reaches
// Express's error pipeline instead of turning into an unhandled rejection.
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// token -> username
const sessions = new Map();
// socket.id -> { username, activeConversationId }
const clients = new Map();

// socket.id -> { count, windowStart } — a basic fixed-window throttle
// against message flooding, since Socket.IO events bypass the REST
// rate limiter entirely.
const messageRateLimits = new Map();
const MESSAGE_RATE_WINDOW_MS = 10 * 1000;
const MESSAGE_RATE_MAX = 20;
function isMessageRateLimited(socketId) {
  const now = Date.now();
  const entry = messageRateLimits.get(socketId);
  if (!entry || now - entry.windowStart > MESSAGE_RATE_WINDOW_MS) {
    messageRateLimits.set(socketId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MESSAGE_RATE_MAX;
}

async function broadcastPresence(conversationId) {
  const members = await getConversationMembers(conversationId);
  const online = new Set([...clients.values()].map((c) => c.username));
  io.to(conversationId).emit("presence", {
    conversationId,
    users: members.filter((m) => online.has(m)),
  });
}

async function broadcastPresenceForUser(username) {
  for (const conv of await listConversationsForUser(username)) {
    await broadcastPresence(conv.id);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post(
  "/api/register",
  authRateLimit,
  ah(async (req, res) => {
    const username = String(req.body?.username || "").trim().slice(0, 30);
    const password = String(req.body?.password || "");
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);

    if (username.length < 2) {
      return res.status(400).json({ error: "שם המשתמשת חייב להכיל לפחות 2 תווים" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 8 תווים" });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "יש להזין כתובת אימייל תקינה" });
    }
    // The very first account bootstraps the system as admin and doesn't need
    // an invite; every account after that must be pre-approved by an admin.
    // registerUser() runs the username/invite checks and the insert inside
    // one locked transaction, so two concurrent registrations can't both
    // become "the first admin" or both consume the same invite.
    let user;
    try {
      user = await registerUser({ username, passwordHash: hashPassword(password), email });
    } catch (err) {
      if (err.code === "USERNAME_TAKEN") return res.status(409).json({ error: err.message });
      if (err.code === "NOT_INVITED") return res.status(403).json({ error: err.message });
      if (err.code === "INVITE_USED") return res.status(409).json({ error: err.message });
      throw err;
    }

    const token = createToken();
    sessions.set(token, user.username);
    res.status(201).json({ token, id: user.id, username: user.username, role: user.role });
  })
);

app.post(
  "/api/login",
  authRateLimit,
  ah(async (req, res) => {
    const username = String(req.body?.username || "").trim().slice(0, 30);
    const password = String(req.body?.password || "");

    const user = await findUser(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "שם משתמשת או סיסמה שגויים" });
    }

    const token = createToken();
    sessions.set(token, user.username);
    res.json({ token, id: user.id, username: user.username, role: user.role });
  })
);

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ error: "לא מחוברת" });
  req.username = username;
  req.token = token;
  next();
}

// The only way to invalidate a token before now was restarting the whole
// server (logging everyone out at once) — this lets a single session end
// on its own, e.g. so a stolen/shared token can be revoked by logging out.
app.post(
  "/api/logout",
  requireAuth,
  ah(async (req, res) => {
    sessions.delete(req.token);
    res.json({ ok: true });
  })
);

const requireAdmin = ah(async (req, res, next) => {
  const user = await findUser(req.username);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "אין הרשאת מנהלת" });
  }
  next();
});

const requireTeamLeadOrAdmin = ah(async (req, res, next) => {
  const user = await findUser(req.username);
  if (!user || (user.role !== "admin" && user.role !== "team_lead")) {
    return res.status(403).json({ error: "אין הרשאה" });
  }
  req.currentUser = user;
  next();
});

app.get(
  "/api/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await findUser(req.username);
    res.json({ id: user.id, username: user.username, role: user.role });
  })
);

app.post(
  "/api/change-password",
  requireAuth,
  ah(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "הסיסמה החדשה חייבת להכיל לפחות 8 תווים" });
    }

    const user = await findUser(req.username);
    if (!verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "הסיסמה הנוכחית שגויה" });
    }

    await updateUserPassword(req.username, hashPassword(newPassword));
    res.json({ ok: true });
  })
);

app.post(
  "/api/forgot-password",
  authRateLimit,
  ah(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "יש להזין כתובת אימייל תקינה" });
    }

    const user = await findUserByEmail(email);
    if (user) {
      const token = createToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await createPasswordReset(user.id, token, expiresAt);
      const origin = `${req.protocol}://${req.get("host")}`;
      const resetUrl = `${origin}/?reset=${token}`;
      try {
        await sendEmail({
          to: email,
          toName: user.username,
          subject: "איפוס סיסמה — מערכת ניהול עובדות",
          html: `<p>שלום ${user.username},</p><p>התקבלה בקשה לאיפוס הסיסמה שלך. לחצי על הקישור הבא כדי לבחור סיסמה חדשה (בתוקף לשעה אחת):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>אם לא ביקשת זאת, אפשר להתעלם מההודעה הזו.</p>`,
          text: `התקבלה בקשה לאיפוס הסיסמה שלך. הקישור בתוקף לשעה אחת: ${resetUrl}`,
        });
      } catch (err) {
        console.error("Failed to send password reset email:", err.message);
      }
    }

    // Same response whether or not the email is registered — otherwise the
    // response itself would let anyone probe which addresses have accounts.
    res.json({ ok: true });
  })
);

app.post(
  "/api/reset-password",
  authRateLimit,
  ah(async (req, res) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!token) {
      return res.status(400).json({ error: "קישור לא תקין" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 8 תווים" });
    }

    const reset = await findPasswordReset(token);
    if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ error: "הקישור לאיפוס הסיסמה אינו תקין או שפג תוקפו" });
    }

    await updateUserPassword(reset.username, hashPassword(password));
    await markPasswordResetUsed(token);
    res.json({ ok: true });
  })
);

app.get(
  "/api/users",
  requireAuth,
  ah(async (req, res) => {
    res.json({ users: await listOtherUsers(req.username) });
  })
);

app.get(
  "/api/conversations",
  requireAuth,
  ah(async (req, res) => {
    const rows = await listConversationsForUser(req.username);
    const conversations = await Promise.all(
      rows.map(async (row) => {
        let displayName = row.name;
        if (row.type === "dm") {
          const members = await getConversationMembers(row.id);
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
      })
    );
    res.json({ conversations });
  })
);

app.post(
  "/api/groups",
  requireAuth,
  requireTeamLeadOrAdmin,
  ah(async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 50);
    const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];

    if (!name) {
      return res.status(400).json({ error: "יש להזין שם לקבוצה" });
    }
    if (rawMembers.length > 200) {
      return res.status(400).json({ error: "יותר מדי חברות בבת אחת (מקסימום 200)" });
    }

    const cleanMembers = [...new Set(rawMembers.map((m) => String(m).trim()))].filter(
      (m) => m && m.toLowerCase() !== req.username.toLowerCase()
    );

    for (const m of cleanMembers) {
      if (!(await findUser(m))) {
        return res.status(400).json({ error: `לא נמצאה משתמשת בשם "${m}"` });
      }
    }
    if (cleanMembers.length < 1) {
      return res.status(400).json({ error: "יש לבחור לפחות משתתפת אחת נוספת לקבוצה" });
    }

    const allMembers = [req.username, ...cleanMembers];
    const id = await createGroupConversation(name, allMembers);

    for (const [socketId, client] of clients) {
      if (allMembers.includes(client.username)) {
        io.sockets.sockets.get(socketId)?.join(id);
      }
    }

    res.status(201).json({ id, type: "group", name, members: allMembers });
  })
);

async function requireGroupConversation(req, res) {
  const conversation = await getConversationById(req.params.id);
  if (!conversation || conversation.type !== "group") {
    res.status(404).json({ error: "הקבוצה לא נמצאה" });
    return null;
  }
  return conversation;
}

app.get(
  "/api/conversations/:id/members",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const conversation = await requireGroupConversation(req, res);
    if (!conversation) return;
    res.json({ members: await getConversationMembers(conversation.id) });
  })
);

app.post(
  "/api/conversations/:id/members",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const conversation = await requireGroupConversation(req, res);
    if (!conversation) return;

    const username = String(req.body?.username || "").trim().slice(0, 30);
    if (!username || !(await findUser(username))) {
      return res.status(400).json({ error: `לא נמצאה משתמשת בשם "${username}"` });
    }
    if (await isMember(conversation.id, username)) {
      return res.status(409).json({ error: "המשתמשת כבר חברה בקבוצה" });
    }

    await addConversationMember(conversation.id, username);
    for (const [socketId, client] of clients) {
      if (client.username === username) {
        io.sockets.sockets.get(socketId)?.join(conversation.id);
      }
    }
    io.to(`user:${username}`).emit("added-to-conversation", { id: conversation.id, name: conversation.name });
    await broadcastPresence(conversation.id);

    res.status(201).json({ members: await getConversationMembers(conversation.id) });
  })
);

app.delete(
  "/api/conversations/:id/members/:username",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const conversation = await requireGroupConversation(req, res);
    if (!conversation) return;

    const username = String(req.params.username || "").trim();
    if (!(await isMember(conversation.id, username))) {
      return res.status(404).json({ error: "המשתמשת אינה חברה בקבוצה" });
    }

    await removeConversationMember(conversation.id, username);
    for (const [socketId, client] of clients) {
      if (client.username === username) {
        io.sockets.sockets.get(socketId)?.leave(conversation.id);
      }
    }
    io.to(`user:${username}`).emit("removed-from-conversation", { id: conversation.id });
    await broadcastPresence(conversation.id);

    res.json({ members: await getConversationMembers(conversation.id) });
  })
);

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
    url: getPublicUrl(row.filename),
  };
}

function serializeTask(task) {
  return { ...task, attachments: (task.attachments || []).map(toAttachmentJson) };
}

app.post(
  "/api/tasks",
  requireAuth,
  ah(async (req, res) => {
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

    const rawAssignees = Array.isArray(req.body?.assigned_to)
      ? req.body.assigned_to
      : req.body?.assigned_to != null && req.body.assigned_to !== ""
      ? [req.body.assigned_to]
      : [];
    const assigneeIds = [...new Set(rawAssignees.map(parseId))];
    if (assigneeIds.some((id) => id === null)) {
      return res.status(400).json({ error: "משתמשת לא קיימת" });
    }
    const assigneeUsers = [];
    for (const id of assigneeIds) {
      const user = await findUserById(id);
      if (!user) {
        return res.status(400).json({ error: "משתמשת לא קיימת" });
      }
      assigneeUsers.push(user);
    }

    let teamId = null;
    let teamMembers = [];
    if (req.body?.team_id != null && req.body.team_id !== "") {
      teamId = parseId(req.body.team_id);
      if (teamId === null) {
        return res.status(400).json({ error: "צוות לא תקין" });
      }
      teamMembers = await getTeamMembers(teamId);
      if (teamMembers.length === 0) {
        return res.status(400).json({ error: "הצוות לא נמצא" });
      }
    }

    const chatMembers = [
      ...new Set([
        req.username,
        ...assigneeUsers.map((u) => u.username),
        ...teamMembers.map((u) => u.username),
      ]),
    ];
    const conversationId = await createGroupConversation(title.slice(0, 50), chatMembers);
    for (const [socketId, client] of clients) {
      if (chatMembers.includes(client.username)) {
        io.sockets.sockets.get(socketId)?.join(conversationId);
      }
    }

    const task = await createTask({
      title,
      description,
      assignee_ids: assigneeIds,
      due_date: dueDate,
      conversation_id: conversationId,
      priority,
      status,
      team_id: teamId,
    });
    res.status(201).json({ task: serializeTask(task) });
  })
);

app.get(
  "/api/tasks",
  requireAuth,
  ah(async (req, res) => {
    // Scoped to the requesting user's own tasks (assignee or her team) —
    // any assigned_to the client sends is ignored, since this route must
    // never be usable to browse another employee's tasks.
    const currentUser = await findUser(req.username);
    const filters = {
      visibleToUserId: currentUser.id,
      visibleToTeamId: currentUser.team_id,
    };
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
    const tasks = await listTasks(filters);
    res.json({ tasks: tasks.map(serializeTask) });
  })
);

// A task is visible/usable by a plain employee only if she's an explicit
// assignee or the task belongs to her team — same rule GET /api/tasks
// already applies via listTasks()'s visibleToUserId/visibleToTeamId.
// Admins can always access every task.
function canAccessTask(user, task) {
  if (!user || !task) return false;
  if (user.role === "admin") return true;
  if ((task.assignees || []).some((a) => a.id === user.id)) return true;
  if (user.team_id != null && task.team_id === user.team_id) return true;
  return false;
}

app.get(
  "/api/tasks/:id",
  requireAuth,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id !== null && (await getTaskById(id));
    if (!task) return res.status(404).json({ error: "המשימה לא נמצאה" });
    const requestingUser = await findUser(req.username);
    if (!canAccessTask(requestingUser, task)) {
      return res.status(403).json({ error: "אין לך גישה למשימה הזו" });
    }
    res.json({ task: serializeTask(task) });
  })
);

app.patch(
  "/api/tasks/:id",
  requireAuth,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id !== null && (await getTaskById(id));
    if (!existing) return res.status(404).json({ error: "המשימה לא נמצאה" });

    const requestingUser = await findUser(req.username);
    const editorOnlyFields = ["title", "description", "due_date", "priority", "assigned_to", "team_id"];
    const requestsEditorFields = editorOnlyFields.some((f) => req.body?.[f] !== undefined);
    if (requestsEditorFields) {
      if (!requestingUser || requestingUser.role !== "admin") {
        return res.status(403).json({ error: "אין הרשאת מנהלת" });
      }
    } else if (!canAccessTask(requestingUser, existing)) {
      // Non-editor fields (currently just `status`) may be changed by
      // anyone who can see the task — but only if she can see it.
      return res.status(403).json({ error: "אין לך גישה למשימה הזו" });
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
    let newAssigneeUsers = null;
    if (req.body?.assigned_to !== undefined) {
      const rawAssignees = Array.isArray(req.body.assigned_to)
        ? req.body.assigned_to
        : req.body.assigned_to != null && req.body.assigned_to !== ""
        ? [req.body.assigned_to]
        : [];
      const ids = [...new Set(rawAssignees.map(parseId))];
      if (ids.some((assigneeId) => assigneeId === null)) {
        return res.status(400).json({ error: "משתמשת לא קיימת" });
      }
      newAssigneeUsers = [];
      for (const assigneeId of ids) {
        const user = await findUserById(assigneeId);
        if (!user) return res.status(400).json({ error: "משתמשת לא קיימת" });
        newAssigneeUsers.push(user);
      }
      fields.assignee_ids = ids;
    }

    let newTeamMembers = [];
    if (req.body?.team_id !== undefined) {
      if (req.body.team_id == null || req.body.team_id === "") {
        fields.team_id = null;
      } else {
        const teamId = parseId(req.body.team_id);
        if (teamId === null) {
          return res.status(400).json({ error: "צוות לא תקין" });
        }
        newTeamMembers = await getTeamMembers(teamId);
        if (newTeamMembers.length === 0) {
          return res.status(400).json({ error: "הצוות לא נמצא" });
        }
        fields.team_id = teamId;
      }
    }

    const task = await updateTask(id, fields);

    const usersToJoinChat = [...(newAssigneeUsers || []), ...newTeamMembers];
    if (usersToJoinChat.length > 0 && task.conversation_id) {
      for (const user of usersToJoinChat) {
        if (!(await isMember(task.conversation_id, user.username))) {
          await addConversationMember(task.conversation_id, user.username);
          for (const [socketId, client] of clients) {
            if (client.username === user.username) {
              io.sockets.sockets.get(socketId)?.join(task.conversation_id);
            }
          }
        }
      }
      await broadcastPresence(task.conversation_id);
    }

    res.json({ task: serializeTask(task) });
  })
);

app.delete(
  "/api/tasks/:id",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id !== null && (await getTaskById(id));
    if (!existing) return res.status(404).json({ error: "המשימה לא נמצאה" });

    for (const attachment of existing.attachments || []) {
      deleteFromStorage(attachment.filename).catch(() => {});
    }

    await deleteTask(id);
    res.json({ ok: true });
  })
);

function toAttachmentResponse(file, filename) {
  return {
    filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: getPublicUrl(filename),
  };
}

app.post(
  "/api/uploads",
  requireAuth,
  upload.single("file"),
  ah(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "לא נבחר קובץ" });
    }
    const filename = await saveToStorage(req.file);
    res.status(201).json({ attachment: toAttachmentResponse(req.file, filename) });
  })
);

app.post(
  "/api/tasks/:id/attachments",
  requireAuth,
  upload.single("file"),
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id !== null && (await getTaskById(id));
    if (!task) {
      return res.status(404).json({ error: "המשימה לא נמצאה" });
    }
    const requestingUser = await findUser(req.username);
    if (!canAccessTask(requestingUser, task)) {
      return res.status(403).json({ error: "אין לך גישה למשימה הזו" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "לא נבחר קובץ" });
    }

    const filename = await saveToStorage(req.file);
    const attachment = await addTaskAttachment({
      task_id: id,
      filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      uploaded_by: req.username,
    });
    res.status(201).json({ attachment: toAttachmentJson(attachment) });
  })
);

app.post(
  "/api/time-logs",
  requireAuth,
  ah(async (req, res) => {
    const currentUser = await findUser(req.username);

    let userId = currentUser.id;
    if (req.body?.user_id != null && req.body.user_id !== "") {
      const requestedId = parseId(req.body.user_id);
      if (requestedId === null || !(await findUserById(requestedId))) {
        return res.status(400).json({ error: "משתמשת לא קיימת" });
      }
      // Anyone can clock themself in; creating a record for someone else is
      // an admin-only action (previously anyone could log hours for anyone).
      if (requestedId !== currentUser.id && currentUser.role !== "admin") {
        return res.status(403).json({ error: "אין הרשאת מנהלת" });
      }
      userId = requestedId;
    }

    const clockIn = req.body?.clock_in ? String(req.body.clock_in) : new Date().toISOString();
    const clockOut = req.body?.clock_out ? String(req.body.clock_out) : null;

    let taskId = null;
    if (req.body?.task_id != null && req.body.task_id !== "") {
      taskId = parseId(req.body.task_id);
      if (taskId === null || !(await getTaskById(taskId))) {
        return res.status(400).json({ error: "המשימה לא נמצאה" });
      }
    }

    let timeLog;
    try {
      timeLog = await createTimeLog({ user_id: userId, clock_in: clockIn, clock_out: clockOut, task_id: taskId });
    } catch (err) {
      // Unique violation on time_logs_one_open_shift_per_user — a "כניסה"
      // is already open for this user.
      if (err.code === "23505") {
        return res.status(409).json({ error: "כבר קיימת כניסה פתוחה למשתמשת הזו" });
      }
      throw err;
    }
    res.status(201).json({ timeLog });
  })
);

app.get(
  "/api/time-logs",
  requireAuth,
  ah(async (req, res) => {
    const currentUser = await findUser(req.username);
    const filters = {};

    if (req.query.user_id != null) {
      const userId = parseId(req.query.user_id);
      if (userId === null) {
        return res.status(400).json({ error: "user_id לא תקין" });
      }
      // Seeing someone else's clock records is an admin-only action
      // (previously anyone could query any user_id and see their records -
      // this also meant the time clock could show a DIFFERENT employee's
      // open shift as if it were your own, since no filter was applied by
      // default and this endpoint just returned the newest match).
      if (userId !== currentUser.id && currentUser.role !== "admin") {
        return res.status(403).json({ error: "אין הרשאת מנהלת" });
      }
      filters.user_id = userId;
    } else {
      // No user_id given -> "my own records" for EVERYONE, admins included.
      // An admin viewing someone else's timesheet always passes that
      // person's id explicitly (e.g. from the admin dashboard's employee
      // picker); this is what makes the personal time-clock widget (which
      // never passes user_id) correct for admins too.
      filters.user_id = currentUser.id;
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
    res.json({ timeLogs: await listTimeLogs(filters) });
  })
);

app.get(
  "/api/time-logs/:id",
  requireAuth,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const timeLog = id !== null && (await getTimeLogById(id));
    if (!timeLog) return res.status(404).json({ error: "רשומת השעון לא נמצאה" });

    const currentUser = await findUser(req.username);
    if (timeLog.user_id !== currentUser.id && currentUser.role !== "admin") {
      return res.status(403).json({ error: "אין הרשאת מנהלת" });
    }
    res.json({ timeLog });
  })
);

app.patch(
  "/api/time-logs/:id",
  requireAuth,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id !== null && (await getTimeLogById(id));
    if (!existing) return res.status(404).json({ error: "רשומת השעון לא נמצאה" });

    const currentUser = await findUser(req.username);
    const isAdmin = currentUser.role === "admin";
    const isOwner = existing.user_id === currentUser.id;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: "אין הרשאה לערוך רשומה זו" });
    }
    // Only an admin may move a record to a different clock-in time or
    // reassign it to someone else; an employee may only close her own open
    // shift (clock_out) or tag it with a task.
    if (!isAdmin && (req.body?.clock_in !== undefined || req.body?.user_id !== undefined)) {
      return res.status(403).json({ error: "אין הרשאת מנהלת" });
    }

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
        if (taskId === null || !(await getTaskById(taskId))) {
          return res.status(400).json({ error: "המשימה לא נמצאה" });
        }
        fields.task_id = taskId;
      }
    }
    if (req.body?.user_id !== undefined) {
      const userId = parseId(req.body.user_id);
      if (userId === null || !(await findUserById(userId))) {
        return res.status(400).json({ error: "משתמשת לא קיימת" });
      }
      fields.user_id = userId;
    }

    let timeLog;
    try {
      timeLog = await updateTimeLog(id, fields);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "כבר קיימת כניסה פתוחה למשתמשת הזו" });
      }
      throw err;
    }
    res.json({ timeLog });
  })
);

app.delete(
  "/api/time-logs/:id",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = id !== null && (await getTimeLogById(id));
    if (!existing) return res.status(404).json({ error: "רשומת השעון לא נמצאה" });
    await deleteTimeLog(id);
    res.json({ ok: true });
  })
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get(
  "/api/admin/users",
  requireAuth,
  requireTeamLeadOrAdmin,
  ah(async (req, res) => {
    if (req.currentUser.role === "admin") {
      return res.json({ users: await listAllUsers() });
    }
    res.json({ users: await listTeamMembers(req.currentUser.id) });
  })
);

app.patch(
  "/api/admin/users/:id",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const target = id !== null && (await findUserById(id));
    if (!target) {
      return res.status(404).json({ error: "משתמשת לא נמצאה" });
    }

    if (req.body?.role !== undefined) {
      if (!ROLES.includes(req.body.role)) {
        return res
          .status(400)
          .json({ error: `תפקיד לא תקין, חייב להיות אחד מ: ${ROLES.join(", ")}` });
      }
      const requestingUser = await findUser(req.username);
      if (requestingUser.id === id && req.body.role !== "admin") {
        return res.status(400).json({ error: "אי אפשר לשלול הרשאת מנהלת מעצמך" });
      }
      await updateUserRole(id, req.body.role);
    }

    if (req.body?.team_lead_id !== undefined) {
      let teamLeadId = null;
      if (req.body.team_lead_id !== null && req.body.team_lead_id !== "") {
        teamLeadId = parseId(req.body.team_lead_id);
        const lead = teamLeadId !== null && (await findUserById(teamLeadId));
        if (!lead || lead.role !== "team_lead") {
          return res.status(400).json({ error: "יש לבחור ראשת צוות תקינה" });
        }
        if (teamLeadId === id) {
          return res.status(400).json({ error: "אי אפשר להקצות משתמשת כראשת הצוות של עצמה" });
        }
      }
      await updateUserTeamLead(id, teamLeadId);
    }

    if (req.body?.team_id !== undefined) {
      let teamId = null;
      if (req.body.team_id !== null && req.body.team_id !== "") {
        teamId = parseId(req.body.team_id);
        const teams = teamId !== null ? await listTeams() : [];
        if (teamId === null || !teams.some((t) => t.id === teamId)) {
          return res.status(400).json({ error: "יש לבחור צוות תקין" });
        }
      }
      await setUserTeamId(id, teamId);
    }

    res.json({ user: await findUserById(id) });
  })
);

app.get(
  "/api/admin/teams",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    res.json({ teams: await listTeams() });
  })
);

app.post(
  "/api/admin/teams",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "יש להזין שם צוות" });
    try {
      const team = await createTeam(name);
      res.status(201).json({ team });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(400).json({ error: "כבר קיים צוות בשם הזה" });
      }
      throw err;
    }
  })
);

app.patch(
  "/api/admin/teams/:id",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: "הצוות לא נמצא" });
    const name = String(req.body?.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "יש להזין שם צוות" });
    try {
      const team = await renameTeam(id, name);
      if (!team) return res.status(404).json({ error: "הצוות לא נמצא" });
      res.json({ team });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(400).json({ error: "כבר קיים צוות בשם הזה" });
      }
      throw err;
    }
  })
);

app.delete(
  "/api/admin/teams/:id",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: "הצוות לא נמצא" });
    await deleteTeam(id);
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/teams/:id/members",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: "הצוות לא נמצא" });
    res.json({ members: await getTeamMembers(id) });
  })
);

app.post(
  "/api/admin/teams/:id/members",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const userId = parseId(req.body?.user_id);
    if (id === null || userId === null) {
      return res.status(400).json({ error: "בקשה לא תקינה" });
    }
    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ error: "משתמשת לא נמצאה" });
    await setUserTeamId(userId, id);
    res.json({ members: await getTeamMembers(id) });
  })
);

app.delete(
  "/api/admin/teams/:id/members/:userId",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (id === null || userId === null) {
      return res.status(400).json({ error: "בקשה לא תקינה" });
    }
    const user = await findUserById(userId);
    if (!user || user.team_id !== id) {
      return res.status(404).json({ error: "המשתמשת אינה בצוות זה" });
    }
    await setUserTeamId(userId, null);
    res.json({ members: await getTeamMembers(id) });
  })
);

app.get(
  "/api/admin/invites",
  requireAuth,
  requireAdmin,
  ah(async (_req, res) => {
    res.json({ invites: await listInvites() });
  })
);

app.post(
  "/api/admin/invites",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "יש להזין כתובת אימייל תקינה" });
    }
    const invite = await addInvite(email, req.username);
    if (!invite) {
      return res.status(409).json({ error: "כתובת האימייל הזו כבר מוזמנת" });
    }
    res.status(201).json({ invite });
  })
);

app.post(
  "/api/admin/invites/bulk",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const rawEmails = Array.isArray(req.body?.emails) ? req.body.emails : [];
    if (rawEmails.length > 200) {
      return res.status(400).json({ error: "יותר מדי כתובות בבת אחת (מקסימום 200)" });
    }
    const candidates = [
      ...new Set(rawEmails.map((e) => String(e).trim().toLowerCase().slice(0, 200))),
    ];

    const added = [];
    const invalid = [];
    const skipped = [];
    for (const email of candidates) {
      if (!EMAIL_RE.test(email)) {
        invalid.push(email);
        continue;
      }
      const invite = await addInvite(email, req.username);
      if (invite) {
        added.push(email);
      } else {
        skipped.push(email);
      }
    }

    res.status(201).json({ added, skipped, invalid });
  })
);

app.delete(
  "/api/admin/invites/:email",
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const email = String(req.params.email || "").trim().toLowerCase();
    await removeInvite(email);
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/tasks",
  requireAuth,
  requireTeamLeadOrAdmin,
  ah(async (req, res) => {
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
    if (req.currentUser.role !== "admin") {
      const teamIds = (await listTeamMembers(req.currentUser.id)).map((u) => u.id);
      if (filters.assigned_to != null && !teamIds.includes(filters.assigned_to)) {
        return res.status(403).json({ error: "אין גישה לעובדת זו" });
      }
      filters.assigned_to_in = teamIds;
    }
    const tasks = await listAllTasksForAdmin(filters);
    res.json({ tasks: tasks.map(serializeTask) });
  })
);

app.get(
  "/api/admin/hours-report",
  requireAuth,
  requireTeamLeadOrAdmin,
  ah(async (req, res) => {
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
    if (req.currentUser.role !== "admin") {
      const teamIds = (await listTeamMembers(req.currentUser.id)).map((u) => u.id);
      if (filters.user_id != null && !teamIds.includes(filters.user_id)) {
        return res.status(403).json({ error: "אין גישה לעובדת זו" });
      }
      filters.user_ids = teamIds;
    }
    res.json({ report: await getHoursReport(filters) });
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Serves the built client (client/dist) so the browser only ever talks to
// this one origin - no separate static-site deployment needed.
const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "הקובץ גדול מדי (מקסימום 10MB)" });
    }
    return res.status(400).json({ error: "שגיאה בהעלאת הקובץ" });
  }
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "שגיאת שרת" });
});

function sh(fn) {
  return (...args) => Promise.resolve(fn(...args)).catch((err) => console.error(err));
}

io.on(
  "connection",
  (socket) => {
    socket.on(
      "authenticate",
      sh(async ({ token } = {}) => {
        const username = sessions.get(String(token || ""));
        if (!username) {
          socket.emit("auth-error", "יש להתחבר מחדש");
          return;
        }

        clients.set(socket.id, { username, activeConversationId: null });
        for (const conv of await listConversationsForUser(username)) {
          socket.join(conv.id);
        }
        socket.join(`user:${username}`);

        socket.emit("authenticated", { username });
        await broadcastPresenceForUser(username);
      })
    );

    socket.on(
      "open-conversation",
      sh(async ({ conversationId } = {}) => {
        const client = clients.get(socket.id);
        if (!client) {
          socket.emit("auth-error", "יש להתחבר מחדש");
          return;
        }
        if (!(await isMember(conversationId, client.username))) {
          socket.emit("open-error", "אין לך גישה לשיחה הזו");
          return;
        }

        // The conversation may have been created after this socket's last
        // authenticate() call (e.g. someone just started a DM/group with this
        // user), so it might not have joined this Socket.IO room yet.
        socket.join(conversationId);
        client.activeConversationId = conversationId;
        socket.emit("opened", { id: conversationId });
        socket.emit("history", await getHistory(conversationId));
        await broadcastPresence(conversationId);
      })
    );

    socket.on(
      "start-dm",
      sh(async ({ partner } = {}) => {
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
        if (!(await findUser(cleanPartner))) {
          socket.emit("open-error", `לא נמצאה משתמשת בשם "${cleanPartner}"`);
          return;
        }

        const id = await getOrCreateDmConversation(client.username, cleanPartner);
        socket.join(id);
        client.activeConversationId = id;

        socket.emit("opened", { id, type: "dm", name: cleanPartner });
        socket.emit("history", await getHistory(id));
        await broadcastPresence(id);
      })
    );

    socket.on(
      "message",
      sh(async ({ text, attachment, replyTo } = {}) => {
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
        if (isMessageRateLimited(socket.id)) return;

        let replyToId = Number(replyTo);
        if (!Number.isInteger(replyToId)) {
          replyToId = null;
        } else {
          const parentRoom = await getMessageRoom(replyToId);
          if (parentRoom !== client.activeConversationId) replyToId = null;
        }

        const saved = await saveMessage(
          client.activeConversationId,
          client.username,
          clean.slice(0, 2000),
          safeAttachment,
          replyToId
        );
        io.to(client.activeConversationId).emit("message", saved);
      })
    );

    socket.on(
      "edit-message",
      sh(async ({ id, text } = {}) => {
        const client = clients.get(socket.id);
        if (!client) return;
        const messageId = Number(id);
        const clean = String(text || "").trim();
        if (!Number.isInteger(messageId) || !clean) return;

        const updated = await updateMessage(messageId, client.username, clean.slice(0, 2000));
        if (!updated) {
          socket.emit("edit-error", "לא ניתן לערוך הודעה זו");
          return;
        }
        io.to(updated.room).emit("message-edited", updated);
      })
    );

    socket.on(
      "delete-message",
      sh(async ({ id } = {}) => {
        const client = clients.get(socket.id);
        if (!client) return;
        const messageId = Number(id);
        if (!Number.isInteger(messageId)) return;

        const deleted = await deleteMessage(messageId, client.username);
        if (!deleted) {
          socket.emit("delete-error", "לא ניתן למחוק הודעה זו");
          return;
        }
        io.to(deleted.room).emit("message-deleted", deleted);
      })
    );

    socket.on(
      "toggle-reaction",
      sh(async ({ id, emoji } = {}) => {
        const client = clients.get(socket.id);
        if (!client) return;
        const messageId = Number(id);
        const cleanEmoji = String(emoji || "").trim().slice(0, 8);
        if (!Number.isInteger(messageId) || !cleanEmoji) return;

        const room = await getMessageRoom(messageId);
        if (!room || !(await isMember(room, client.username))) return;

        const reactions = await toggleReaction(messageId, client.username, cleanEmoji);
        io.to(room).emit("message-reactions", { id: messageId, reactions });
      })
    );

    socket.on("typing", ({ isTyping } = {}) => {
      const client = clients.get(socket.id);
      if (!client || !client.activeConversationId) return;
      socket.to(client.activeConversationId).emit("typing", {
        conversationId: client.activeConversationId,
        username: client.username,
        isTyping: !!isTyping,
      });
    });

    socket.on(
      "disconnect",
      sh(async () => {
        const client = clients.get(socket.id);
        clients.delete(socket.id);
        messageRateLimits.delete(socket.id);
        if (client) await broadcastPresenceForUser(client.username);
      })
    );
  }
);

// Every REST handler is wrapped in ah() and every socket handler in sh(),
// so in normal operation nothing should reach here — this is a last-resort
// net so a bug that slips through logs loudly instead of silently killing
// the one process serving every connected user.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`שרת הצ'אט פועל על פורט ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("נכשל באתחול בסיס הנתונים:", err);
    process.exit(1);
  });
