
import { auth, db, storage, rtdb } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where,
  orderBy, onSnapshot, serverTimestamp, limit,
  runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

import {
  ref as dbRef,
  set,
  onValue,
  onDisconnect,
  remove,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

// ======================================================
// CONFIG
// ======================================================

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const $ = id => document.getElementById(id);
const exists = id => Boolean($(id));

const THEMES = ["neon", "dark", "light", "purple"];

let currentUser = null;
let currentProfile = null;
let activeChat = null;
let activeChatType = "private";

let unsubscribers = [];
let messageUnsubscribe = null;
let appListenersStarted = false;
let toastTimer = null;
let searchTimer = null;
let typingTimer = null;
let presenceUnsubscribe = null;
let typingUnsubscribe = null;
let firstMessageSnapshot = true;
let lastNotificationTime = 0;
let registrationInProgress = false;

const presenceCache = new Map();

// ======================================================
// HELPERS
// ======================================================

function on(id, event, callback) {
  if (exists(id)) {
    $(id).addEventListener(event, callback);
  }
}

function setText(id, value) {
  if (exists(id)) {
    $(id).textContent = value ?? "";
  }
}

function setHidden(id, hidden) {
  if (exists(id)) {
    $(id).hidden = hidden;
  }
}

function safeElement(tag, className = "", text) {
  const el = document.createElement(tag);

  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;

  return el;
}

function isAdmin() {
  return currentUser?.uid === ADMIN_UID;
}

function errorMessage(error) {
  console.error(error);

  const messages = {
    "auth/email-already-in-use": "Email sudah terdaftar.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Password minimal 8 karakter.",
    "auth/user-disabled": "Akun dinonaktifkan.",
    "auth/too-many-requests": "Terlalu banyak percobaan.",
    "auth/network-request-failed": "Koneksi internet bermasalah.",
    "permission-denied": "Akses ditolak. Periksa Firebase Rules.",
    "storage/unauthorized": "Akses foto ditolak. Periksa Storage Rules.",
    "unavailable": "Layanan sedang tidak tersedia."
  };

  return messages[error?.code] ||
    error?.message ||
    "Terjadi kesalahan.";
}

function formatTime(value) {
  const date = value?.toDate
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;

  if (!date) return "";

  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatLastSeen(timestamp) {
  if (!timestamp) return "Terakhir dilihat belum diketahui";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Terakhir dilihat belum diketahui";
  }

  return `Terakhir dilihat pukul ${date.toLocaleTimeString(
    "id-ID",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  )}`;
}

function timestampMillis(value) {
  return value?.toMillis?.() || 0;
}

// ======================================================
// TOAST
// ======================================================

function toast(message) {
  const el = $("toast");

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3200);
}

// ======================================================
// CUSTOM DIALOG
// ======================================================

function zoraDialog({
  title = "Konfirmasi",
  message = "",
  confirmText = "Lanjutkan",
  cancelText = "Batal",
  danger = false,
  input = false,
  placeholder = "",
  defaultValue = "",
  multiline = false
} = {}) {
  return new Promise(resolve => {
    const overlay = safeElement("div", "zora-dialog-overlay");
    const card = safeElement("div", "zora-dialog-card");

    card.append(
      safeElement("div", "zora-dialog-kicker", "ZORAAPP / SYSTEM"),
      safeElement("h2", "", title),
      safeElement("p", "", message)
    );

    let field = null;

    if (input) {
      field = document.createElement(
        multiline ? "textarea" : "input"
      );

      field.className = "zora-dialog-input";
      field.placeholder = placeholder;
      field.value = defaultValue;
      field.maxLength = multiline ? 500 : 100;

      if (multiline) {
        field.rows = 4;
      } else {
        field.type = "text";
      }

      card.append(field);
    }

    const actions = safeElement("div", "zora-dialog-actions");

    const cancel = safeElement(
      "button",
      "zora-dialog-cancel",
      cancelText
    );

    const confirm = safeElement(
      "button",
      `zora-dialog-confirm${danger ? " danger" : ""}`,
      confirmText
    );

    cancel.type = confirm.type = "button";

    actions.append(cancel, confirm);
    card.append(actions);
    overlay.append(card);
    document.body.append(overlay);

    let finished = false;

    function close(value) {
      if (finished) return;

      finished = true;
      overlay.remove();
      document.removeEventListener("keydown", keyHandler);
      resolve(value);
    }

    function keyHandler(event) {
      if (event.key === "Escape") close(null);

      if (
        event.key === "Enter" &&
        input &&
        !multiline &&
        document.activeElement === field
      ) {
        event.preventDefault();
        confirm.click();
      }
    }

    cancel.onclick = () => close(null);

    confirm.onclick = () => {
      if (!input) {
        close(true);
        return;
      }

      const value = field.value.trim();

      if (!value) {
        field.focus();
        return;
      }

      close(value);
    };

    overlay.onclick = event => {
      if (event.target === overlay) close(null);
    };

    document.addEventListener("keydown", keyHandler);

    setTimeout(() => {
      (field || confirm).focus();
    }, 80);
  });
}

async function zoraConfirm(message, options = {}) {
  return (await zoraDialog({
    title: options.title || "Konfirmasi tindakan",
    message,
    confirmText: options.confirmText || "Ya, lanjutkan",
    danger: Boolean(options.danger)
  })) === true;
}

async function zoraPrompt(title, message, placeholder = "") {
  return zoraDialog({
    title,
    message,
    input: true,
    placeholder,
    confirmText: "Simpan"
  });
}

// ======================================================
// VERIFIED BADGE
// ======================================================

function createVerifiedBadge() {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "verified-badge");
  svg.setAttribute("aria-label", "Akun terverifikasi");

  const badge = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );

  badge.setAttribute(
    "d",
    "M12 1.5 14.4 3l3-.1 1.2 2.7 2.7 1.2-.1 3L22.5 12l-1.3 2.4.1 3-2.7 1.2-1.2 2.7-3-.1L12 22.5l-2.4-1.3-3 .1-1.2-2.7-2.7-1.2.1-3L1.5 12l1.3-2.4-.1-3 2.7-1.2 1.2-2.7 3 .1z"
  );

  badge.setAttribute("fill", "#2589f5");

  const check = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );

  check.setAttribute("d", "m7.5 12.2 3 3 6.2-6.4");
  check.setAttribute("fill", "none");
  check.setAttribute("stroke", "#fff");
  check.setAttribute("stroke-width", "2.1");
  check.setAttribute("stroke-linecap", "round");
  check.setAttribute("stroke-linejoin", "round");

  svg.append(badge, check);

  return svg;
}

function renderVerifiedName(element, name, verified = false) {
  if (typeof element === "string") {
    element = $(element);
  }

  if (!element) return;

  element.replaceChildren(
    document.createTextNode(name || "Pengguna")
  );

  if (verified) {
    element.append(createVerifiedBadge());
  }
}

function createNameElement(name, verified = false) {
  const element = safeElement("strong");

  renderVerifiedName(element, name, verified);

  return element;
}

// ======================================================
// AVATAR
// ======================================================

