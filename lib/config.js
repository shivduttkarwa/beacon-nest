// BeaconNest — Supabase connection + auth + display-name helpers.
// Shared by popup.js and manager.js (loaded after lib/vendor/supabase.js).

const BEACONNEST_CONFIG_KEY = "beaconnestSupabaseConfig";
const BEACONNEST_NAME_KEY = "beaconnestUserName";
const BEACONNEST_BUCKET = "screenshots";

let _beaconnestClient = null;
let _beaconnestClientKey = null;

async function beaconnestGetConfig() {
  const data = await chrome.storage.local.get(BEACONNEST_CONFIG_KEY);
  return data[BEACONNEST_CONFIG_KEY] || null; // { url, anonKey }
}

async function beaconnestSetConfig(url, anonKey) {
  await chrome.storage.local.set({
    [BEACONNEST_CONFIG_KEY]: { url: url.trim().replace(/\/+$/, ""), anonKey: anonKey.trim() },
  });
  _beaconnestClient = null; // force re-init with new config
}

async function beaconnestClearConfig() {
  await chrome.storage.local.remove(BEACONNEST_CONFIG_KEY);
  _beaconnestClient = null;
}

// Returns a cached Supabase client, or null if not configured yet.
// Session persistence uses this page's own localStorage, which is fine —
// popup and manager are each stable extension-page origins.
async function beaconnestGetClient() {
  const config = await beaconnestGetConfig();
  if (!config || !config.url || !config.anonKey) return null;

  const cacheKey = `${config.url}::${config.anonKey}`;
  if (_beaconnestClient && _beaconnestClientKey === cacheKey) return _beaconnestClient;

  _beaconnestClient = supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  _beaconnestClientKey = cacheKey;
  return _beaconnestClient;
}

async function beaconnestGetSession() {
  const client = await beaconnestGetClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session || null;
}

async function beaconnestSignIn(email, password) {
  const client = await beaconnestGetClient();
  if (!client) throw new Error("Not configured");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function beaconnestSignOut() {
  const client = await beaconnestGetClient();
  if (!client) return;
  await client.auth.signOut();
}

// --- Display name ------------------------------------------------------
// Tagged onto every beacon this install saves, so teammates can tell who
// left it and filter by person. Stored per-device/per-profile, independent
// of Supabase auth (kept simple — no need to make it a DB profile field).

async function beaconnestGetUserName() {
  const data = await chrome.storage.local.get(BEACONNEST_NAME_KEY);
  return data[BEACONNEST_NAME_KEY] || "";
}

async function beaconnestSetUserName(name) {
  const trimmed = (name || "").trim();
  await chrome.storage.local.set({ [BEACONNEST_NAME_KEY]: trimmed });
  return trimmed;
}
