const MENU_IDS = {
  selection: "share-to-nostr-selection",
  image: "share-to-nostr-image",
  video: "share-to-nostr-video",
  page: "share-to-nostr-page"
};

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol"
];
const DEFAULT_SHARE_SETTINGS = {
  includeSourceUrl: true
};
const STORAGE_KEYS = {
  pendingDraft: "pendingShareDraft",
  signerSession: "signerSession",
  shareSettings: "shareSettings"
};

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  void ensureShareSettings();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  void ensureShareSettings();
});

createContextMenus();
void ensureShareSettings();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const sourceTabId = tab?.id;
  const sourceUrl = info.pageUrl || info.frameUrl || tab?.url || "";
  const pageTitle = tab?.title || "Untitled page";
  const shareSettings = await getShareSettings();

  if (info.menuItemId === MENU_IDS.selection) {
    const selectedText = (info.selectionText || "").trim();
    if (!selectedText) {
      return;
    }
    const includeSourceUrl = shareSettings.includeSourceUrl;

    await openComposeWithDraft({
      type: "selection",
      sourceTabId,
      sourceUrl: includeSourceUrl ? sourceUrl : "",
      pageTitle,
      selectedText,
      content: includeSourceUrl ? `\"${selectedText}\"\n\n${sourceUrl}` : `\"${selectedText}\"`,
      relays: DEFAULT_RELAYS
    });
  }

  if (info.menuItemId === MENU_IDS.image) {
    const imageUrl = info.srcUrl || "";
    if (!imageUrl) {
      return;
    }
    const includeSourceUrl = shareSettings.includeSourceUrl;

    await openComposeWithDraft({
      type: "image",
      sourceTabId,
      sourceUrl: includeSourceUrl ? sourceUrl : "",
      pageTitle,
      imageUrl,
      content: includeSourceUrl ? `${imageUrl}\n\n${sourceUrl}` : `${imageUrl}`,
      relays: DEFAULT_RELAYS
    });
  }

  if (info.menuItemId === MENU_IDS.video) {
    const videoUrl = info.srcUrl || "";
    if (!videoUrl) {
      return;
    }
    const includeSourceUrl = shareSettings.includeSourceUrl;

    await openComposeWithDraft({
      type: "video",
      sourceTabId,
      sourceUrl: includeSourceUrl ? sourceUrl : "",
      pageTitle,
      videoUrl,
      content: includeSourceUrl ? `${videoUrl}\n\n${sourceUrl}` : `${videoUrl}`,
      relays: DEFAULT_RELAYS
    });
  }

  if (info.menuItemId === MENU_IDS.page) {
    await openComposeWithDraft({
      type: "page",
      sourceTabId,
      sourceUrl,
      pageTitle,
      content: `${pageTitle}\n${sourceUrl}`,
      relays: DEFAULT_RELAYS
    });
  }
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.selection,
      title: "Share selection to Nostr",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: MENU_IDS.image,
      title: "Share image to Nostr",
      contexts: ["image"]
    });

    chrome.contextMenus.create({
      id: MENU_IDS.video,
      title: "Share video to Nostr",
      contexts: ["video"]
    });

    chrome.contextMenus.create({
      id: MENU_IDS.page,
      title: "Share page to Nostr",
      contexts: ["page", "frame"]
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === "share:open-compose") {
      const prepared = normalizeDraft(message.draft || {});
      await openComposeWithDraft(prepared);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "draft:get") {
      const { pendingShareDraft } = await chrome.storage.local.get(STORAGE_KEYS.pendingDraft);
      if (!pendingShareDraft) {
        sendResponse({ ok: false, error: "No draft is available." });
        return;
      }

      if (message.draftId && pendingShareDraft.id !== message.draftId) {
        sendResponse({ ok: false, error: "Draft not found." });
        return;
      }

      sendResponse({ ok: true, draft: pendingShareDraft });
      return;
    }

    if (message?.type === "draft:clear") {
      await chrome.storage.local.remove(STORAGE_KEYS.pendingDraft);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "settings:get") {
      const settings = await getShareSettings();
      sendResponse({ ok: true, settings });
      return;
    }

    if (message?.type === "settings:update") {
      const settings = await updateShareSettings(message.settings || {});
      sendResponse({ ok: true, settings });
      return;
    }

    if (message?.type === "nostr:check-signer") {
      const signerSession = await getSignerSession();
      const tabId = await findSigningTabId({
        preferredTabId: message.preferredTabId,
        signerTabId: signerSession?.tabId
      });
      if (!tabId) {
        sendResponse({ ok: false, error: "No suitable browser tab found for signer check." });
        return;
      }

      const signerResult = await checkNip07Signer(tabId, signerSession?.pubkey || "");
      if (signerResult.ok) {
        await setSignerSession(tabId, signerResult.pubkey || signerSession?.pubkey || "");
      } else if (signerSession?.tabId === tabId) {
        await clearSignerSession();
      }

      sendResponse({ ...signerResult, tabId });
      return;
    }

    if (message?.type === "nostr:publish") {
      try {
        const signerSession = await getSignerSession();
        const tabId = await findSigningTabId({
          preferredTabId: message.preferredTabId,
          signerTabId: signerSession?.tabId
        });
        if (!tabId) {
          sendResponse({ ok: false, error: "Open any website tab with your signer extension enabled, then try again." });
          return;
        }

        const relays = normalizeRelays(message.relays);
        const content = `${message.content || ""}`.trim();

        if (!content) {
          sendResponse({ ok: false, error: "Post content is required." });
          return;
        }

        if (relays.length === 0) {
          sendResponse({ ok: false, error: "At least one relay is required." });
          return;
        }

        const unsignedEvent = {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content
        };

        const signedEvent = await signEventWithNip07(tabId, unsignedEvent, signerSession?.pubkey || "");
        await setSignerSession(tabId, signedEvent.pubkey || signerSession?.pubkey || "");
        const relayResults = await Promise.all(relays.map((relay) => publishToRelay(relay, signedEvent)));
        const succeeded = relayResults.filter((relay) => relay.ok);

        sendResponse({
          ok: succeeded.length > 0,
          eventId: signedEvent.id,
          signerTabId: tabId,
          relays: relayResults,
          error: succeeded.length > 0 ? null : "Event was signed, but no relay accepted it."
        });
      } catch (error) {
        sendResponse({ ok: false, error: normalizeError(error) });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
  })();

  return true;
});

