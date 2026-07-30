import { TASK_STATUS_COLUMNS } from "./taskMeta";

function greetingForHour(hour) {
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "אחר הצהריים טובים";
  return "ערב טוב";
}

function formatHebrewDate(date) {
  return date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
}

function parseDueDate(due) {
  if (!due) return null;
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? null : d;
}

function SkeletonRows({ count = 3 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="inbox-skeleton-row" style={{ width: `${80 - i * 12}%` }} />
      ))}
    </div>
  );
}

export default function Inbox({
  username,
  myRole,
  tasks,
  tasksLoading,
  conversations,
  conversationsLoading,
  unreadCounts,
  timeClockOpenLog,
  timeClockLoading,
  timeClockBusy,
  timeClockError,
  timeClockHasWorkedToday,
  onClockIn,
  onClockOut,
  onSelectConversation,
  onEnterTasks,
  onEnterAdmin,
  onOpenNewChat,
  onOpenNewGroup,
}) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const statusCounts = TASK_STATUS_COLUMNS.map((col) => ({
    ...col,
    count: tasks.filter((t) => t.status === col.key).length,
  }));

  const overdueCount = tasks.filter((t) => {
    if (t.status === "done") return false;
    const due = parseDueDate(t.due_date);
    return due && due < todayStart;
  }).length;

  const upcomingTasks = [...tasks]
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const da = parseDueDate(a.due_date);
      const db = parseDueDate(b.due_date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    })
    .slice(0, 3);

  const unreadConversations = conversations.filter((c) => unreadCounts[c.id] > 0);
  const conversationsToShow = unreadConversations.length > 0
    ? unreadConversations
    : conversations.slice(0, 3);

  const canCreateGroup = myRole === "admin" || myRole === "team_lead";

  return (
    <div className="inbox-home">
      <h1 className="inbox-greeting">
        {greetingForHour(now.getHours())}, {username}
      </h1>
      <p className="inbox-date">{formatHebrewDate(now)}</p>

      <div className="inbox-cards">
        <section className="inbox-card" aria-labelledby="inbox-shift-heading">
          <h2 id="inbox-shift-heading">משמרת</h2>
          {timeClockLoading ? (
            <SkeletonRows count={1} />
          ) : (
            <div className="inbox-shift-row">
              <span role="status" aria-live="polite">
                {timeClockOpenLog
                  ? "את נוכחת כרגע"
                  : timeClockHasWorkedToday
                  ? "בהפסקה"
                  : "עוד לא התחלת לעבוד היום"}
              </span>
              <button
                type="button"
                className={`btn ${timeClockOpenLog ? "btn-danger" : "btn-success"}`}
                onClick={timeClockOpenLog ? onClockOut : onClockIn}
                disabled={timeClockBusy}
              >
                {timeClockOpenLog ? "סיום עבודה" : timeClockHasWorkedToday ? "המשך עבודה" : "התחלת עבודה"}
              </button>
            </div>
          )}
          {timeClockError && <div className="alert">{timeClockError}</div>}
        </section>

        <section className="inbox-card" aria-labelledby="inbox-tasks-heading">
          <div className="inbox-card-head">
            <h2 id="inbox-tasks-heading">המשימות שלי</h2>
          </div>
          {tasksLoading ? (
            <SkeletonRows />
          ) : tasks.length === 0 ? (
            <p className="empty-hint">אין לך משימות כרגע</p>
          ) : (
            <>
              <div className="inbox-stat-row">
                {statusCounts.map((s) => (
                  <button type="button" key={s.key} className="inbox-stat" onClick={onEnterTasks}>
                    <span className="inbox-stat-count">{s.count}</span>
                    <span className="inbox-stat-label">{s.label}</span>
                  </button>
                ))}
              </div>
              {overdueCount > 0 && (
                <p className="inbox-overdue">
                  {overdueCount} {overdueCount === 1 ? "משימה באיחור" : "משימות באיחור"}
                </p>
              )}
              {upcomingTasks.length > 0 && (
                <ul className="inbox-task-list">
                  {upcomingTasks.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={onEnterTasks}>
                        <span dir="auto">{t.title}</span>
                        {t.due_date && <span className="inbox-task-due">{t.due_date}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section className="inbox-card" aria-labelledby="inbox-conversations-heading">
          <h2 id="inbox-conversations-heading">
            {unreadConversations.length > 0 ? "שיחות שממתינות לך" : "שיחות אחרונות"}
          </h2>
          {conversationsLoading ? (
            <SkeletonRows />
          ) : conversationsToShow.length === 0 ? (
            <p className="empty-hint">אין עדיין שיחות</p>
          ) : (
            <ul className="inbox-conversation-list">
              {conversationsToShow.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onSelectConversation(row)}>
                    <span dir="auto">{row.name}</span>
                    {unreadCounts[row.id] > 0 && (
                      <span className="unread-badge">{unreadCounts[row.id]}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="inbox-actions">
        <button type="button" className="btn btn-primary" onClick={onOpenNewChat}>
          שיחה חדשה
        </button>
        {canCreateGroup && (
          <button type="button" className="btn btn-secondary" onClick={onOpenNewGroup}>
            קבוצה חדשה
          </button>
        )}
        {myRole === "admin" && (
          <button type="button" className="btn btn-secondary" onClick={onEnterAdmin}>
            משימה חדשה
          </button>
        )}
      </div>
    </div>
  );
}