function renderAvatarInto(element, photoURL, name = "Z") {
  element.replaceChildren();

  if (!photoURL) {
    element.textContent = (name || "Z")[0].toUpperCase();
    return;
  }

  const image = document.createElement("img");

  image.src = photoURL;
  image.alt = "Foto profil";
  image.className = "avatar-photo";

  image.onerror = () => {
    element.textContent = (name || "Z")[0].toUpperCase();
  };

  element.append(image);
}

function renderAvatar(id, photoURL, name = "Z") {
  const element = $(id);

  if (element) {
    renderAvatarInto(element, photoURL, name);
  }
}

// ======================================================
// THEME
// ======================================================

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "dark";

  document.body.classList.remove(
    "dark",
    "theme-neon",
    "theme-dark",
    "theme-light",
    "theme-purple"
  );

  document.body.classList.add(`theme-${theme}`);

  if (theme === "dark") {
    document.body.classList.add("dark");
  }

  localStorage.setItem("zora-theme", theme);

  setText("themeBtn", theme.toUpperCase());
  setText("settingsThemeBtn", `TEMA: ${theme.toUpperCase()}`);
}

function cycleTheme() {
  const current = localStorage.getItem("zora-theme") || "dark";
  const index = THEMES.indexOf(current);

  const next = THEMES[(index + 1) % THEMES.length];

  applyTheme(next);
  toast(`TEMA ${next.toUpperCase()} AKTIF`);
}

on("themeBtn", "click", cycleTheme);
on("settingsThemeBtn", "click", cycleTheme);

applyTheme(localStorage.getItem("zora-theme") || "dark");

// ======================================================
// USERNAME
// ======================================================

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

async function claimUsername(username, uid, oldUsername = "") {
  const normalized = normalizeUsername(username);
  const oldNormalized = normalizeUsername(oldUsername);

  if (!validUsername(normalized)) {
    throw new Error("Username harus 3–20 karakter.");
  }

  await runTransaction(db, async transaction => {
    const newRef = doc(db, "usernames", normalized);
    const newSnap = await transaction.get(newRef);

    if (newSnap.exists() && newSnap.data().uid !== uid) {
      throw new Error("Username sudah digunakan.");
    }

    let oldRef;
    let oldSnap;

    if (oldNormalized && oldNormalized !== normalized) {
      oldRef = doc(db, "usernames", oldNormalized);
      oldSnap = await transaction.get(oldRef);
    }

    if (oldSnap?.exists() && oldSnap.data().uid === uid) {
      transaction.delete(oldRef);
    }

    transaction.set(newRef, {
      uid,
      username: normalized,
      updatedAt: serverTimestamp()
    });
  });

  return normalized;
}

// ======================================================
// CLEANUP
// ======================================================

function stopMessageListener() {
  if (messageUnsubscribe) {
    messageUnsubscribe();
    messageUnsubscribe = null;
  }
}

function stopTypingListener() {
  if (typingUnsubscribe) {
    typingUnsubscribe();
    typingUnsubscribe = null;
  }
}

function stopPresenceListener() {
  if (presenceUnsubscribe) {
    presenceUnsubscribe();
    presenceUnsubscribe = null;
  }
}

function cleanup() {
  unsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  unsubscribers = [];

  stopMessageListener();
  stopTypingListener();
  stopPresenceListener();

  activeChat = null;
  appListenersStarted = false;
}

// ======================================================
// PRESENCE: ONLINE / OFFLINE
// ======================================================

async function setupPresence() {
  if (!currentUser) return;

  const connectedRef = dbRef(rtdb, ".info/connected");
  const statusRef = dbRef(rtdb, `status/${currentUser.uid}`);

  presenceUnsubscribe = onValue(
    connectedRef,
    async snapshot => {
      if (snapshot.val() !== true) return;

      try {
        await onDisconnect(statusRef).set({
          state: "offline",
          last_changed: rtdbTimestamp()
        });

        await set(statusRef, {
          state: "online",
          last_changed: rtdbTimestamp()
        });
      } catch (error) {
        console.warn("Presence error:", error);
      }
    }
  );
}

async function setOffline() {
  if (!currentUser) return;

  try {
    await set(
      dbRef(rtdb, `status/${currentUser.uid}`),
      {
        state: "offline",
        last_changed: rtdbTimestamp()
      }
    );
  } catch (error) {
    console.warn(error);
  }
}

function listenPresence(uid, callback) {
  const statusRef = dbRef(rtdb, `status/${uid}`);

  return onValue(
    statusRef,
    snapshot => {
      const data = snapshot.val();

      presenceCache.set(uid, data || null);

      callback(data || null);
    },
    error => {
      console.warn("Presence listener:", error);
      callback(null);
    }
  );
}

// ======================================================
// TYPING INDICATOR
// ======================================================

function typingPath() {
  if (!activeChat || !currentUser) return null;

  return `typing/${activeChatType}_${activeChat.id}/${currentUser.uid}`;
}

async function updateTyping(isTyping) {
  const path = typingPath();

  if (!path) return;

  try {
    const typingRef = dbRef(rtdb, path);

    if (isTyping) {
      await set(typingRef, {
        typing: true,
        name: currentProfile?.name || "Pengguna",
        updatedAt: rtdbTimestamp()
      });
    } else {
      await remove(typingRef);
    }
  } catch (error) {
    console.warn("Typing update:", error);
  }
}

function listenTyping() {
  stopTypingListener();

  if (!activeChat || !currentUser) return;

  const path = `typing/${activeChatType}_${activeChat.id}`;

  typingUnsubscribe = onValue(
    dbRef(rtdb, path),
    snapshot => {
      const users = snapshot.val() || {};

      const typingUsers = Object.entries(users)
        .filter(([uid, data]) => (
          uid !== currentUser.uid &&
          data?.typing === true &&
          Date.now() - Number(data.updatedAt || 0) < 12000
        ));

      let text = "";

      if (typingUsers.length === 1) {
        text = `${typingUsers[0][1].name || "Pengguna"} sedang mengetik...`;
      } else if (typingUsers.length > 1) {
        text = "Beberapa orang sedang mengetik...";
      }

      setTypingIndicator(text);
    }
  );
}

function setTypingIndicator(text) {
  let element = $("typingIndicator");

  if (!element) {
    const panel = $("chatPanel");
    if (!panel) return;

    element = safeElement("div", "typing-indicator");
    element.id = "typingIndicator";

    const messages = $("messages");

    if (messages) {
      messages.before(element);
    } else {
      panel.append(element);
    }
  }

  element.textContent = text || "";
  element.hidden = !text;
}

on("messageInput", "input", () => {
  if (!activeChat || activeChatType === "channel") return;

  updateTyping(true);

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    updateTyping(false);
  }, 1800);
});

// ======================================================
// AUTH
// ======================================================

on("loginBtn", "click", async () => {
  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

  setText("authError", "");

  if (!email || !password) {
    setText("authError", "Email dan password wajib diisi.");
    return;
  }

  $("loginBtn").disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setText("authError", errorMessage(error));
  } finally {
    $("loginBtn").disabled = false;
  }
});

on("forgotPassword", "click", async () => {
  const email = $("authEmail")?.value.trim();

  if (!email) {
    setText("authError", "Masukkan email terlebih dahulu.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password sudah dikirim.");
  } catch (error) {
    setText("authError", errorMessage(error));
  }
});

on("registerBtn", "click", async () => {
  const name = $("authName")?.value.trim();
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value;
  const username = normalizeUsername(
    $("registerUsername")?.value
  );

  setText("registerError", "");

  if (!name || !email || !password) {
    setText("registerError", "Semua kolom wajib diisi.");
    return;
  }

  if (name.length < 3 || password.length < 8) {
    setText(
      "registerError",
      "Nama minimal 3 karakter dan password minimal 8 karakter."
    );
    return;
  }

  if (!validUsername(username)) {
    setText("registerError", "Format username tidak valid.");
    return;
  }

  $("registerBtn").disabled = true;
  registrationInProgress = true;

  let credential = null;

  try {
    credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await claimUsername(username, credential.user.uid);

    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      name,
      username,
      usernameLower: username,
      email,
      bio: "",
      photoURL: "",
      verified: false,
      status: "active",
      createdAt: serverTimestamp()
    });

    await signOut(auth);

    $("authName").value = "";
    $("registerEmail").value = "";
    $("registerPassword").value = "";
    $("registerUsername").value = "";

    $("authEmail").value = email;

    setHidden("registerMode", true);
    setHidden("loginMode", false);

    toast("AKUN BERHASIL DIBUAT, SILAHKAN MASUK");
  } catch (error) {
    setText("registerError", errorMessage(error));
  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
});

// ======================================================
// PROFILE PHOTO
// ======================================================

function createProfilePhotoControls() {
  const modal = $("profileModal");

  if (!modal || exists("profilePhotoControls")) return;

  const controls = safeElement("div", "profile-photo-editor");
  controls.id = "profilePhotoControls";

  const preview = safeElement("div", "profile-photo-preview");
  preview.id = "profilePhotoPreview";

  const label = safeElement(
    "label",
    "photo-upload-button",
    "Ganti Foto Profil"
  );

  label.htmlFor = "profilePhotoInput";

  const input = document.createElement("input");

  input.type = "file";
  input.id = "profilePhotoInput";
  input.accept = "image/jpeg,image/png,image/webp";
  input.hidden = true;

  input.onchange = event => {
    const file = event.target.files?.[0];

    if (file) uploadProfilePhoto(file);
  };

  controls.append(
    preview,
    label,
    input,
    safeElement("small", "", "JPG, PNG, WEBP. Maksimal 5 MB.")
  );

  const card = modal.querySelector(".modal-card");

  (card || modal).prepend(controls);
}

async function uploadProfilePhoto(file) {
  if (!currentUser) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    toast("Format foto tidak didukung.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    toast("Ukuran foto maksimal 5 MB.");
    return;
  }

  const input = $("profilePhotoInput");

  if (input) input.disabled = true;

  try {
    const imageRef = ref(
      storage,
      `profilePhotos/${currentUser.uid}/avatar`
    );

    await uploadBytes(imageRef, file, {
      contentType: file.type
    });

    const photoURL = await getDownloadURL(imageRef);

    await updateDoc(doc(db, "users", currentUser.uid), {
      photoURL
    });

    currentProfile.photoURL = photoURL;

    renderAvatar(
      "profilePhotoPreview",
      photoURL,
      currentProfile.name
    );

    renderAvatar(
      "myAvatar",
      photoURL,
      currentProfile.name
    );

    toast("Foto profil diperbarui.");
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    if (input) {
      input.disabled = false;
      input.value = "";
    }
  }
}

// ======================================================
// AUTH STATE
// ======================================================

onAuthStateChanged(auth, user => {
  cleanup();

  currentUser = user;
  currentProfile = null;

  if (!user) {
    [
      "appScreen",
      "holdScreen",
      "recoveredScreen",
      "permanentScreen"
    ].forEach(id => setHidden(id, true));

    setHidden("authScreen", false);

    return;
  }

  setHidden("authScreen", true);

  const userRef = doc(db, "users", user.uid);

  const unsubscribe = onSnapshot(
    userRef,
    async snap => {
      if (!snap.exists()) {
        if (registrationInProgress) return;

        try {
          await setDoc(userRef, {
            uid: user.uid,
            name: user.email?.split("@")[0] || "Pengguna",
            email: user.email || "",
            username: "",
            bio: "",
            photoURL: "",
            verified: false,
            status: "active",
            createdAt: serverTimestamp()
          });
        } catch (error) {
          toast(errorMessage(error));
        }

        return;
      }

      currentProfile = snap.data();

      [
        "appScreen",
        "holdScreen",
        "recoveredScreen",
        "permanentScreen"
      ].forEach(id => setHidden(id, true));

      if (currentProfile.status === "permanent") {
        setHidden("permanentScreen", false);
        return;
      }

      if (currentProfile.status === "held") {
        setHidden("holdScreen", false);
        return;
      }

      if (currentProfile.status === "recovered") {
        setHidden("recoveredScreen", false);
        return;
      }

      if (currentProfile.status !== "active") {
        setHidden("holdScreen", false);
        return;
      }

      setHidden("appScreen", false);

      renderVerifiedName(
        "myName",
        currentProfile.name || "Pengguna",
        currentProfile.verified === true
      );

      setText("myEmail", user.email || "");

      renderAvatar(
        "myAvatar",
        currentProfile.photoURL,
        currentProfile.name
      );

      setHidden("openAdmin", !isAdmin());

      createProfilePhotoControls();

      renderAvatar(
        "profilePhotoPreview",
        currentProfile.photoURL,
        currentProfile.name
      );

      if (!appListenersStarted) {
        appListenersStarted = true;

        setupPresence();

        listenChats();
        listenStatuses();
        listenGroups();
        listenChannels();
      }
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
});

// ======================================================
// LOGOUT
// ======================================================

async function logout() {
  try {
    await setOffline();
    cleanup();
    await signOut(auth);
  } catch (error) {
    toast(errorMessage(error));
  }
}

[
  "logoutBtn",
  "logoutHold",
  "logoutRecovered",
  "newAccountBtn",
  "settingsLogoutBtn"
].forEach(id => on(id, "click", logout));

on("verifyAccountBtn", "click", async () => {
  if (
    !currentUser ||
    currentProfile?.status !== "recovered"
  ) return;

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      status: "active",
      verifiedAt: serverTimestamp()
    });

    toast("Akun berhasil dipulihkan.");
  } catch (error) {
    toast(errorMessage(error));
  }
});

// ======================================================
// NAVIGATION
// ======================================================

function openPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== pageId;
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });

  $("appScreen")?.classList.remove("chat-open");
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

on("backToChats", "click", () => {
  updateTyping(false);
  openPage("chatsPage");
});

// ======================================================
// CONVERSATION HEADER
// ======================================================

function createChatSecurityNotice() {
  const panel = $("chatPanel");

  if (!panel || exists("chatSecurityNotice")) return;

  const notice = safeElement("div", "chat-security-notice");
  notice.id = "chatSecurityNotice";

  const text = safeElement("div", "security-copy");

  text.append(
    safeElement("strong", "", "Privasi percakapan"),
    safeElement(
      "small",
      "",
      "Enkripsi end-to-end belum aktif. Jangan kirim informasi rahasia."
    )
  );

  notice.append(
    safeElement("span", "security-mark", "i"),
    text
  );

  const header = panel.querySelector(".conversation-header");

  if (header) header.after(notice);
  else panel.prepend(notice);
}

function showConversation(name, verified = false) {
  setHidden("emptyChat", true);
  setHidden("chatPanel", false);

  renderVerifiedName("chatName", name, verified);

  renderAvatar(
    "chatAvatar",
    activeChat?.photoURL,
    name
  );

  createChatSecurityNotice();

  if (window.innerWidth <= 800) {
    $("appScreen")?.classList.add("chat-open");
  }

  updateComposerAccess();
}

function updateComposerAccess() {
  const composer = $("messageInput");
  const send = $("sendBtn");
  const image = $("imageInput");

  if (!composer || !send) return;

  const isChannel = activeChatType === "channel";

  const canPost = !isChannel ||
    isAdmin() ||
    activeChat?.owner === currentUser?.uid;

  composer.hidden = !canPost;
  send.hidden = !canPost;

  if (image) {
    image.hidden = !canPost;
  }

  if (isChannel && !canPost) {
    composer.value = "";
  }

  composer.placeholder = isChannel
    ? "Tulis postingan saluran..."
    : "Ketik pesan...";
}

// ======================================================
// PRIVATE CHAT
// ======================================================

function privateChatId(a, b) {
  return [a, b].sort().join("_");
}

async function findExistingPrivateChat(otherUid) {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const snap = await getDocs(q);

  const matches = snap.docs.filter(item => {
    const members = item.data().members || [];

    return members.length === 2 &&
      members.includes(otherUid);
  });

  if (!matches.length) return null;

  matches.sort((a, b) =>
    timestampMillis(b.data().updatedAt) -
    timestampMillis(a.data().updatedAt)
  );

  return matches[0];
}

async function openPrivateChat(other) {
  if (!currentUser || !other?.uid) return;

  try {
    const existing = await findExistingPrivateChat(other.uid);

    const id = existing?.id ||
      privateChatId(currentUser.uid, other.uid);

    const chatRef = doc(db, "chats", id);

    if (!existing) {
      const snap = await getDoc(chatRef);

      if (!snap.exists()) {
        await setDoc(chatRef, {
          members: [currentUser.uid, other.uid],
          lastMessage: "",
          updatedAt: serverTimestamp(),
          lastMessageAt: serverTimestamp()
        });
      } else {
        const members = snap.data().members || [];

        if (
          !members.includes(currentUser.uid) ||
          !members.includes(other.uid)
        ) {
          throw new Error("Anggota percakapan tidak valid.");
        }
      }
    }

    const hiddenRef = doc(
      db,
      "users",
      currentUser.uid,
      "hiddenChats",
      id
    );

    const hiddenSnap = await getDoc(hiddenRef);

    if (hiddenSnap.exists()) {
      await deleteDoc(hiddenRef);
    }

    activeChat = {
      id,
      uid: other.uid,
      name: other.name || "Pengguna",
      photoURL: other.photoURL || "",
      verified: other.verified === true
    };

    activeChatType = "private";

    showConversation(
      activeChat.name,
      activeChat.verified
    );

    listenMessages("chats", id);
    listenTyping();
    listenOtherPresence(other.uid);
  } catch (error) {
    toast(errorMessage(error));
  }
}

// ======================================================
// LAST SEEN
// ======================================================

function listenOtherPresence(uid) {
  const old = $("chatPresence");

  if (old) old.remove();

  const panel = $("chatPanel");
  const header = panel?.querySelector(".conversation-header");

  if (!header) return;

  const element = safeElement("small", "chat-presence");
  element.id = "chatPresence";

  header.append(element);

  const unsubscribe = listenPresence(uid, data => {
    if (!data) {
      element.textContent = "Trạngi tidak diketahui";
      return;
    }

    if (data.state === "online") {
      element.textContent = "Online";
      element.classList.add("is-online");
    } else {
      element.classList.remove("is-online");
      element.textContent = formatLastSeen(data.last_changed);
    }
  });

  unsubscribers.push(unsubscribe);
}

// ======================================================
// GROUPS
// ======================================================

