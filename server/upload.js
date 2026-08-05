const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const BUCKET = process.env.SUPABASE_BUCKET || "uploads";

let supabase = null;
function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// The storage bucket is public, so whatever content-type we save a file
// with is exactly what a browser gets when someone opens the direct link.
// Only let genuinely safe-to-render types (photos, PDFs) keep their real
// mimetype; anything else — including a client-spoofed "image/svg+xml" or
// an uploaded .html file — is forced to a generic binary type so it
// downloads instead of executing as a page in the browser.
const INLINE_SAFE_MIME_RE = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf)$/i;

async function saveToStorage(file) {
  const ext = path.extname(file.originalname).slice(0, 20);
  const filename = `${crypto.randomUUID()}${ext}`;
  const contentType = INLINE_SAFE_MIME_RE.test(file.mimetype)
    ? file.mimetype
    : "application/octet-stream";
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(filename, file.buffer, { contentType });
  if (error) throw error;
  return filename;
}

async function deleteFromStorage(filename) {
  await getSupabase().storage.from(BUCKET).remove([filename]);
}

function getPublicUrl(filename) {
  if (!filename) return null;
  return getSupabase().storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
}

module.exports = { upload, saveToStorage, deleteFromStorage, getPublicUrl };
