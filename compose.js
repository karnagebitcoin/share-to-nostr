const previewTypeEl = document.getElementById("previewType");
const previewContentEl = document.getElementById("previewContent");
const previewImageWrapEl = document.getElementById("previewImageWrap");
const previewImageEl = document.getElementById("previewImage");
const previewVideoWrapEl = document.getElementById("previewVideoWrap");
const previewVideoEl = document.getElementById("previewVideo");
const previewUrlEl = document.getElementById("previewUrl");
const sourceTitleEl = document.getElementById("sourceTitle");
const sourceMetaEl = document.getElementById("sourceMeta");

const contentInputEl = document.getElementById("contentInput");
const contentCountEl = document.getElementById("contentCount");
const mediaInputEl = document.getElementById("mediaInput");
const sourceInputEl = document.getElementById("sourceInput");
const relaysInputEl = document.getElementById("relaysInput");
const signerStatusEl = document.getElementById("signerStatus");
const checkSignerButtonEl = document.getElementById("checkSignerButton");
const publishButtonEl = document.getElementById("publishButton");
const clearDraftButtonEl = document.getElementById("clearDraftButton");
const publishResultEl = document.getElementById("publishResult");

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"];

let currentDraft = {
  id: crypto.randomUUID(),
  type: "manual",
  sourceTabId: null,
  sourceUrl: "",
  pageTitle: "",
  selectedText: "",
  imageUrl: "",
  videoUrl: "",
  content: "",
  relays: DEFAULT_RELAYS
};

initialize().catch((error) => {
  updateSignerStatus(error?.message || "Failed to initialize composer.", false);
});

async function initialize() {
  const draftId = new URLSearchParams(window.location.search).get("draft");
  const response = await chrome.runtime.sendMessage({ type: "draft:get", draftId });

  if (response?.ok && response.draft) {
    currentDraft = {
      ...currentDraft,
      ...response.draft,
      relays: normalizeRelayLines(response.draft.relays)
    };
  }

  hydrateForm();
  wireEvents();
  renderPreview();
}

function hydrateForm() {
  contentInputEl.value = currentDraft.content || "";
  mediaInputEl.value = currentDraft.imageUrl || currentDraft.videoUrl || "";
  sourceInputEl.value = currentDraft.sourceUrl || "";
  relaysInputEl.value = normalizeRelayLines(currentDraft.relays).join("\n");
  updateCharacterCount();
}

function wireEvents() {
  contentInputEl.addEventListener("input", () => {
    updateCharacterCount();
    renderPreview();
  });

  mediaInputEl.addEventListener("input", renderPreview);
  sourceInputEl.addEventListener("input", renderPreview);

  relaysInputEl.addEventListener("input", () => {
    if (relaysInputEl.value.trim() === "") {
      relaysInputEl.classList.remove("invalid");
    }
  });

  checkSignerButtonEl.addEventListener("click", checkSigner);
  publishButtonEl.addEventListener("click", publishPost);
  clearDraftButtonEl.addEventListener("click", clearDraft);
}

function updateCharacterCount() {
  contentCountEl.textContent = `${contentInputEl.value.length} characters`;
}

function renderPreview() {
  const content = contentInputEl.value.trim();
  const sourceUrl = sourceInputEl.value.trim();
  const mediaUrl = mediaInputEl.value.trim();
  const type = labelForType(currentDraft.type);

  previewTypeEl.textContent = type;
  previewContentEl.textContent = content || "Start writing your post...";
  previewContentEl.classList.toggle("empty", !content);

  if (isLikelyImageUrl(mediaUrl)) {
    previewImageEl.src = mediaUrl;
    previewImageWrapEl.classList.remove("hidden");
    previewVideoWrapEl.classList.add("hidden");
    previewVideoEl.removeAttribute("src");
  } else {
    previewImageWrapEl.classList.add("hidden");
    previewImageEl.removeAttribute("src");
  }

  if (isLikelyVideoUrl(mediaUrl)) {
    previewVideoEl.src = mediaUrl;
    previewVideoWrapEl.classList.remove("hidden");
    previewImageWrapEl.classList.add("hidden");
    previewImageEl.removeAttribute("src");
  } else {
    previewVideoWrapEl.classList.add("hidden");
    previewVideoEl.removeAttribute("src");
  }

  if (isLikelyHttpUrl(sourceUrl)) {
    previewUrlEl.href = sourceUrl;
    previewUrlEl.textContent = sourceUrl;
    previewUrlEl.classList.remove("hidden");
  } else {
    previewUrlEl.classList.add("hidden");
    previewUrlEl.removeAttribute("href");
  }

  sourceTitleEl.textContent = currentDraft.pageTitle || "No specific source.";
  sourceMetaEl.textContent = sourceUrl || "Manual post";
}

function labelForType(type) {
  const map = {
    selection: "Text",
    image: "Image",
    video: "Video",
    page: "Page",
    manual: "Manual"
  };

  return map[type] || "Draft";
}

