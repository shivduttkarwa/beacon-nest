// BeaconNest content script
// Responsibilities:
//   1. On request, find the nearest element to the current viewport center
//      and describe it with a short, resilient CSS selector.
//   2. On request, scroll a previously saved beacon back into view.

(() => {
  if (window.__beaconnestInjected) return;
  window.__beaconnestInjected = true;

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

  function nearestTextSnippet(el) {
    if (!el) return "";
    const text = (el.innerText || el.textContent || "").trim();
    return text.replace(/\s+/g, " ").slice(0, 90);
  }

  function getAnchorInfo() {
    const selection = window.getSelection ? window.getSelection().toString().trim() : "";
    const cx = Math.floor(window.innerWidth / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const centerEl = document.elementFromPoint(cx, cy);

    const selector = buildSelector(centerEl);
    const snippet = selection ? selection.slice(0, 90) : nearestTextSnippet(centerEl);

    return {
      title: document.title,
      url: location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      selector,
      selectedText: selection || null,
      snippet,
    };
  }

  function scrollToAnchor({ selector, scrollX, scrollY }) {
    let target = null;
    if (selector) {
      try {
        target = document.querySelector(selector);
      } catch (e) {
        target = null;
      }
    }
    if (target) {
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.style.outline = "3px solid #0F7B6C";
      target.style.outlineOffset = "2px";
      setTimeout(() => {
        target.style.outline = "";
        target.style.outlineOffset = "";
      }, 1800);
    } else {
      window.scrollTo({ left: scrollX || 0, top: scrollY || 0, behavior: "instant" });
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "BEACONNEST_GET_ANCHOR") {
      sendResponse(getAnchorInfo());
      return true;
    }
    if (msg?.type === "BEACONNEST_SCROLL_TO") {
      scrollToAnchor(msg.payload || {});
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
