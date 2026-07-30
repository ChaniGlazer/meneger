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

async function saveToStorage(file) {
  const ext = path.extname(file.originalname).slice(0, 20);
  const filename = `${crypto.randomUUID()}${ext}`;
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(filename, file.buffer, { contentType: file.mimetype });
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
