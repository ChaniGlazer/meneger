function toDate(iso) {
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

function formatClockTime(iso) {
  return toDate(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Presentational only - the shift state itself lives in App.jsx so the top
 * bar and the inbox home screen's shift card can share one source of truth
 * instead of drifting when a shift is started/ended from either place.
 */
export default function TimeClock({ openLog, loading, busy, error, now, onClockIn, onClockOut }) {
  return (
    <div className="time-clock-bar">
      <div className="app-brand">
        <img className="app-brand-logo" src="/brand/codebloom.svg" alt="" aria-hidden="true" />
        מערכת ניהול עובדות
      </div>

      {!loading && (
        <div className="time-clock-widget">
          {openLog ? (
            <>
              <span className="time-clock-status" role="status" aria-live="polite">
                נוכחת מ-{formatClockTime(openLog.clock_in)} ·{" "}
                {formatElapsed(now - toDate(openLog.clock_in).getTime())}
              </span>
              <button
                type="button"
                className="time-clock-button clock-out"
                onClick={onClockOut}
                disabled={busy}
              >
                סיום עבודה
              </button>
            </>
          ) : (
            <>
              <span className="time-clock-status" role="status" aria-live="polite">
                עוד לא התחלת לעבוד היום
              </span>
              <button
                type="button"
                className="time-clock-button clock-in"
                onClick={onClockIn}
                disabled={busy}
              >
                התחלת עבודה
              </button>
            </>
          )}
          {error && <span className="time-clock-error">{error}</span>}
        </div>
      )}
    </div>
  );
}