async function createGroup() {
  const name = await zoraPrompt(
    "Buat grup",
    "Masukkan nama grup.",
    "Nama grup"
  );

  if (!name) return;

  try {
    const group = await addDoc(collection(db, "groups"), {
      name: name.trim(),
      owner: currentUser.uid,
      members: [currentUser.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    toast("Grup berhasil dibuat.");

    openGroup(group.id, name.trim());
  } catch (error) {
    toast(errorMessage(error));
  }
}

on("createGroupBtn", "click", createGroup);

function listenGroups() {
  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    q,
    snap => {
      const list = $("groupList");
      if (!list) return;

      list.replaceChildren();

      snap.forEach(item => {
        const group = item.data();

        const row = safeElement("div", "chat-item");
        const avatar = safeElement("div", "avatar", "G");
        const details = safeElement("div", "chat-item-details");

        details.append(
          safeElement("strong", "", group.name || "Grup"),
          safeElement(
            "small",
            "",
            `${group.members?.length || 1} anggota`
          )
        );

        row.append(avatar, details);

        row.onclick = () => {
          openGroup(item.id, group.name);
        };

        list.append(row);
      });
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

async function inviteGroupMember(groupId) {
  const username = normalizeUsername(
    await zoraPrompt(
      "Undang anggota",
      "Masukkan username pengguna yang ingin ditambahkan.",
      "username"
    )
  );

  if (!username) return;

  try {
    const groupRef = doc(db, "groups", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      throw new Error("Grup tidak ditemukan.");
    }

    const group = groupSnap.data();

    if (
      !group.members?.includes(currentUser.uid)
    ) {
      throw new Error("Lu bukan anggota grup ini.");
    }

    const usernameSnap = await getDoc(
      doc(db, "usernames", username)
    );

    if (!usernameSnap.exists()) {
      throw new Error("Username tidak ditemukan.");
    }

    const uid = usernameSnap.data().uid;

    if (group.members.includes(uid)) {
      toast("Pengguna sudah menjadi anggota.");
      return;
    }

    await updateDoc(groupRef, {
      members: arrayUnion(uid),
      updatedAt: serverTimestamp()
    });

    toast("Anggota berhasil ditambahkan.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

function openGroup(id, name) {
  activeChat = { id, name };
  activeChatType = "group";

  showConversation(name, false);

  let inviteButton = $("inviteGroupMember");

  if (!inviteButton) {
    inviteButton = safeElement(
      "button",
      "group-invite-button",
      "Tambah anggota"
    );

    inviteButton.id = "inviteGroupMember";

    $("chatPanel")?.querySelector(
      ".conversation-header"
    )?.append(inviteButton);
  }

  inviteButton.hidden = false;
  inviteButton.onclick = () => inviteGroupMember(id);

  listenMessages("groups", id);
  listenTyping();
}

// ======================================================
// CHANNELS
// ======================================================

on("createChannelBtn", "click", async () => {
  const name = await zoraPrompt(
    "Buat saluran",
    "Masukkan nama saluran.",
    "Nama saluran"
  );

  if (!name) return;

  const description = await zoraPrompt(
    "Deskripsi saluran",
    "Masukkan deskripsi saluran.",
    "Deskripsi"
  );

  try {
    const channel = await addDoc(collection(db, "channels"), {
      name: name.trim(),
      description: description || "",
      owner: currentUser.uid,
      followers: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");

    openChannel(
      channel.id,
      name.trim(),
      currentUser.uid
    );
  } catch (error) {
    toast(errorMessage(error));
  }
});

function listenChannels() {
  const q = query(
    collection(db, "channels"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  const unsubscribe = onSnapshot(
    q,
    snap => {
      const list = $("channelList");
      if (!list) return;

      list.replaceChildren();

      snap.forEach(item => {
        const channel = item.data();

        const row = safeElement("div", "chat-item");
        const avatar = safeElement("div", "avatar", "S");
        const details = safeElement("div", "chat-item-details");

        details.append(
          safeElement("strong", "", channel.name || "Saluran"),
          safeElement(
            "small",
            "",
            `${channel.followers?.length || 0} pengikut`
          )
        );

        row.append(avatar, details);

        row.onclick = () => {
          openChannel(
            item.id,
            channel.name,
            channel.owner
          );
        };

        list.append(row);
      });
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

async function toggleFollowChannel(channelId) {
  try {
    const channelRef = doc(db, "channels", channelId);
    const snap = await getDoc(channelRef);

    if (!snap.exists()) {
      throw new Error("Saluran tidak ditemukan.");
    }

    const channel = snap.data();
    const followers = channel.followers || [];

    const following = followers.includes(currentUser.uid);

    await updateDoc(channelRef, {
      followers: following
        ? arrayRemove(currentUser.uid)
        : arrayUnion(currentUser.uid)
    });

    toast(
      following
        ? "Berhenti mengikuti saluran."
        : "Berhasil mengikuti saluran."
    );

    if (activeChat?.id === channelId) {
      activeChat.followers = following
        ? followers.filter(uid => uid !== currentUser.uid)
        : [...followers, currentUser.uid];

      renderChannelControls();
    }
  } catch (error) {
    toast(errorMessage(error));
  }
}

function renderChannelControls() {
  const channel = activeChat;

  if (!channel || activeChatType !== "channel") return;

  let controls = $("channelControls");

  if (!controls) {
    controls = safeElement("div", "channel-controls");
    controls.id = "channelControls";

    const header = $("chatPanel")?.querySelector(
      ".conversation-header"
    );

    if (header) header.after(controls);
  }

  controls.replaceChildren();

  const count = safeElement(
    "span",
    "channel-follower-count",
    `${channel.followers?.length || 0} pengikut`
  );

  controls.append(count);

  const owner = channel.owner === currentUser.uid;
  const following = (channel.followers || []).includes(
    currentUser.uid
  );

  if (!owner) {
    const button = safeElement(
      "button",
      following ? "secondary-btn" : "primary-btn",
      following ? "Berhenti mengikuti" : "Ikuti"
    );

    button.type = "button";
    button.onclick = () => toggleFollowChannel(channel.id);

    controls.append(button);
  }

  updateComposerAccess();
}

async function openChannel(id, name, owner) {
  stopMessageListener();

  const snap = await getDoc(doc(db, "channels", id));

  if (!snap.exists()) {
    toast("Saluran tidak ditemukan.");
    return;
  }

  const channel = snap.data();

  activeChat = {
    id,
    name,
    owner,
    followers: channel.followers || []
  };

  activeChatType = "channel";

  showConversation(name, false);

  renderChannelControls();

  const q = query(
    collection(db, "channels", id, "posts"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  messageUnsubscribe = onSnapshot(
    q,
    snapshot => {
      const container = $("messages");
      if (!container) return;

      container.replaceChildren();

      snapshot.forEach(item => {
        const post = item.data();
        const bubble = safeElement("div", "bubble");

        bubble.append(
          safeElement(
            "div",
            "message-body",
            post.text || ""
          ),
          safeElement(
            "small",
            "",
            `${post.authorName || "Admin"} · ${formatTime(post.createdAt)}`
          )
        );

        if (
          post.uid === currentUser.uid ||
          isAdmin()
        ) {
          const del = safeElement(
            "button",
            "message-delete",
            "Hapus"
          );

          del.type = "button";

          del.onclick = async () => {
            const confirmed = await zoraConfirm(
              "Hapus postingan ini?",
              {
                title: "Hapus postingan",
                confirmText: "Hapus",
                danger: true
              }
            );

            if (!confirmed) return;

            try {
              await deleteDoc(
                doc(
                  db,
                  "channels",
                  id,
                  "posts",
                  item.id
                )
              );

              toast("Postingan dihapus.");
            } catch (error) {
              toast(errorMessage(error));
            }
          };

          bubble.append(del);
        }

        container.append(bubble);
      });

      container.scrollTop = container.scrollHeight;
    },
    error => toast(errorMessage(error))
  );
}

// ======================================================
// MESSAGE ACTION MENU
// ======================================================

function createMessageActionMenu(messageRef, data) {
  const wrapper = safeElement("div", "message-actions");

  const trigger = safeElement(
    "button",
    "message-menu-trigger",
    "⋯"
  );

  trigger.type = "button";

  const menu = safeElement("div", "message-menu");
  menu.hidden = true;

  trigger.onclick = event => {
    event.stopPropagation();

    document.querySelectorAll(".message-menu").forEach(item => {
      if (item !== menu) item.hidden = true;
    });

    menu.hidden = !menu.hidden;
  };

  const hide = safeElement(
    "button",
    "",
    "Hapus untuk saya"
  );

  hide.type = "button";

  hide.onclick = async () => {
    try {
      await updateDoc(messageRef, {
        deletedFor: arrayUnion(currentUser.uid)
      });

      toast("Pesan disembunyikan.");
    } catch (error) {
      toast(errorMessage(error));
    }
  };

  menu.append(hide);

  if (
    data.sender === currentUser.uid &&
    !data.deleted
  ) {
    const removeAll = safeElement(
      "button",
      "danger-option",
      "Hapus untuk semua orang"
    );

    removeAll.type = "button";

    removeAll.onclick = async () => {
      const confirmed = await zoraConfirm(
        "Pesan akan dihapus untuk semua anggota.",
        {
          title: "Hapus pesan",
          confirmText: "Hapus",
          danger: true
        }
      );

      if (!confirmed) return;

      try {
        await updateDoc(messageRef, {
          text: "Pesan ini telah dihapus",
          deleted: true,
          deletedAt: serverTimestamp()
        });
      } catch (error) {
        toast(errorMessage(error));
      }
    };

    menu.append(removeAll);
  }

  wrapper.append(trigger, menu);

  return wrapper;
}

// ======================================================
// READ RECEIPTS
// ======================================================

function makeDoubleTick(isRead) {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  svg.setAttribute("viewBox", "0 0 22 16");
  svg.setAttribute("width", "19");
  svg.setAttribute("height", "14");
  svg.setAttribute(
    "class",
    `message-ticks${isRead ? " read" : ""}`
  );

  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );

  path.setAttribute(
    "d",
    "M1 8.5 5.2 12.5 13.3 3.5 M8.5 8.5 12.5 12.5 21 3.5"
  );

  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.append(path);

  return svg;
}

// ======================================================
// MESSAGE LISTENER
// ======================================================

function listenMessages(root, id) {
  stopMessageListener();

  firstMessageSnapshot = true;

  const q = query(
    collection(db, root, id, "messages"),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  messageUnsubscribe = onSnapshot(
    q,
    async snap => {
      const container = $("messages");
      if (!container) return;

      if (!firstMessageSnapshot) {
        snap.docChanges().forEach(change => {
          if (change.type !== "added") return;

          const data = change.doc.data();

          if (data.sender !== currentUser.uid) {
            const viewing = activeChat?.id === id &&
              !document.hidden;

            if (!viewing) {
              const now = Date.now();

              if (now - lastNotificationTime > 500) {
                lastNotificationTime = now;

                toast(
                  `${data.senderName || "Pesan baru"}: ${(data.text || "").slice(0, 60)}`
                );
              }
            }
          }
        });
      }

      firstMessageSnapshot = false;
      container.replaceChildren();

      const readUpdates = [];

      snap.forEach(item => {
        const data = item.data();

        const mine = data.sender === currentUser.uid;

        if ((data.deletedFor || []).includes(currentUser.uid)) {
          return;
        }

        if (
          !mine &&
          !data.deleted &&
          !(data.readBy || []).includes(currentUser.uid)
        ) {
          readUpdates.push(
            updateDoc(item.ref, {
              readBy: arrayUnion(currentUser.uid)
            }).catch(console.warn)
          );
        }

        const bubble = safeElement(
          "div",
          `bubble${mine ? " mine" : ""}${data.deleted ? " deleted-message" : ""}`
        );

        if (
          activeChatType === "group" &&
          !mine
        ) {
          bubble.append(
            safeElement(
              "strong",
              "message-sender",
              data.senderName || "Pengguna"
            )
          );
        }

        bubble.append(
          safeElement(
            "div",
            "message-body",
            data.deleted
              ? "Pesan ini telah dihapus"
              : data.text || ""
          )
        );

        const footer = safeElement("div", "message-footer");

        footer.append(
          safeElement("small", "", formatTime(data.createdAt))
        );

        if (
          mine &&
          activeChatType === "private" &&
          !data.deleted
        ) {
          footer.append(
            makeDoubleTick(
              (data.readBy || []).includes(activeChat.uid)
            )
          );
        }

        bubble.append(footer);

        if (!data.deleted) {
          bubble.append(
            createMessageActionMenu(item.ref, data)
          );
        }

        container.append(bubble);
      });

      if (readUpdates.length) {
        await Promise.all(readUpdates);
      }

      container.scrollTop = container.scrollHeight;
    },
    error => toast(errorMessage(error))
  );
}

// ======================================================
// SEND MESSAGE
// ======================================================

async function sendMessage(text) {
  if (!activeChat || !currentUser) {
    throw new Error("Pilih percakapan terlebih dahulu.");
  }

  const cleanText = text.trim();

  if (!cleanText) return;

  if (activeChatType === "channel") {
    const allowed =
      isAdmin() ||
      activeChat.owner === currentUser.uid;

    if (!allowed) {
      throw new Error("Hanya admin saluran yang boleh posting.");
    }

    await addDoc(
      collection(db, "channels", activeChat.id, "posts"),
      {
        uid: currentUser.uid,
        authorName: currentProfile?.name || "Admin",
        text: cleanText,
        createdAt: serverTimestamp()
      }
    );

    return;
  }

  const root = activeChatType === "group"
    ? "groups"
    : "chats";

  const conversationRef = doc(
    db,
    root,
    activeChat.id
  );

  const conversationSnap = await getDoc(conversationRef);

  if (!conversationSnap.exists()) {
    throw new Error("Percakapan tidak ditemukan.");
  }

  const members = conversationSnap.data().members || [];

  if (!members.includes(currentUser.uid)) {
    throw new Error("Akses percakapan ditolak.");
  }

  await addDoc(
    collection(db, root, activeChat.id, "messages"),
    {
      sender: currentUser.uid,
      senderName: currentProfile?.name || "Pengguna",
      text: cleanText,
      type: "text",
      readBy: [currentUser.uid],
      deletedFor: [],
      deleted: false,
      createdAt: serverTimestamp()
    }
  );

  await updateDoc(conversationRef, {
    lastMessage: cleanText,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  updateTyping(false);
}

on("sendBtn", "click", async () => {
  const text = $("messageInput")?.value.trim();

  if (!text) return;

  $("sendBtn").disabled = true;

  try {
    await sendMessage(text);
    $("messageInput").value = "";
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    $("sendBtn").disabled = false;
  }
});

on("messageInput", "keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("sendBtn")?.click();
  }
});

on("imageInput", "change", event => {
  event.target.value = "";
  toast("Pengiriman gambar chat belum diaktifkan.");
});

// ======================================================
// DELETE CHAT
// ======================================================

async function deleteChatForMe(chatId) {
  const confirmed = await zoraConfirm(
    "Hapus percakapan dari daftar akun lu?",
    {
      title: "Hapus percakapan",
      confirmText: "Hapus",
      danger: true
    }
  );

  if (!confirmed) return;

  try {
    await setDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "hiddenChats",
        chatId
      ),
      {
        chatId,
        hiddenAt: serverTimestamp()
      }
    );

    if (activeChat?.id === chatId) {
      stopMessageListener();

      activeChat = null;

      setHidden("chatPanel", true);
      setHidden("emptyChat", false);

      $("appScreen")?.classList.remove("chat-open");
    }

    toast("Percakapan dihapus dari daftar.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

// ======================================================
// CHAT LIST
// ======================================================

function listenChats() {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    q,
    async snap => {
      const list = $("chatList");
      if (!list) return;

      const entries = [];

      for (const item of snap.docs) {
        const data = item.data();

        const otherId = data.members?.find(
          uid => uid !== currentUser.uid
        );

        if (!otherId) continue;

        try {
          const [userSnap, hiddenSnap] = await Promise.all([
            getDoc(doc(db, "users", otherId)),
            getDoc(
              doc(
                db,
                "users",
                currentUser.uid,
                "hiddenChats",
                item.id
              )
            )
          ]);

          if (!userSnap.exists()) continue;

          const user = userSnap.data();

          if (user.status !== "active") continue;

          const lastActivity = timestampMillis(
            data.lastMessageAt || data.updatedAt
          );

          const hiddenAt = hiddenSnap.exists()
            ? timestampMillis(hiddenSnap.data().hiddenAt)
            : 0;

          if (hiddenSnap.exists() && lastActivity <= hiddenAt) {
            continue;
          }

          if (hiddenSnap.exists() && lastActivity > hiddenAt) {
            deleteDoc(hiddenSnap.ref).catch(() => {});
          }

          entries.push({
            id: item.id,
            otherId,
            user,
            data,
            lastActivity
          });
        } catch (error) {
          console.warn(error);
        }
      }

      const unique = new Map();

      entries.forEach(entry => {
        const previous = unique.get(entry.otherId);

        if (
          !previous ||
          entry.lastActivity > previous.lastActivity
        ) {
          unique.set(entry.otherId, entry);
        }
      });

      const sorted = [...unique.values()].sort(
        (a, b) => b.lastActivity - a.lastActivity
      );

      list.replaceChildren();

      if (!sorted.length) {
        list.append(
          safeElement(
            "div",
            "chat-empty-note",
            "Belum ada percakapan."
          )
        );

        return;
      }

      sorted.forEach(entry => {
        const row = safeElement("div", "chat-item");

        const avatar = safeElement("div", "avatar");

        renderAvatarInto(
          avatar,
          entry.user.photoURL,
          entry.user.name
        );

        const details = safeElement(
          "div",
          "chat-item-details"
        );

        details.append(
          createNameElement(
            entry.user.name,
            entry.user.verified === true
          ),
          safeElement(
            "small",
            "",
            entry.data.lastMessage || "Mulai percakapan"
          )
        );

        const actions = safeElement(
          "div",
          "chat-row-actions"
        );

        const more = safeElement(
          "button",
          "chat-row-more",
          "⋯"
        );

        more.type = "button";

        more.onclick = event => {
          event.stopPropagation();
          deleteChatForMe(entry.id);
        };

        actions.append(more);
        row.append(avatar, details, actions);

        row.onclick = () => {
          openPrivateChat({
            ...entry.user,
            uid: entry.otherId
          });
        };

        list.append(row);
      });
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

// ======================================================
// USER SEARCH
// ======================================================

on("searchUser", "input", () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(searchUsers, 350);
});

async function searchUsers() {
  if (!currentUser || !exists("searchUser")) return;

  const username = normalizeUsername($("searchUser").value);
  const results = $("searchResults");

  if (!results) return;

  results.replaceChildren();

  if (username.length < 3) return;

  try {
    const usernameSnap = await getDoc(
      doc(db, "usernames", username)
    );

    if (!usernameSnap.exists()) {
      results.append(
        safeElement("small", "search-empty", "Username tidak ditemukan.")
      );

      return;
    }

    const uid = usernameSnap.data().uid;

    if (uid === currentUser.uid) {
      results.append(
        safeElement("small", "search-empty", "Itu akun lu sendiri.")
      );

      return;
    }

    const userSnap = await getDoc(doc(db, "users", uid));

    if (
      !userSnap.exists() ||
      userSnap.data().status !== "active"
    ) {
      results.append(
        safeElement("small", "search-empty", "Pengguna tidak tersedia.")
      );

      return;
    }

    const user = userSnap.data();

    const row = safeElement("div", "user-item");
    const avatar = safeElement("div", "avatar");

    renderAvatarInto(avatar, user.photoURL, user.name);

    const details = safeElement("div");

    details.append(
      createNameElement(user.name, user.verified === true),
      safeElement("small", "", `@${user.username || username}`)
    );

    row.append(avatar, details);

    row.onclick = () => {
      openPrivateChat({ ...user, uid });
    };

    results.append(row);
  } catch (error) {
    toast(errorMessage(error));
  }
}

on("newChatBtn", "click", () => {
  $("searchUser")?.focus();
  toast("Cari username untuk memulai chat.");
});

// ======================================================
// STATUS
// ======================================================

function createStatusModal() {
  if (exists("statusModal")) return;

  const modal = safeElement("div", "zora-modal");
  modal.id = "statusModal";
  modal.hidden = true;

  const card = safeElement("div", "zora-modal-card");

  const heading = safeElement("div", "zora-modal-heading");
  const title = safeElement("div");

  title.append(
    safeElement("small", "", "MOMENTS"),
    safeElement("h2", "", "Buat Status")
  );

  const close = safeElement("button", "zora-modal-close", "×");

  close.type = "button";
  close.onclick = () => setHidden("statusModal", true);

  heading.append(title, close);

  const textarea = safeElement("textarea");
  textarea.id = "statusInput";
  textarea.maxLength = 500;
  textarea.placeholder = "Apa yang sedang kamu pikirkan?";

  const actions = safeElement("div", "zora-modal-actions");

  const cancel = safeElement("button", "secondary-btn", "Batal");
  cancel.type = "button";
  cancel.onclick = () => setHidden("statusModal", true);

  const publish = safeElement("button", "primary-btn", "Bagikan Status");
  publish.type = "button";
  publish.id = "publishStatus";
  publish.onclick = publishStatus;

  actions.append(cancel, publish);
  card.append(heading, textarea, actions);
  modal.append(card);

  modal.onclick = event => {
    if (event.target === modal) {
      setHidden("statusModal", true);
    }
  };

  document.body.append(modal);
}

function openStatusModal() {
  createStatusModal();

  $("statusInput").value = "";
  setHidden("statusModal", false);

  setTimeout(() => $("statusInput")?.focus(), 100);
}

async function publishStatus() {
  const text = $("statusInput")?.value.trim();

  if (!text) {
    toast("Tulis status terlebih dahulu.");
    return;
  }

  $("publishStatus").disabled = true;

  try {
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      name: currentProfile?.name || "Pengguna",
      text,
      createdAt: serverTimestamp()
    });

    setHidden("statusModal", true);
    toast("Status berhasil dibuat.");
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    $("publishStatus").disabled = false;
  }
}

on("createStatusBtn", "click", openStatusModal);

function listenStatuses() {
  const q = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(80)
  );

  const unsubscribe = onSnapshot(
    q,
    snap => {
      const list = $("statusList");
      const mine = $("myStatuses");

      if (!list || !mine) return;

      list.replaceChildren();
      mine.replaceChildren();

      snap.forEach(item => {
        const status = item.data();
        const isMine = status.uid === currentUser.uid;

        const row = safeElement("div", "status-item");
        const avatar = safeElement("div", "status-avatar");

        renderAvatarInto(
          avatar,
          isMine ? currentProfile?.photoURL : "",
          status.name
        );

        const details = safeElement("div", "status-details");

        details.append(
          safeElement("strong", "", status.name || "Pengguna"),
          safeElement("small", "", status.text || "")
        );

        row.append(avatar, details);

        if (isMine) {
          const del = safeElement("button", "secondary-btn", "Hapus");

          del.type = "button";

          del.onclick = async event => {
            event.stopPropagation();

            const confirmed = await zoraConfirm(
              "Hapus status ini?",
              {
                title: "Hapus status",
                confirmText: "Hapus",
                danger: true
              }
            );

            if (!confirmed) return;

            try {
              await deleteDoc(doc(db, "statuses", item.id));
              toast("Status dihapus.");
            } catch (error) {
              toast(errorMessage(error));
            }
          };

          row.append(del);
          mine.append(row);
        } else {
          list.append(row);
        }
      });
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

// ======================================================
// PROFILE
// ======================================================

function openProfile() {
  if (!currentProfile) return;

  if (exists("profileName")) {
    $("profileName").value = currentProfile.name || "";
  }

  if (exists("profileBio")) {
    $("profileBio").value = currentProfile.bio || "";
  }

  if (exists("profileUsername")) {
    $("profileUsername").value = currentProfile.username || "";
  }

  createProfilePhotoControls();

  renderAvatar(
    "profilePhotoPreview",
    currentProfile.photoURL,
    currentProfile.name
  );

  setHidden("profileModal", false);
}

on("profileBtn", "click", openProfile);
on("editProfileBtn", "click", openProfile);

on("closeProfile", "click", () => {
  setHidden("profileModal", true);
});

on("saveProfile", "click", async () => {
  const name = $("profileName")?.value.trim();
  const bio = $("profileBio")?.value.trim() || "";

  const oldUsername = currentProfile?.username || "";

  const newUsername = normalizeUsername(
    $("profileUsername")?.value || oldUsername
  );

  if (!name || name.length < 3) {
    toast("Nama minimal 3 karakter.");
    return;
  }

  if (!validUsername(newUsername)) {
    toast("Format username tidak valid.");
    return;
  }

  try {
    if (newUsername !== normalizeUsername(oldUsername)) {
      await claimUsername(
        newUsername,
        currentUser.uid,
        oldUsername
      );
    }

    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      bio,
      username: newUsername,
      usernameLower: newUsername
    });

    setHidden("profileModal", true);
    toast("Profil berhasil diperbarui.");
  } catch (error) {
    toast(errorMessage(error));
  }
});

// ======================================================
// APPEAL
// ======================================================

on("appealBtn", "click", async () => {
  const text = $("appealText")?.value.trim();

  if (!text || text.length < 10) {
    setText(
      "appealMessage",
      "Jelaskan alasan banding minimal 10 karakter."
    );

    return;
  }

  try {
    await addDoc(collection(db, "appeals"), {
      uid: currentUser.uid,
      email: currentUser.email,
      text,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealText").value = "";

    setText(
      "appealMessage",
      "Banding berhasil dikirim. Tunggu pemeriksaan admin."
    );
  } catch (error) {
    setText("appealMessage", errorMessage(error));
  }
});

// ======================================================
// ADMIN
// ======================================================

on("openAdmin", "click", () => {
  if (!isAdmin()) {
    toast("Akses ditolak.");
    return;
  }

  setHidden("adminScreen", false);
  loadAppeals();
});

on("closeAdmin", "click", () => {
  setHidden("adminScreen", true);
});

on("findAdminUser", "click", async () => {
  if (!isAdmin()) {
    toast("Akses ditolak.");
    return;
  }

  const uid = $("adminSearch")?.value.trim();
  const result = $("adminUserResult");

  if (!result || !uid) return;

  result.replaceChildren();

  try {
    const snap = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
      result.textContent = "Pengguna tidak ditemukan.";
      return;
    }

    const user = snap.data();

    result.append(
      safeElement(
        "p",
        "",
        `${user.name || "Pengguna"} — ${user.email || ""} — ${user.status || "unknown"}`
      )
    );

    const actions = [
      ["Centang biru", { verified: true }],
      ["Cabut centang", { verified: false }],
      ["Tahan akun", { status: "held" }],
      ["Permanenkan akun", { status: "permanent" }],
      ["Pulihkan akun", { status: "recovered" }]
    ];

    actions.forEach(([label, changes]) => {
      const button = safeElement("button", "secondary-btn", label);

      button.type = "button";

      button.onclick = async () => {
        if (uid === ADMIN_UID) {
          toast("Admin utama tidak dapat dimoderasi.");
          return;
        }

        const confirmed = await zoraConfirm(
          `Lanjutkan tindakan: ${label}?`,
          {
            title: "Moderasi akun",
            confirmText: "Lanjutkan",
            danger: changes.status === "permanent"
          }
        );

        if (!confirmed) return;

        try {
          await updateDoc(doc(db, "users", uid), {
            ...changes,
            moderatedAt: serverTimestamp(),
            moderatedBy: currentUser.uid
          });

          toast("Perubahan akun berhasil disimpan.");
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      result.append(button);
    });
  } catch (error) {
    toast(errorMessage(error));
  }
});

async function loadAppeals() {
  if (!isAdmin()) return;

  const list = $("appealList");
  if (!list) return;

  list.textContent = "Memuat...";

  try {
    const q = query(
      collection(db, "appeals"),
      where("status", "==", "pending")
    );

    const snap = await getDocs(q);

    list.replaceChildren();

    if (snap.empty) {
      list.textContent = "Belum ada banding.";
      return;
    }

    snap.forEach(item => {
      const appeal = item.data();

      const card = safeElement(
        "div",
        "admin-user",
        `${appeal.email || appeal.uid}: ${appeal.text || ""}`
      );

      const approve = safeElement("button", "primary-btn", "Terima");
      approve.type = "button";

      approve.onclick = async () => {
        const confirmed = await zoraConfirm(
          "Terima banding pengguna ini?",
          {
            title: "Terima banding",
            confirmText: "Terima"
          }
        );

        if (!confirmed) return;

        try {
          await updateDoc(doc(db, "users", appeal.uid), {
            status: "recovered",
            moderatedAt: serverTimestamp(),
            moderatedBy: currentUser.uid
          });

          await updateDoc(doc(db, "appeals", item.id), {
            status: "approved",
            reviewedAt: serverTimestamp(),
            reviewedBy: currentUser.uid
          });

          toast("Banding diterima.");
          loadAppeals();
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      const reject = safeElement("button", "secondary-btn", "Tolak");
      reject.type = "button";

      reject.onclick = async () => {
        const confirmed = await zoraConfirm(
          "Tolak banding pengguna ini?",
          {
            title: "Tolak banding",
            confirmText: "Tolak",
            danger: true
          }
        );

        if (!confirmed) return;

        try {
          await updateDoc(doc(db, "appeals", item.id), {
            status: "rejected",
            reviewedAt: serverTimestamp(),
            reviewedBy: currentUser.uid
          });

          toast("Banding ditolak.");
          loadAppeals();
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      card.append(approve, reject);
      list.append(card);
    });
  } catch (error) {
    list.textContent = errorMessage(error);
  }
}

// ======================================================
// GLOBAL EVENTS
// ======================================================

document.addEventListener("click", event => {
  if (
    !event.target.closest(".message-actions") &&
    !event.target.closest(".message-menu")
  ) {
    document.querySelectorAll(".message-menu").forEach(menu => {
      menu.hidden = true;
    });
  }
});

window.addEventListener("pagehide", () => {
  updateTyping(false);
});

// ======================================================
// START
// ======================================================

console.log("ZORAAPP — app.js loaded.");
