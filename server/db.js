const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "data", "chat.db"));

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const existingColumns = db
  .prepare("PRAGMA table_info(messages)")
  .all()
  .map((c) => c.name);

if (!existingColumns.includes("room")) {
  db.exec("ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'general'");
}

if (!existingColumns.includes("attachment_filename")) {
  db.exec("ALTER TABLE messages ADD COLUMN attachment_filename TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN attachment_original_name TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN attachment_mime_type TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN attachment_size INTEGER");
}

if (!existingColumns.includes("edited_at")) {
  db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN deleted_at TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const existingUserColumns = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .map((c) => c.name);

if (!existingUserColumns.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'employee'");
  // Bootstrap: this app has no role-management UI yet, so on the first run after
  // this column is introduced, promote the earliest-registered account to admin.
  // Otherwise an already-populated database would end up with zero admins.
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!hasAdmin) {
    const earliest = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
    if (earliest) {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(earliest.id);
    }
  }
}

// Earlier versions of this migration defaulted new rows to 'user' instead of
// 'employee'; normalize any leftovers so the two-role system stays consistent.
db.exec("UPDATE users SET role = 'employee' WHERE role = 'user'");

const ROLES = ["employee", "admin"];

const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
);

const getUserByUsername = db.prepare(
  "SELECT id, username, password_hash, role FROM users WHERE username = ?"
);

function createUser(username, passwordHash) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  const role = count === 0 ? "admin" : "employee";
  const info = insertUser.run(username, passwordHash, role);
  return { id: info.lastInsertRowid, username, role };
}

function findUser(username) {
  return getUserByUsername.get(username);
}

const getUserByIdStmt = db.prepare("SELECT id, username, role FROM users WHERE id = ?");

function findUserById(id) {
  return getUserByIdStmt.get(id);
}

const listAllUsersStmt = db.prepare(
  "SELECT id, username, role FROM users ORDER BY username COLLATE NOCASE"
);

function listAllUsers() {
  return listAllUsersStmt.all();
}

const updateUserRoleStmt = db.prepare("UPDATE users SET role = ? WHERE id = ?");

function updateUserRole(id, role) {
  updateUserRoleStmt.run(role, id);
  return getUserByIdStmt.get(id);
}

const TASK_PRIORITIES = ["low", "medium", "high"];
const TASK_STATUSES = ["todo", "in_progress", "review", "done"];

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to INTEGER REFERENCES users(id),
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const existingTaskColumns = db
  .prepare("PRAGMA table_info(tasks)")
  .all()
  .map((c) => c.name);

if (!existingTaskColumns.includes("conversation_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN conversation_id TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS task_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertTaskAttachment = db.prepare(`
  INSERT INTO task_attachments (task_id, filename, original_name, mime_type, size, uploaded_by)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getTaskAttachmentByIdStmt = db.prepare("SELECT * FROM task_attachments WHERE id = ?");

function addTaskAttachment({ task_id, filename, original_name, mime_type, size, uploaded_by }) {
  const info = insertTaskAttachment.run(
    task_id,
    filename,
    original_name,
    mime_type ?? null,
    size ?? null,
    uploaded_by
  );
  return getTaskAttachmentByIdStmt.get(info.lastInsertRowid);
}

const deleteTaskAttachmentsStmt = db.prepare("DELETE FROM task_attachments WHERE task_id = ?");
const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?");

function deleteTask(id) {
  deleteTaskAttachmentsStmt.run(id);
  deleteTaskStmt.run(id);
}

function attachAttachmentsToTasks(tasks) {
  if (tasks.length === 0) return tasks;
  const ids = [...new Set(tasks.map((t) => t.id))];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM task_attachments WHERE task_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...ids);
  const byTask = new Map();
  for (const row of rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
    byTask.get(row.task_id).push(row);
  }
  return tasks.map((t) => ({ ...t, attachments: byTask.get(t.id) || [] }));
}

const insertTask = db.prepare(`
  INSERT INTO tasks (title, description, assigned_to, due_date, priority, status, conversation_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getTaskByIdStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");

function createTask({ title, description, assigned_to, due_date, priority, status, conversation_id }) {
  const info = insertTask.run(
    title,
    description ?? null,
    assigned_to ?? null,
    due_date ?? null,
    priority || "medium",
    status || "todo",
    conversation_id ?? null
  );
  return getTaskById(info.lastInsertRowid);
}

function getTaskById(id) {
  const task = getTaskByIdStmt.get(id);
  if (!task) return task;
  return attachAttachmentsToTasks([task])[0];
}

function listTasks({ assigned_to, status, priority } = {}) {
  const clauses = [];
  const params = [];
  if (assigned_to != null) {
    clauses.push("assigned_to = ?");
    params.push(assigned_to);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (priority) {
    clauses.push("priority = ?");
    params.push(priority);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const tasks = db.prepare(`SELECT * FROM tasks ${where} ORDER BY id DESC`).all(...params);
  return attachAttachmentsToTasks(tasks);
}

function listAllTasksForAdmin({ assigned_to, status, priority } = {}) {
  const clauses = [];
  const params = [];
  if (assigned_to != null) {
    clauses.push("t.assigned_to = ?");
    params.push(assigned_to);
  }
  if (status) {
    clauses.push("t.status = ?");
    params.push(status);
  }
  if (priority) {
    clauses.push("t.priority = ?");
    params.push(priority);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const tasks = db
    .prepare(
      `SELECT t.*, u.username AS assigned_to_username
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       ${where}
       ORDER BY t.id DESC`
    )
    .all(...params);
  return attachAttachmentsToTasks(tasks);
}

const TASK_UPDATE_COLUMNS = ["title", "description", "assigned_to", "due_date", "priority", "status"];

function updateTask(id, fields) {
  const keys = Object.keys(fields).filter((k) => TASK_UPDATE_COLUMNS.includes(k));
  if (keys.length === 0) return getTaskById(id);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE tasks SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(
    ...values,
    id
  );
  return getTaskById(id);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    task_id INTEGER REFERENCES tasks(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertTimeLog = db.prepare(`
  INSERT INTO time_logs (user_id, clock_in, clock_out, task_id)
  VALUES (?, ?, ?, ?)
`);

const getTimeLogByIdStmt = db.prepare("SELECT * FROM time_logs WHERE id = ?");

function createTimeLog({ user_id, clock_in, clock_out, task_id }) {
  const info = insertTimeLog.run(user_id, clock_in, clock_out ?? null, task_id ?? null);
  return getTimeLogByIdStmt.get(info.lastInsertRowid);
}

function getTimeLogById(id) {
  return getTimeLogByIdStmt.get(id);
}

function listTimeLogs({ user_id, task_id, open } = {}) {
  const clauses = [];
  const params = [];
  if (user_id != null) {
    clauses.push("user_id = ?");
    params.push(user_id);
  }
  if (task_id != null) {
    clauses.push("task_id = ?");
    params.push(task_id);
  }
  if (open) {
    clauses.push("clock_out IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM time_logs ${where} ORDER BY id DESC`).all(...params);
}

