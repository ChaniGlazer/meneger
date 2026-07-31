const crypto = require("crypto");
const { Pool } = require("pg");
const { getPublicUrl } = require("./upload");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
      ? { rejectUnauthorized: false }
      : false,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function init() {
  await query("CREATE EXTENSION IF NOT EXISTS citext");

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username CITEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email CITEXT UNIQUE`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_lead_id INTEGER REFERENCES users(id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS invited_emails (
      email CITEXT PRIMARY KEY,
      invited_by CITEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      used_by INTEGER REFERENCES users(id),
      used_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL DEFAULT 'general',
      username CITEXT NOT NULL,
      text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      attachment_filename TEXT,
      attachment_original_name TEXT,
      attachment_mime_type TEXT,
      attachment_size INTEGER
    )
  `);
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id),
      username CITEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, username, emoji)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER REFERENCES users(id),
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'todo',
      conversation_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    )
  `);
  await query(`
    INSERT INTO task_assignees (task_id, user_id)
    SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS time_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      clock_in TIMESTAMPTZ NOT NULL,
      clock_out TIMESTAMPTZ,
      task_id INTEGER REFERENCES tasks(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      username CITEXT NOT NULL,
      PRIMARY KEY (conversation_id, username)
    )
  `);
}

const ROLES = ["employee", "team_lead", "admin"];
const TASK_PRIORITIES = ["low", "medium", "high"];
const TASK_STATUSES = ["todo", "in_progress", "review", "done"];

async function createUser(username, passwordHash, email) {
  const { rows: countRows } = await query("SELECT COUNT(*)::int AS count FROM users");
  const role = countRows[0].count === 0 ? "admin" : "employee";
  const { rows } = await query(
    "INSERT INTO users (username, password_hash, role, email) VALUES ($1, $2, $3, $4) RETURNING id, username, role, email",
    [username, passwordHash, role, email ?? null]
  );
  return rows[0];
}

async function updateUserPassword(username, passwordHash) {
  await query("UPDATE users SET password_hash = $1 WHERE username = $2", [passwordHash, username]);
}

async function findUser(username) {
  const { rows } = await query(
    "SELECT id, username, password_hash, role, team_id FROM users WHERE username = $1",
    [username]
  );
  return rows[0];
}

async function countUsers() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM users");
  return rows[0].count;
}

async function findInvite(email) {
  const { rows } = await query("SELECT * FROM invited_emails WHERE email = $1", [email]);
  return rows[0];
}

async function addInvite(email, invitedBy) {
  const { rows } = await query(
    `INSERT INTO invited_emails (email, invited_by) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [email, invitedBy]
  );
  return rows[0];
}

async function listInvites() {
  const { rows } = await query(
    `SELECT i.email, i.invited_by, i.created_at, i.used_at, u.username AS used_by_username
     FROM invited_emails i
     LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC`
  );
  return rows;
}

async function removeInvite(email) {
  await query("DELETE FROM invited_emails WHERE email = $1", [email]);
}

async function markInviteUsed(email, userId) {
  await query("UPDATE invited_emails SET used_by = $1, used_at = now() WHERE email = $2", [userId, email]);
}

