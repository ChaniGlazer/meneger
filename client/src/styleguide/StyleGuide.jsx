import { useEffect, useState } from "react";
import { contrast, verdict } from "./contrast";

/* ---------------------------------------------------------------- helpers */

function Section({ title, note, children }) {
  return (
    <section className="sg-section">
      <h2>{title}</h2>
      {note && <p className="sg-note">{note}</p>}
      {children}
    </section>
  );
}

/** A foreground/background pair with its measured ratio and WCAG verdict. */
function ContrastRow({ label, fg, bg, size = "normal", sample = "אבגד abc 123" }) {
  const [ratio, setRatio] = useState(null);

  useEffect(() => {
    setRatio(contrast(fg, bg));
  }, [fg, bg]);

  const v = ratio == null ? null : verdict(ratio, size);

  return (
    <tr>
      <td>{label}</td>
      <td>
        <span className="sg-swatch" style={{ background: bg, color: fg }}>
          {sample}
        </span>
      </td>
      <td className="sg-ratio">{ratio == null ? "…" : `${ratio.toFixed(2)}:1`}</td>
      <td>
        {v && <span className={`sg-verdict ${v.state}`}>{v.label}</span>}
      </td>
      <td style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
        {size === "normal" ? "טקסט רגיל (4.5)" : "טקסט גדול / רכיב (3.0)"}
      </td>
    </tr>
  );
}

