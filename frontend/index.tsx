import { definePlugin } from "@steambrew/client";

declare const Millennium: any;

const PROXY_URL = "http://127.0.0.1:32145/reviews";
const STEAM_BLUE = "#66C0F4";
const POSITIVE_GREEN = "#66c06a";
const MIXED_GOLD = "#b9a074";
const NEGATIVE_RED = "#a34c25";
const NEUTRAL_TEXT = "#8f98a0";
const FORCE_SHOW_GAME_DETAILS = true;

const GAME_INFO_BOX_SELECTOR =
  "._25oBZpa3dUcMw8QAsa2u67._3yfoeR7q8sXXS2UyFcIK1K";
const INFO_BUTTON_SELECTOR = "._3qDWQGB0rtwM3qpXTb11Q-";
const DIM_CLASS = "_1FXWy2UilVZIppT-PetDWw";
const REVIEW_BLOCK_ID = "st-steam-review-block";

type ReviewSummary = {
  total_reviews: number | null;
  review_score_desc: string;
};

type ReviewResponse = {
  appid?: string;
  overall?: ReviewSummary;
  recent?: ReviewSummary;
  error?: string;
};

let observerStarted = false;
let pendingTimer: number | null = null;
let currentAppId: string | null = null;
let lastSeenUrl = "";
let urlPollTimer: number | null = null;
let inFlightAppId: string | null = null;
let abortController: AbortController | null = null;

function injectAnimationStyles(doc: Document) {
  if (doc.getElementById("st-review-animations")) return;

  const style = doc.createElement("style");
  style.id = "st-review-animations";
  style.textContent = `
    .st-rating-text {
      display: inline-block;
    }

    .st-rating-rainbow {
      background-image: linear-gradient(
        90deg,
        #ff5e5e 0%,
        #ffb347 16%,
        #fff36b 32%,
        #6bff95 48%,
        #66c0f4 64%,
        #b07cff 82%,
        #ff5e5e 100%
      );
      background-size: 500% 100%;
      background-position: 0% 50%;
      background-repeat: repeat;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent !important;
      -webkit-text-fill-color: transparent;
      animation: st-rainbow-shift 3s linear infinite;
    }

    .st-rating-glow {
      text-shadow:
        0 0 6px rgba(255, 225, 107, 0.18),
        0 0 12px rgba(102, 192, 244, 0.14);
    }

    @keyframes st-rainbow-shift {
      0% { background-position: 0% 50%; }
      100% { background-position: 100% 50%; }
    }
  `;
  doc.head.appendChild(style);
}

function injectForceGameInfoStyles(doc: Document) {
  if (!FORCE_SHOW_GAME_DETAILS) return;
  if (doc.getElementById("st-force-gameinfo-styles")) return;

  const style = doc.createElement("style");
  style.id = "st-force-gameinfo-styles";
  style.textContent = `
    ${GAME_INFO_BOX_SELECTOR} {
      height: unset !important;
      margin: 6px 0 0 !important;
    }

    ${INFO_BUTTON_SELECTOR}:has(.SVGIcon_Information) {
      display: none;
    }

    ${INFO_BUTTON_SELECTOR}[hltb-click-listener="true"] {
      display: flex;
    }

    ${INFO_BUTTON_SELECTOR}[hltb-click-listener="true"] svg {
      display: none;
    }

    ${INFO_BUTTON_SELECTOR}[hltb-click-listener="true"] .zvLq1GUCH3yLuqv_TXBJ1::before {
      display: flex;
      width: 18px;
      height: 18px;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
    }

    ${INFO_BUTTON_SELECTOR}[hltb-click-listener="true"][hltb-injected="true"] {
      display: none;
    }
  `;
  doc.head.appendChild(style);
}