async function findUserById(id) {
  const { rows } = await query(
    "SELECT id, username, role, team_lead_id, team_id FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
}

async function listAllUsers() {
  const { rows } = await query(
    `SELECT u.id, u.username, u.role, u.team_lead_id, tl.username AS team_lead_username,
       u.team_id, t.name AS team_name
     FROM users u
     LEFT JOIN users tl ON tl.id = u.team_lead_id
     LEFT JOIN teams t ON t.id = u.team_id
     ORDER BY u.username`
  );
  return rows;
}

async function listTeamMembers(teamLeadId) {
  const { rows } = await query(
    "SELECT id, username, role, team_lead_id FROM users WHERE team_lead_id = $1 OR id = $1 ORDER BY username",
    [teamLeadId]
  );
  return rows;
}

async function listTeams() {
  const { rows } = await query(
    `SELECT t.id, t.name, t.created_at, COUNT(u.id)::int AS member_count
     FROM teams t
     LEFT JOIN users u ON u.team_id = t.id
     GROUP BY t.id
     ORDER BY t.name`
  );
  return rows;
}

async function createTeam(name) {
  const { rows } = await query(
    "INSERT INTO teams (name) VALUES ($1) RETURNING id, name, created_at",
    [name]
  );
  return rows[0];
}

async function renameTeam(id, name) {
  const { rows } = await query(
    "UPDATE teams SET name = $1 WHERE id = $2 RETURNING id, name, created_at",
    [name, id]
  );
  return rows[0];
}

async function deleteTeam(id) {
  await query("UPDATE users SET team_id = NULL WHERE team_id = $1", [id]);
  await query("UPDATE tasks SET team_id = NULL WHERE team_id = $1", [id]);
  await query("DELETE FROM teams WHERE id = $1", [id]);
}

async function getTeamMembers(teamId) {
  const { rows } = await query(
    "SELECT id, username, role FROM users WHERE team_id = $1 ORDER BY username",
    [teamId]
  );
  return rows;
}

async function setUserTeamId(userId, teamId) {
  await query("UPDATE users SET team_id = $1 WHERE id = $2", [teamId, userId]);
  return findUserById(userId);
}

async function updateUserRole(id, role) {
  await query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
  return findUserById(id);
}

async function updateUserTeamLead(id, teamLeadId) {
  await query("UPDATE users SET team_lead_id = $1 WHERE id = $2", [teamLeadId, id]);
  return findUserById(id);
}

async function attachAttachmentsToTasks(tasks) {
  if (tasks.length === 0) return tasks;
  const ids = [...new Set(tasks.map((t) => t.id))];
  const { rows } = await query(
    "SELECT * FROM task_attachments WHERE task_id = ANY($1::int[]) ORDER BY id ASC",
    [ids]
  );
  const byTask = new Map();
  for (const row of rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
    byTask.get(row.task_id).push(row);
  }
  return tasks.map((t) => ({ ...t, attachments: byTask.get(t.id) || [] }));
}

async function attachAssigneesToTasks(tasks) {
  if (tasks.length === 0) return tasks;
  const ids = [...new Set(tasks.map((t) => t.id))];
  const { rows } = await query(
    `SELECT ta.task_id, u.id, u.username
     FROM task_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = ANY($1::int[])
     ORDER BY u.username`,
    [ids]
  );
  const byTask = new Map();
  for (const row of rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
    byTask.get(row.task_id).push({ id: row.id, username: row.username });
  }
  return tasks.map((t) => ({ ...t, assignees: byTask.get(t.id) || [] }));
}

async function attachTeamNamesToTasks(tasks) {
  const ids = [...new Set(tasks.map((t) => t.team_id).filter(Boolean))];
  if (ids.length === 0) return tasks.map((t) => ({ ...t, team_name: null }));
  const { rows } = await query("SELECT id, name FROM teams WHERE id = ANY($1::int[])", [ids]);
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return tasks.map((t) => ({ ...t, team_name: t.team_id ? byId.get(t.team_id) || null : null }));
}

async function setTaskAssignees(taskId, userIds) {
  await query("DELETE FROM task_assignees WHERE task_id = $1", [taskId]);
  for (const userId of userIds) {
    await query(
      "INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [taskId, userId]
    );
  }
}

async function addTaskAttachment({ task_id, filename, original_name, mime_type, size, uploaded_by }) {
  const { rows } = await query(
    `INSERT INTO task_attachments (task_id, filename, original_name, mime_type, size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [task_id, filename, original_name, mime_type ?? null, size ?? null, uploaded_by]
  );
  return rows[0];
}

async function deleteTask(id) {
  await query("DELETE FROM task_attachments WHERE task_id = $1", [id]);
  await query("DELETE FROM task_assignees WHERE task_id = $1", [id]);
  await query("DELETE FROM tasks WHERE id = $1", [id]);
}

async function createTask({ title, description, assignee_ids, due_date, priority, status, conversation_id, team_id }) {
  const { rows } = await query(
    `INSERT INTO tasks (title, description, due_date, priority, status, conversation_id, team_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      title,
      description ?? null,
      due_date ?? null,
      priority || "medium",
      status || "todo",
      conversation_id ?? null,
      team_id ?? null,
    ]
  );
  await setTaskAssignees(rows[0].id, assignee_ids || []);
  return getTaskById(rows[0].id);
}

async function getTaskById(id) {
  const { rows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
  if (!rows[0]) return undefined;
  const [withAttachments] = await attachAttachmentsToTasks([rows[0]]);
  const [withAssignees] = await attachAssigneesToTasks([withAttachments]);
  const [withTeam] = await attachTeamNamesToTasks([withAssignees]);
  return withTeam;
}

// Used by the plain (non-admin) /api/tasks route: a task is visible to a
// user if she's an explicit assignee OR the task is assigned to her team.
async function listTasks({ visibleToUserId, visibleToTeamId, status, priority } = {}) {
  const clauses = [];
  const params = [];
  if (visibleToUserId != null) {
    const visibilityParts = [];
    params.push(visibleToUserId);
    visibilityParts.push(
      `EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = tasks.id AND ta.user_id = $${params.length})`
    );
    if (visibleToTeamId != null) {
      params.push(visibleToTeamId);
      visibilityParts.push(`tasks.team_id = $${params.length}`);
    }
    clauses.push(`(${visibilityParts.join(" OR ")})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    clauses.push(`priority = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM tasks ${where} ORDER BY id DESC`, params);
  const withAttachments = await attachAttachmentsToTasks(rows);
  const withAssignees = await attachAssigneesToTasks(withAttachments);
  return attachTeamNamesToTasks(withAssignees);
}

async function listAllTasksForAdmin({ assigned_to, status, priority, assigned_to_in } = {}) {
  const clauses = [];
  const params = [];
  if (assigned_to != null) {
    params.push(assigned_to);
    clauses.push(`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $${params.length})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`t.status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    clauses.push(`t.priority = $${params.length}`);
  }
  if (assigned_to_in) {
    params.push(assigned_to_in);
    clauses.push(
      `EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ANY($${params.length}::int[]))`
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT t.* FROM tasks t ${where} ORDER BY t.id DESC`,
    params
  );
  const withAttachments = await attachAttachmentsToTasks(rows);
  const withAssignees = await attachAssigneesToTasks(withAttachments);
  return attachTeamNamesToTasks(withAssignees);
}

const TASK_UPDATE_COLUMNS = ["title", "description", "due_date", "priority", "status", "team_id"];

async function updateTask(id, fields) {
  const keys = Object.keys(fields).filter((k) => TASK_UPDATE_COLUMNS.includes(k));
  if (keys.length > 0) {
    const params = keys.map((k) => fields[k]);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    params.push(id);
    await query(`UPDATE tasks SET ${setClause}, updated_at = now() WHERE id = $${params.length}`, params);
  }
  if (fields.assignee_ids !== undefined) {
    await setTaskAssignees(id, fields.assignee_ids);
    await query("UPDATE tasks SET updated_at = now() WHERE id = $1", [id]);
  }
  return getTaskById(id);
}

async function createTimeLog({ user_id, clock_in, clock_out, task_id }) {
  const { rows } = await query(
    `INSERT INTO time_logs (user_id, clock_in, clock_out, task_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [user_id, clock_in, clock_out ?? null, task_id ?? null]
  );
  return rows[0];
}

async function getTimeLogById(id) {
  const { rows } = await query("SELECT * FROM time_logs WHERE id = $1", [id]);
  return rows[0];
}

async function listTimeLogs({ user_id, task_id, open, from, to } = {}) {
  const clauses = [];
  const params = [];
  if (user_id != null) {
    params.push(user_id);
    clauses.push(`user_id = $${params.length}`);
  }
  if (task_id != null) {
    params.push(task_id);
    clauses.push(`task_id = $${params.length}`);
  }
  if (open) {
    clauses.push("clock_out IS NULL");
  }
  if (from) {
    params.push(from);
    clauses.push(`clock_in >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`clock_in <= $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM time_logs ${where} ORDER BY id DESC`, params);
  return rows;
}

async function deleteTimeLog(id) {
  await query("DELETE FROM time_logs WHERE id = $1", [id]);
}

async function getHoursReport({ from, to, user_id, user_ids } = {}) {
  const clauses = ["tl.clock_out IS NOT NULL"];
  const params = [];
  if (from) {
    params.push(from);
    clauses.push(`tl.clock_in >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`tl.clock_in <= $${params.length}`);
  }
  if (user_id != null) {
    params.push(user_id);
    clauses.push(`tl.user_id = $${params.length}`);
  }
  if (user_ids) {
    params.push(user_ids);
    clauses.push(`tl.user_id = ANY($${params.length}::int[])`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const { rows } = await query(
    `SELECT u.id AS user_id, u.username,
       COUNT(tl.id)::int AS entries,
       SUM(EXTRACT(EPOCH FROM (tl.clock_out - tl.clock_in)) / 3600)::float8 AS total_hours
     FROM time_logs tl
     JOIN users u ON u.id = tl.user_id
     ${where}
     GROUP BY u.id, u.username
     ORDER BY u.username`,
    params
  );
  return rows;
}

const TIME_LOG_UPDATE_COLUMNS = ["user_id", "clock_in", "clock_out", "task_id"];

async function updateTimeLog(id, fields) {
  const keys = Object.keys(fields).filter((k) => TIME_LOG_UPDATE_COLUMNS.includes(k));
  if (keys.length === 0) return getTimeLogById(id);
  const params = keys.map((k) => fields[k]);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  params.push(id);
  await query(`UPDATE time_logs SET ${setClause} WHERE id = $${params.length}`, params);
  return getTimeLogById(id);
}

function canonicalDmId(userA, userB) {
  return [userA, userB]
    .map((u) => u.toLowerCase())
    .sort()
    .join("::");
}

async function getOrCreateDmConversation(userA, userB) {
  const id = canonicalDmId(userA, userB);
  await query("INSERT INTO conversations (id, type, name) VALUES ($1, 'dm', NULL) ON CONFLICT DO NOTHING", [id]);
  await query(
    "INSERT INTO conversation_members (conversation_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [id, userA]
  );
  await query(
    "INSERT INTO conversation_members (conversation_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [id, userB]
  );
  return id;
}

async function createGroupConversation(name, usernames) {
  const id = crypto.randomUUID();
  await query("INSERT INTO conversations (id, type, name) VALUES ($1, 'group', $2)", [id, name]);
  for (const username of usernames) {
    await query(
      "INSERT INTO conversation_members (conversation_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, username]
    );
  }
  return id;
}

async function getConversationById(id) {
  const { rows } = await query("SELECT id, type, name, created_at FROM conversations WHERE id = $1", [id]);
  return rows[0];
}

async function getConversationMembers(conversationId) {
  const { rows } = await query(
    "SELECT username FROM conversation_members WHERE conversation_id = $1",
    [conversationId]
  );
  return rows.map((row) => row.username);
}

async function addConversationMember(conversationId, username) {
  await query(
    "INSERT INTO conversation_members (conversation_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [conversationId, username]
  );
}

async function removeConversationMember(conversationId, username) {
  await query(
    "DELETE FROM conversation_members WHERE conversation_id = $1 AND username = $2",
    [conversationId, username]
  );
}

async function isMember(conversationId, username) {
  const { rows } = await query(
    "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND username = $2",
    [conversationId, username]
  );
  return rows.length > 0;
}

async function listConversationsForUser(username) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT c.id, c.type, c.name, c.created_at, t.id AS task_id,
         (SELECT text FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
         (SELECT username FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_username,
         (SELECT created_at FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
         (SELECT id FROM messages m WHERE m.room = c.id ORDER BY m.id DESC LIMIT 1) AS last_id
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       LEFT JOIN tasks t ON t.conversation_id = c.id
       WHERE cm.username = $1
     ) sub
     ORDER BY COALESCE(sub.last_at, sub.created_at) DESC, COALESCE(sub.last_id, 0) DESC`,
    [username]
  );
  return rows;
}

async function listOtherUsers(excludeUsername) {
  const { rows } = await query(
    "SELECT username FROM users WHERE username != $1 ORDER BY username",
    [excludeUsername]
  );
  return rows.map((row) => row.username);
}

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
            url: getPublicUrl(row.attachment_filename),
          }
        : null,
    reactions: row.reactions || [],
    reply_to_id: row.reply_to_id || null,
  };
}

