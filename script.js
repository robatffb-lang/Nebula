// ==========================================================================
// CONFIGURATION & KEYS
// ==========================================================================
// Replace the string below with your actual active Groq API Key
const TYPING_SPEED_MS = 35;

// Define usage limits for non-Mini-X models
const MODEL_LIMITS = {
  "mini-x": Infinity,
  "flash": 100,
  "pro": 50
};

// Global controller to abort running streams
let currentAbortController = null;

document.addEventListener("contextmenu", e => e.preventDefault());

// Block common DevTools shortcuts
document.addEventListener("keydown", e => {
  if (
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) ||
    (e.ctrlKey && e.key.toUpperCase() === "U")
  ) {
    e.preventDefault();
  }
});

let conversationHistory = [];
let isUserLoggedIn = false;
let currentAccountId = null; // Key for scoping user profile & history
let allSavedChats = [];
let currentChatId = null;

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const loaderBadge = document.getElementById("loader-badge");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const welcomeScreen = document.getElementById("welcome-screen");
const welcomeSubtext = document.getElementById("welcome-subtext");
const messagesList = document.getElementById("messages-list");
const newChatBtn = document.getElementById("new-chat-btn");
const historyList = document.getElementById("history-list");

// ==========================================================================
// NEBULA MODEL & MODIFIER CHOOSER LOGIC
// ==========================================================================
const COOLDOWN_DURATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds

let messageCount = parseInt(localStorage.getItem('chat_msg_count') || '0');
let cooldownTimer = null;

function checkCooldownStatus() {
  const cooldownEndTime = localStorage.getItem('cooldown_end_time');
  
  if (cooldownEndTime) {
    const remainingTime = parseInt(cooldownEndTime) - Date.now();
    
    if (remainingTime > 0) {
      startCooldownTimer(remainingTime);
      return true;
    } else {
      resetCooldown();
    }
  }
  return false;
}

function triggerCooldown() {
  const endTime = Date.now() + COOLDOWN_DURATION_MS;
  localStorage.setItem('cooldown_end_time', endTime);
  startCooldownTimer(COOLDOWN_DURATION_MS);
}

function startCooldownTimer(durationMs) {
  const inputEl = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  
  if (inputEl) inputEl.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  updateTimerUI(durationMs);

  if (cooldownTimer) clearInterval(cooldownTimer);

  cooldownTimer = setInterval(() => {
    const endTime = parseInt(localStorage.getItem('cooldown_end_time') || '0');
    const remaining = endTime - Date.now();

    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      resetCooldown();
    } else {
      updateTimerUI(remaining);
    }
  }, 1000);
}

function resetCooldown() {
  localStorage.removeItem('cooldown_end_time');
  localStorage.removeItem('chat_msg_count');
  messageCount = 0;

  const inputEl = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');

  if (inputEl) {
    inputEl.disabled = false;
    inputEl.placeholder = "Message Nebula...";
  }
  if (sendBtn) sendBtn.disabled = false;

  const banner = document.getElementById('cooldown-banner');
  if (banner) banner.classList.add('hidden');
}

function updateTimerUI(remainingMs) {
  const minutes = Math.floor(remainingMs / (1000 * 60));
  const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
  const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const inputEl = document.getElementById('user-input');
  if (inputEl) {
    inputEl.placeholder = `Limit reached. Cooldown active: ${timeString}`;
  }

  const banner = document.getElementById('cooldown-banner');
  if (banner) {
    banner.classList.remove('hidden');
    banner.textContent = `You've reached your limit! Please wait ${timeString} before sending more messages.`;
  }
}

checkCooldownStatus();

let currentModel = 'mini-x';
let activeModifiers = new Set();

function getModelUsage() {
  const saved = localStorage.getItem('nebula_model_usage');
  try {
    return saved ? JSON.parse(saved) : { flash: 0, pro: 0 };
  } catch (e) {
    return { flash: 0, pro: 0 };
  }
}

function saveModelUsage(usage) {
  localStorage.setItem('nebula_model_usage', JSON.stringify(usage));
}

function updateLimitsUI() {
  const usage = getModelUsage();

  const flashUsed = Number(usage.flash) || 0;
  const flashRemaining = Math.max(0, MODEL_LIMITS.flash - flashUsed);
  const flashBadge = document.getElementById('flash-count-badge');
  const flashOpt = document.getElementById('opt-flash');

  if (flashBadge) {
    flashBadge.textContent = `${flashRemaining} / ${MODEL_LIMITS.flash} left`;
    flashBadge.classList.toggle('exhausted', flashRemaining <= 0);
  }
  if (flashOpt) {
    flashOpt.classList.toggle('disabled', flashRemaining <= 0);
  }

  const proUsed = Number(usage.pro) || 0;
  const proRemaining = Math.max(0, MODEL_LIMITS.pro - proUsed);
  const proBadge = document.getElementById('pro-count-badge');
  const proOpt = document.getElementById('opt-pro');

  if (proBadge) {
    proBadge.textContent = `${proRemaining} / ${MODEL_LIMITS.pro} left`;
    proBadge.classList.toggle('exhausted', proRemaining <= 0);
  }
  if (proOpt) {
    proOpt.classList.toggle('disabled', proRemaining <= 0);
  }

  if ((currentModel === 'flash' && flashRemaining <= 0) || 
      (currentModel === 'pro' && proRemaining <= 0)) {
    selectModel('mini-x');
  }
}

function selectModel(modelKey) {
  currentModel = modelKey;
  const badge = document.getElementById('active-model-badge');

  if (badge) {
    badge.className = `model-badge ${modelKey}`;
    badge.textContent = modelKey === 'mini-x' ? 'Mini-X' : modelKey.toUpperCase();
  }

  document.querySelectorAll('.dropdown-option[data-model]').forEach((opt) => {
    opt.classList.toggle('selected', opt.getAttribute('data-model') === modelKey);
  });
}

function updateTriggerModsIndicator() {
  const indicator = document.getElementById('active-mods-indicator');
  if (!indicator) return;

  if (activeModifiers.size > 0) {
    indicator.textContent = `+${activeModifiers.size}`;
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }
}

