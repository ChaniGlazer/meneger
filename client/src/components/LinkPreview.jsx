import { useEffect, useState } from "react";
import { authedFetch } from "../api";

// Shared across every LinkPreview instance so the same URL appearing in
// multiple messages (or re-rendered on scroll) only hits the server once.
const previewCache = new Map();

export default function LinkPreview({ url }) {
  const [preview, setPreview] = useState(() => previewCache.get(url) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || previewCache.has(url)) return;
    let cancelled = false;
    authedFetch(`link-preview?url=${encodeURIComponent(url)}`, { method: "GET" })
      .then((data) => {
        previewCache.set(url, data);
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || failed) return null;
  if (!preview || (!preview.title && !preview.description && !preview.image)) return null;

  return (
    <a
      className="link-preview"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image && (
        <img className="link-preview-image" src={preview.image} alt="" loading="lazy" />
      )}
      <div className="link-preview-body">
        <div className="link-preview-site">{preview.siteName}</div>
        {preview.title && <div className="link-preview-title">{preview.title}</div>}
        {preview.description && (
          <div className="link-preview-description">{preview.description}</div>
        )}
      </div>
    </a>
  );
}
