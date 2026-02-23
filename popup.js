const pageTitleEl = document.getElementById("pageTitle");
const pageUrlEl = document.getElementById("pageUrl");
const sharePageButton = document.getElementById("sharePageButton");
const openComposeButton = document.getElementById("openComposeButton");
const includeSourceToggle = document.getElementById("includeSourceToggle");
const statusEl = document.getElementById("status");

let activePageDraft = {
  type: "manual",
  sourceTabId: null,
  sourceUrl: "",
  pageTitle: "",
  content: "",
  relays: []
};

init().catch((error) => {
  showStatus(error?.message || "Could not initialize popup.");
});

async function init() {
  await loadSettings();
  includeSourceToggle.addEventListener("change", saveSettings);

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab || !isHttpTab(tab.url)) {
    pageTitleEl.textContent = "Open a website tab";
    pageUrlEl.textContent = "Page sharing works on http(s) pages.";
    sharePageButton.disabled = true;
    return;
  }

  const safeUrl = tab.url || "";
  const safeTitle = tab.title || "Untitled page";

  pageTitleEl.textContent = safeTitle;
  pageUrlEl.textContent = safeUrl;

  activePageDraft = {
    type: "page",
    sourceTabId: tab.id,
    sourceUrl: safeUrl,
    pageTitle: safeTitle,
    content: `${safeTitle}\n${safeUrl}`,
    relays: ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"]
  };
}

sharePageButton.addEventListener("click", async () => {
  sharePageButton.disabled = true;
  showStatus("Opening composer...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "share:open-compose",
      draft: activePageDraft
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not open composer.");
    }

    window.close();
  } catch (error) {
    sharePageButton.disabled = false;
    showStatus(error?.message || "Failed to open composer.");
  }
});

openComposeButton.addEventListener("click", async () => {
  openComposeButton.disabled = true;
  showStatus("Opening empty composer...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "share:open-compose",
      draft: {
        type: "manual",
        content: "",
        sourceTabId: activePageDraft.sourceTabId,
        relays: ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"]
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not open composer.");
    }

    window.close();
  } catch (error) {
    openComposeButton.disabled = false;
    showStatus(error?.message || "Failed to open composer.");
  }
});

function showStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "settings:get" });
  if (!response?.ok || !response.settings) {
    throw new Error(response?.error || "Could not load settings.");
  }

  includeSourceToggle.checked = response.settings.includeSourceUrl !== false;
}

async function saveSettings() {
  includeSourceToggle.disabled = true;
  showStatus("Saving setting...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings:update",
      settings: {
        includeSourceUrl: includeSourceToggle.checked
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not save setting.");
    }

    includeSourceToggle.checked = response.settings.includeSourceUrl !== false;
    showStatus("Setting saved.");
  } catch (error) {
    showStatus(error?.message || "Failed to save setting.");
  } finally {
    includeSourceToggle.disabled = false;
  }
}

function isHttpTab(url) {
  return typeof url === "string" && /^(https?:\/\/)/i.test(url);
}