window.consumeModelUsage = function(modelKey) {
  if (modelKey === 'mini-x') return true;

  const usage = getModelUsage();
  const currentCount = Number(usage[modelKey]) || 0;

  if (currentCount >= MODEL_LIMITS[modelKey]) {
    updateLimitsUI();
    return false;
  }

  usage[modelKey] = currentCount + 1;
  saveModelUsage(usage);
  updateLimitsUI();
  return true;
};

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('unified-chooser');
  const trigger = e.target.closest('#chooser-trigger');
  const modelOpt = e.target.closest('.dropdown-option[data-model]');
  const modOpt = e.target.closest('.dropdown-option[data-mod]');
  const sendBtnTarget = e.target.closest('#send-btn') || e.target.closest('.send-btn');

  if (trigger && dropdown) {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    return;
  }

  if (modelOpt && dropdown) {
    const model = modelOpt.getAttribute('data-model');
    const usage = getModelUsage();

    if (model !== 'mini-x' && (usage[model] || 0) >= MODEL_LIMITS[model]) {
      alert(`Limit reached for ${model.toUpperCase()}. Defaulting to Mini-X.`);
      selectModel('mini-x');
    } else {
      selectModel(model);
    }

    dropdown.classList.remove('open');
    return;
  }

  if (modOpt) {
    e.stopPropagation();
    const mod = modOpt.getAttribute('data-mod');

    if (activeModifiers.has(mod)) {
      activeModifiers.delete(mod);
      modOpt.classList.remove('selected');
    } else {
      activeModifiers.add(mod);
      modOpt.classList.add('selected');
    }

    updateTriggerModsIndicator();
    return;
  }

  if (sendBtnTarget) {
    // If generation is active, clicking button aborts stream
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
      return;
    }
    handleSendMessage();
    return;
  }

  if (dropdown && !dropdown.contains(e.target)) {
    dropdown.classList.remove('open');
  }
});

document.addEventListener('keydown', (e) => {
  const input = document.getElementById('user-input') || document.querySelector('input[type="text"]');
  if (e.target === input && e.key === 'Enter' && !e.shiftKey) {
    if (currentAbortController) {
      e.preventDefault();
      return;
    }
    handleSendMessage();
  }
});

function handleSendMessage() {
  if (currentModel !== 'mini-x' && checkCooldownStatus()) {
    alert("You are currently on a 1-hour cooldown for Flash/Pro models!");
    return;
  }

  const inputEl = document.getElementById('user-input');
  const text = inputEl ? inputEl.value.trim() : "";

  if (!text && attachedFiles.length === 0) return;

  sendMessage();

  if (currentModel !== 'mini-x') {
    messageCount++;
    localStorage.setItem('chat_msg_count', messageCount);

    if (messageCount >= MODEL_LIMIT) {
      triggerCooldown();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateLimitsUI();
});

const devChannel = new BroadcastChannel('nebula_dev_channel');

function notifyNebulaDev(eventType, userObj) {
  const payload = {
    type: eventType,
    displayName: userObj.displayName || userObj.username,
    username: userObj.username,
    email: userObj.email || `${userObj.username}@nebula.ai`,
    timestamp: new Date().toLocaleString(),
    // Find this inside notifyNebulaDev:
origin: window.location.origin || 'https://robatffb-lang.github.io/Nebula'
  };
  
  devChannel.postMessage(payload);
}

// ----------------------------------------------------
// ANIMATED INPUT CARET POSITIONING
// ----------------------------------------------------
const inputEl = document.getElementById("user-input");
const caretEl = document.getElementById("animated-caret");
const inputContainer = inputEl ? inputEl.parentElement : null;

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

function updateCaretPosition() {
  if (!inputEl || !caretEl) return;

  const style = window.getComputedStyle(inputEl);
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.font = font;

  const cursorPos = inputEl.selectionStart || 0;
  const textBeforeCursor = inputEl.value.substring(0, cursorPos);
  let textWidth = context.measureText(textBeforeCursor).width;

  const letterSpacing = parseFloat(style.letterSpacing);
  if (!isNaN(letterSpacing) && textBeforeCursor.length > 0) {
    textWidth += letterSpacing * textBeforeCursor.length;
  }

  const paddingLeft = parseFloat(style.paddingLeft) || 14;
  const totalX = paddingLeft + textWidth - 1;

  caretEl.style.transform = `translate(${totalX}px, -50%)`;
}

if (inputEl && caretEl) {
  let typingTimeout;

  ["input", "keydown", "keyup", "click", "focus"].forEach((evt) => {
    inputEl.addEventListener(evt, () => {
      updateCaretPosition();

      if (inputContainer) {
        inputContainer.classList.add("is-typing");
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          inputContainer.classList.remove("is-typing");
        }, 400);
      }
    });
  });

  inputEl.addEventListener("focus", () => {
    caretEl.style.opacity = "1";
    updateCaretPosition();
  });

  inputEl.addEventListener("blur", () => {
    caretEl.style.opacity = "0";
  });
}

const translations = {
  en: {
    welcomeSub: "Your personal, professional AI assistant.",
    inputPlaceholder: "Message Nebula...",
    newChat: "New chat",
    chatHistory: "Chat History",
    signUp: "Sign Up",
    disclaimer: "Nebula is an AI assistant, its reply may not be fully correct.",
    loadingEngine: "Loading AI Engine...",
    startingLoad: "Engine Ready",
    card1Title: "Write code",
    card1Desc: "Sort an array of objects in JS",
    card2Title: "Explain concepts",
    card2Desc: "Quantum computing for beginners",
    card3Title: "Creative writing",
    card3Desc: "Brainstorm a sci-fi storyline"
  },
  zh: {
    welcomeSub: "你的个人且专业的AI助手。",
    inputPlaceholder: "给 Nebula 发送消息...",
    newChat: "新建对话",
    chatHistory: "历史对话",
    signUp: "注册 / 登录",
    disclaimer: "Nebula 是一个 AI 助手，其回复可能不完全准确。",
    loadingEngine: "AI 引擎准备好了",
    startingLoad: "AI 引擎准备好了",
    card1Title: "编写代码",
    card1Desc: "在 JS 中对对象数组进行排序",
    card2Title: "解释概念",
    card2Desc: "适合初学者的量子计算",
    card3Title: "创意写作",
    card3Desc: "构思科幻故事构架"
  },
  es: {
    welcomeSub: "Tu asistente de IA personal y profesional.",
    inputPlaceholder: "Enviar mensaje a Nebula...",
    newChat: "Nuevo chat",
    chatHistory: "Historial de chat",
    signUp: "Registrarse",
    disclaimer: "Nebula es un asistente de IA, sus respuestas pueden no ser del todo correctas.",
    loadingEngine: "Motor listo",
    startingLoad: "Motor listo",
    card1Title: "Escribir código",
    card1Desc: "Ordenar un arreglo de objetos en JS",
    card2Title: "Explicar conceptos",
    card2Desc: "Computación cuántica para principiantes",
    card3Title: "Escritura creativa",
    card3Desc: "Lluvia de ideas para una historia sci-fi"
  },
  ms: {
    welcomeSub: "Pembantu AI peribadi dan profesional anda.",
    inputPlaceholder: "Mesej Nebula...",
    newChat: "Sembang Baharu",
    chatHistory: "Sejarah Sembang",
    signUp: "Daftar",
    disclaimer: "Nebula ialah pembantu AI, jawapannya mungkin tidak tepat sepenuhnya.",
    loadingEngine: "Sedia Enjin",
    startingLoad: "Sedia Enjin",
    card1Title: "Tulis kod",
    card1Desc: "Susun tatasusunan objek dalam JS",
    card2Title: "Terangkan konsep",
    card2Desc: "Pengkomputeran kuantum untuk pemula",
    card3Title: "Penulisan kreatif",
    card3Desc: "Sumbang saran cerita rekaan sains"
  }
};

function updateUILanguage(lang) {
  const dict = translations[lang] || translations.en;

  const loadingLabel = document.getElementById("loading-label");
  if (loadingLabel) loadingLabel.textContent = dict.loadingEngine;

  const statusText = document.getElementById("status-text");
  if (statusText) statusText.textContent = dict.startingLoad;

  const newChatBtn = document.getElementById("new-chat-btn");
  const newChatSpan = newChatBtn ? newChatBtn.querySelector("span") : null;
  if (newChatSpan) newChatSpan.textContent = dict.newChat;

  const historyLabel = document.querySelector(".history-label");
  if (historyLabel) historyLabel.textContent = dict.chatHistory;

  const userDisplayLabel = document.getElementById("user-display-label");
  if (userDisplayLabel && !isUserLoggedIn && userDisplayLabel.textContent === "Sign Up") {
    userDisplayLabel.textContent = dict.signUp;
  }

  const welcomeSubtext = document.getElementById("welcome-subtext");
  if (welcomeSubtext) welcomeSubtext.textContent = dict.welcomeSub;

  const cards = document.querySelectorAll(".suggestions-grid .card");
  if (cards.length >= 3) {
    cards[0].querySelector("h4").textContent = dict.card1Title;
    cards[0].querySelector("p").textContent = dict.card1Desc;

    cards[1].querySelector("h4").textContent = dict.card2Title;
    cards[1].querySelector("p").textContent = dict.card2Desc;

    cards[2].querySelector("h4").textContent = dict.card3Title;
    cards[2].querySelector("p").textContent = dict.card3Desc;
  }

  const userInput = document.getElementById("user-input");
  if (userInput) userInput.placeholder = dict.inputPlaceholder;

  const disclaimer = document.querySelector(".disclaimer");
  if (disclaimer) disclaimer.textContent = dict.disclaimer;
}

window.usePrompt = (text) => {
  if (!userInput || currentAbortController) return;
  userInput.value = text;
  userInput.focus();
  sendBtn.disabled = false;
};

function initializeEngine() {
  if (statusDot) statusDot.className = "status-dot ready";
  if (statusText) statusText.textContent = "Engine Ready";
  if (loaderBadge) loaderBadge.style.display = "none";
  
  if (userInput) {
    userInput.disabled = false;
    userInput.placeholder = "Message Nebula...";
    userInput.focus();
  }
  
  if (welcomeSubtext) {
    welcomeSubtext.textContent = "Your personal, professional AI assistant.";
  }
}

initializeEngine();

if (userInput) {
  userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height = `${userInput.scrollHeight}px`;
    if (!currentAbortController) {
      sendBtn.disabled = userInput.value.trim() === "";
    }
  });
}

// ----------------------------------------------------
// FULL USER PROFILE & STORAGE HELPERS
// ----------------------------------------------------
function saveUserData(accountId, displayName, pfpUrl) {
  if (!accountId) return;
  localStorage.setItem(`nebula_displayname_${accountId}`, displayName);
  if (pfpUrl) {
    localStorage.setItem(`nebula_pfp_${accountId}`, pfpUrl);
  }
}

function loadUserData(accountId) {
  if (!accountId) return { displayName: accountId, pfpUrl: null };
  const displayName = localStorage.getItem(`nebula_displayname_${accountId}`) || accountId;
  const pfpUrl = localStorage.getItem(`nebula_pfp_${accountId}`) || null;
  return { displayName, pfpUrl };
}

function saveUserChats() {
  if (!currentAccountId) return;
  const storageKey = `nebula_chats_${currentAccountId}`;
  localStorage.setItem(storageKey, JSON.stringify(allSavedChats));
}

function loadUserChats() {
  if (!currentAccountId) return [];
  const storageKey = `nebula_chats_${currentAccountId}`;
  const data = localStorage.getItem(storageKey);
  return data ? JSON.parse(data) : [];
}

function renderSidebarHistory() {
  if (!historyList) return;
  historyList.innerHTML = "";

  allSavedChats.forEach((chat) => {
    const li = createHistoryListItem(chat.id, chat.title);
    historyList.appendChild(li);
  });
}

// ----------------------------------------------------
// SIGN UP, USER PROFILE & LOGOUT
// ----------------------------------------------------
const signupSidebarBtn = document.getElementById("signup-sidebar-btn");
const signupModal = document.getElementById("signup-modal");
const modalCloseBtn = document.getElementById("modal-close-btn");
const mainSignupView = document.getElementById("main-signup-view");
const phoneSignupView = document.getElementById("phone-signup-view");

const googleBtn = document.getElementById("google-signup-btn");
const fbBtn = document.getElementById("fb-signup-btn");
const phoneBtn = document.getElementById("phone-signup-btn");
const phoneBackBtn = document.getElementById("phone-back-btn");

const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");
const phoneForm = document.getElementById("phone-form");
const phoneNumberInput = document.getElementById("phone-number");
const otpGroup = document.getElementById("otp-group");
const phoneSubmitBtn = document.getElementById("phone-submit-btn");
const phoneError = document.getElementById("phone-error");

let isOtpSent = false;

function renderUserProfile(displayName, photoUrl = null) {
  isUserLoggedIn = true;
  if (!signupSidebarBtn) return;

  const initial = displayName ? displayName.charAt(0).toUpperCase() : "U";

  const avatarHtml = photoUrl 
    ? `<img src="${photoUrl}" alt="PFP" class="user-pfp-img" />`
    : `<div class="user-avatar-badge">${initial}</div>`;

  signupSidebarBtn.innerHTML = `
    <div class="user-profile-card">
      ${avatarHtml}
      <span class="user-display-name" id="user-display-label">${displayName}</span>
      <button class="logout-btn" id="logout-btn" title="Log Out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
      </button>
    </div>
  `;

  signupSidebarBtn.style.cursor = "default";

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleLogout();
    });
  }
}

function completeSignUp(accountId, defaultDisplayName, pfpUrl = null) {
  currentAccountId = accountId;
  localStorage.setItem("nebula_active_account", accountId);

  let userData = loadUserData(accountId);
  let finalDisplayName = userData.displayName !== accountId ? userData.displayName : defaultDisplayName;
  let finalPfp = userData.pfpUrl ? userData.pfpUrl : pfpUrl;

  saveUserData(accountId, finalDisplayName, finalPfp);
  renderUserProfile(finalDisplayName, finalPfp);
  
  allSavedChats = loadUserChats();
  renderSidebarHistory();
  closeModal();
}

function handleLogout() {
  saveUserChats();

  isUserLoggedIn = false;
  currentAccountId = null;
  localStorage.removeItem("nebula_active_account");

  messagesList.innerHTML = "";
  conversationHistory = [];
  currentChatId = null;
  allSavedChats = [];
  if (historyList) historyList.innerHTML = "";
  if (welcomeScreen) welcomeScreen.style.display = "flex";

  if (signupSidebarBtn) {
    signupSidebarBtn.style.cursor = "pointer";
    signupSidebarBtn.innerHTML = `
      <div class="user-profile-card">
        <div class="user-avatar-badge">+</div>
        <span class="user-display-name" id="user-display-label">Sign Up</span>
      </div>
    `;
  }
}

if (googleBtn) {
  googleBtn.addEventListener("click", () => {
    const GOOGLE_CLIENT_ID = "334139676656-g78966akaqhbveir7oeor36ohjt37t3j.apps.googleusercontent.com";
const currentOrigin = window.location.origin + window.location.pathname;
const redirectUri = encodeURIComponent(currentOrigin);
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${redirectUri}&` +
      `response_type=token&` +
      `scope=email%20profile&` +
      `prompt=select_account`;

    window.location.href = googleAuthUrl;
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const hash = window.location.hash;

  if (hash.includes("access_token")) {
    const params = new URLSearchParams(hash.replace("#", "?"));
    const accessToken = params.get("access_token");

    fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then((res) => res.json())
      .then((user) => {
        completeSignUp(user.email || user.sub, user.name || "Google User", user.picture);
      })
      .catch(() => completeSignUp("google_user", "Google User"));

    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const savedLang = localStorage.getItem("nebula_language") || "en";
  setCustomLangSelect(savedLang);
  updateUILanguage(savedLang);

  const activeAccount = localStorage.getItem("nebula_active_account");
  if (activeAccount) {
    currentAccountId = activeAccount;
    const userData = loadUserData(activeAccount);

    renderUserProfile(userData.displayName, userData.pfpUrl);
    allSavedChats = loadUserChats();
    renderSidebarHistory();
  }
});

if (signupSidebarBtn) {
  signupSidebarBtn.addEventListener("click", () => {
    if (!isUserLoggedIn) {
      signupModal.classList.remove("hidden");
      resetModalViews();
    }
  });
}

const closeModal = () => {
  if (signupModal) signupModal.classList.add("hidden");
  resetModalViews();
};

function resetModalViews() {
  if (mainSignupView) mainSignupView.classList.remove("hidden");
  if (phoneSignupView) phoneSignupView.classList.add("hidden");
  if (signupError) signupError.style.display = "none";
  if (phoneError) phoneError.style.display = "none";
  if (otpGroup) otpGroup.classList.add("hidden");
  if (phoneSubmitBtn) phoneSubmitBtn.textContent = "Send Code";
  isOtpSent = false;
  
  if (signupForm) signupForm.reset();
  if (phoneForm) phoneForm.reset();
}

if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
if (signupModal) {
  signupModal.addEventListener("click", (e) => {
    if (e.target === signupModal) closeModal();
  });
}

if (phoneBtn) {
  phoneBtn.addEventListener("click", () => {
    mainSignupView.classList.add("hidden");
    phoneSignupView.classList.remove("hidden");
  });
}

if (phoneBackBtn) {
  phoneBackBtn.addEventListener("click", () => {
    phoneSignupView.classList.add("hidden");
    mainSignupView.classList.remove("hidden");
  });
}

if (phoneForm) {
  phoneForm.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!isOtpSent) {
      const phoneVal = phoneNumberInput.value.trim();
      if (phoneVal.length < 7) {
        phoneError.textContent = "Please enter a valid phone number.";
        phoneError.style.display = "block";
        return;
      }

      phoneError.style.display = "none";
      otpGroup.classList.remove("hidden");
      phoneSubmitBtn.textContent = "Verify & Sign Up";
      isOtpSent = true;
    } else {
      const otpVal = document.getElementById("otp-code").value.trim();
      if (otpVal.length !== 6) {
        phoneError.textContent = "Please enter a 6-digit code.";
        phoneError.style.display = "block";
        return;
      }

      const phone = phoneNumberInput.value.trim();
      completeSignUp(`phone_${phone}`, `+1 ${phone}`);
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById("signup-username").value.trim();
    const cleanUsername = usernameInput.toLowerCase();
    const password = document.getElementById("signup-password").value;

    if (password.length < 6) {
      signupError.textContent = "Password must be at least 6 characters.";
      signupError.style.display = "block";
      return;
    }

    if (isUsernameTaken(cleanUsername)) {
      signupError.textContent = `Username "${usernameInput}" is already taken!`;
      signupError.style.display = "block";
      return;
    }

    registerUsername(cleanUsername);
    signupError.style.display = "none";
    completeSignUp(cleanUsername, usernameInput);
  });
}

// ----------------------------------------------------
// CUSTOM LANGUAGE SELECT UI
// ----------------------------------------------------
const customLangSelect = document.getElementById("custom-lang-select");
const hiddenLangInput = document.getElementById("settings-language");

function setCustomLangSelect(value) {
  if (!customLangSelect) return;
  
  const options = customLangSelect.querySelectorAll(".custom-option");
  const triggerText = customLangSelect.querySelector(".selected-option-text");
  
  options.forEach(opt => {
    if (opt.dataset.value === value) {
      opt.classList.add("selected");
      if (triggerText) {
        const flag = opt.querySelector(".flag-icon")?.outerHTML || "";
        const label = opt.querySelector("span:not(.flag-icon)")?.textContent || "";
        triggerText.innerHTML = `${flag} ${label}`;
      }
    } else {
      opt.classList.remove("selected");
    }
  });

  if (hiddenLangInput) {
    hiddenLangInput.value = value;
  }
}

if (customLangSelect) {
  const trigger = customLangSelect.querySelector(".custom-select-trigger");
  const options = customLangSelect.querySelectorAll(".custom-option");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    customLangSelect.classList.toggle("open");
  });

  options.forEach((opt) => {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      const val = opt.dataset.value;
      
      setCustomLangSelect(val);
      customLangSelect.classList.remove("open");
      updateUILanguage(val);
    });
  });

  document.addEventListener("click", (e) => {
    if (!customLangSelect.contains(e.target)) {
      customLangSelect.classList.remove("open");
    }
  });
}

// ----------------------------------------------------
// SETTINGS FORM & PROFILE PICTURE UPDATE
// ----------------------------------------------------
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const settingsForm = document.getElementById("settings-form");

const settingsUsername = document.getElementById("settings-username");
const settingsDisplayName = document.getElementById("settings-displayname");

if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    const currentLang = localStorage.getItem("nebula_language") || "en";
    setCustomLangSelect(currentLang);

    if (currentAccountId) {
      const userData = loadUserData(currentAccountId);
      if (settingsUsername) settingsUsername.value = currentAccountId;
      if (settingsDisplayName) settingsDisplayName.value = userData.displayName;
    }

    settingsModal.classList.remove("hidden");
  });
}

const closeSettingsModal = () => {
  if (settingsModal) settingsModal.classList.add("hidden");
  if (customLangSelect) customLangSelect.classList.remove("open");
};

if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsModal);
if (settingsModal) {
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });
}

if (settingsForm) {
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    
    const language = hiddenLangInput ? hiddenLangInput.value : "en";
    const displayName = settingsDisplayName ? settingsDisplayName.value.trim() : "";
    
    const pfpFileInput = document.getElementById("settings-pfp-input");
    const pfpUrlInput = document.getElementById("settings-pfp-url"); 

    localStorage.setItem("nebula_language", language);
    updateUILanguage(language);

    if (currentAccountId) {
      const activeDisplayName = displayName || currentAccountId;

      const applyAndSave = (pfpUrl) => {
        saveUserData(currentAccountId, activeDisplayName, pfpUrl);
        renderUserProfile(activeDisplayName, pfpUrl);
        closeSettingsModal();
      };

      if (pfpFileInput && pfpFileInput.files && pfpFileInput.files[0]) {
        const file = pfpFileInput.files[0];
        const reader = new FileReader();

        reader.onload = function (event) {
          const newPfpUrl = event.target.result;
          applyAndSave(newPfpUrl);
        };

        reader.readAsDataURL(file);
      } 
      else if (pfpUrlInput && pfpUrlInput.value.trim() !== "") {
        const directUrl = pfpUrlInput.value.trim();
        applyAndSave(directUrl);
      } 
      else {
        const currentPfp = localStorage.getItem(`nebula_pfp_${currentAccountId}`);
        applyAndSave(currentPfp);
      }
    } else {
      closeSettingsModal();
    }
  });
}

// ----------------------------------------------------
// HELPER: COMPRESS IMAGE & STRIP THINK BLOCKS
// ----------------------------------------------------
function fileToBase64(file, maxWidth = 1024, maxHeight = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedBase64);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removeThinkingBlocks(text) {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  clean = clean.replace(/<think>[\s\S]*/gi, "");
  clean = clean.replace(/<t?h?i?n?k?$/gi, "");
  return clean.trim();
}

// ----------------------------------------------------
// UI GENERATION STATE TOGGLE (Option 2: Pure CSS Logic)
// ----------------------------------------------------
function setGeneratingState(isGenerating) {
  if (isGenerating) {
    userInput.disabled = true;
    userInput.blur();
    sendBtn.disabled = false;
    sendBtn.classList.add("is-generating");
    sendBtn.title = "Stop generating";
  } else {
    userInput.disabled = false;
    userInput.focus();
    sendBtn.classList.remove("is-generating");
    sendBtn.title = "Send Message";
    sendBtn.disabled = userInput.value.trim() === "";
  }
}

function saveCurrentChat() {
  if (!currentAccountId) return;

  if (!currentChatId && conversationHistory.length >= 2) {
    const firstUserMsg =
      conversationHistory.find(m => m.role === "user");

    let chatTitle = "New Chat";

    if (firstUserMsg) {
      if (typeof firstUserMsg.content === "string") {
        chatTitle = firstUserMsg.content;
      } else if (Array.isArray(firstUserMsg.content)) {
        const textObj =
          firstUserMsg.content.find(c => c.type === "text");

        chatTitle = textObj
          ? textObj.text
          : "Image Analysis Chat";
      }
    }

    currentChatId = "chat_" + Date.now();

    allSavedChats.push({
      id: currentChatId,
      title: chatTitle,
      history: [...conversationHistory]
    });

    if (historyList) {
      const li = createHistoryListItem(
        currentChatId,
        chatTitle
      );

      li.classList.add("active");
      historyList.appendChild(li);
    }
  } else if (currentChatId) {
    const currentChatObj =
      allSavedChats.find(c => c.id === currentChatId);

    if (currentChatObj) {
      currentChatObj.history = [...conversationHistory];
    }
  }

  saveUserChats();
}

// ----------------------------------------------------
// CHAT MESSAGING LOGIC
// ----------------------------------------------------
async function sendMessage() {
  const prompt = userInput.value.trim();

  if (!prompt && attachedFiles.length === 0) return;

  if (welcomeScreen) {
    welcomeScreen.style.display = "none";
  }

  // Check model usage
  if (typeof window.consumeModelUsage === "function") {
    const allowed = window.consumeModelUsage(currentModel);

    if (!allowed) {
      alert(
        `Limit reached for ${currentModel.toUpperCase()}. Defaulting to Mini-X.`
      );

      selectModel("mini-x");
      return;
    }
  }

  // IMPORTANT:
  // Freeze the model BEFORE doing async work.
  const activeModel = currentModel;

  const currentFiles = [...attachedFiles];

  // Show user's message immediately
  appendMessage("user", prompt, currentFiles);

  // ----------------------------------------------------
  // BUILD USER CONTENT
  // ----------------------------------------------------

  const userContent = [];

  for (const file of currentFiles) {
    if (file.type.startsWith("image/")) {
      try {
        const base64Image = await fileToBase64(file);

        userContent.push({
          type: "image_url",
          image_url: {
            url: base64Image
          }
        });
      } catch (error) {
        console.error("Image conversion failed:", error);

        const aiBubble = appendMessage(
          "nebula",
          "I couldn't process that image."
        );

        return;
      }
    }
  }

  if (prompt) {
    userContent.push({
      type: "text",
      text: prompt
    });
  }

  // If only text was sent, keep normal string format.
  // If an image is included, KEEP THE ARRAY.
  const apiPayload =
    userContent.length === 1 &&
    userContent[0].type === "text"
      ? userContent[0].text
      : userContent;

  conversationHistory.push({
    role: "user",
    content: apiPayload
  });

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";
  clearAttachedFiles();

  // Start generation
  currentAbortController = new AbortController();
  setGeneratingState(true);

  const aiBubble = appendMessage("nebula", "");

  // ----------------------------------------------------
  // CHECK WHETHER THIS CONVERSATION CONTAINS AN IMAGE
  // ----------------------------------------------------

  const hasImage = conversationHistory.some(msg => {
    if (!Array.isArray(msg.content)) return false;

    return msg.content.some(
      part => part && part.type === "image_url"
    );
  });

  try {
    // ----------------------------------------------------
    // IMPORTANT:
    // DO NOT STRIP IMAGE CONTENT.
    // ----------------------------------------------------

    const apiMessages = [
      {
        role: "system",
        content:
          "You are Nebula, a helpful AI assistant capable of analyzing text and images directly. Answer accurately and be friendly. Use emojis when appropriate."
      },
      ...conversationHistory
    ];

    // ----------------------------------------------------
    // SEND TO NEBULA BACKEND
    // ----------------------------------------------------

    const response = await fetch(
      "https://nebula-backend.vercel.app/api/chat",
      {
        method: "POST",
        signal: currentAbortController.signal,

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          messages: apiMessages,

          // Normal model when text only.
          // "vision" tells backend to use an image-capable model.
          model: hasImage ? "vision" : activeModel
        })
      }
    );

    // ----------------------------------------------------
    // ERROR HANDLING
    // ----------------------------------------------------

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));

      throw new Error(
        errData.error?.message ||
        errData.error ||
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error("Backend returned an empty response.");
    }

    // ----------------------------------------------------
    // STREAM RESPONSE
    // ----------------------------------------------------

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let assistantText = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      const lines = buffer.split("\n");

      // Keep incomplete line for next chunk
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) continue;

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const dataLine = trimmed.slice(5).trim();

        if (dataLine === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(dataLine);

          const token =
            parsed.choices?.[0]?.delta?.content || "";

          if (!token) continue;

          assistantText += token;

          const visibleText =
            removeThinkingBlocks(assistantText);

          renderFormattedText(
            aiBubble,
            visibleText
          );

          messagesList.scrollTop =
            messagesList.scrollHeight;

          // Your requested typing speed
          if (TYPING_SPEED_MS > 0) {
            await new Promise(resolve =>
              setTimeout(
                resolve,
                TYPING_SPEED_MS
              )
            );
          }

        } catch (parseError) {
          console.warn(
            "Stream parsing error:",
            parseError,
            dataLine
          );
        }
      }
    }

    // Process anything left in the buffer
    if (buffer.trim().startsWith("data:")) {
      const dataLine = buffer
        .trim()
        .slice(5)
        .trim();

      if (
        dataLine &&
        dataLine !== "[DONE]"
      ) {
        try {
          const parsed = JSON.parse(dataLine);

          const token =
            parsed.choices?.[0]?.delta?.content || "";

          if (token) {
            assistantText += token;
          }
        } catch (error) {
          console.warn(
            "Final stream parse error:",
            error
          );
        }
      }
    }

    // ----------------------------------------------------
    // FINAL RESPONSE
    // ----------------------------------------------------

    const finalText =
      removeThinkingBlocks(assistantText);

    if (!finalText) {
      aiBubble.textContent =
        "I'm sorry, I couldn't generate a response. Please try again.";
    } else {
      renderFormattedText(
        aiBubble,
        finalText
      );

      conversationHistory.push({
        role: "assistant",
        content: finalText
      });
    }

    // ----------------------------------------------------
    // SAVE CHAT
    // ----------------------------------------------------

    if (
      !currentChatId &&
      conversationHistory.length >= 2
    ) {
      const firstUserMsg =
        conversationHistory.find(
          msg => msg.role === "user"
        );

      let chatTitle = "New Chat";

      if (firstUserMsg) {
        if (
          typeof firstUserMsg.content === "string"
        ) {
          chatTitle =
            firstUserMsg.content;
        } else if (
          Array.isArray(firstUserMsg.content)
        ) {
          const textObj =
            firstUserMsg.content.find(
              part => part.type === "text"
            );

          chatTitle = textObj
            ? textObj.text
            : "Image Analysis Chat";
        }
      }

      currentChatId =
        "chat_" + Date.now();

      allSavedChats.push({
        id: currentChatId,
        title: chatTitle,
        history: [...conversationHistory]
      });

      if (historyList) {
        const li =
          createHistoryListItem(
            currentChatId,
            chatTitle
          );

        li.classList.add("active");

        historyList.appendChild(li);
      }

    } else if (currentChatId) {

      const currentChatObj =
        allSavedChats.find(
          chat =>
            chat.id === currentChatId
        );

      if (currentChatObj) {
        currentChatObj.history =
          [...conversationHistory];
      }
    }

    saveUserChats();

  } catch (err) {

    if (err.name === "AbortError") {

      const stoppedText =
        removeThinkingBlocks(
          aiBubble.textContent || ""
        );

      if (stoppedText) {
        conversationHistory.push({
          role: "assistant",
          content: stoppedText
        });
      }

    } else {

      console.error(
        "API Request Error:",
        err
      );

      aiBubble.textContent =
        `Error: ${err.message}`;
    }

  } finally {

    currentAbortController = null;

    setGeneratingState(false);
  }
}

function appendMessage(sender, text, files = []) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}-row`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  
  if (sender === "user") {
    const userData = loadUserData(currentAccountId);
    if (userData.pfpUrl) {
      avatar.innerHTML = `<img src="${userData.pfpUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"/>`;
    } else {
      avatar.textContent = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : "ME";
    }
  } else {
  avatar.innerHTML = `<img src="./logo1.jpg" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (sender === "user" && files && files.length > 0) {
    const mediaContainer = document.createElement("div");
    mediaContainer.className = "attached-media-grid";

    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "chat-attached-image";
        img.src = URL.createObjectURL(file);
        mediaContainer.appendChild(img);
      } else if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.className = "chat-attached-video";
        video.controls = true;
        video.src = URL.createObjectURL(file);
        mediaContainer.appendChild(video);
      } else {
        const fileCard = document.createElement("div");
        fileCard.className = "chat-attached-file";
        fileCard.innerHTML = `📄 <span>${file.name}</span>`;
        mediaContainer.appendChild(fileCard);
      }
    });

    bubble.appendChild(mediaContainer);
  }

  if (text) {
    if (sender === "user") {
      if (files && files.length > 0) {
        const textNode = document.createElement("p");
        textNode.textContent = text;
        textNode.style.margin = "0";
        bubble.appendChild(textNode);
      } else {
        bubble.textContent = text;
      }
    } else {
      renderFormattedText(bubble, text);
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesList.appendChild(row);

  messagesList.scrollTop = messagesList.scrollHeight;
  return bubble;
}

// Helper to parse basic markdown (bold, italic, inline code) safely
function parseMarkdown(text) {
  // Escapes HTML entities to prevent XSS injection
  let safeText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return safeText
    // Bold: **text** or __text__
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.*?)__/g, "<strong>$1</strong>")
    // Italic: *text* or _text_
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/_(.*?)_/g, "<em>$1</em>")
    // Inline Code: `text`
    .replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>")
    // Newlines to line breaks
    .replace(/\n/g, "<br>");
}

function renderFormattedText(container, text) {
  container.innerHTML = "";

  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Render text before code block with markdown parsing
    if (match.index > lastIndex) {
      const textChunk = text.slice(lastIndex, match.index);
      const textNode = document.createElement("span");
      textNode.innerHTML = parseMarkdown(textChunk);
      container.appendChild(textNode);
    }

    const rawLanguage = match[1].trim() || "code";
    const codeContent = match[2];

    let highlightLang = rawLanguage.toLowerCase();
    if (highlightLang === "luau") highlightLang = "lua";

    const codeBox = document.createElement("div");
    codeBox.className = "code-box";

    const header = document.createElement("div");
    header.className = "code-box-header";

    const langLabel = document.createElement("span");
    langLabel.className = "code-lang";
    langLabel.textContent = rawLanguage.toUpperCase();

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(codeContent);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
    };

    header.appendChild(langLabel);
    header.appendChild(copyBtn);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = `language-${highlightLang}`;
    code.textContent = codeContent;

    pre.appendChild(code);
    codeBox.appendChild(header);
    codeBox.appendChild(pre);
    container.appendChild(codeBox);

    if (window.hljs) {
      window.hljs.highlightElement(code);
    }

    lastIndex = codeBlockRegex.lastIndex;

    if (match.index === codeBlockRegex.lastIndex) {
      codeBlockRegex.lastIndex++;
    }
  }

  // Render remaining text after last code block
  if (lastIndex < text.length) {
    const remainingTextNode = document.createElement("span");
    remainingTextNode.innerHTML = parseMarkdown(text.slice(lastIndex));
    container.appendChild(remainingTextNode);
  }
}

// ----------------------------------------------------
// SIDEBAR CHAT HISTORY MANAGEMENT
// ----------------------------------------------------
function createHistoryListItem(id, title) {
  const li = document.createElement("li");
  li.dataset.chatId = id;
  
  li.innerHTML = `
    <div class="chat-item-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <span class="title-text">${title.length > 15 ? title.substring(0, 15) + "..." : title}</span>
    </div>
    <div class="chat-actions">
      <button class="chat-action-btn rename-btn" title="Rename Chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
      </button>
      <button class="chat-action-btn delete-btn" title="Delete Chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>
  `;
  
  return li;
}

if (newChatBtn) {
  newChatBtn.addEventListener("click", () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    if (conversationHistory.length >= 1 && !currentChatId) {
      const firstUserMsg = conversationHistory.find((msg) => msg.role === "user");
      let chatTitle = "New Chat";
      if (firstUserMsg) {
        if (typeof firstUserMsg.content === "string") {
          chatTitle = firstUserMsg.content;
        } else if (Array.isArray(firstUserMsg.content)) {
          const textObj = firstUserMsg.content.find(c => c.type === "text");
          chatTitle = textObj ? textObj.text : "Image Analysis Chat";
        }
      }
      
      const newId = "chat_" + Date.now();
      allSavedChats.push({
        id: newId,
        title: chatTitle,
        history: [...conversationHistory]
      });

      const li = createHistoryListItem(newId, chatTitle);
      historyList.appendChild(li);
      saveUserChats();
    }

    const activeLi = historyList.querySelector("li.active");
    if (activeLi) activeLi.classList.remove("active");

    messagesList.innerHTML = "";
    conversationHistory = [];
    currentChatId = null;
    if (welcomeScreen) welcomeScreen.style.display = "flex";
    userInput.focus();
  });
}

if (historyList) {
  historyList.addEventListener("click", (e) => {
    const targetLi = e.target.closest("li");
    if (!targetLi) return;

    const chatId = targetLi.dataset.chatId;

    const deleteBtn = e.target.closest(".delete-btn");
    if (deleteBtn) {
      e.stopPropagation();
      
      allSavedChats = allSavedChats.filter(c => c.id !== chatId);
      targetLi.remove();
      saveUserChats();

      if (currentChatId === chatId) {
        messagesList.innerHTML = "";
        conversationHistory = [];
        currentChatId = null;
        if (welcomeScreen) welcomeScreen.style.display = "flex";
      }
      return;
    }

    const renameBtn = e.target.closest(".rename-btn");
    if (renameBtn) {
      e.stopPropagation();
      
      const titleContainer = targetLi.querySelector(".chat-item-title");
      const titleTextSpan = titleContainer.querySelector(".title-text");
      const currentTitle = titleTextSpan ? titleTextSpan.textContent : "New Chat";

      const input = document.createElement("input");
      input.type = "text";
      input.value = currentTitle;
      input.className = "rename-input";

      titleContainer.innerHTML = "";
      titleContainer.appendChild(input);
      input.focus();

      const saveRename = () => {
        const newTitle = input.value.trim() || currentTitle;
        
        const chatObj = allSavedChats.find(c => c.id === chatId);
        if (chatObj) {
          chatObj.title = newTitle;
          saveUserChats();
        }

        titleContainer.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span class="title-text">${newTitle.length > 15 ? newTitle.substring(0, 15) + "..." : newTitle}</span>
        `;
      };

      input.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") saveRename();
      });

      input.addEventListener("blur", saveRename);
      return;
    }

    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    const activeLi = historyList.querySelector("li.active");
    if (activeLi) activeLi.classList.remove("active");
    targetLi.classList.add("active");

    messagesList.innerHTML = "";
    if (welcomeScreen) welcomeScreen.style.display = "none";

    if (!chatId) {
      conversationHistory = [];
      currentChatId = null;
      if (welcomeScreen) welcomeScreen.style.display = "flex";
    } else {
      const targetChat = allSavedChats.find(c => c.id === chatId);
      if (targetChat) {
        conversationHistory = [...targetChat.history];
        currentChatId = chatId;

        targetChat.history.forEach(msg => {
          const bubble = appendMessage(msg.role === "user" ? "user" : "nebula", "");
          if (msg.role === "user") {
            if (typeof msg.content === "string") {
              bubble.textContent = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textObj = msg.content.find(c => c.type === "text");
              if (textObj) bubble.textContent = textObj.text;
            }
          } else {
            renderFormattedText(bubble, msg.content);
          }
        });
      }
    }
  });
}

