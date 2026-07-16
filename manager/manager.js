const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const notConnected = document.getElementById("notConnected");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const personFilterEl = document.getElementById("personFilter");
const exportBtn = document.getElementById("exportBtn");

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

function populatePersonFilter() {
  const current = personFilterEl.value;
  const names = Array.from(new Set(allBeacons.map(personLabel).filter(Boolean))).sort();

  personFilterEl.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "All people";
  personFilterEl.appendChild(allOpt);

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    personFilterEl.appendChild(opt);
  }

  personFilterEl.value = names.includes(current) ? current : "";
}

async function render() {
  grid.innerHTML = "";
  countEl.textContent = filtered.length
    ? `${filtered.length} beacon${filtered.length === 1 ? "" : "s"} saved`
    : "";
  empty.classList.toggle("hidden", allBeacons.length !== 0);

  for (const b of filtered) {
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
    desc.placeholder = "Add a note…";
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

    const meta = document.createElement("div");
    meta.className = "card__meta";
    const who = personLabel(b) ? ` · ${personLabel(b)}` : "";
    meta.textContent = `Saved ${fmtDate(b.createdAt)}${who}`;

    const hint = document.createElement("span");
    hint.className = "save-hint";
    hint.textContent = "Saved ✓";

    const actions = document.createElement("div");
    actions.className = "card__actions";

    const goBtn = document.createElement("button");
    goBtn.className = "btn-go";
    goBtn.textContent = "Go there";
    goBtn.addEventListener("click", () => goToBeacon(b));

    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this beacon? This can't be undone.")) return;
      try {
        await beaconnestDeleteBeacon(b.id, b.screenshotPath);
        allBeacons = allBeacons.filter((x) => x.id !== b.id);
        populatePersonFilter();
        applyFilter();
      } catch (err) {
        console.error("BeaconNest delete failed:", err);
        alert("Couldn't delete that beacon: " + (err.message || "unknown error"));
      }
    });

    actions.appendChild(goBtn);
    actions.appendChild(delBtn);

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

  if (!b.selectedText && (b.selector || b.scrollY)) {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs
          .sendMessage(tabId, {
            type: "BEACONNEST_SCROLL_TO",
            payload: { selector: b.selector, scrollX: b.scrollX, scrollY: b.scrollY },
          })
          .catch(() => {});
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
}

function applyFilter() {
  const q = searchEl.value.trim();
  const person = personFilterEl.value;
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
    authBlock.classList.remove("hidden");
    notConnected.classList.remove("hidden");
    grid.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    return false;
  }

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
personFilterEl.addEventListener("change", applyFilter);

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