function Ramp({ name, steps }) {
  return (
    <>
      <div className="sg-h3">{name}</div>
      <div className="sg-ramp">
        {steps.map((s) => (
          <div className="sg-chip" key={s}>
            <div className="sg-chip-color" style={{ background: `var(${s})` }} />
            <div className="sg-chip-label">{s.replace("--", "")}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Renders one message bubble matching App.jsx's real structure: name (group
    threads only) above the content, reaction badges, then a footer with the
    time and - for own messages - a "⋮" menu instead of permanent text links. */
function Bubble({ mine, name, time, text, edited, deleted, reactions, editing, attachment, dm, menuOpen }) {
  return (
    <div className={`bubble ${mine ? "mine" : "theirs"}${deleted ? " deleted" : ""}`}>
      {!dm && !deleted && <div className="bubble-name">{name}</div>}

      {deleted ? (
        <div className="bubble-text bubble-deleted-text">ההודעה נמחקה</div>
      ) : editing ? (
        <form className="bubble-edit-form" onSubmit={(e) => e.preventDefault()}>
          <textarea defaultValue={text} rows={1} />
          <div className="bubble-edit-actions">
            <button type="submit">שמירה</button>
            <button type="button">ביטול</button>
          </div>
        </form>
      ) : (
        <>
          {attachment === "file" && (
            <a className="attachment-file" href="#" onClick={(e) => e.preventDefault()}>
              <span className="attachment-file-name">quarterly-report-2026.pdf</span>
              <span className="attachment-file-size">2.4 MB</span>
            </a>
          )}
          {text && <div className="bubble-text" dir="auto">{text}</div>}
        </>
      )}

      {reactions && !deleted && (
        <div className="bubble-reactions">
          <button type="button" className="reaction-chip">👍 2</button>
          <button type="button" className="reaction-chip mine">❤️ 1</button>
          <button type="button" className="reaction-add">😊+</button>
        </div>
      )}

      {!editing && (
        <div className="bubble-footer">
          <span className="bubble-time">
            {time}
            {edited && !deleted && <span className="bubble-edited"> · נערך</span>}
          </span>
          {mine && !deleted && (
            <div className="menu-wrap bubble-menu-wrap">
              <button type="button" className="menu-trigger" aria-label="פעולות נוספות" style={menuOpen ? { opacity: 1 } : undefined}>
                ⋮
              </button>
              {menuOpen && (
                <div className="menu-dropdown">
                  <button type="button">עריכה</button>
                  <button type="button">מחיקה</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function StyleGuide() {
  const [modal, setModal] = useState(null);

  useEffect(() => {
    document.title = "StyleGuide — מערכת ניהול עובדות";
  }, []);

  return (
    <div className="sg">
      <h1 className="sg-title">StyleGuide</h1>
      <p className="sg-lede">
        כל האלמנטים של מערכת העיצוב, עם יחסי ניגודיות שמחושבים בזמן אמת בדפדפן.
        הדף הזה קיים רק בפיתוח — <code>vite build</code> בונה רק את{" "}
        <code>index.html</code>, אז הוא לא נכנס לגרסת הייצור. משמש גם כתחליף
        לבסיס נתוני בדיקות: כאן בודקים מצבי טעינה, מצבים ריקים ומצבי שגיאה בלי
        לכתוב שום דבר ל-Supabase.
      </p>

      {/* ---------------------------------------------------- contrast */}
      <Section
        title="ניגודיות — כל צמד צבע/רקע שבשימוש"
        note="היחסים נמדדים מהצבעים שבאמת מרונדרים. אם שינוי בפלטה יחזיר כשל נגישות, הוא יופיע כאן באדום."
      >
        <table className="sg-table">
          <thead>
            <tr>
              <th>תפקיד</th>
              <th>דוגמה</th>
              <th>יחס</th>
              <th>תקן</th>
              <th>דרישה</th>
            </tr>
          </thead>
          <tbody>
            <ContrastRow label="fg-default על משטח" fg="var(--fg-default)" bg="var(--bg-surface)" />
            <ContrastRow label="fg-muted על משטח" fg="var(--fg-muted)" bg="var(--bg-surface)" />
            <ContrastRow label="fg-subtle על משטח (היה 3.5 ✗)" fg="var(--fg-subtle)" bg="var(--bg-surface)" />
            <ContrastRow label="fg-link על משטח (היה 4.4 ✗)" fg="var(--fg-link)" bg="var(--bg-surface)" />
            <ContrastRow label="לבן על brand (כפתור ראשי)" fg="var(--fg-on-brand)" bg="var(--brand)" />
            <ContrastRow label="brand כטקסט על tint" fg="var(--brand-fg-on-tint)" bg="var(--brand-tint)" />
            <ContrastRow label="accent על accent-tint" fg="var(--accent-fg-on-tint)" bg="var(--accent-tint)" />
            <ContrastRow label="לבן על accent" fg="var(--fg-on-brand)" bg="var(--accent)" />
            <ContrastRow label="success על tint" fg="var(--success)" bg="var(--success-tint)" />
            <ContrastRow label="warning על tint (היה 3.8 ✗)" fg="var(--warning)" bg="var(--warning-tint)" />
            <ContrastRow label="danger על tint" fg="var(--danger)" bg="var(--danger-tint)" />
            <ContrastRow label="טקסט על בועה שלי (brand-tint)" fg="var(--fg-default)" bg="var(--bubble-mine-bg)" />
            <ContrastRow label="meta על בועה שלי (היה 3.2 ✗)" fg="var(--fg-muted)" bg="var(--bubble-mine-bg)" />
            <ContrastRow label="סרגל עליון — טקסט" fg="var(--fg-on-inverse)" bg="var(--bg-inverse)" />
            <ContrastRow label="סרגל עליון — משני" fg="var(--fg-on-inverse-muted)" bg="var(--bg-inverse)" />
            <ContrastRow label="סרגל עליון — שגיאה" fg="var(--fg-on-inverse-danger)" bg="var(--bg-inverse)" />
            <ContrastRow label="גבול בועה מול קנבס (נדרש 3.0)" fg="var(--bubble-mine-border)" bg="var(--bg-canvas)" size="nontext" sample="גבול" />
            <ContrastRow label="טבעת פוקוס מול קנבס (נדרש 3.0)" fg="var(--focus-ring)" bg="var(--bg-canvas)" size="nontext" sample="טבעת" />
          </tbody>
        </table>
      </Section>

      {/* ---------------------------------------------------- ramps */}
      <Section title="הרמפות" note="פרימיטיבים בלבד — רכיבים לעולם לא מפנים אליהם ישירות, רק לשכבת התפקידים.">
        <Ramp name="ink (ניטרלים בגוון נייבי)" steps={["--ink-900","--ink-800","--ink-700","--ink-600","--ink-500","--ink-400","--ink-300","--ink-200","--ink-100","--ink-50","--ink-25"]} />
        <Ramp name="navy — שדה הלוגו, פעולה ראשית" steps={["--navy-900","--navy-800","--navy-700","--navy-600","--navy-100","--navy-50"]} />
        <Ramp name="terracotta — הפרח, הדגשה" steps={["--terra-800","--terra-700","--terra-600","--terra-500","--terra-100","--cream"]} />
        <Ramp name="סמנטיים" steps={["--success","--success-tint","--warning","--warning-tint","--danger","--danger-tint"]} />
      </Section>

      {/* ---------------------------------------------------- type */}
      <Section title="טיפוגרפיה" note="Heebo, מתארח מקומית. גובה שורה 1.65 — קודם לא היה line-height בכלל, והכל ירש ~1.2 מהדפדפן, צפוף מדי לעברית.">
        <p className="sg-type-sample" style={{ fontSize: "var(--text-3xl)", lineHeight: "var(--leading-tight)" }}>3xl · בוקר טוב, חני</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-2xl)", lineHeight: "var(--leading-tight)" }}>2xl · מערכת ניהול עובדות</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-xl)" }}>xl · כותרת מסך</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-lg)" }}>lg · כותרת מקטע</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-md)" }}>md · טקסט גוף רגיל, וגם Latin mixed inline 42</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>sm · טקסט משני ופקדים</p>
        <p className="sg-type-sample" style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>xs · מטא־דאטה — רצפה קשיחה של 12px</p>
      </Section>

      {/* ---------------------------------------------------- buttons */}
      <Section title="כפתורים" note="מערכת אחת. עברו עם Tab כדי לראות את טבעת הפוקוס — גם על רקע לבן, גם על שקוע, וגם על כהה.">
        <div className="sg-h3">וריאנטים</div>
        <div className="sg-row">
          <button className="btn btn-primary">ראשי</button>
          <button className="btn btn-secondary">משני</button>
          <button className="btn btn-success">הצלחה</button>
          <button className="btn btn-ghost">שקוף</button>
          <button className="btn btn-ghost btn-danger">מסוכן</button>
          <button className="btn btn-primary btn-sm">קטן</button>
        </div>

        <div className="sg-h3">מצב מושבת</div>
        <div className="sg-row">
          <button className="btn btn-primary" disabled>ראשי</button>
          <button className="btn btn-secondary" disabled>משני</button>
          <button className="btn btn-ghost" disabled>שקוף</button>
        </div>

        <div className="sg-h3">פוקוס על רקע שקוע (סרגל הצד)</div>
        <div className="sg-onsunken sg-row">
          <button className="btn btn-primary">ראשי</button>
          <button className="btn btn-secondary">משני</button>
          <button className="btn btn-ghost">שקוף</button>
        </div>

        <div className="sg-h3">פוקוס על רקע כהה (סרגל עליון)</div>
        <div className="sg-inverse sg-row">
          <span className="app-brand">מערכת ניהול עובדות</span>
          <span className="time-clock-status">נוכחת מ-09:14 · 03:22:10</span>
          <button className="time-clock-button clock-in">התחלת עבודה</button>
          <button className="time-clock-button clock-out">סיום עבודה</button>
          <span className="time-clock-error">שגיאה בטעינת שעון הנוכחות</span>
        </div>
      </Section>

      {/* ---------------------------------------------------- fields */}
      <Section title="שדות קלט" note="קודם לא היה שום טיפול ב-:focus. עכשיו יש גבול מותג + הילה.">
        <div className="sg-stack">
          <input className="field" placeholder="מצב רגיל" />
          <input className="field" defaultValue="עם ערך" />
          <input className="field" placeholder="מושבת" disabled />
          <select className="field"><option>בחירה מרשימה</option></select>
          <textarea className="field" rows={3} placeholder="טקסט ארוך" />
        </div>
      </Section>

      {/* ---------------------------------------------------- pills */}
      <Section title="תגיות ותוויות" note="צורה אחת לכל התגיות. קודם אותה עדיפות נראתה מלבן בלוח המשימות ואליפסה בטבלת הניהול.">
        <div className="sg-row">
          <span className="pill priority-low">נמוכה</span>
          <span className="pill priority-medium">בינונית</span>
          <span className="pill priority-high">גבוהה</span>
        </div>
        <div className="sg-row">
          <span className="pill status-todo">לביצוע</span>
          <span className="pill status-in_progress">בתהליך</span>
          <span className="pill status-review">להגהה</span>
          <span className="pill status-done">הושלם</span>
        </div>
        <div className="sg-row">
          <span className="sidebar-role-badge">מנהלת</span>
          <span className="conv-type-tag">קבוצה</span>
          <span className="conv-type-tag task-tag">משימה</span>
          <span className="unread-badge">3</span>
          <span className="unread-badge">128</span>
        </div>
      </Section>

      {/* ---------------------------------------------------- feedback */}
      <Section title="הודעות מערכת" note="קודם היו שלוש שפות ויזואליות שונות ל״משהו נכשל״, וטוסט מידע נראה כמו אזהרה כתומה.">
        <div className="sg-stack">
          <div className="alert">שם משתמשת או סיסמה שגויים</div>
          <div className="alert alert-warning">הקובץ גדול מדי (מקסימום 10MB)</div>
          <div className="alert alert-success">הסיסמה עודכנה בהצלחה</div>
          <div className="alert alert-info">הוסרת מהקבוצה הזו</div>
          <div className="banner">הודעה חדשה מרבקה: מתי הפגישה?</div>
        </div>
      </Section>

      {/* ---------------------------------------------------- bubbles */}
      <Section
        title="מטריצת בועות הצ׳אט"
        note="כאן היו נתפסים שני באגי ״אלמנט בלתי נראה״: צ׳יפ הריאקציה על בועה משלי, ומסגרת שדה העריכה על בועה שהתקבלה. בדקי שכל טקסט קריא ושום גבול לא נעלם."
      >
        <div className="sg-thread">
          <Bubble mine name="חני" time="09:14" text="שלום, מה המצב עם הדוח?" />
          <Bubble name="רבקה" time="09:15" text="שולחת עוד מעט" />
          <Bubble mine name="חני" time="09:16" text="מעולה, תודה!" reactions />
          <Bubble name="רבקה" time="09:17" text="Sent from my iPhone — quarterly_report_final_v2.pdf" />
          <Bubble mine name="חני" time="09:18" text="🎉🎉🎉" />
          <Bubble name="רבקה" time="09:20" text={"שורה ראשונה\nשורה שנייה אחרי Shift+Enter\nשורה שלישית"} />
          <Bubble mine name="חני" time="09:21" text="הודעה שנערכה" edited />
          <Bubble name="רבקה" time="09:22" deleted />
          <Bubble mine name="חני" time="09:23" deleted />
          <Bubble name="רבקה" time="09:24" attachment="file" />
          <Bubble mine name="חני" time="09:25" attachment="file" text="מצורף הקובץ" />
          <Bubble name="רבקה" time="09:26" text="עריכה על בועה שהתקבלה" editing />
          <Bubble mine name="חני" time="09:27" text="עריכה על בועה שלי" editing />
          <Bubble mine name="חני" time="09:29" text="עם תפריט הפעולות פתוח" menuOpen />
          <Bubble
            name="רבקה"
            time="09:28"
            text={"הודעה ארוכה מאוד שבודקת גלישת שורות ורוחב מקסימלי. ".repeat(6)}
          />
          <div className="typing-indicator">
            רבקה מקלידה
            <span className="typing-dots" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
          </div>
        </div>

        <div className="sg-h3">שיחת דו-שיח (השם מוסתר, מוצג רק בקבוצות)</div>
        <div className="sg-thread">
          <Bubble dm mine time="09:30" text="הגעת?" />
          <Bubble dm time="09:31" text="עוד 5 דקות" />
        </div>
      </Section>

      <Section title="נוכחות, טוסט ופאנל עליון" note="הנוכחות מקבלת נקודת סטטוס; הטוסט הוא כרטיס צף עם כפתור סגירה, לא באנר בתוך הזרימה.">
        <div className="sg-h3">נוכחות</div>
        <div className="sg-row">
          <span className="presence online">מחוברות כעת: רבקה, שרה</span>
          <span className="presence">אין משתמשות מחוברות</span>
        </div>

        <div className="sg-h3">טוסט (ממוקם fixed — כאן מוצג inline להדגמה)</div>
        <div className="sg-row" style={{ position: "relative", height: 60 }}>
          <div className="toast" style={{ position: "static" }} role="status">
            <button type="button" className="toast-body">הודעה חדשה מרבקה: מתי הפגישה?</button>
            <button type="button" className="toast-close" aria-label="סגירה">✕</button>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------- states */}
      <Section title="מצבי טעינה ומצבים ריקים" note="נבדקים כאן במקום מול בסיס הנתונים האמיתי — כך אין צורך ליצור או למחוק רשומות אמיתיות כדי לראות מצב ריק.">
        <div className="sg-h3">שלד טעינה (סרגל צד)</div>
        <div className="sg-onsunken" style={{ maxWidth: 280 }}>
          <div className="sg-skeleton-row" style={{ width: "70%" }} />
          <div className="sg-skeleton-row" style={{ width: "90%" }} />
          <div className="sg-skeleton-row" style={{ width: "55%" }} />
        </div>

        <div className="sg-h3">מצבים ריקים</div>
        <p className="empty-hint">אין עדיין שיחות</p>
        <p className="empty-hint">לא נמצאו משימות התואמות לסינון</p>
        <p className="empty-hint">אין נתוני נוכחות בטווח שנבחר</p>
      </Section>

      {/* ---------------------------------------------------- modal */}
      <Section title="מודאל" note="מימוש אחד. Escape, מלכודת פוקוס והחזרת פוקוס מגיעים עם רכיב ה-Modal בשלב 2.">
        <div className="sg-row">
          <button className="btn btn-primary" onClick={() => setModal("generic")}>פתחי מודאל</button>
        </div>
        {modal && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
            <div className="modal-panel">
              <div className="modal-head">
                <h3>קבוצה חדשה</h3>
                <button className="modal-close" onClick={() => setModal(null)} aria-label="סגירה">✕</button>
              </div>
              <input className="field" placeholder="שם הקבוצה" />
              <p className="user-list-title">בחרי משתתפות:</p>
              <div className="user-list">
                <label className="checkbox-row"><input type="checkbox" defaultChecked /> רבקה</label>
                <label className="checkbox-row"><input type="checkbox" /> שרה</label>
                <label className="checkbox-row"><input type="checkbox" /> מרים</label>
              </div>
              <div className="admin-modal-actions">
                <button className="btn btn-secondary" onClick={() => setModal(null)}>ביטול</button>
                <button className="btn btn-primary">צרי קבוצה</button>
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------- table */}
      <Section title="טבלה" note="מספרים ב-tabular-nums כדי שהעמודות יתיישרו. כותרות ללא uppercase — לעברית אין אותיות גדולות.">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>עובדת</th><th>סה״כ שעות</th><th>מספר רישומים</th><th>עדיפות</th></tr>
            </thead>
            <tbody>
              <tr><td>חני</td><td>162.50</td><td>21</td><td><span className="pill priority-high">גבוהה</span></td></tr>
              <tr><td>רבקה</td><td>8.25</td><td>3</td><td><span className="pill priority-medium">בינונית</span></td></tr>
              <tr><td>מרים</td><td>0.00</td><td>0</td><td><span className="admin-cell-muted">—</span></td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---------------------------------------------------- cards */}
      <Section title="כרטיס משימה">
        <div style={{ maxWidth: 260 }}>
          <div className="task-card">
            <span className="task-priority priority-high">גבוהה</span>
            <div className="task-title">הכנת דוח רבעוני</div>
            <div className="task-description">לאסוף את הנתונים מכל הצוותים ולסכם</div>
            <div className="task-due">יעד: 2026-08-15</div>
            <button className="task-chat-button">פתיחת שיחת משימה</button>
          </div>
        </div>
      </Section>
    </div>
  );
}
