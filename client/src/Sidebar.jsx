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
  conversationsLoading,
  conversationsError,
  unreadCounts,
  onSelectConversation,
  onEnterInbox,
  onEnterTasks,
  onEnterAdmin,
  onOpenNewChat,
  onOpenNewGroup,
  onOpenChangePassword,
  onLogout,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="sidebar-username" dir="auto">{username}</div>
          {myRole === "admin" && <div className="sidebar-role-badge">מנהלת</div>}
          {myRole === "team_lead" && <div className="sidebar-role-badge">ראשת צוות</div>}
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          type="button"
          className={stage === "inbox" || stage === "chat" ? "active" : ""}
          aria-current={stage === "inbox" || stage === "chat" ? "page" : undefined}
          onClick={onEnterInbox}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">💬</span>
          תקשורת צוותית
        </button>
        <button
          type="button"
          className={stage === "tasks" ? "active" : ""}
          aria-current={stage === "tasks" ? "page" : undefined}
          onClick={onEnterTasks}
        >
          <span className="sidebar-nav-icon" aria-hidden="true">📋</span>
          המשימות שלי
        </button>
        {(myRole === "admin" || myRole === "team_lead") && (
          <button
            type="button"
            className={stage === "admin" ? "active" : ""}
            aria-current={stage === "admin" ? "page" : undefined}
            onClick={onEnterAdmin}
          >
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
        {conversationsLoading ? (
          <div className="sidebar-skeleton" aria-hidden="true">
            <div className="sidebar-skeleton-row" style={{ width: "80%" }} />
            <div className="sidebar-skeleton-row" style={{ width: "60%" }} />
            <div className="sidebar-skeleton-row" style={{ width: "70%" }} />
          </div>
        ) : (
          <>
            {conversations.map((row) => (
              <button
                type="button"
                key={row.id}
                className={`sidebar-conversation-row${row.id === activeConversationId ? " active" : ""}`}
                aria-current={row.id === activeConversationId ? "true" : undefined}
                onClick={() => onSelectConversation(row)}
              >
                <div className="sidebar-conversation-main">
                  <span className="sidebar-conversation-name" dir="auto">
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
                    <span dir="auto">
                      {row.lastMessage.username}: {row.lastMessage.text}
                    </span>
                    <span className="sidebar-conversation-time">
                      {formatConversationTime(row.lastMessage.createdAt)}
                    </span>
                  </div>
                )}
              </button>
            ))}
            {conversations.length === 0 && !conversationsError && (
              <p className="empty-hint">אין עדיין שיחות</p>
            )}
          </>
        )}
      </div>

      <button type="button" className="sidebar-change-password" onClick={onOpenChangePassword}>
        שינוי סיסמה
      </button>
      <button type="button" className="sidebar-logout" onClick={onLogout}>
        התנתקות
      </button>
    </aside>
  );
}
