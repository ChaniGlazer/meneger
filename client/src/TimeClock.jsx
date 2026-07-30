import { useEffect, useState } from "react";
import { authedFetch } from "./api";

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

export default function TimeClock() {
  const [openLog, setOpenLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    authedFetch("time-logs?open=true")
      .then((data) => setOpenLog(data.timeLogs[0] || null))
      .catch(() => setError("שגיאה בטעינת שעון הנוכחות"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!openLog) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [openLog]);

  async function handleClockIn() {
    setBusy(true);
    setError("");
    try {
      const data = await authedFetch("time-logs", { method: "POST", body: JSON.stringify({}) });
      setOpenLog(data.timeLog);
      setNow(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClockOut() {
    if (!openLog) return;
    setBusy(true);
    setError("");
    try {
      await authedFetch(`time-logs/${openLog.id}`, {
        method: "PATCH",
        body: JSON.stringify({ clock_out: new Date().toISOString() }),
      });
      setOpenLog(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="time-clock-bar">
      <div className="app-brand">מערכת ניהול עובדים</div>

      {!loading && (
        <div className="time-clock-widget">
          {openLog ? (
            <>
              <span className="time-clock-status">
                נוכח/ת מ-{formatClockTime(openLog.clock_in)} ·{" "}
                {formatElapsed(now - toDate(openLog.clock_in).getTime())}
              </span>
              <button
                type="button"
                className="time-clock-button clock-out"
                onClick={handleClockOut}
                disabled={busy}
              >
                יציאה
              </button>
            </>
          ) : (
            <>
              <span className="time-clock-status">לא נרשמה כניסה</span>
              <button
                type="button"
                className="time-clock-button clock-in"
                onClick={handleClockIn}
                disabled={busy}
              >
                כניסה
              </button>
            </>
          )}
          {error && <span className="time-clock-error">{error}</span>}
        </div>
      )}
    </div>
  );
}