function normalizeDraft(draft) {
  return {
    id: draft.id || crypto.randomUUID(),
    type: draft.type || "manual",
    sourceTabId: Number.isInteger(draft.sourceTabId) ? draft.sourceTabId : null,
    sourceUrl: draft.sourceUrl || "",
    pageTitle: draft.pageTitle || "",
    selectedText: draft.selectedText || "",
    imageUrl: draft.imageUrl || "",
    videoUrl: draft.videoUrl || "",
    content: draft.content || "",
    relays: normalizeRelays(draft.relays).length > 0 ? normalizeRelays(draft.relays) : DEFAULT_RELAYS,
    createdAt: Date.now()
  };
}

async function openComposeWithDraft(draft) {
  const normalized = normalizeDraft(draft);
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingDraft]: normalized });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`compose.html?draft=${encodeURIComponent(normalized.id)}`)
  });
}

function normalizeRelays(relays) {
  if (!Array.isArray(relays)) {
    return [];
  }

  const seen = new Set();
  const valid = [];

  for (const relay of relays) {
    const value = `${relay || ""}`.trim();
    if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
      continue;
    }

    if (!seen.has(value)) {
      seen.add(value);
      valid.push(value);
    }
  }

  return valid;
}

async function ensureShareSettings() {
  const { shareSettings } = await chrome.storage.local.get(STORAGE_KEYS.shareSettings);
  if (shareSettings) {
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.shareSettings]: DEFAULT_SHARE_SETTINGS
  });
}

async function getShareSettings() {
  const { shareSettings } = await chrome.storage.local.get(STORAGE_KEYS.shareSettings);
  return normalizeShareSettings(shareSettings);
}

async function updateShareSettings(partialSettings) {
  const current = await getShareSettings();
  const next = normalizeShareSettings({ ...current, ...partialSettings });
  await chrome.storage.local.set({ [STORAGE_KEYS.shareSettings]: next });
  return next;
}

function normalizeShareSettings(rawSettings) {
  const candidate = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    includeSourceUrl: candidate.includeSourceUrl !== false
  };
}