async function checkSigner() {
  checkSignerButtonEl.disabled = true;
  updateSignerStatus("Checking for NIP-07 signer...", null);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "nostr:check-signer",
      preferredTabId: currentDraft.sourceTabId
    });

    if (response?.ok && response.pubkey) {
      updateSignerStatus(`Signer connected (pubkey ${shorten(response.pubkey)})`, true);
      return;
    }

    updateSignerStatus(response?.error || "Signer was not found.", false);
  } catch (error) {
    updateSignerStatus(error?.message || "Could not check signer.", false);
  } finally {
    checkSignerButtonEl.disabled = false;
  }
}

async function publishPost() {
  const content = contentInputEl.value.trim();
  const sourceUrl = sourceInputEl.value.trim();
  const mediaUrl = mediaInputEl.value.trim();
  const relays = parseRelays(relaysInputEl.value);

  if (!content) {
    updateSignerStatus("Please add content before publishing.", false);
    contentInputEl.focus();
    return;
  }

  if (relays.length === 0) {
    updateSignerStatus("Add at least one valid relay URL (ws:// or wss://).", false);
    relaysInputEl.focus();
    return;
  }

  publishButtonEl.disabled = true;
  checkSignerButtonEl.disabled = true;
  clearDraftButtonEl.disabled = true;
  updateSignerStatus("Requesting signature and publishing...", null);
  hidePublishResult();

  try {
    const effectiveContent = buildContent(content, sourceUrl, mediaUrl);

    const response = await chrome.runtime.sendMessage({
      type: "nostr:publish",
      preferredTabId: currentDraft.sourceTabId,
      content: effectiveContent,
      relays
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not publish to relays.");
    }

    updateSignerStatus("Published successfully.", true);
    showPublishResult(response);
    await chrome.runtime.sendMessage({ type: "draft:clear" });
  } catch (error) {
    updateSignerStatus(error?.message || "Publish failed.", false);
  } finally {
    publishButtonEl.disabled = false;
    checkSignerButtonEl.disabled = false;
    clearDraftButtonEl.disabled = false;
  }
}

function buildContent(content, sourceUrl, mediaUrl) {
  const lines = [content.trim()];

  if (mediaUrl && !content.includes(mediaUrl)) {
    lines.push(mediaUrl);
  }

  if (sourceUrl && !content.includes(sourceUrl)) {
    lines.push(sourceUrl);
  }

  return lines.filter(Boolean).join("\n\n");
}

function showPublishResult(response) {
  const relays = Array.isArray(response.relays) ? response.relays : [];
  const accepted = relays.filter((relay) => relay.ok).length;

  const resultParts = [];
  resultParts.push(`<p><strong>Event ID:</strong> ${escapeHtml(response.eventId || "unknown")}</p>`);
  resultParts.push(`<p><strong>Relay successes:</strong> ${accepted}/${relays.length}</p>`);

  if (relays.length > 0) {
    const items = relays
      .map((relay) => {
        const state = relay.ok ? "accepted" : "failed";
        const msg = relay.message ? ` - ${escapeHtml(relay.message)}` : "";
        return `<li><code>${escapeHtml(relay.relay)}</code>: ${state}${msg}</li>`;
      })
      .join("");
    resultParts.push(`<ul>${items}</ul>`);
  }

  publishResultEl.innerHTML = resultParts.join("");
  publishResultEl.classList.remove("hidden");
}

function hidePublishResult() {
  publishResultEl.classList.add("hidden");
  publishResultEl.innerHTML = "";
}

async function clearDraft() {
  currentDraft = {
    ...currentDraft,
    type: "manual",
    sourceUrl: "",
    pageTitle: "",
    selectedText: "",
    imageUrl: "",
    videoUrl: "",
    content: "",
    relays: DEFAULT_RELAYS
  };

  contentInputEl.value = "";
  mediaInputEl.value = "";
  sourceInputEl.value = "";
  relaysInputEl.value = DEFAULT_RELAYS.join("\n");
  updateCharacterCount();
  hidePublishResult();
  renderPreview();
  await chrome.runtime.sendMessage({ type: "draft:clear" });
  updateSignerStatus("Draft cleared.", null);
}

function updateSignerStatus(message, isSuccess) {
  signerStatusEl.textContent = message;

  signerStatusEl.classList.remove("neutral", "good", "bad");

  if (isSuccess === true) {
    signerStatusEl.classList.add("good");
    return;
  }

  if (isSuccess === false) {
    signerStatusEl.classList.add("bad");
    return;
  }

  signerStatusEl.classList.add("neutral");
}

function parseRelays(rawValue) {
  const lines = rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("ws://") || line.startsWith("wss://"));

  return [...new Set(lines)];
}

function normalizeRelayLines(relays) {
  if (!Array.isArray(relays)) {
    return DEFAULT_RELAYS;
  }

  const parsed = parseRelays(relays.join("\n"));
  return parsed.length > 0 ? parsed : DEFAULT_RELAYS;
}

function isLikelyHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isLikelyImageUrl(value) {
  if (!isLikelyHttpUrl(value)) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(value);
}

function isLikelyVideoUrl(value) {
  if (!isLikelyHttpUrl(value)) {
    return false;
  }

  return /\.(mp4|webm|mov|m4v|ogg|ogv)(\?.*)?$/i.test(value);
}

function shorten(value) {
  if (!value || value.length < 16) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