function stripDimClassFromGameInfo(doc: Document) {
  if (!FORCE_SHOW_GAME_DETAILS) return;

  const boxes = Array.from(
    doc.querySelectorAll(GAME_INFO_BOX_SELECTOR)
  ) as HTMLElement[];

  for (const box of boxes) {
    box.classList.remove(DIM_CLASS);

    let parent: HTMLElement | null = box.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      parent.classList.remove(DIM_CLASS);
      parent = parent.parentElement;
    }

    const descendants = Array.from(
      box.querySelectorAll(`.${DIM_CLASS}`)
    ) as HTMLElement[];

    for (const el of descendants) {
      el.classList.remove(DIM_CLASS);
    }
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAnimatedLabelHtml(label: string) {
  const safe = escapeHtml(label || "Unavailable");
  const normalized = (label || "").toLowerCase();

  if (normalized === "overwhelmingly positive") {
    return `<span class="st-rating-text st-rating-rainbow st-rating-glow">${safe}</span>`;
  }

  return `<span class="st-rating-text">${safe}</span>`;
}

function findNearbyAppId(root: ParentNode | null): string | null {
  if (!root) return null;

  const links = Array.from(root.querySelectorAll("a[href]"));
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const match =
      href.match(/store\.steampowered\.com\/app\/(\d+)/i) ||
      href.match(/\/app\/(\d+)(\/|$)/i) ||
      href.match(/steam:\/\/store\/(\d+)/i) ||
      href.match(/steam:\/\/run\/(\d+)/i);
    if (match) return match[1];
  }

  const imgs = Array.from(root.querySelectorAll("img[src]"));
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    const match = src.match(/apps\/(\d+)\//i);
    if (match) return match[1];
  }

  let node: Element | null = root instanceof Element ? root : null;
  while (node) {
    const attrs = node.getAttributeNames?.() || [];
    for (const attr of attrs) {
      const value = node.getAttribute(attr) || "";
      const match =
        value.match(/store\.steampowered\.com\/app\/(\d+)/i) ||
        value.match(/\/app\/(\d+)(\/|$)/i) ||
        value.match(/steam:\/\/store\/(\d+)/i) ||
        value.match(/steam:\/\/run\/(\d+)/i) ||
        value.match(/\bappid["':=\s]+(\d{3,})/i);
      if (match) return match[1];
    }
    node = node.parentElement;
  }

  const all = Array.from(root.querySelectorAll?.("*") || []);
  for (const el of all) {
    const attrs = (el as Element).getAttributeNames?.() || [];
    for (const attr of attrs) {
      const value = (el as Element).getAttribute(attr) || "";
      const match =
        value.match(/store\.steampowered\.com\/app\/(\d+)/i) ||
        value.match(/\/app\/(\d+)(\/|$)/i) ||
        value.match(/steam:\/\/store\/(\d+)/i) ||
        value.match(/steam:\/\/run\/(\d+)/i) ||
        value.match(/\bappid["':=\s]+(\d{3,})/i);
      if (match) return match[1];
    }
  }

  return null;
}

function getUrlAppId(doc: Document): string | null {
  const href = doc.location?.href || "";
  const match =
    href.match(/store\.steampowered\.com\/app\/(\d+)/i) ||
    href.match(/\/app\/(\d+)(\/|$)/i) ||
    href.match(/steam:\/\/store\/(\d+)/i) ||
    href.match(/steam:\/\/run\/(\d+)/i);

  return match ? match[1] : null;
}

function getReviewColor(label: string) {
  const text = (label || "").toLowerCase();

  if (text === "very positive") return STEAM_BLUE;
  if (text.includes("positive")) return POSITIVE_GREEN;
  if (text.includes("mixed")) return MIXED_GOLD;
  if (text.includes("negative")) return NEGATIVE_RED;

  return NEUTRAL_TEXT;
}

function formatCount(value: unknown, fallback = "Unavailable") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value.toLocaleString();
}

function buildReviewBlock(doc: Document) {
  let block = doc.getElementById(REVIEW_BLOCK_ID) as HTMLElement | null;
  if (block) return block;

  block = doc.createElement("div");
  block.id = REVIEW_BLOCK_ID;
  block.style.marginTop = "4px";
  block.style.paddingTop = "2px";
  block.style.fontSize = "12px";
  block.style.lineHeight = "1.2";
  block.style.fontFamily = "inherit";
  block.style.minWidth = "320px";

  block.innerHTML = `
    <div style="
      display:grid;
      grid-template-columns:max-content max-content;
      column-gap:10px;
      row-gap:2px;
      align-items:start;
      width:fit-content;
    ">
      <div id="st-overall-left" style="color:${NEUTRAL_TEXT}; font-weight:400;">Overall Reviews: loading...</div>
      <div id="st-overall-right" style="color:${NEUTRAL_TEXT}; font-weight:600; text-align:left;">...</div>

      <div id="st-recent-left" style="color:${NEUTRAL_TEXT}; font-weight:400;">Recent Reviews: loading...</div>
      <div id="st-recent-right" style="color:${NEUTRAL_TEXT}; font-weight:600; text-align:left;">...</div>
    </div>
  `;

  return block;
}

function locateAnchor(doc: Document) {
  const allDivs = Array.from(doc.querySelectorAll("div"));
  return allDivs.find((el) =>
    (el.textContent || "").trim().startsWith("Developer:")
  ) as HTMLElement | undefined;
}

function removeReviewBlock(doc: Document) {
  const block = doc.getElementById(REVIEW_BLOCK_ID);
  if (block) block.remove();
}

function clearDisplayedReviewsImmediately(doc: Document) {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  inFlightAppId = null;
  removeReviewBlock(doc);
}

function setLoadingState(block: HTMLElement, appid?: string) {
  if (
    block.dataset.loadedAppid === appid &&
    block.dataset.loadingAppid !== appid
  ) {
    return;
  }

  const overallLeft = block.querySelector("#st-overall-left") as HTMLElement;
  const recentLeft = block.querySelector("#st-recent-left") as HTMLElement;
  const overallRight = block.querySelector("#st-overall-right") as HTMLElement;
  const recentRight = block.querySelector("#st-recent-right") as HTMLElement;

  overallLeft.textContent = "Overall Reviews: loading...";
  recentLeft.textContent = "Recent Reviews: loading...";
  overallRight.textContent = "...";
  recentRight.textContent = "...";
  overallRight.style.color = NEUTRAL_TEXT;
  recentRight.style.color = NEUTRAL_TEXT;

  block.dataset.loadedAppid = "";
  block.dataset.loadingAppid = appid || "";
}

function setErrorState(block: HTMLElement, message: string, appid?: string) {
  const overallLeft = block.querySelector("#st-overall-left") as HTMLElement;
  const recentLeft = block.querySelector("#st-recent-left") as HTMLElement;
  const overallRight = block.querySelector("#st-overall-right") as HTMLElement;
  const recentRight = block.querySelector("#st-recent-right") as HTMLElement;

  overallLeft.textContent = `Overall Reviews: ${message}`;
  recentLeft.textContent = "Recent Reviews: -";
  overallRight.textContent = "-";
  recentRight.textContent = "-";
  overallRight.style.color = NEUTRAL_TEXT;
  recentRight.style.color = NEUTRAL_TEXT;

  block.dataset.loadedAppid = "";
  block.dataset.loadingAppid = appid || "";
}

function renderData(block: HTMLElement, data: ReviewResponse, appid: string) {
  if (
    block.dataset.loadedAppid === appid &&
    block.dataset.loadingAppid !== appid
  ) {
    return;
  }

  const overallLeft = block.querySelector("#st-overall-left") as HTMLElement;
  const recentLeft = block.querySelector("#st-recent-left") as HTMLElement;
  const overallRight = block.querySelector("#st-overall-right") as HTMLElement;
  const recentRight = block.querySelector("#st-recent-right") as HTMLElement;

  const overallCount = data.overall?.total_reviews ?? null;
  const overallLabel = data.overall?.review_score_desc || "Unavailable";
  const recentCount = data.recent?.total_reviews ?? null;
  const recentLabel = data.recent?.review_score_desc || "Unavailable";

  overallLeft.textContent = `Overall Reviews: (${formatCount(overallCount)})`;
  recentLeft.textContent = `Recent Reviews: (${formatCount(recentCount)})`;

  overallRight.innerHTML = getAnimatedLabelHtml(overallLabel);
  recentRight.innerHTML = getAnimatedLabelHtml(recentLabel);

  overallRight.style.color = getReviewColor(overallLabel);
  recentRight.style.color = getReviewColor(recentLabel);

  block.dataset.loadedAppid = appid;
  block.dataset.loadingAppid = "";
}

function getDetectedAppId(doc: Document, anchor?: HTMLElement | null): string | null {
  return (
    getUrlAppId(doc) ||
    (anchor
      ? findNearbyAppId(anchor) ||
        findNearbyAppId(anchor.parentElement) ||
        findNearbyAppId(anchor.parentElement?.parentElement || null)
      : null) ||
    findNearbyAppId(doc.querySelector("main")) ||
    findNearbyAppId(doc.body)
  );
}

function handleAppSwitch(doc: Document, nextAppId: string | null) {
  if (!nextAppId || currentAppId === nextAppId) return;

  currentAppId = nextAppId;
  clearDisplayedReviewsImmediately(doc);
  stripDimClassFromGameInfo(doc);
}

async function updateReviewBlock(doc: Document) {
  stripDimClassFromGameInfo(doc);

  const anchor = locateAnchor(doc);
  if (!anchor) return;

  let block = doc.getElementById(REVIEW_BLOCK_ID) as HTMLElement | null;
  if (!block) {
    block = buildReviewBlock(doc);
    anchor.insertAdjacentElement("afterend", block);
  } else if (block.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", block);
  }

  const appid = getDetectedAppId(doc, anchor);
  if (!appid) {
    setErrorState(block, "appid not found");
    return;
  }

  if (currentAppId !== appid) {
    handleAppSwitch(doc, appid);

    block = doc.getElementById(REVIEW_BLOCK_ID) as HTMLElement | null;
    if (!block) {
      block = buildReviewBlock(doc);
      anchor.insertAdjacentElement("afterend", block);
    }
  }

  if (block.dataset.loadedAppid === appid && inFlightAppId !== appid) {
    return;
  }

  if (inFlightAppId === appid) {
    return;
  }

  setLoadingState(block, appid);

  inFlightAppId = appid;
  const requestController = new AbortController();
  abortController = requestController;

  try {
    const res = await fetch(`${PROXY_URL}?appid=${appid}`, {
      signal: requestController.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      if (currentAppId !== appid) return;
      setErrorState(block, `HTTP ${res.status}`, appid);
      return;
    }

    const data = (await res.json()) as ReviewResponse;

    if (requestController.signal.aborted) return;
    if (currentAppId !== appid) return;

    if (data.error) {
      setErrorState(block, data.error, appid);
      return;
    }

    renderData(block, data, appid);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    if (currentAppId !== appid) return;
    setErrorState(block, "fetch failed", appid);
  } finally {
    if (abortController === requestController) {
      abortController = null;
    }
    if (inFlightAppId === appid) {
      inFlightAppId = null;
    }
  }
}

function scheduleUpdate(doc: Document) {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    void updateReviewBlock(doc);
  }, 120);
}

function watchLocationChanges(doc: Document) {
  if (urlPollTimer) return;

  lastSeenUrl = doc.location?.href || "";

  urlPollTimer = window.setInterval(() => {
    const nextUrl = doc.location?.href || "";
    if (nextUrl === lastSeenUrl) return;

    lastSeenUrl = nextUrl;
    const nextAppId = getUrlAppId(doc);

    if (nextAppId && nextAppId !== currentAppId) {
      handleAppSwitch(doc, nextAppId);
      scheduleUpdate(doc);
    }
  }, 150) as unknown as number;
}

function isLikelyNavigationTarget(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;

  const clickable = el.closest("a, button, [role='button'], [onclick]");
  if (!clickable) return null;

  const appid = findNearbyAppId(clickable);
  if (!appid) return null;

  return clickable;
}

function watchNavigationClicks(doc: Document) {
  doc.addEventListener(
    "click",
    (event) => {
      const clickable = isLikelyNavigationTarget(event.target);
      if (!clickable) return;

      const nextAppId = findNearbyAppId(clickable);
      if (!nextAppId) return;
      if (nextAppId === currentAppId) return;

      handleAppSwitch(doc, nextAppId);
      scheduleUpdate(doc);
    },
    true
  );
}

function shouldIgnoreMutation(mutation: MutationRecord): boolean {
  const target = mutation.target;
  if (!(target instanceof Node)) return false;

  const reviewBlock = (target as Element)?.closest?.(`#${REVIEW_BLOCK_ID}`);
  if (reviewBlock) return true;

  for (const node of mutation.addedNodes) {
    if (
      node instanceof HTMLElement &&
      (node.id === REVIEW_BLOCK_ID || node.closest?.(`#${REVIEW_BLOCK_ID}`))
    ) {
      return true;
    }
  }

  return false;
}

function shouldScheduleFromMutations(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (shouldIgnoreMutation(mutation)) {
      continue;
    }

    if (mutation.type === "childList") {
      return true;
    }
  }
  return false;
}

function watchSteamShell(win: any) {
  const doc = win?.m_popup?.document;
  if (!doc?.body) return;
  if (observerStarted) return;

  observerStarted = true;

  injectAnimationStyles(doc);
  injectForceGameInfoStyles(doc);
  watchLocationChanges(doc);
  watchNavigationClicks(doc);
  stripDimClassFromGameInfo(doc);
  scheduleUpdate(doc);

  const observer = new MutationObserver((mutations) => {
    stripDimClassFromGameInfo(doc);

    if (!shouldScheduleFromMutations(mutations)) {
      return;
    }

    scheduleUpdate(doc);
  });

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
  });
}

function startHook() {
  Millennium.AddWindowCreateHook((win: any) => {
    if (win?.m_strName !== "SP Desktop_uid0") return;
    if (win?.m_strTitle !== "Steam") return;

    const tries = [1000, 3000, 5000, 8000];
    for (const delay of tries) {
      setTimeout(() => {
        try {
          watchSteamShell(win);
        } catch {}
      }, delay);
    }
  });
}

startHook();

export default definePlugin(() => ({
  title: "Steam Library Reviews",
  icon: null as any,
  content: null as any,
}));