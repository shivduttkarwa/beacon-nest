// BeaconNest background service worker.
// All beacon data now lives in Supabase; nothing to initialize locally.
// Kept as a placeholder service worker so the extension has one, per manifest.

chrome.runtime.onInstalled.addListener(() => {
  // no-op
});
