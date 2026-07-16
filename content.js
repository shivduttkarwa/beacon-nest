// BeaconNest content script
// Responsibilities:
//   1. On request (BEACONNEST_GET_ANCHOR), describe the spot at the viewport
//      center: a text snippet actually visible at/around that point, a CSS
//      selector, and the scroll position (absolute + as a ratio of the page).
//   2. On request (BEACONNEST_SCROLL_TO), take the page back to that spot.
//
// Revisit design notes — this is deliberately NOT the browser's native
// #:~:text= text fragment, and NOT a bare scrollIntoView:
//   - We search the page's rendered text ourselves via a normalized,
//     cross-node character index. That makes matching immune to things that
//     break native fragments and selectors on animated/inspiration sites:
//     split-text animations that wrap every character in its own span, CJK
//     and other languages without space-delimited words, NBSP/zero-width
//     characters, and case differences.
//   - When the same text appears multiple times, we pick the occurrence
//     closest to where the beacon was saved (scroll ratio hint) instead of
//     blindly taking the first one.
//   - We scroll with an animation that passes through intermediate positions,
//     because scroll-reveal effects (IntersectionObserver / GSAP ScrollTrigger
//     "once" reveals) only fire as the viewport sweeps the page — an instant
//     teleport leaves sections stuck invisible and the page looking broken.
//   - After arriving we re-measure and correct (up to 3 passes), because lazy
//     images/embeds loading below can shift the target after the first scroll.
//   - The highlight is a self-removing overlay, never a style mutation on the
//     site's own elements.