function getRegisteredUsernames() {
  const data = localStorage.getItem("nebula_registered_usernames");
  return data ? JSON.parse(data) : [];
}

function registerUsername(username) {
  const registered = getRegisteredUsernames();
  const cleanUsername = username.toLowerCase().trim();
  if (!registered.includes(cleanUsername)) {
    registered.push(cleanUsername);
    localStorage.setItem("nebula_registered_usernames", JSON.stringify(registered));
  }
}

function isUsernameTaken(username) {
  const registered = getRegisteredUsernames();
  return registered.includes(username.toLowerCase().trim());
}

// ==========================================================================
// PLUS ACTION MENU LOGIC
// ==========================================================================

document.addEventListener('click', (e) => {
  const actionDropdown = document.getElementById('action-dropdown');
  const actionTrigger = e.target.closest('#action-trigger');

  if (actionTrigger && actionDropdown) {
    e.stopPropagation();
    actionDropdown.classList.toggle('open');
    return;
  }

  if (actionDropdown && !actionDropdown.contains(e.target)) {
    actionDropdown.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const closeActionMenu = () => {
    const actionDropdown = document.getElementById('action-dropdown');
    if (actionDropdown) actionDropdown.classList.remove('open');
  };

  document.getElementById('opt-upload-file')?.addEventListener('click', () => {
    closeActionMenu();
    document.getElementById('file-input-document')?.click();
  });

  document.getElementById('opt-upload-photos')?.addEventListener('click', () => {
    closeActionMenu();
    document.getElementById('file-input-photo')?.click();
  });

  document.getElementById('opt-upload-videos')?.addEventListener('click', () => {
    closeActionMenu();
    document.getElementById('file-input-video')?.click();
  });

  document.getElementById('opt-take-photo')?.addEventListener('click', () => {
    closeActionMenu();
    document.getElementById('camera-input-photo')?.click();
  });

  document.getElementById('opt-take-video')?.addEventListener('click', () => {
    closeActionMenu();
    document.getElementById('camera-input-video')?.click();
  });
});

// ==========================================================================
// FILE ATTACHMENT & PREVIEW SYSTEM
// ==========================================================================

let attachedFiles = [];

function handleFileSelection(files) {
  const container = document.getElementById('file-previews');
  if (!container) return;

  Array.from(files).forEach((file) => {
    attachedFiles.push(file);

    const chip = document.createElement('div');
    chip.className = 'file-chip';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'file-chip-thumbnail';
      img.src = URL.createObjectURL(file);
      chip.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.innerHTML = '📎';
      chip.appendChild(icon);
    }

    const nameLabel = document.createElement('span');
    nameLabel.className = 'file-chip-name';
    nameLabel.textContent = file.name;
    chip.appendChild(nameLabel);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-chip-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = () => {
      attachedFiles = attachedFiles.filter((f) => f !== file);
      chip.remove();
      if (attachedFiles.length === 0) {
        container.classList.add('hidden');
      }
    };
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });

  if (attachedFiles.length > 0) {
    container.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInputIds = [
    'file-input-document',
    'file-input-photo',
    'file-input-video',
    'camera-input-photo',
    'camera-input-video'
  ];

  fileInputIds.forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFileSelection(e.target.files);
          e.target.value = '';
        }
      });
    }
  });
});

function clearAttachedFiles() {
  attachedFiles = [];
  const container = document.getElementById('file-previews');
  if (container) {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}
