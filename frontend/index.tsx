import { definePlugin } from "@steambrew/client";

declare const Millennium: any;

const PROXY_URL = "http://127.0.0.1:32145/reviews";
const POSITIVE_GREEN = "#66c06a";
const MIXED_GOLD = "#b9a074";
const NEGATIVE_RED = "#a34c25";
const NEUTRAL_TEXT = "#8f98a0";

let observerStarted = false;
let pendingTimer: number | null = null;
let currentAppId: string | null = null;
let inFlightAppId: string | null = null;
let abortController: AbortController | null = null;

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

  const all = Array.from(root.querySelectorAll("*"));
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

function getReviewColor(label: string) {
  const text = (label || "").toLowerCase();

  if (text.includes("positive")) return POSITIVE_GREEN;
  if (text.includes("mixed")) return MIXED_GOLD;
  if (text.includes("negative")) return NEGATIVE_RED;

  return NEUTRAL_TEXT;
}

function buildReviewBlock(doc: Document) {
  let block = doc.getElementById("st-steam-review-block") as HTMLElement | null;
  if (block) return block;

  block = doc.createElement("div");
  block.id = "st-steam-review-block";
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

function setLoadingState(block: HTMLElement) {
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
}

function setErrorState(block: HTMLElement, message: string) {
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
}

function locateAnchor(doc: Document) {
  const allDivs = Array.from(doc.querySelectorAll("div"));
  return allDivs.find((el) =>
    (el.textContent || "").trim().startsWith("Developer:")
  ) as HTMLElement | undefined;
}

function renderData(block: HTMLElement, data: any, appid: string) {
  const overallLeft = block.querySelector("#st-overall-left") as HTMLElement;
  const recentLeft = block.querySelector("#st-recent-left") as HTMLElement;
  const overallRight = block.querySelector("#st-overall-right") as HTMLElement;
  const recentRight = block.querySelector("#st-recent-right") as HTMLElement;

  const overallCount = data.overall?.total_reviews ?? 0;
  const overallLabel = data.overall?.review_score_desc || "No rating";
  const recentCount = data.recent?.total_reviews ?? 0;
  const recentLabel = data.recent?.review_score_desc || "No recent rating";

  overallLeft.textContent = `Overall Reviews: (${overallCount.toLocaleString()})`;
  recentLeft.textContent = `Recent Reviews: (${recentCount.toLocaleString()})`;
  overallRight.textContent = overallLabel;
  recentRight.textContent = recentLabel;
  overallRight.style.color = getReviewColor(overallLabel);
  recentRight.style.color = getReviewColor(recentLabel);

  block.dataset.loadedAppid = appid;
}

async function updateReviewBlock(doc: Document) {
  const anchor = locateAnchor(doc);
  if (!anchor) return;

  let block = doc.getElementById("st-steam-review-block") as HTMLElement | null;
  if (!block) {
    block = buildReviewBlock(doc);
    anchor.insertAdjacentElement("afterend", block);
  } else if (block.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", block);
  }

  const appid =
    findNearbyAppId(anchor.parentElement) ||
    findNearbyAppId(anchor.parentElement?.parentElement || null) ||
    findNearbyAppId(doc.querySelector("main")) ||
    findNearbyAppId(doc.body);

  if (!appid) {
    setErrorState(block, "appid not found");
    return;
  }

  if (block.dataset.loadedAppid === appid) return;
  if (inFlightAppId === appid) return;

  currentAppId = appid;
  inFlightAppId = appid;

  if (abortController) abortController.abort();
  abortController = new AbortController();

  setLoadingState(block);

  try {
    const res = await fetch(`${PROXY_URL}?appid=${appid}`, {
      signal: abortController.signal,
    });

    if (!res.ok) {
      setErrorState(block, `HTTP ${res.status}`);
      return;
    }

    const data = await res.json();

    if (data.error) {
      setErrorState(block, data.error);
      return;
    }

    if (currentAppId !== appid) return;

    renderData(block, data, appid);
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    setErrorState(block, "fetch failed");
  } finally {
    if (inFlightAppId === appid) {
      inFlightAppId = null;
    }
  }
}

function scheduleUpdate(doc: Document) {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    updateReviewBlock(doc);
  }, 500);
}

function watchSteamShell(win: any) {
  const doc = win?.m_popup?.document;
  if (!doc?.body) return;
  if (observerStarted) return;

  observerStarted = true;

  scheduleUpdate(doc);

  const observer = new MutationObserver(() => {
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