(() => {
  if (window.__beaconnestInjected) return;
  window.__beaconnestInjected = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME",
    "CANVAS", "VIDEO", "AUDIO", "SVG", "SELECT", "TEXTAREA",
  ]);
  const HIGHLIGHT_COLOR = "#4f46e5";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------
  // Shared text utilities
  // ---------------------------------------------------------------------

  function isInvisibleChar(ch) {
    // Soft hyphen, zero-width space/joiners, BOM — present in the DOM but not
    // in what the user reads; both capture and matching must skip them.
    return ch === "\u00AD" || (ch >= "\u200B" && ch <= "\u200D") || ch === "\uFEFF";
  }

  function normalizeNeedle(s) {
    return (s || "")
      .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function rangeIsVisible(range) {
    for (const r of range.getClientRects()) {
      // Filters out display:none (no rects) and 1px clip-rect "visually
      // hidden" accessibility text (the source of garbage snippets).
      if (r.width > 1 && r.height > 2) return true;
    }
    return false;
  }

  function textNodeVisible(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    return rangeIsVisible(range);
  }

  function scrollableHeight() {
    // Some sites make <body> the scrolling box rather than <html>.
    return Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
  }

  // Builds a searchable string from the page's text nodes plus a map from
  // each character back to its {node, offset}. Whitespace runs collapse to a
  // single space and invisible characters are skipped, so text split across
  // arbitrary inline elements (including one-span-per-character animation
  // markup) concatenates the same way every time.
  function buildTextIndex(root, { visibleOnly = false, lowercase = true } = {}) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (visibleOnly && !textNodeVisible(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = "";
    const map = [];
    let lastWasSpace = true;
    let node;
    while ((node = walker.nextNode())) {
      const s = node.textContent;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (isInvisibleChar(ch)) continue;
        if (/\s/.test(ch)) {
          if (!lastWasSpace) {
            text += " ";
            map.push({ node, offset: i });
            lastWasSpace = true;
          }
        } else {
          text += lowercase ? ch.toLowerCase() : ch;
          map.push({ node, offset: i });
          lastWasSpace = false;
        }
      }
    }
    return { text, map };
  }

  // ---------------------------------------------------------------------
  // Capture (BEACONNEST_GET_ANCHOR)
  // ---------------------------------------------------------------------

  function buildSelector(el) {
    if (!(el instanceof Element)) return null;
    const parts = [];
    let node = el;
    let depth = 0;

    while (node && node.nodeType === 1 && depth < 6) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTagSiblings = Array.from(parent.children).filter(
        (c) => c.tagName === node.tagName
      );
      const index = sameTagSiblings.indexOf(node) + 1;
      const part =
        sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag;
      parts.unshift(part);
      node = parent;
      depth += 1;
      if (node === document.body) {
        parts.unshift("body");
        break;
      }
    }
    return parts.join(" > ");
  }

  function trimToWords(text, maxLen) {
    if (text.length <= maxLen) return text;
    const cut = text.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    // No usable space boundary (e.g. CJK) → hard cut is fine: our own matcher
    // does plain substring search with no word-boundary requirement.
    return lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  }

  // The snippet must be text the user can actually SEE at/near the anchor
  // point. Never raw el.innerText of a big container — that pulls in
  // visually-hidden accessibility labels and unrelated sibling content.
  function captureSnippet(centerEl, cx, cy) {
    // 1. The exact text node under the pixel, if it carries enough text.
    if (document.caretRangeFromPoint) {
      try {
        const caret = document.caretRangeFromPoint(cx, cy);
        const n = caret && caret.startContainer;
        if (n && n.nodeType === Node.TEXT_NODE && textNodeVisible(n)) {
          const own = n.textContent.replace(/\s+/g, " ").trim();
          if (own.length >= 8) return trimToWords(own, 90);
        }
      } catch (e) {
        /* fall through */
      }
    }

    // 2. Nearest ancestor with a reasonable amount of *visible* text — walks
    //    up from the center element (an image card's title lives on a sibling
    //    branch, so the card container finds it). Skips page-level wrappers,
    //    whose "first visible text" would be something arbitrary like the nav.
    const viewportArea = window.innerWidth * window.innerHeight;
    let el = centerEl;
    for (let depth = 0; el && el !== document.body && depth < 4; depth++, el = el.parentElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height > viewportArea * 0.65) break;
      const { text } = buildTextIndex(el, { visibleOnly: true, lowercase: false });
      const trimmed = text.trim();
      if (trimmed.length >= 8) return trimToWords(trimmed, 90);
    }
    return "";
  }

  function getAnchorInfo() {
    const selection = window.getSelection ? window.getSelection().toString().trim() : "";
    const cx = Math.floor(window.innerWidth / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const centerEl = document.elementFromPoint(cx, cy);

    const selector = buildSelector(centerEl);
    const snippet = selection ? trimToWords(selection.replace(/\s+/g, " "), 90) : captureSnippet(centerEl, cx, cy);

    const maxScroll = Math.max(1, scrollableHeight() - window.innerHeight);
    const scrollYRatio = Math.min(1, Math.max(0, window.scrollY / maxScroll));

    return {
      title: document.title,
      url: location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollYRatio,
      selector,
      selectedText: selection || null,
      snippet,
    };
  }

  // ---------------------------------------------------------------------
  // Revisit (BEACONNEST_SCROLL_TO)
  // ---------------------------------------------------------------------

  let userTookOver = false;
  function armUserTakeoverWatch() {
    userTookOver = false;
    const mark = () => { userTookOver = true; };
    for (const ev of ["wheel", "touchstart", "keydown"]) {
      window.addEventListener(ev, mark, { passive: true, once: true });
    }
  }

  function findTextMatches(needle) {
    const { text, map } = buildTextIndex(document.body, { lowercase: true });
    const matches = [];
    let idx = text.indexOf(needle);
    let guard = 0;
    while (idx !== -1 && guard++ < 100) {
      const start = map[idx];
      const end = map[idx + needle.length - 1];
      try {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset + 1);
        // Validate here, not during indexing: hidden text (a11y labels,
        // collapsed sections) must never win, but checking every node up
        // front would be slow on big pages.
        if (rangeIsVisible(range)) matches.push(range);
      } catch (e) {
        /* DOM changed under us; skip this occurrence */
      }
      idx = text.indexOf(needle, idx + 1);
    }
    return matches;
  }

  function rangeDocY(range) {
    const rect = range.getBoundingClientRect();
    return rect.top + window.scrollY + rect.height / 2;
  }

  // Same text can repeat (nav links, repeated card labels, marquee clones).
  // Pick the occurrence closest to where the beacon was saved.
  function pickBest(items, getY, expectedY) {
    if (!items.length) return null;
    if (items.length === 1 || typeof expectedY !== "number") return items[0];
    let best = items[0];
    let bestDist = Infinity;
    for (const it of items) {
      let y;
      try {
        y = getY(it);
      } catch (e) {
        continue;
      }
      const d = Math.abs(y - expectedY);
      if (d < bestDist) {
        bestDist = d;
        best = it;
      }
    }
    return best;
  }

  // Animated scroll that sweeps through intermediate positions so
  // scroll-reveal animations fire along the way. Aborts if the user scrolls.
  function animateScroll(targetY) {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const dist = targetY - startY;
      if (Math.abs(dist) < 2) return resolve(true);
      const duration = Math.min(1100, 350 + Math.abs(dist) * 0.25);
      const t0 = performance.now();
      let aborted = false;
      const abort = () => { aborted = true; };
      window.addEventListener("wheel", abort, { passive: true, once: true });
      window.addEventListener("touchstart", abort, { passive: true, once: true });
      const cleanup = () => {
        window.removeEventListener("wheel", abort);
        window.removeEventListener("touchstart", abort);
      };
      const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      function step(now) {
        if (aborted) {
          cleanup();
          return resolve(false);
        }
        const t = Math.min(1, (now - t0) / duration);
        window.scrollTo(window.scrollX, startY + dist * ease(t));
        if (t < 1) requestAnimationFrame(step);
        else {
          cleanup();
          resolve(true);
        }
      }
      requestAnimationFrame(step);
    });
  }

  // Scroll so the target sits at viewport center, then re-measure and correct:
  // lazy images/embeds loading during the scroll shift everything below them.
  async function scrollToDocY(getTargetY) {
    for (let pass = 0; pass < 3; pass++) {
      if (userTookOver) return false;
      let targetY;
      try {
        targetY = getTargetY();
      } catch (e) {
        return false;
      }
      if (targetY == null) return false;
      const maxScroll = Math.max(0, scrollableHeight() - window.innerHeight);
      const dest = Math.max(0, Math.min(maxScroll, targetY - window.innerHeight / 2));
      const finished = await animateScroll(dest);
      if (!finished) return false; // user took over — never fight them
      await sleep(450); // let lazy content and reveal animations settle
      let nowY;
      try {
        nowY = getTargetY();
      } catch (e) {
        return true;
      }
      if (nowY == null) return true;
      if (Math.abs(nowY - (window.scrollY + window.innerHeight / 2)) < 48) return true;
    }
    return true;
  }

  // Overlay highlight — never mutates the site's own elements.
  function flashRect(rect) {
    if (!rect || (!rect.width && !rect.height)) return;
    const pad = 6;
    const box = document.createElement("div");
    box.style.cssText = [
      "position: fixed",
      `left: ${rect.left - pad}px`,
      `top: ${rect.top - pad}px`,
      `width: ${rect.width + pad * 2}px`,
      `height: ${rect.height + pad * 2}px`,
      `border: 3px solid ${HIGHLIGHT_COLOR}`,
      "border-radius: 10px",
      "box-shadow: 0 0 0 6px rgba(79, 70, 229, 0.22)",
      "pointer-events: none",
      "z-index: 2147483647",
      "opacity: 1",
      "transition: opacity 0.6s ease 1.2s",
    ].join(";");
    document.documentElement.appendChild(box);
    requestAnimationFrame(() => {
      box.style.opacity = "0";
    });
    setTimeout(() => box.remove(), 2200);
  }

  async function revisitAnchor(payload) {
    armUserTakeoverWatch();

    const needle = normalizeNeedle(payload.selectedText || payload.snippet || "");
    const hasRatio = typeof payload.scrollYRatio === "number" && payload.scrollYRatio > 0;

    const expectedY = () => {
      const maxScroll = Math.max(0, scrollableHeight() - window.innerHeight);
      if (hasRatio) return payload.scrollYRatio * maxScroll + window.innerHeight / 2;
      if (payload.scrollY) return payload.scrollY + window.innerHeight / 2;
      return null;
    };

    // 1. Text anchor. Poll: client-rendered/animated pages often mount their
    //    content well after the load event.
    if (needle.length >= 4) {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && !userTookOver) {
        const matches = findTextMatches(needle);
        if (matches.length) {
          const best = pickBest(matches, rangeDocY, expectedY());
          const done = await scrollToDocY(() => rangeDocY(best));
          if (done) {
            try {
              flashRect(best.getBoundingClientRect());
            } catch (e) { /* range invalidated after arrival — highlight is optional */ }
          }
          return;
        }
        await sleep(500);
      }
    }
    if (userTookOver) return;

    // 2. Saved CSS selector.
    let target = null;
    if (payload.selector) {
      try {
        target = document.querySelector(payload.selector);
      } catch (e) {
        target = null;
      }
    }
    if (target) {
      const elY = () => {
        const r = target.getBoundingClientRect();
        if (!r.width && !r.height) return null; // detached or hidden
        return r.top + window.scrollY + r.height / 2;
      };
      if (elY() != null) {
        const done = await scrollToDocY(elY);
        if (done) flashRect(target.getBoundingClientRect());
        return;
      }
    }

    // 3. Raw position (ratio-based when available — page height changes
    //    between visits, absolute pixels don't transfer).
    const y = expectedY();
    if (y != null) await scrollToDocY(() => y);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "BEACONNEST_GET_ANCHOR") {
      sendResponse(getAnchorInfo());
      return true;
    }
    if (msg?.type === "BEACONNEST_SCROLL_TO") {
      revisitAnchor(msg.payload || {}); // async; runs on after we ack
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