async function findSigningTabId({ preferredTabId = null, signerTabId = null } = {}) {
  const checkedTabIds = new Set();

  const getValidTabId = async (tabId, shouldClearStored = false) => {
    if (!Number.isInteger(tabId) || checkedTabIds.has(tabId)) {
      return null;
    }

    checkedTabIds.add(tabId);

    try {
      const tab = await chrome.tabs.get(tabId);
      if (isSignableTabUrl(tab?.url)) {
        return tab.id;
      }
    } catch {
      if (shouldClearStored) {
        await clearSignerSession();
      }
    }

    return null;
  };

  const rememberedTabId = await getValidTabId(signerTabId, true);
  if (rememberedTabId) {
    return rememberedTabId;
  }

  const preferredId = await getValidTabId(preferredTabId);
  if (preferredId) {
    return preferredId;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id && !checkedTabIds.has(activeTab.id) && isSignableTabUrl(activeTab.url)) {
    return activeTab.id;
  }

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const candidate = tabs.find((tab) => tab.id && !checkedTabIds.has(tab.id) && isSignableTabUrl(tab.url));
  return candidate?.id || null;
}

function isSignableTabUrl(url) {
  return typeof url === "string" && /^(https?:\/\/)/i.test(url);
}

async function checkNip07Signer(tabId, cachedPubkey) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (cachedPubkey) => {
        if (!window.nostr) {
          return { ok: false, error: "NIP-07 signer was not detected in this tab." };
        }

        if (typeof window.nostr.getPublicKey !== "function" || typeof window.nostr.signEvent !== "function") {
          return { ok: false, error: "Signer is present but missing required NIP-07 methods." };
        }

        if (cachedPubkey) {
          return { ok: true, pubkey: cachedPubkey, cached: true };
        }

        try {
          const pubkey = await window.nostr.getPublicKey();
          return { ok: true, pubkey };
        } catch (error) {
          return {
            ok: false,
            error: error?.message || "Signer did not grant public key access."
          };
        }
      },
      args: [cachedPubkey]
    });

    return result?.result || { ok: false, error: "Signer check returned no response." };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function signEventWithNip07(tabId, unsignedEvent, cachedPubkey) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (eventTemplate, cachedPubkey) => {
      if (!window.nostr) {
        return { ok: false, error: "NIP-07 signer was not detected in this tab." };
      }

      if (typeof window.nostr.getPublicKey !== "function" || typeof window.nostr.signEvent !== "function") {
        return { ok: false, error: "Signer is present but missing required NIP-07 methods." };
      }

      try {
        const pubkey = cachedPubkey || (await window.nostr.getPublicKey());
        const eventToSign = { ...eventTemplate, pubkey };
        const signed = await window.nostr.signEvent(eventToSign);
        return { ok: true, signed, pubkey };
      } catch (error) {
        return { ok: false, error: error?.message || "Signer request was rejected." };
      }
    },
    args: [unsignedEvent, cachedPubkey]
  });

  if (!result?.result?.ok || !result.result.signed) {
    throw new Error(result?.result?.error || "Could not sign event with NIP-07 signer.");
  }

  return result.result.signed;
}

async function getSignerSession() {
  const { signerSession } = await chrome.storage.local.get(STORAGE_KEYS.signerSession);
  if (!signerSession || !Number.isInteger(signerSession.tabId)) {
    return null;
  }

  return {
    tabId: signerSession.tabId,
    pubkey: typeof signerSession.pubkey === "string" ? signerSession.pubkey : "",
    updatedAt: Number.isFinite(signerSession.updatedAt) ? signerSession.updatedAt : 0
  };
}

async function setSignerSession(tabId, pubkey) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.signerSession]: {
      tabId,
      pubkey: typeof pubkey === "string" ? pubkey : "",
      updatedAt: Date.now()
    }
  });
}

async function clearSignerSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.signerSession);
}

async function publishToRelay(relay, signedEvent) {
  return new Promise((resolve) => {
    let socket;
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;

      clearTimeout(timeoutId);
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }

      resolve({ relay, ...result });
    };

    const timeoutId = setTimeout(() => {
      settle({ ok: false, message: "Timed out waiting for relay response." });
    }, 9000);

    try {
      socket = new WebSocket(relay);
    } catch (error) {
      settle({ ok: false, message: normalizeError(error) });
      return;
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(["EVENT", signedEvent]));
    });

    socket.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!Array.isArray(parsed) || parsed[0] !== "OK") {
        return;
      }

      if (parsed[1] !== signedEvent.id) {
        return;
      }

      const ok = Boolean(parsed[2]);
      const message = parsed[3] || (ok ? "Accepted" : "Rejected by relay");
      settle({ ok, message });
    });

    socket.addEventListener("error", () => {
      settle({ ok: false, message: "Relay connection failed." });
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        settle({ ok: false, message: "Relay closed before acknowledging event." });
      }
    });
  });
}

function normalizeError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || String(error);
}