async function attachReplyPreviews(messages) {
  const ids = [...new Set(messages.map((m) => m.reply_to_id).filter(Boolean))];
  if (ids.length === 0) return messages.map((m) => ({ ...m, reply_to: null }));

  const { rows } = await query(
    "SELECT id, username, text, deleted_at FROM messages WHERE id = ANY($1::int[])",
    [ids]
  );
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        username: row.username,
        text: row.deleted_at ? null : row.text,
        deleted: !!row.deleted_at,
      },
    ])
  );
  return messages.map((m) => ({
    ...m,
    reply_to: m.reply_to_id ? byId.get(m.reply_to_id) || null : null,
  }));
}

async function attachReactionsToMessages(messages) {
  if (messages.length === 0) return messages;
  const ids = [...new Set(messages.map((m) => m.id))];
  const { rows } = await query(
    "SELECT message_id, username, emoji FROM message_reactions WHERE message_id = ANY($1::int[])",
    [ids]
  );
  const byMessage = new Map();
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
    byMessage.get(row.message_id).push({ username: row.username, emoji: row.emoji });
  }
  return messages.map((m) => ({ ...m, reactions: byMessage.get(m.id) || [] }));
}

async function getMessageReactions(messageId) {
  const { rows } = await query(
    "SELECT username, emoji FROM message_reactions WHERE message_id = $1",
    [messageId]
  );
  return rows;
}

