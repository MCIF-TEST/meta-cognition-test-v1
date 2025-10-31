/* ============================================================
   ui.js – Meta Cognition Test UI Module (Enterprise-Grade)
   Developed for MCIF Framework | Hayden Andrew Carr
   ============================================================ */

/* ---------- Core Fade and Transition Utilities ---------- */
export function fadeIn(element, duration = 400) {
  if (!element) return;
  element.style.opacity = 0;
  element.style.display = "block";

  let last = +new Date();
  const tick = () => {
    element.style.opacity = +element.style.opacity + (new Date() - last) / duration;
    last = +new Date();

    if (+element.style.opacity < 1) {
      (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
    } else {
      element.style.opacity = 1;
    }
  };
  tick();
}

export function fadeOut(element, duration = 400) {
  if (!element) return;
  element.style.opacity = 1;

  let last = +new Date();
  const tick = () => {
    element.style.opacity = +element.style.opacity - (new Date() - last) / duration;
    last = +new Date();

    if (+element.style.opacity > 0) {
      (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
    } else {
      element.style.opacity = 0;
      element.style.display = "none";
    }
  };
  tick();
}

/* ---------- Progress and Message Display ---------- */
export function updateProgress(current, total) {
  const progressEl = document.getElementById("progress");
  if (progressEl) {
    progressEl.textContent = `Question ${current} of ${total}`;
  }
}

export function showMessage(message, type = "info") {
  const promptEl = document.getElementById("prompt");
  if (!promptEl) return;

  promptEl.textContent = message;
  promptEl.className = ""; // reset classes

  switch (type) {
    case "success":
      promptEl.classList.add("message-success");
      break;
    case "error":
      promptEl.classList.add("message-error");
      break;
    default:
      promptEl.classList.add("message-info");
  }
}

/* ---------- Button & Input Feedback ---------- */
export function setButtonLoading(button, state = true) {
  if (!button) return;
  if (state) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Processing...';
  } else {
    button.disabled = false;
    button.innerHTML = "Next";
  }
}

export function shakeElement(element) {
  if (!element) return;
  element.classList.add("shake");
  setTimeout(() => element.classList.remove("shake"), 600);
}

/* ---------- Initialization ---------- */
export function initUI() {
  console.log("%cUI Module initialized successfully", "color:#6cf;font-weight:bold;");
}

/* ---------- Spinner Styling Injection ---------- */
(function injectSpinnerStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .spinner {
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: #00bcd4;
      border-radius: 50%;
      width: 14px;
      height: 14px;
      animation: spin 0.6s linear infinite;
      display: inline-block;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .shake {
      animation: shakeAnimation 0.5s;
    }
    @keyframes shakeAnimation {
      10%, 90% { transform: translateX(-2px); }
      20%, 80% { transform: translateX(4px); }
      30%, 50%, 70% { transform: translateX(-8px); }
      40%, 60% { transform: translateX(8px); }
    }
    .message-success { color: #4CAF50; }
    .message-error { color: #FF5252; }
    .message-info { color: #E0E0E0; }
  `;
  document.head.appendChild(style);
})();
