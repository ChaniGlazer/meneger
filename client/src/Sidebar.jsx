function formatConversationTime(iso) {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

export default function Sidebar({
  username,
  myRole,
  stage,
  activeConversationId,
  conversations,
  conversationsError,
  unreadCounts,
  onSelectConversation,
  onEnterInbox,
  onEnterTasks,
  onEnterAdmin,
  onOpenNewChat,
  onOpenNewGroup,
  onLogout,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="sidebar-username">{username}</div>
          <div className="sidebar-role-badge">
            {myRole === "admin" ? "מנהלת" : myRole === "team_lead" ? "ראשת צוות" : "עובדת"}
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          type="button"
          className={stage === "inbox" || stage === "chat" ? "active" : ""}
          onClick={onEnterInbox}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">💬</span>
          תקשורת צוותית
        </button>
        <button type="button" className={stage === "tasks" ? "active" : ""} onClick={onEnterTasks}>
          <span className="sidebar-nav-icon" aria-hidden="true">📋</span>
          המשימות שלי
        </button>
        {(myRole === "admin" || myRole === "team_lead") && (
          <button type="button" className={stage === "admin" ? "active" : ""} onClick={onEnterAdmin}>
            <span className="sidebar-nav-icon" aria-hidden="true">⚙️</span>
            {myRole === "admin" ? "מסך ניהול" : "ניהול הצוות"}
          </button>
        )}
      </nav>

      <div className="sidebar-section-head">
        <span>שיחות אחרונות</span>
        <div className="sidebar-section-actions">
          <button type="button" title="שיחה חדשה" aria-label="שיחה חדשה" onClick={onOpenNewChat}>
            +
          </button>
          {(myRole === "admin" || myRole === "team_lead") && (
            <button type="button" title="קבוצה חדשה" aria-label="קבוצה חדשה" onClick={onOpenNewGroup}>
              👥
            </button>
          )}
        </div>
      </div>

      {conversationsError && <div className="sidebar-error">{conversationsError}</div>}

      <div className="sidebar-conversations">
        {conversations.map((row) => (
          <div
            key={row.id}
            className={`sidebar-conversation-row${row.id === activeConversationId ? " active" : ""}`}
            onClick={() => onSelectConversation(row)}
          >
            <div className="sidebar-conversation-main">
              <span className="sidebar-conversation-name">
                {row.isTask ? (
                  <span className="conv-type-tag task-tag">משימה</span>
                ) : (
                  row.type === "group" && <span className="conv-type-tag">קבוצה</span>
                )}
                {row.name}
              </span>
              {unreadCounts[row.id] > 0 && (
                <span className="unread-badge">{unreadCounts[row.id]}</span>
              )}
            </div>
            {row.lastMessage && (
              <div className="sidebar-conversation-preview">
                <span>
                  {row.lastMessage.username}: {row.lastMessage.text}
                </span>
                <span className="sidebar-conversation-time">
                  {formatConversationTime(row.lastMessage.createdAt)}
                </span>
              </div>
            )}
          </div>
        ))}
        {conversations.length === 0 && !conversationsError && (
          <p className="empty-hint">אין עדיין שיחות</p>
        )}
      </div>

      <button type="button" className="sidebar-logout" onClick={onLogout}>
        התנתקות
      </button>
    </aside>
  );
}
