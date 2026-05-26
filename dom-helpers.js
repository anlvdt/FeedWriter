"use strict";

// DOM helper utilities — MutationObserver-based element waiting.
// Replaces brittle setTimeout polling throughout FeedWriter.

function waitForElement(selector, timeout = 10000, root = document) {
  return new Promise((resolve, reject) => {
    const existing = root.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(root === document ? document.body : root, {
      childList: true,
      subtree: true,
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitForElement: "${selector}" not found within ${timeout}ms`));
    }, timeout);
  });
}

function waitForElementInShadow(selector, hostSelector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const tryFind = () => {
      const host = document.querySelector(hostSelector);
      if (host && host.shadowRoot) {
        const el = host.shadowRoot.querySelector(selector);
        if (el) return el;
      }
      return null;
    };

    const existing = tryFind();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = tryFind();
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitForElementInShadow: "${selector}" in "${hostSelector}" not found within ${timeout}ms`));
    }, timeout);
  });
}

function waitForCondition(checkFn, timeout = 10000, interval = 200) {
  return new Promise((resolve, reject) => {
    const result = checkFn();
    if (result) {
      resolve(result);
      return;
    }

    const timer = setInterval(() => {
      const r = checkFn();
      if (r) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve(r);
      }
    }, interval);

    const deadline = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`waitForCondition: timed out after ${timeout}ms`));
    }, timeout);
  });
}

async function uploadFilesToInput(fileInput, fileDataList) {
  const dataTransfer = new DataTransfer();
  for (const fileData of fileDataList) {
    try {
      const response = await fetch(fileData.url);
      const arrayBuffer = await response.arrayBuffer();
      const file = new File([arrayBuffer], fileData.name, { type: fileData.type || "image/jpeg" });
      dataTransfer.items.add(file);
    } catch (err) {
      console.warn("[CrossPost] Failed to fetch file:", fileData.url, err.message);
    }
  }
  if (dataTransfer.files.length === 0) return false;

  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  fileInput.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function pasteTextToEditor(editor, text) {
  editor.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  editor.dispatchEvent(new ClipboardEvent("paste", {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
  }));
}