async function getMessageRoom(messageId) {
  const { rows } = await query(
    "SELECT room FROM messages WHERE id = $1 AND deleted_at IS NULL",
    [messageId]
  );
  return rows[0]?.room;
}

async function toggleReaction(messageId, username, emoji) {
  const { rows } = await query(
    "SELECT 1 FROM message_reactions WHERE message_id = $1 AND username = $2 AND emoji = $3",
    [messageId, username, emoji]
  );
  if (rows.length > 0) {
    await query(
      "DELETE FROM message_reactions WHERE message_id = $1 AND username = $2 AND emoji = $3",
      [messageId, username, emoji]
    );
  } else {
    await query(
      "INSERT INTO message_reactions (message_id, username, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [messageId, username, emoji]
    );
  }
  return getMessageReactions(messageId);
}

async function saveMessage(room, username, text, attachment, replyToId) {
  const { rows } = await query(
    `INSERT INTO messages (room, username, text, attachment_filename, attachment_original_name, attachment_mime_type, attachment_size, reply_to_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [
      room,
      username,
      text,
      attachment?.filename ?? null,
      attachment?.originalName ?? null,
      attachment?.mimeType ?? null,
      attachment?.size ?? null,
      replyToId ?? null,
    ]
  );
  const message = rowToMessage({
    id: rows[0].id,
    room,
    username,
    text,
    created_at: rows[0].created_at,
    edited_at: null,
    deleted_at: null,
    attachment_filename: attachment?.filename ?? null,
    attachment_original_name: attachment?.originalName ?? null,
    attachment_mime_type: attachment?.mimeType ?? null,
    attachment_size: attachment?.size ?? null,
    reply_to_id: replyToId ?? null,
  });
  const [withReply] = await attachReplyPreviews([message]);
  return withReply;
}

async function getHistory(room, limit = 100) {
  const { rows } = await query(
    `SELECT id, room, username, text, created_at, edited_at, deleted_at,
       attachment_filename, attachment_original_name, attachment_mime_type, attachment_size, reply_to_id
     FROM messages WHERE room = $1 ORDER BY id DESC LIMIT $2`,
    [room, limit]
  );
  const withReactions = await attachReactionsToMessages(rows);
  const messages = withReactions.reverse().map(rowToMessage);
  return attachReplyPreviews(messages);
}

async function updateMessage(id, username, text) {
  const { rows } = await query(
    `UPDATE messages SET text = $1, edited_at = now()
     WHERE id = $2 AND username = $3 AND deleted_at IS NULL
     RETURNING *`,
    [text, id, username]
  );
  if (!rows[0]) return null;
  rows[0].reactions = await getMessageReactions(id);
  return rowToMessage(rows[0]);
}

async function deleteMessage(id, username) {
  const { rows } = await query(
    `UPDATE messages SET deleted_at = now(), text = NULL,
       attachment_filename = NULL, attachment_original_name = NULL,
       attachment_mime_type = NULL, attachment_size = NULL
     WHERE id = $1 AND username = $2 AND deleted_at IS NULL
     RETURNING *`,
    [id, username]
  );
  return rows[0] ? rowToMessage(rows[0]) : null;
}

module.exports = {
  init,
  saveMessage,
  getHistory,
  updateMessage,
  deleteMessage,
  toggleReaction,
  getMessageRoom,
  createUser,
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
  countUsers,
  findInvite,
  addInvite,
  listInvites,
  removeInvite,
  markInviteUsed,
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
};
