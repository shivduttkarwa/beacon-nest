const els = {
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  signin: document.getElementById("state-signin"),
  name: document.getElementById("state-name"),
  nameInput: document.getElementById("nameInput"),
  saveNameBtn: document.getElementById("saveNameBtn"),
  saveError: document.getElementById("state-save-error"),
  saveErrorDetail: document.getElementById("saveErrorDetail"),
  ready: document.getElementById("state-ready"),
  thumb: document.getElementById("thumb"),
  pageTitle: document.getElementById("pageTitle"),
  anchorSnippet: document.getElementById("anchorSnippet"),
  description: document.getElementById("description"),
  saveBtn: document.getElementById("saveBtn"),
  savedMsg: document.getElementById("savedMsg"),
  manageBtn: document.getElementById("manageBtn"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
};

let capturedTab = null;
let anchorInfo = null;
let screenshotDataUrl = null;

function showState(name) {
  const all = ["loading", "error", "signin", "name", "saveError", "ready"];
  all.forEach((n) => els[n].classList.toggle("hidden", n !== name));
}

async function getAnchorInfoWithRetry(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "BEACONNEST_GET_ANCHOR" });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, { type: "BEACONNEST_GET_ANCHOR" });
  }
}

async function capture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      throw new Error("Unsupported page");
    }
    capturedTab = tab;

    const [info, dataUrl] = await Promise.all([
      getAnchorInfoWithRetry(tab.id),
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
    ]);

    anchorInfo = info;
    screenshotDataUrl = dataUrl;

    els.thumb.src = dataUrl;
    els.pageTitle.textContent = info.title || tab.title || tab.url;
    els.anchorSnippet.textContent = info.snippet
      ? `Near: “${info.snippet}”`
      : "Anchored to nearest element on screen.";

    showState("ready");
    els.description.focus();
  } catch (err) {
    console.error("BeaconNest capture failed:", err);
    showState("error");
  }
}

async function init() {
  showState("loading");

  const session = await beaconnestGetSession().catch(() => null);
  if (!session) {
    showState("signin");
    return;
  }

  const userName = await beaconnestGetUserName();
  if (!userName) {
    showState("name");
    els.nameInput.focus();
    return;
  }

  await capture();
}

async function handleSaveName() {
  const value = els.nameInput.value.trim();
  if (!value) {
    els.nameInput.focus();
    return;
  }
  els.saveNameBtn.disabled = true;
  await beaconnestSetUserName(value);
  els.saveNameBtn.disabled = false;
  showState("loading");
  await capture();
}

async function handleSave() {
  if (!anchorInfo || !screenshotDataUrl || !capturedTab) return;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving…";

  try {
    const createdByName = await beaconnestGetUserName();
    await beaconnestAddBeacon({
      title: anchorInfo.title || capturedTab.title || "",
      url: anchorInfo.url || capturedTab.url,
      description: els.description.value.trim(),
      selector: anchorInfo.selector || null,
      selectedText: anchorInfo.selectedText || null,
      snippet: anchorInfo.snippet || "",
      scrollX: anchorInfo.scrollX || 0,
      scrollY: anchorInfo.scrollY || 0,
      screenshotDataUrl,
      createdByName,
    });
    els.savedMsg.classList.remove("hidden");
    els.saveBtn.textContent = "Saved ✓";
    setTimeout(() => window.close(), 700);
  } catch (err) {
    console.error("BeaconNest save failed:", err);
    els.saveErrorDetail.textContent = err.message || "Unknown error — check your connection.";
    showState("saveError");
  }
}

els.saveBtn.addEventListener("click", handleSave);
els.saveNameBtn.addEventListener("click", handleSaveName);
els.nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSaveName();
});
els.manageBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.openSettingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

init();
