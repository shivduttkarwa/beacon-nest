const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const notConnected = document.getElementById("notConnected");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const personDropdown = document.getElementById("personDropdown");
const personDropdownTrigger = document.getElementById("personDropdownTrigger");
const personDropdownLabel = document.getElementById("personDropdownLabel");
const personDropdownMenu = document.getElementById("personDropdownMenu");
const exportBtn = document.getElementById("exportBtn");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");

function showModal({ title, message, confirmLabel = "OK", danger = false, showCancel = true }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalConfirmBtn.textContent = confirmLabel;
    modalConfirmBtn.classList.toggle("modal__confirm-btn--danger", danger);
    modalCancelBtn.classList.toggle("hidden", !showCancel);
    modalOverlay.classList.remove("hidden");

    function cleanup(result) {
      modalOverlay.classList.add("hidden");
      modalConfirmBtn.removeEventListener("click", onConfirm);
      modalCancelBtn.removeEventListener("click", onCancel);
      modalOverlay.removeEventListener("mousedown", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlayClick(e) { if (e.target === modalOverlay) cleanup(false); }
    function onKeydown(e) { if (e.key === "Escape") cleanup(false); }

    modalConfirmBtn.addEventListener("click", onConfirm);
    modalCancelBtn.addEventListener("click", onCancel);
    modalOverlay.addEventListener("mousedown", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

function beaconnestConfirm(title, message) {
  return showModal({ title, message, confirmLabel: "Delete", danger: true, showCancel: true });
}

function beaconnestAlert(title, message) {
  return showModal({ title, message, confirmLabel: "OK", danger: false, showCancel: false });
}

const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const nameBlock = document.getElementById("settings-name");
const userNameInput = document.getElementById("userName");
const saveNameBtn = document.getElementById("saveNameBtn");
const nameStatus = document.getElementById("nameStatus");
const configBlock = document.getElementById("settings-config");
const authBlock = document.getElementById("settings-auth");
const signedInBlock = document.getElementById("settings-signed-in");
const sbUrl = document.getElementById("sbUrl");
const sbAnonKey = document.getElementById("sbAnonKey");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const configStatus = document.getElementById("configStatus");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const signInBtn = document.getElementById("signInBtn");
const authStatus = document.getElementById("authStatus");
const signedInEmail = document.getElementById("signedInEmail");
const signOutBtn = document.getElementById("signOutBtn");

let allBeacons = [];
let filtered = [];
let unsubscribeRealtime = null;
let selectedPerson = "";
let currentUserId = null;

const PERSON_HUES = [252, 168, 12, 292, 200, 42, 330, 96];
function personColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = PERSON_HUES[hash % PERSON_HUES.length];
  return `hsl(${hue} 70% 50%)`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

function matchesQuery(b, q) {
  if (!q) return true;
  const hay = `${b.title} ${b.description} ${b.url} ${b.snippet}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function personLabel(b) {
  return b.createdByName || b.createdByEmail || "";
}

function checkIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.classList.add("dropdown__option-check");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 10.5L8 14.5L16 6");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function buildPersonOption(name, label) {
  const li = document.createElement("li");
  li.className = "dropdown__option";
  li.setAttribute("role", "option");
  li.dataset.value = name;
  li.setAttribute("aria-selected", String(selectedPerson === name));

  if (name) {
    const dot = document.createElement("span");
    dot.className = "dropdown__option-dot";
    dot.style.background = personColor(name);
    li.appendChild(dot);
  }

  const text = document.createElement("span");
  text.textContent = label;
  li.appendChild(text);
  li.appendChild(checkIcon());

  li.addEventListener("click", () => setSelectedPerson(name));
  return li;
}

function populatePersonFilter() {
  const names = Array.from(new Set(allBeacons.map(personLabel).filter(Boolean))).sort();
  if (!names.includes(selectedPerson)) selectedPerson = "";

  personDropdownMenu.innerHTML = "";
  personDropdownMenu.appendChild(buildPersonOption("", "All people"));
  for (const name of names) {
    personDropdownMenu.appendChild(buildPersonOption(name, name));
  }

  personDropdownLabel.textContent = selectedPerson || "All people";
}

function setSelectedPerson(name) {
  selectedPerson = name;
  personDropdownLabel.textContent = name || "All people";
  personDropdownMenu.querySelectorAll(".dropdown__option").forEach((opt) => {
    opt.setAttribute("aria-selected", String(opt.dataset.value === name));
  });
  closePersonDropdown();
  applyFilter();
}

function openPersonDropdown() {
  personDropdownMenu.classList.remove("hidden");
  personDropdown.dataset.open = "true";
  personDropdownTrigger.setAttribute("aria-expanded", "true");
}

function closePersonDropdown() {
  personDropdownMenu.classList.add("hidden");
  personDropdown.dataset.open = "false";
  personDropdownTrigger.setAttribute("aria-expanded", "false");
}

personDropdownTrigger.addEventListener("click", () => {
  const isOpen = personDropdown.dataset.open === "true";
  if (isOpen) closePersonDropdown();
  else openPersonDropdown();
});

document.addEventListener("click", (e) => {
  if (!personDropdown.contains(e.target)) closePersonDropdown();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePersonDropdown();
});

async function render() {
  grid.innerHTML = "";
  countEl.textContent = filtered.length
    ? `${filtered.length} beacon${filtered.length === 1 ? "" : "s"} saved`
    : "";
  empty.classList.toggle("hidden", allBeacons.length !== 0);

  for (const b of filtered) {
    const isOwner = !!currentUserId && b.createdBy === currentUserId;

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = b.id;

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "card__thumb-wrap";
    const img = document.createElement("img");
    img.className = "card__thumb";
    img.alt = b.title;
    img.title = "Open at this spot";
    thumbWrap.appendChild(img);
    const pin = document.createElement("span");
    pin.className = "card__pin";
    thumbWrap.appendChild(pin);
    thumbWrap.addEventListener("click", () => goToBeacon(b));

    beaconnestScreenshotUrl(b.screenshotPath).then((url) => {
      if (url) img.src = url;
    });

    const body = document.createElement("div");
    body.className = "card__body";

    const title = document.createElement("p");
    title.className = "card__title";
    title.textContent = b.title || b.url;
    title.title = b.title || b.url;

    const url = document.createElement("p");
    url.className = "card__url";
    url.textContent = b.url;
    url.title = b.url;

    const desc = document.createElement("textarea");
    desc.className = "card__desc";
    desc.value = b.description || "";
    desc.placeholder = isOwner ? "Add a note…" : "No note";
    if (isOwner) {
      let saveTimer = null;
      desc.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          try {
            await beaconnestUpdateBeacon(b.id, { description: desc.value.trim() });
            b.description = desc.value.trim();
            const hint = card.querySelector(".save-hint");
            hint.classList.add("show");
            setTimeout(() => hint.classList.remove("show"), 900);
          } catch (err) {
            console.error("BeaconNest update failed:", err);
          }
        }, 500);
      });
    } else {
      desc.readOnly = true;
      desc.classList.add("card__desc--readonly");
      desc.title = "Only the person who saved this beacon can edit it";
    }

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const savedText = document.createElement("span");
    savedText.textContent = `Saved ${fmtDate(b.createdAt)}`;
    meta.appendChild(savedText);
    const who = personLabel(b);
    if (who) {
      meta.appendChild(document.createTextNode("·"));
      const person = document.createElement("span");
      person.className = "card__person";
      const dot = document.createElement("span");
      dot.className = "card__person-dot";
      dot.style.background = personColor(who);
      person.appendChild(dot);
      person.appendChild(document.createTextNode(who));
      meta.appendChild(person);
    }

    const hint = document.createElement("span");
    hint.className = "save-hint";
    hint.textContent = "Saved ✓";

    const actions = document.createElement("div");
    actions.className = "card__actions";
    if (!isOwner) actions.classList.add("card__actions--view-only");

    const goBtn = document.createElement("button");
    goBtn.className = "btn-go";
    goBtn.textContent = "Go there";
    goBtn.addEventListener("click", () => goToBeacon(b));

    actions.appendChild(goBtn);

    if (!isOwner) {
      const lockNote = document.createElement("span");
      lockNote.className = "card__lock-note";
      lockNote.innerHTML =
        '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" stroke-width="1.5"/></svg><span>View only</span>';
      actions.appendChild(lockNote);
    }

    if (isOwner) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-delete";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        const confirmed = await beaconnestConfirm("Delete this beacon?", "This can't be undone.");
        if (!confirmed) return;
        try {
          await beaconnestDeleteBeacon(b.id, b.screenshotPath);
          allBeacons = allBeacons.filter((x) => x.id !== b.id);
          populatePersonFilter();
          applyFilter();
        } catch (err) {
          console.error("BeaconNest delete failed:", err);
          await beaconnestAlert("Couldn't delete that beacon", err.message || "Unknown error.");
        }
      });
      actions.appendChild(delBtn);
    }

    body.appendChild(title);
    body.appendChild(url);
    body.appendChild(desc);
    body.appendChild(meta);
    body.appendChild(hint);
    body.appendChild(actions);

    card.appendChild(thumbWrap);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

async function goToBeacon(b) {
  const targetUrl = beaconnestBuildTargetUrl(b);
  const tab = await chrome.tabs.create({ url: targetUrl });

  // content.js owns the whole revisit (text search → selector → scroll
  // ratio, with its own waiting/retry for late-rendering content), so all we
  // do is hand it the beacon's anchor data once the page finishes loading.
  const payload = {
    selectedText: b.selectedText,
    snippet: b.snippet,
    selector: b.selector,
    scrollX: b.scrollX,
    scrollY: b.scrollY,
    scrollYRatio: b.scrollYRatio,
  };

  const listener = async (tabId, info) => {
    if (tabId !== tab.id || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(listener);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "BEACONNEST_SCROLL_TO", payload });
    } catch (e) {
      // Content script not there (e.g. extension was reloaded after the tab
      // opened) — inject it and retry once, same pattern as the popup.
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await chrome.tabs.sendMessage(tabId, { type: "BEACONNEST_SCROLL_TO", payload });
      } catch (e2) {
        /* page we can't script (chrome://, store) — nothing more to do */
      }
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

function applyFilter() {
  const q = searchEl.value.trim();
  const person = selectedPerson;
  filtered = allBeacons.filter((b) => matchesQuery(b, q) && (!person || personLabel(b) === person));
  render();
}

// --- Realtime handling -------------------------------------------------

function handleRealtimeChange(eventType, newRow, oldRow) {
  if (eventType === "INSERT") {
    const b = beaconnestRowToBeacon(newRow);
    if (!allBeacons.some((x) => x.id === b.id)) {
      allBeacons.unshift(b);
      populatePersonFilter();
      applyFilter();
    }
  } else if (eventType === "UPDATE") {
    const b = beaconnestRowToBeacon(newRow);
    allBeacons = allBeacons.map((x) => (x.id === b.id ? b : x));
    populatePersonFilter();
    applyFilter();
  } else if (eventType === "DELETE") {
    allBeacons = allBeacons.filter((x) => x.id !== oldRow.id);
    populatePersonFilter();
    applyFilter();
  }
}

// --- Connection / auth ---------------------------------------------------

async function refreshConnectionUI() {
  const config = await beaconnestGetConfig();
  configBlock.classList.remove("hidden");
  authBlock.classList.add("hidden");
  signedInBlock.classList.add("hidden");
  notConnected.classList.add("hidden");
  grid.classList.remove("hidden");

  if (config) {
    sbUrl.value = config.url;
    sbAnonKey.value = config.anonKey;
  }

  if (!config) {
    notConnected.classList.remove("hidden");
    grid.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    return false;
  }

  const session = await beaconnestGetSession().catch(() => null);
  if (!session) {
    currentUserId = null;
    authBlock.classList.remove("hidden");
    notConnected.classList.remove("hidden");
    grid.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    return false;
  }

  currentUserId = session.user.id;
  signedInBlock.classList.remove("hidden");
  signedInEmail.textContent = session.user.email;
  settingsPanel.classList.add("hidden");
  return true;
}

async function loadBeaconsAndSubscribe() {
  try {
    allBeacons = await beaconnestGetAllBeacons();
    populatePersonFilter();
    applyFilter();
  } catch (err) {
    console.error("BeaconNest load failed:", err);
  }
  if (unsubscribeRealtime) unsubscribeRealtime();
  unsubscribeRealtime = await beaconnestSubscribe(handleRealtimeChange).catch((err) => {
    console.error("BeaconNest realtime subscribe failed:", err);
    return null;
  });
}

async function init() {
  userNameInput.value = await beaconnestGetUserName();
  const connected = await refreshConnectionUI();
  if (connected) {
    await loadBeaconsAndSubscribe();
  }
}

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

saveNameBtn.addEventListener("click", async () => {
  const value = userNameInput.value.trim();
  if (!value) {
    nameStatus.textContent = "Enter a name.";
    return;
  }
  await beaconnestSetUserName(value);
  nameStatus.textContent = "Saved.";
});

saveConfigBtn.addEventListener("click", async () => {
  const url = sbUrl.value.trim();
  const key = sbAnonKey.value.trim();
  if (!url || !key) {
    configStatus.textContent = "Enter both the Project URL and anon key.";
    return;
  }
  await beaconnestSetConfig(url, key);
  configStatus.textContent = "Saved.";
  const connected = await refreshConnectionUI();
  if (connected) await loadBeaconsAndSubscribe();
});

signInBtn.addEventListener("click", async () => {
  authStatus.textContent = "Signing in…";
  try {
    await beaconnestSignIn(authEmail.value.trim(), authPassword.value);
    authStatus.textContent = "";
    const connected = await refreshConnectionUI();
    if (connected) await loadBeaconsAndSubscribe();
  } catch (err) {
    authStatus.textContent = err.message || "Sign-in failed.";
  }
});

signOutBtn.addEventListener("click", async () => {
  await beaconnestSignOut();
  allBeacons = [];
  filtered = [];
  if (unsubscribeRealtime) unsubscribeRealtime();
  await refreshConnectionUI();
});

searchEl.addEventListener("input", applyFilter);

exportBtn.addEventListener("click", () => {
  const csv = beaconnestToCSV(allBeacons);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `beaconnest-beacons-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

init();