function getHoursReport({ from, to, user_id } = {}) {
  const clauses = ["tl.clock_out IS NOT NULL"];
  const params = [];
  if (from) {
    clauses.push("tl.clock_in >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("tl.clock_in <= ?");
    params.push(to);
  }
  if (user_id != null) {
    clauses.push("tl.user_id = ?");
    params.push(user_id);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  return db
    .prepare(
      `SELECT u.id AS user_id, u.username,
         COUNT(tl.id) AS entries,
         SUM((julianday(tl.clock_out) - julianday(tl.clock_in)) * 24) AS total_hours
       FROM time_logs tl
       JOIN users u ON u.id = tl.user_id
       ${where}
       GROUP BY u.id, u.username
       ORDER BY u.username COLLATE NOCASE`
    )
    .all(...params);
}

const TIME_LOG_UPDATE_COLUMNS = ["user_id", "clock_in", "clock_out", "task_id"];

function updateTimeLog(id, fields) {
  const keys = Object.keys(fields).filter((k) => TIME_LOG_UPDATE_COLUMNS.includes(k));
  if (keys.length === 0) return getTimeLogById(id);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE time_logs SET ${setClause} WHERE id = ?`).run(...values, id);
  return getTimeLogById(id);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (conversation_id, username)
  )
`);

function canonicalDmId(userA, userB) {
  return [userA, userB]
    .map((u) => u.toLowerCase())
    .sort()
    .join("::");
}

const insertConversation = db.prepare(
  "INSERT OR IGNORE INTO conversations (id, type, name) VALUES (?, ?, ?)"
);
const insertMember = db.prepare(
  "INSERT OR IGNORE INTO conversation_members (conversation_id, username) VALUES (?, ?)"
);

function getOrCreateDmConversation(userA, userB) {
  const id = canonicalDmId(userA, userB);
  insertConversation.run(id, "dm", null);
  insertMember.run(id, userA);
  insertMember.run(id, userB);
  return id;
}

function createGroupConversation(name, usernames) {
  const id = crypto.randomUUID();
  insertConversation.run(id, "group", name);
  for (const username of usernames) insertMember.run(id, username);
  return id;
}

const getMembers = db.prepare(
  "SELECT username FROM conversation_members WHERE conversation_id = ?"
);

function getConversationMembers(conversationId) {
  return getMembers.all(conversationId).map((row) => row.username);
}

function addConversationMember(conversationId, username) {
  insertMember.run(conversationId, username);
}

const getMembership = db.prepare(
  "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND username = ?"
);

function isMember(conversationId, username) {
  return !!getMembership.get(conversationId, username);
}

const getUserConversations = db.prepare(`
  SELECT c.id, c.type, c.name, c.created_at, t.id AS task_id,
    (SELECT text FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
    (SELECT username FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_username,
    (SELECT created_at FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
    (SELECT id FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_id
  FROM conversations c
  JOIN conversation_members cm ON cm.conversation_id = c.id
  LEFT JOIN tasks t ON t.conversation_id = c.id
  WHERE cm.username = ?
  ORDER BY COALESCE(last_at, c.created_at) DESC, COALESCE(last_id, 0) DESC
`);

function listConversationsForUser(username) {
  return getUserConversations.all(username);
}

// One-time backfill: DM history from before the conversations/members tables
// existed has no membership row yet. Without this, that history would be
// invisible in the inbox until the pair happened to re-start the DM.
(function backfillLegacyDmConversations() {
  const existingIds = new Set(db.prepare("SELECT id FROM conversations").all().map((r) => r.id));
  const rooms = db.prepare("SELECT DISTINCT room FROM messages").all().map((r) => r.room);

  for (const room of rooms) {
    if (existingIds.has(room) || room === "general") continue;
    const parts = room.split("::");
    if (parts.length !== 2) continue;

    const userA = getUserByUsername.get(parts[0]);
    const userB = getUserByUsername.get(parts[1]);
    if (!userA || !userB) continue;

    insertConversation.run(room, "dm", null);
    insertMember.run(room, userA.username);
    insertMember.run(room, userB.username);
  }
})();

const getOtherUsernames = db.prepare(
  "SELECT username FROM users WHERE username != ? COLLATE NOCASE ORDER BY username COLLATE NOCASE"
);

function listOtherUsers(excludeUsername) {
  return getOtherUsernames.all(excludeUsername).map((row) => row.username);
}

const insertMessage = db.prepare(`
  INSERT INTO messages (room, username, text, attachment_filename, attachment_original_name, attachment_mime_type, attachment_size)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getRecentMessages = db.prepare(
  `SELECT id, room, username, text, created_at, edited_at, deleted_at,
     attachment_filename, attachment_original_name, attachment_mime_type, attachment_size
   FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?`
);

function rowToMessage(row) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    room: row.room,
    username: row.username,
    text: deleted ? null : row.text,
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    deleted_at: row.deleted_at || null,
    attachment:
      !deleted && row.attachment_filename
        ? {
            filename: row.attachment_filename,
            originalName: row.attachment_original_name,
            mimeType: row.attachment_mime_type,
            size: row.attachment_size,
            url: `/uploads/${row.attachment_filename}`,
          }
        : null,
  };
}

const getMessageByIdStmt = db.prepare("SELECT * FROM messages WHERE id = ?");

const updateMessageTextStmt = db.prepare(
  "UPDATE messages SET text = ?, edited_at = datetime('now') WHERE id = ?"
);

function updateMessage(id, username, text) {
  const existing = getMessageByIdStmt.get(id);
  if (!existing || existing.username !== username || existing.deleted_at) return null;
  updateMessageTextStmt.run(text, id);
  return rowToMessage(getMessageByIdStmt.get(id));
}

const deleteMessageStmt = db.prepare(
  `UPDATE messages SET deleted_at = datetime('now'), text = NULL,
     attachment_filename = NULL, attachment_original_name = NULL,
     attachment_mime_type = NULL, attachment_size = NULL
   WHERE id = ?`
);

function deleteMessage(id, username) {
  const existing = getMessageByIdStmt.get(id);
  if (!existing || existing.username !== username || existing.deleted_at) return null;
  deleteMessageStmt.run(id);
  return rowToMessage(getMessageByIdStmt.get(id));
}

function saveMessage(room, username, text, attachment) {
  const info = insertMessage.run(
    room,
    username,
    text,
    attachment?.filename ?? null,
    attachment?.originalName ?? null,
    attachment?.mimeType ?? null,
    attachment?.size ?? null
  );
  return rowToMessage({
    id: info.lastInsertRowid,
    room,
    username,
    text,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
    attachment_filename: attachment?.filename ?? null,
    attachment_original_name: attachment?.originalName ?? null,
    attachment_mime_type: attachment?.mimeType ?? null,
    attachment_size: attachment?.size ?? null,
  });
}

function getHistory(room, limit = 100) {
  return getRecentMessages.all(room, limit).reverse().map(rowToMessage);
}

module.exports = {
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
};
