// Shared between App.jsx (task board), Inbox.jsx (task summary), and
// AdminDashboard.jsx (task table/filters) - previously duplicated in two
// places with a real risk of drifting out of sync.

export const TASK_STATUS_COLUMNS = [
  { key: "todo", label: "לביצוע" },
  { key: "in_progress", label: "בתהליך" },
  { key: "review", label: "להגהה" },
  { key: "done", label: "הושלם" },
];

export const TASK_STATUS_LABELS = Object.fromEntries(
  TASK_STATUS_COLUMNS.map((c) => [c.key, c.label])
);

export const TASK_PRIORITY_LABELS = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };
