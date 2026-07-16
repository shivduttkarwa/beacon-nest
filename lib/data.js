// BeaconNest — data layer, backed by Supabase (Postgres + Storage + Realtime).
// Requires lib/vendor/supabase.js and lib/config.js to be loaded first.

function beaconnestGenerateId() {
  // Used only as the storage object path prefix — Postgres assigns the real row id.
  return `bn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function beaconnestRowToBeacon(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description || "",
    selector: row.selector,
    selectedText: row.selected_text,
    snippet: row.snippet || "",
    scrollX: row.scroll_x || 0,
    scrollY: row.scroll_y || 0,
    scrollYRatio: row.scroll_y_ratio || 0,
    screenshotPath: row.screenshot_path,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function beaconnestRequireClient() {
  const client = await beaconnestGetClient();
  if (!client) throw new Error("BeaconNest isn't connected to Supabase yet.");
  return client;
}

// --- Screenshots -----------------------------------------------------------

async function beaconnestUploadScreenshot(localId, dataUrl) {
  const client = await beaconnestRequireClient();
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${localId}.png`;
  const { error } = await client.storage
    .from(BEACONNEST_BUCKET)
    .upload(path, blob, { contentType: "image/png", upsert: true });
  if (error) throw error;
  return path;
}

async function beaconnestScreenshotUrl(path) {
  if (!path) return null;
  const client = await beaconnestRequireClient();
  const { data } = client.storage.from(BEACONNEST_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

async function beaconnestDeleteScreenshotFile(path) {
  if (!path) return;
  const client = await beaconnestRequireClient();
  await client.storage.from(BEACONNEST_BUCKET).remove([path]);
}

// --- Beacons (Postgres table `beacons`) -------------------------------------

async function beaconnestGetAllBeacons() {
  const client = await beaconnestRequireClient();
  const { data, error } = await client
    .from("beacons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(beaconnestRowToBeacon);
}

async function beaconnestAddBeacon({ title, url, description, selector, selectedText, snippet, scrollX, scrollY, scrollYRatio, screenshotDataUrl, createdByName }) {
  const client = await beaconnestRequireClient();
  const { data: sessionData } = await client.auth.getSession();
  const user = sessionData.session?.user;

  const localId = beaconnestGenerateId();
  const screenshotPath = screenshotDataUrl
    ? await beaconnestUploadScreenshot(localId, screenshotDataUrl)
    : null;

  const { data, error } = await client
    .from("beacons")
    .insert({
      title,
      url,
      description: description || "",
      selector,
      selected_text: selectedText,
      snippet,
      scroll_x: scrollX || 0,
      scroll_y: scrollY || 0,
      scroll_y_ratio: scrollYRatio || 0,
      screenshot_path: screenshotPath,
      created_by: user?.id || null,
      created_by_email: user?.email || null,
      created_by_name: createdByName || null,
    })
    .select()
    .single();

  if (error) throw error;
  return beaconnestRowToBeacon(data);
}

async function beaconnestUpdateBeacon(id, updates) {
  const client = await beaconnestRequireClient();
  const patch = {};
  if ("description" in updates) patch.description = updates.description;
  if ("title" in updates) patch.title = updates.title;

  const { data, error } = await client
    .from("beacons")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return beaconnestRowToBeacon(data);
}

async function beaconnestDeleteBeacon(id, screenshotPath) {
  const client = await beaconnestRequireClient();
  const { error } = await client.from("beacons").delete().eq("id", id);
  if (error) throw error;
  await beaconnestDeleteScreenshotFile(screenshotPath);
}

// Live updates: fires callback(eventType, row) on insert/update/delete from anyone.
async function beaconnestSubscribe(onChange) {
  const client = await beaconnestRequireClient();
  const channel = client
    .channel("beacons-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "beacons" },
      (payload) => onChange(payload.eventType, payload.new, payload.old)
    )
    .subscribe();
  return () => client.removeChannel(channel);
}

// --- Misc --------------------------------------------------------------

// The URL is opened exactly as captured — including the page's own #hash,
// which hash-routed SPAs need to land on the right view at all. All scroll
// positioning happens afterwards in content.js (BEACONNEST_SCROLL_TO): it
// runs its own text search over the rendered page, which the browser-native
// #:~:text= fragment can't match for reliability on animated or non-English
// pages (word-boundary rules, split-text spans, first-occurrence-only,
// silent failure, instant jumps that skip scroll-reveal animations).
function beaconnestBuildTargetUrl(beacon) {
  return beacon.url;
}

function beaconnestToCSV(list) {
  const headers = ["title", "url", "description", "selector", "selectedText", "scrollX", "scrollY", "createdByName", "createdByEmail", "createdAt", "updatedAt"];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = list.map((b) => headers.map((h) => escape(b[h])).join(","));
  return [headers.join(","), ...rows].join("\n");
}
