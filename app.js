import { auth, db, storage, rtdb } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  linkWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where,
  onSnapshot, serverTimestamp, limit,
  runTransaction, arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

import {
  ref as dbRef,
  set as rtdbSet,
  onValue,
  onDisconnect,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const PHONE_PATTERN = /^\+628\d{8,11}$/;
const $ = id => document.getElementById(id);

let user = null;
let profile = null;
let activeChat = null;
let activeChatData = null;
let activeChatType = "private";

let activeChatUnsubscribe = null;
let chatListUnsubscribe = null;
let typingUnsubscribe = null;
let presenceUnsubscribe = null;
let statusUnsubscribe = null;
let groupUnsubscribe = null;
let channelUnsubscribe = null;
let appealUnsubscribe = null;
let otherUserUnsubscribe = null;

let confirmationResult = null;
let linkConfirmationResult = null;
let recaptcha = null;
let linkRecaptcha = null;

let toastTimer = null;
let searchTimer = null;
let currentStatus = null;
let conversationVersion = 0;

const hiddenChats = new Set();

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));

const initials = name =>
  String(name || "Z").trim().charAt(0).toUpperCase() || "Z";

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

function toast(message, type = "normal") {
  const el = $("toast");

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function showError(id, message) {
  const el = $(id);
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("visible", Boolean(message));
}

function setLoading(button, loading, text = "Memproses...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function showOnly(screenId) {
  [
    "authScreen",
    "holdScreen",
    "recoveredScreen",
    "permanentScreen",
    "appScreen"
  ].forEach(id => {
    const el = $(id);
    if (el) el.hidden = id !== screenId;
  });
}

function openModal(id) {
  const el = $(id);
  if (el) el.hidden = false;
}

function closeModal(id) {
  const el = $(id);
  if (el) el.hidden = true;
}

function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short"
  });
}

function isAdmin() {
  return user?.uid === ADMIN_UID;
}

function logFirebaseError(label, error) {
  console.error(label, {
    code: error?.code,
    message: error?.message,
    uid: user?.uid,
    profileStatus: profile?.status
  });
}

// =====================================
// VERIFIED BADGE - TETAP DIPERTAHANKAN
// =====================================

function installVerifiedStyle() {
  if ($("verifiedBadgeStyle")) return;

  const style = document.createElement("style");
  style.id = "verifiedBadgeStyle";

  style.textContent = `
    .zora-verified {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width:17px;
      height:17px;
      margin-left:4px;
      vertical-align:-3px;
      flex-shrink:0;
      color:#2589ed;
    }

    .zora-verified svg {
      display:block;
      width:100%;
      height:100%;
    }

    .verified-name {
      display:inline-flex;
      align-items:center;
      gap:2px;
    }
  `;

  document.head.appendChild(style);
}

function verifiedBadge(verified) {
  if (verified !== true) return "";

  return `
    <span class="zora-verified"
      title="Akun terverifikasi"
      aria-label="Akun terverifikasi">
      <svg viewBox="0 0 24 24" fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 2.2L14.4 3.8L17.3 3.7L18.6 6.3L21.1 7.7L20.9 10.6L22.2 13L20.6 15.4L20.7 18.3L18.1 19.6L16.7 22.1L13.8 21.9L11.4 23.2L9 21.6L6.1 21.7L4.8 19.1L2.3 17.7L2.5 14.8L1.2 12.4L2.8 10L2.7 7.1L5.3 5.8L6.7 3.3L9.6 3.5L12 2.2Z"
          fill="currentColor"/>
        <path
          d="M7.5 12.2L10.3 15L16.7 8.8"
          stroke="white"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"/>
      </svg>
    </span>
  `;
}

function verifiedName(name, verified) {
  return `
    <span class="verified-name">
      ${escapeHTML(name || "Pengguna")}
      ${verifiedBadge(verified)}
    </span>
  `;
}

// =====================================
// PREMIUM BUTTON STYLE
// =====================================

function installPremiumButtonStyle() {
  if ($("zoraPremiumButtonStyle")) return;

  const style = document.createElement("style");
  style.id = "zoraPremiumButtonStyle";

  style.textContent = `
    .app button {
      -webkit-tap-highlight-color:transparent;
      transition:transform .18s ease,background .18s ease,
      border-color .18s ease,box-shadow .18s ease,opacity .18s ease;
    }

    .app button:not(:disabled):active {
      transform:scale(.96);
    }

    .app button:disabled {
      opacity:.5;
      cursor:not-allowed;
    }

    .app .list-item,
    .app .search-result {
      border:1px solid rgba(128,145,170,.13);
      border-radius:15px;
      background:var(--card-bg,rgba(128,145,170,.07));
      margin-bottom:8px;
      overflow:hidden;
    }

    .app .list-item:hover,
    .app .search-result:hover {
      border-color:rgba(65,135,240,.45);
      background:rgba(65,135,240,.09);
    }

    .app .secondary-btn,
    .app .danger-btn,
    .app .admin-actions button {
      min-height:39px;
      padding:9px 15px;
      border-radius:11px;
      font-weight:600;
      cursor:pointer;
    }

    .app .secondary-btn {
      border:1px solid rgba(110,150,220,.25);
      background:rgba(65,135,240,.12);
    }

    .app .danger-btn {
      border:1px solid rgba(235,75,90,.25);
      background:rgba(235,75,90,.12);
      color:#ed6572;
    }

    .app .message-actions {
      display:flex;
      flex-wrap:wrap;
      gap:6px;
      margin-top:7px;
    }

    .app .message-actions button {
      border:1px solid rgba(130,145,170,.2);
      background:rgba(130,145,170,.09);
      border-radius:9px;
      padding:7px 10px;
      font-size:11px;
      cursor:pointer;
    }

    .app .message-actions button:hover {
      background:rgba(65,135,240,.18);
      border-color:rgba(65,135,240,.4);
    }

    .app .reaction-chip {
      border:1px solid rgba(130,145,170,.2);
      border-radius:20px;
      padding:5px 10px;
      background:rgba(130,145,170,.1);
    }

    .app .reaction-chip.selected {
      border-color:#4389ee;
      background:rgba(65,135,240,.2);
    }

    .app button:focus-visible {
      outline:2px solid #4389ee;
      outline-offset:3px;
    }
  `;

  document.head.appendChild(style);
}

// =====================================
// NAVIGATION
// =====================================

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== pageId;
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });

  closeChat();
}

// =====================================
// HEADER / PROFILE UI
// =====================================

function updateHeader() {
  const name = profile?.username
    ? `@${profile.username}`
    : profile?.name || user?.displayName || "Pengguna";

  if ($("headerUsername")) {
    $("headerUsername").innerHTML =
      verifiedName(name, profile?.verified === true);
  }
}

function updateProfileUI() {
  if (!profile || !user) return;

  updateHeader();

  if ($("myName")) {
    $("myName").innerHTML =
      verifiedName(profile.name || "Pengguna", profile.verified === true);
  }

  if ($("myEmail")) $("myEmail").textContent = user.email || "";

  if ($("myPhone")) {
    $("myPhone").textContent =
      user.phoneNumber || profile.phoneNumber || "";
  }

  if ($("myAvatar")) {
    $("myAvatar").textContent = initials(profile.name);
  }

  if ($("profileName")) $("profileName").value = profile.name || "";
  if ($("profileUsername")) $("profileUsername").value = profile.username || "";
  if ($("profileBio")) $("profileBio").value = profile.bio || "";

  if ($("profilePhotoPreview")) {
    $("profilePhotoPreview").innerHTML = profile.photoURL
      ? `<img src="${escapeHTML(profile.photoURL)}" alt="Foto profil">`
      : escapeHTML(initials(profile.name));
  }

  if ($("openAdmin")) {
    $("openAdmin").hidden = !isAdmin();
  }
}

// =====================================
// CUSTOM DIALOG
// =====================================

function installZoraDialog() {
  if ($("zoraDialog")) return;

  const style = document.createElement("style");
  style.id = "zoraDialogStyle";

  style.textContent = `
    #zoraDialog[hidden]{display:none!important}
    #zoraDialog{
      position:fixed;inset:0;z-index:99999;
      display:flex;align-items:center;justify-content:center;
      padding:20px;background:rgba(0,0,0,.58);
      backdrop-filter:blur(8px);
    }
    #zoraDialog .zd-card{
      width:min(100%,390px);padding:22px;
      border:1px solid rgba(255,255,255,.12);
      border-radius:20px;background:var(--modal-bg,#171a23);
      color:var(--text-color,#fff);
      box-shadow:0 24px 80px rgba(0,0,0,.35);
      animation:zdIn .18s ease-out;
    }
    #zoraDialog .zd-title{font-size:18px;font-weight:700;margin:0 0 8px}
    #zoraDialog .zd-message{
      font-size:14px;line-height:1.55;opacity:.75;
      margin:0 0 16px;white-space:pre-wrap;
    }
    #zoraDialog .zd-input{
      display:block;width:100%;box-sizing:border-box;
      min-height:44px;padding:12px 13px;margin:0 0 18px;
      border-radius:12px;border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.06);color:inherit;
      outline:none;font:inherit;
    }
    #zoraDialog .zd-actions{
      display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;
    }
    #zoraDialog .zd-actions button{
      min-height:40px;padding:0 16px;border:0;border-radius:11px;
      cursor:pointer;font:inherit;font-weight:600;
    }
    #zoraDialog .zd-cancel{color:inherit;background:rgba(255,255,255,.09)}
    #zoraDialog .zd-ok{color:white;background:#3978e8}
    #zoraDialog .zd-danger{background:#d94350}
    #zoraDialog .zd-choices{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 18px}
    #zoraDialog .zd-choice{
      min-width:45px;min-height:43px;border-radius:12px;
      border:1px solid rgba(255,255,255,.13);
      background:rgba(255,255,255,.07);color:inherit;
      font-size:22px;cursor:pointer;
    }
    @keyframes zdIn{
      from{opacity:0;transform:translateY(8px) scale(.98)}
      to{opacity:1;transform:translateY(0) scale(1)}
    }
  `;

  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "zoraDialog";
  modal.hidden = true;

  modal.innerHTML = `
    <div class="zd-card" role="dialog" aria-modal="true">
      <h3 class="zd-title" id="zdTitle"></h3>
      <p class="zd-message" id="zdMessage"></p>
      <div id="zdExtra"></div>
      <div class="zd-actions" id="zdActions"></div>
    </div>
  `;

  document.body.appendChild(modal);
}

function zoraDialog({
  title = "ZORAAPP",
  message = "",
  input = false,
  placeholder = "",
  defaultValue = "",
  choices = null,
  confirmText = "Lanjutkan",
  cancelText = "Batal",
  danger = false
} = {}) {
  installZoraDialog();

  return new Promise(resolve => {
    const modal = $("zoraDialog");
    const extra = $("zdExtra");
    const actions = $("zdActions");

    $("zdTitle").textContent = title;
    $("zdMessage").textContent = message;

    extra.innerHTML = "";
    actions.innerHTML = "";

    let inputElement = null;

    if (input) {
      inputElement = document.createElement("input");
      inputElement.className = "zd-input";
      inputElement.placeholder = placeholder;
      inputElement.value = defaultValue;
      inputElement.maxLength = 500;
      extra.appendChild(inputElement);
    }

    const finish = value => {
      modal.hidden = true;
      modal.removeEventListener("click", outside);
      resolve(value);
    };

    const outside = event => {
      if (event.target === modal) finish(null);
    };

    modal.addEventListener("click", outside);

    if (Array.isArray(choices)) {
      const choiceBox = document.createElement("div");
      choiceBox.className = "zd-choices";

      choices.forEach(choice => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "zd-choice";
        button.textContent = choice;
        button.onclick = () => finish(choice);
        choiceBox.appendChild(button);
      });

      extra.appendChild(choiceBox);
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "zd-cancel";
    cancel.textContent = cancelText;
    cancel.onclick = () => finish(null);
    actions.appendChild(cancel);

    if (!choices) {
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = `zd-ok ${danger ? "zd-danger" : ""}`;
      ok.textContent = confirmText;
      ok.onclick = () => finish(input ? inputElement.value : true);
      actions.appendChild(ok);
    }

    modal.hidden = false;

    if (inputElement) {
      setTimeout(() => inputElement.focus(), 30);

      inputElement.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(inputElement.value);
        }
      });
    }
  });
}

async function zoraConfirm(message, options = {}) {
  return (await zoraDialog({
    title: options.title || "Konfirmasi",
    message,
    confirmText: options.confirmText || "Ya, lanjutkan",
    cancelText: "Batal",
    danger: Boolean(options.danger)
  })) === true;
}

async function zoraPrompt(message, options = {}) {
  const result = await zoraDialog({
    title: options.title || "ZORAAPP",
    message,
    input: true,
    placeholder: options.placeholder || "Masukkan di sini...",
    defaultValue: options.defaultValue || "",
    confirmText: options.confirmText || "Simpan"
  });

  return typeof result === "string" ? result.trim() : null;
}

// =====================================
// PROFILE / USERNAME
// =====================================

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;

  return { uid, ...snap.data() };
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function validUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

async function reserveUsername(username, uid) {
  const usernameRef = doc(db, "usernames", username);

  await runTransaction(db, async transaction => {
    const existing = await transaction.get(usernameRef);

    if (existing.exists() && existing.data().uid !== uid) {
      throw new Error("Username sudah digunakan.");
    }

    transaction.set(usernameRef, {
      uid,
      username,
      createdAt: serverTimestamp()
    });
  });
}

async function createUserProfile(uid, data) {
  const username = normalizeUsername(data.username);

  if (!validUsername(username)) {
    throw new Error("Username tidak valid.");
  }

  await reserveUsername(username, uid);

  await setDoc(doc(db, "users", uid), {
    uid,
    name: String(data.name || "").trim(),
    username,
    bio: "",
    photoURL: "",
    phoneNumber: data.phoneNumber || "",
    status: "active",
    verified: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// =====================================
// AUTHENTICATION
// =====================================

function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Email atau password salah.",
    "auth/email-already-in-use": "Email sudah digunakan.",
    "auth/weak-password": "Password terlalu lemah.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Akun tidak ditemukan.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/network-request-failed": "Koneksi internet bermasalah.",
    "auth/invalid-phone-number": "Nomor HP tidak valid.",
    "auth/operation-not-allowed": "Metode login belum diaktifkan."
  };

  return messages[error?.code] || error?.message || "Terjadi kesalahan.";
}

async function loginEmail() {
  const button = $("loginBtn");
  setLoading(button, true);

  try {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    if (!email || !password) {
      throw new Error("Isi email dan password.");
    }

    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showError("authError", authErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
}

async function registerEmail() {
  const button = $("registerBtn");
  setLoading(button, true);

  try {
    const name = $("authName").value.trim();
    const username = normalizeUsername($("registerUsername").value);
    const email = $("registerEmail").value.trim();
    const password = $("registerPassword").value;

    if (!name || !username || !email || !password) {
      throw new Error("Lengkapi semua data.");
    }

    if (password.length < 8) {
      throw new Error("Password minimal 8 karakter.");
    }

    if (!validUsername(username)) {
      throw new Error("Username tidak valid.");
    }

    const credential = await createUserWithEmailAndPassword(
      auth, email, password
    );

    await updateProfile(credential.user, { displayName: name });

    await createUserProfile(credential.user.uid, {
      name,
      username
    });

    toast("Pendaftaran berhasil.");
  } catch (error) {
    logFirebaseError("REGISTER ERROR", error);
    showError("registerError", authErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
}

async function forgotPassword() {
  const email = $("authEmail").value.trim();

  if (!email) {
    showError("authError", "Masukkan email terlebih dahulu.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password dikirim ke email.");
  } catch (error) {
    showError("authError", authErrorMessage(error));
  }
}

// =====================================
// PHONE AUTH
// =====================================

function setupRecaptcha(containerId, existing) {
  if (existing) {
    try {
      existing.clear();
    } catch {}
  }

  return new RecaptchaVerifier(auth, containerId, {
    size: "normal",
    callback: () => {}
  });
}

async function sendPhoneOTP() {
  const button = $("sendPhoneOtp");
  setLoading(button, true);

  try {
    const phone = $("phoneNumber").value.trim();

    if (!PHONE_PATTERN.test(phone)) {
      throw new Error("Gunakan format +628xxxxxxxxxx.");
    }

    recaptcha = setupRecaptcha("recaptcha-container", recaptcha);

    confirmationResult = await signInWithPhoneNumber(
      auth, phone, recaptcha
    );

    $("otpPanel").hidden = false;
    toast("Kode verifikasi telah dikirim.");
  } catch (error) {
    logFirebaseError("PHONE OTP ERROR", error);
    showError("authError", authErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
}

async function verifyPhoneOTP() {
  try {
    if (!confirmationResult) {
      throw new Error("Kirim kode OTP terlebih dahulu.");
    }

    const code = $("phoneOtp").value.trim();

    if (!/^\d{6}$/.test(code)) {
      throw new Error("Masukkan 6 digit OTP.");
    }

    await confirmationResult.confirm(code);
  } catch (error) {
    showError("authError", authErrorMessage(error));
  }
}

async function completePhoneProfile() {
  try {
    const name = $("phoneProfileName").value.trim();
    const username = normalizeUsername(
      $("phoneProfileUsername").value
    );

    if (!name || !username) {
      throw new Error("Lengkapi nama dan username.");
    }

    await createUserProfile(user.uid, {
      name,
      username,
      phoneNumber: user.phoneNumber || ""
    });

    closeModal("phoneProfileModal");
    await enterApp();
  } catch (error) {
    showError("phoneProfileError", authErrorMessage(error));
  }
}

async function sendLinkPhoneOTP() {
  try {
    const phone = $("linkPhoneNumber").value.trim();

    if (!PHONE_PATTERN.test(phone)) {
      throw new Error("Gunakan format +628xxxxxxxxxx.");
    }

    linkRecaptcha = setupRecaptcha(
      "link-recaptcha-container",
      linkRecaptcha
    );

    linkConfirmationResult = await linkWithPhoneNumber(
      user, phone, linkRecaptcha
    );

    $("linkPhoneOtpPanel").hidden = false;
    toast("Kode OTP dikirim.");
  } catch (error) {
    showError("linkPhoneError", authErrorMessage(error));
  }
}

async function verifyLinkPhoneOTP() {
  try {
    if (!linkConfirmationResult) {
      throw new Error("Kirim OTP terlebih dahulu.");
    }

    await linkConfirmationResult.confirm(
      $("linkPhoneOtp").value.trim()
    );

    await updateDoc(doc(db, "users", user.uid), {
      phoneNumber: user.phoneNumber || "",
      updatedAt: serverTimestamp()
    });

    profile = await loadProfile(user.uid);
    updateProfileUI();

    closeModal("linkPhoneModal");
    toast("Nomor HP berhasil dihubungkan.");
  } catch (error) {
    showError("linkPhoneError", authErrorMessage(error));
  }
}

// =====================================
// IMAGE UPLOAD
// =====================================

async function uploadImage(file, folder) {
  if (!file) return "";

  if (!file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Ukuran gambar maksimal 5 MB.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${user.uid}/${Date.now()}_${safeName}`;
  const target = storageRef(storage, path);

  await uploadBytes(target, file);

  return getDownloadURL(target);
}

// =====================================
// PROFILE MANAGEMENT
// =====================================

async function saveProfile() {
  try {
    const name = $("profileName").value.trim();

    if (!name) {
      throw new Error("Nama tidak boleh kosong.");
    }

    let photoURL = profile.photoURL || "";
    const file = $("profilePhotoInput")?.files?.[0];

    if (file) {
      photoURL = await uploadImage(file, "profile");
    }

    await updateDoc(doc(db, "users", user.uid), {
      name,
      photoURL,
      bio: $("profileBio").value.trim(),
      updatedAt: serverTimestamp()
    });

    await updateProfile(user, { displayName: name });

    profile = await loadProfile(user.uid);
    updateProfileUI();

    closeModal("profileModal");
    toast("Profil berhasil diperbarui.");
  } catch (error) {
    logFirebaseError("SAVE PROFILE ERROR", error);
    toast(authErrorMessage(error), "error");
  }
}

// =====================================
// THEME
// =====================================

function setTheme() {
  const next =
    document.body.dataset.theme === "dark" ? "light" : "dark";

  document.body.dataset.theme = next;
  localStorage.setItem("zora-theme", next);
}

function loadTheme() {
  document.body.dataset.theme =
    localStorage.getItem("zora-theme") || "dark";
}

// =====================================
// CHAT HELPERS
// =====================================

function chatIdFor(a, b) {
  return [a, b].sort().join("_");
}

function messagesCollection(id, type = activeChatType) {
  if (type === "group") {
    return collection(db, "groups", id, "messages");
  }

  if (type === "channel") {
    return collection(db, "channels", id, "posts");
  }

  return collection(db, "chats", id, "messages");
}

async function getUserByUsername(value) {
  const username = normalizeUsername(value);

  if (!validUsername(username)) return null;

  const usernameSnap = await getDoc(doc(db, "usernames", username));

  if (!usernameSnap.exists()) return null;

  const uid = usernameSnap.data().uid;
  if (!uid) return null;

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return null;

  return { uid, ...userSnap.data() };
}

async function startPrivate(otherUid, otherProfile) {
  try {
    if (!user || !otherUid || otherUid === user.uid) return;

    const id = chatIdFor(user.uid, otherUid);
    const chatRef = doc(db, "chats", id);
    const snap = await getDoc(chatRef);

    if (!snap.exists()) {
      await setDoc(chatRef, {
        type: "private",
        members: [user.uid, otherUid].sort(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: "",
        lastSenderId: ""
      });
    } else {
      const members = snap.data().members || [];

      if (!members.includes(user.uid) || !members.includes(otherUid)) {
        throw new Error("Data anggota chat tidak valid.");
      }
    }

    await openConversation(id, {
      ...(snap.exists() ? snap.data() : {}),
      type: "private",
      members: [user.uid, otherUid],
      otherUid,
      otherName: otherProfile.name || otherProfile.username,
      otherUsername: otherProfile.username,
      otherPhoto: otherProfile.photoURL || "",
      otherVerified: otherProfile.verified === true
    });

    if ($("searchResults")) $("searchResults").innerHTML = "";
    if ($("searchUser")) $("searchUser").value = "";
  } catch (error) {
    logFirebaseError("START PRIVATE ERROR", error);
    toast("Gagal membuka chat: " + error.message, "error");
  }
}

// =====================================
// OPEN / CLOSE CHAT
// =====================================

async function openConversation(id, data) {
  cleanupConversation();

  activeChat = id;
  activeChatData = data;
  activeChatType = data.type || "private";

  if ($("emptyChat")) $("emptyChat").hidden = true;
  if ($("chatPanel")) $("chatPanel").hidden = false;

  const type = activeChatType;

  if ($("chatName")) {
    if (type === "private") {
      $("chatName").innerHTML = verifiedName(
        data.otherName || data.name || "Percakapan",
        data.otherVerified === true
      );
    } else {
      $("chatName").textContent = data.name || data.title || "Percakapan";
    }
  }

  if ($("chatAvatar")) {
    $("chatAvatar").textContent = initials(
      data.otherName || data.name || data.title
    );
  }

  if ($("chatPresence")) $("chatPresence").textContent = "";
  if ($("typingIndicator")) $("typingIndicator").hidden = true;

  const isChannel = type === "channel";
  const isOwner = data.ownerId === user.uid;

  if ($("composer")) $("composer").hidden = isChannel;
  if ($("channelComposer")) {
    $("channelComposer").hidden = !isChannel || !isOwner;
  }

  if ($("inviteGroupMember")) {
    $("inviteGroupMember").hidden = type !== "group";
  }

  if ($("channelControls")) {
    $("channelControls").hidden = !isChannel;
  }

  if (isChannel && $("channelControls")) {
    const canDelete = isOwner || isAdmin();

    $("channelControls").innerHTML = `
      <div class="channel-info">
        <strong>${escapeHTML(data.title || data.name || "Saluran")}</strong>
        <span>${Number(data.followers || 0)} pengikut</span>
      </div>
      ${isOwner ? '<span class="owner-label">PEMILIK SALURAN</span>' : ""}
      <button type="button" id="followChannelBtn" class="secondary-btn">
        Ikuti / Berhenti mengikuti
      </button>
      ${canDelete
        ? '<button type="button" id="deleteChannelBtn" class="danger-btn">Hapus Saluran</button>'
        : ""}
    `;

    $("followChannelBtn").onclick = toggleFollowChannel;

    const deleteButton = $("deleteChannelBtn");
    if (deleteButton) {
      deleteButton.onclick = () => deleteChannel(id, data);
    }
  }

  document.querySelector(".app")?.classList.add("chat-open");

  listenMessages(id, type);

  if (type === "private") {
    listenPresence(data.otherUid);
    listenTyping(id);
    listenOtherUserVerification(data.otherUid);
    markMessagesRead(id);
  }
}

function closeChat() {
  cleanupConversation();

  activeChat = null;
  activeChatData = null;
  activeChatType = "private";

  if ($("chatPanel")) $("chatPanel").hidden = true;
  if ($("emptyChat")) $("emptyChat").hidden = false;

  document.querySelector(".app")?.classList.remove("chat-open");
}

function cleanupConversation() {
  conversationVersion++;

  if (activeChatUnsubscribe) activeChatUnsubscribe();
  if (typingUnsubscribe) typingUnsubscribe();
  if (presenceUnsubscribe) presenceUnsubscribe();
  if (otherUserUnsubscribe) otherUserUnsubscribe();

  activeChatUnsubscribe = null;
  typingUnsubscribe = null;
  presenceUnsubscribe = null;
  otherUserUnsubscribe = null;
}

// =====================================
// LIVE VERIFIED STATUS
// =====================================

function listenOtherUserVerification(otherUid) {
  if (!otherUid) return;

  otherUserUnsubscribe = onSnapshot(
    doc(db, "users", otherUid),
    snapshot => {
      if (!snapshot.exists() || activeChatType !== "private") return;

      const other = snapshot.data();
      const name = other.name || other.username || "Pengguna";

      if ($("chatName")) {
        $("chatName").innerHTML = verifiedName(
          name,
          other.verified === true
        );
      }

      if (activeChatData) {
        activeChatData.otherVerified = other.verified === true;
        activeChatData.otherName = name;
      }
    },
    error => logFirebaseError("VERIFICATION LISTENER ERROR", error)
  );
}

// =====================================
// MESSAGE LISTENER - HISTORY FIX
// =====================================

function listenMessages(id, type = activeChatType) {
  if (activeChatUnsubscribe) {
    activeChatUnsubscribe();
    activeChatUnsubscribe = null;
  }

  const target = messagesCollection(id, type);

  activeChatUnsubscribe = onSnapshot(
    target,
    snapshot => {
      if (activeChat !== id || activeChatType !== type) return;

      const messages = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      messages.sort((a, b) =>
        timestampMillis(a.createdAt) -
        timestampMillis(b.createdAt)
      );

      renderMessages(messages);

      if (type === "private") {
        markMessagesRead(id);
      }
    },
    error => {
      logFirebaseError("LOAD MESSAGES ERROR", error);

      const container = $("messages");

      if (container) {
        container.innerHTML = `
          <div class="message-empty">
            <strong>Riwayat gagal dimuat</strong>
            <span>${escapeHTML(error.code || error.message)}</span>
          </div>
        `;
      }

      toast(
        "Gagal memuat riwayat: " +
        (error.code || error.message),
        "error"
      );
    }
  );
}

// =====================================
// RENDER MESSAGES
// =====================================

function renderMessages(messages) {
  const container = $("messages");
  if (!container) return;

  container.innerHTML = "";

  const visibleMessages = messages.filter(message =>
    !(message.deletedFor || []).includes(user.uid)
  );

  if (!visibleMessages.length) {
    container.innerHTML = `
      <div class="message-empty">
        <strong>Belum ada pesan</strong>
        <span>Mulai percakapan sekarang.</span>
      </div>
    `;
    return;
  }

  visibleMessages.forEach(message => {
    const mine = message.senderId === user.uid;
    const deletedAll = message.deletedForEveryone === true;

    const readByOthers = (message.readBy || []).some(
      uid => uid !== message.senderId
    );

    const tick = mine
      ? `<span class="message-tick ${readByOthers ? "read" : ""}">
          ${readByOthers ? "✓✓" : "✓"}
        </span>`
      : "";

    const image = message.imageURL
      ? `<img class="message-image"
          src="${escapeHTML(message.imageURL)}"
          alt="Gambar pesan">`
      : "";

    const content = deletedAll
      ? `<em class="deleted-message">Pesan ini telah dihapus.</em>`
      : `${image}${message.text
        ? `<div>${escapeHTML(message.text)}</div>`
        : ""}`;

    const node = document.createElement("article");

    node.className = `message ${mine ? "mine" : "theirs"}`;
    node.dataset.messageId = message.id;

    node.innerHTML = `
      ${!mine
        ? `<small class="message-sender">
            ${escapeHTML(message.senderName || "Pengguna")}
          </small>`
        : ""}
      <div class="message-bubble">
        ${content}
        <div class="message-meta">
          <time>${formatTime(message.createdAt)}</time>
          ${tick}
        </div>
      </div>
      <div class="message-actions">
        <button type="button" data-action="react">Reaksi</button>
        <button type="button" data-action="delete-me">Hapus untuk saya</button>
        ${mine
          ? '<button type="button" data-action="delete-all">Hapus untuk semua</button>'
          : ""}
      </div>
      <div class="reaction-list">
        ${renderReactions(message.reactions)}
      </div>
    `;

    node.querySelector('[data-action="react"]').onclick = () =>
      reactToMessage(message.id, message.reactions || {});

    node.querySelector('[data-action="delete-me"]').onclick = () =>
      deleteForMe(message.id);

    const deleteAllButton = node.querySelector('[data-action="delete-all"]');

    if (deleteAllButton) {
      deleteAllButton.onclick = () => deleteForEveryone(message.id);
    }

    node.querySelectorAll(".reaction-chip").forEach(button => {
      button.onclick = () =>
        reactToMessage(
          message.id,
          message.reactions || {},
          button.dataset.emoji
        );
    });

    container.appendChild(node);
  });

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderReactions(reactions = {}) {
  return Object.entries(reactions)
    .filter(([, users]) => Array.isArray(users) && users.length)
    .map(([emoji, users]) => `
      <button
        class="reaction-chip ${users.includes(user.uid) ? "selected" : ""}"
        data-emoji="${escapeHTML(emoji)}"
        type="button"
      >${escapeHTML(emoji)} ${users.length}</button>
    `)
    .join("");
}

// =====================================
// SEND MESSAGE - PRIVATE / GROUP
// =====================================

async function sendMessage() {
  if (!activeChat || activeChatType === "channel") return;

  const input = $("messageInput");
  const imageInput = $("imageInput");

  const text = input?.value.trim() || "";
  const file = imageInput?.files?.[0];

  if (!text && !file) return;

  const targetChat = activeChat;
  const targetType = activeChatType;

  try {
    let imageURL = "";

    if (file) {
      imageURL = await uploadImage(file, "messages");
    }

    const payload = {
      senderId: user.uid,
      senderName: String(profile.name || profile.username || "Pengguna"),
      text,
      imageURL,
      reactions: {},
      readBy: [user.uid],
      deletedFor: [],
      createdAt: serverTimestamp()
    };

    await addDoc(messagesCollection(targetChat, targetType), payload);

    if (activeChat === targetChat && activeChatType === targetType) {
      if (input) input.value = "";
      if (imageInput) imageInput.value = "";
    }

    const parentCollection =
      targetType === "group" ? "groups" : "chats";

    await updateDoc(doc(db, parentCollection, targetChat), {
      lastMessage: text || "Mengirim gambar",
      lastSenderId: user.uid,
      updatedAt: serverTimestamp()
    });

    await updateTyping(false).catch(() => {});

    toast("Pesan berhasil dikirim.");
  } catch (error) {
    logFirebaseError("SEND MESSAGE ERROR", error);

    toast(
      "Gagal mengirim pesan: " + (error.code || error.message),
      "error"
    );
  }
}

// =====================================
// DELETE / REACTION
// =====================================

async function deleteForMe(messageId) {
  if (!activeChat) return;

  const chatId = activeChat;
  const type = activeChatType;

  try {
    await updateDoc(
      doc(messagesCollection(chatId, type), messageId),
      { deletedFor: arrayUnion(user.uid) }
    );

    toast("Pesan dihapus dari tampilan lu.");
  } catch (error) {
    logFirebaseError("DELETE FOR ME ERROR", error);
    toast("Gagal menghapus pesan: " + error.message, "error");
  }
}

async function deleteForEveryone(messageId) {
  if (!activeChat) return;

  const chatId = activeChat;
  const type = activeChatType;

  const approved = await zoraConfirm(
    "Hapus pesan ini untuk semua orang?",
    { danger: true, confirmText: "Hapus pesan" }
  );

  if (!approved) return;

  try {
    await updateDoc(
      doc(messagesCollection(chatId, type), messageId),
      {
        deletedForEveryone: true,
        text: "",
        imageURL: ""
      }
    );

    toast("Pesan dihapus untuk semua orang.");
  } catch (error) {
    logFirebaseError("DELETE EVERYONE ERROR", error);
    toast("Gagal menghapus pesan: " + error.message, "error");
  }
}

async function reactToMessage(messageId, reactions, preset = null) {
  if (!activeChat) return;

  const chatId = activeChat;
  const type = activeChatType;
  const choices = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

  const selected = preset || await zoraDialog({
    title: "Pilih reaksi",
    message: "Pilih reaksi untuk pesan ini.",
    choices
  });

  if (!choices.includes(selected)) return;

  const users = Array.isArray(reactions[selected])
    ? [...reactions[selected]]
    : [];

  const index = users.indexOf(user.uid);

  if (index >= 0) users.splice(index, 1);
  else users.push(user.uid);

  try {
    await updateDoc(
      doc(messagesCollection(chatId, type), messageId),
      { [`reactions.${selected}`]: users }
    );
  } catch (error) {
    logFirebaseError("REACTION ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// READ RECEIPTS
// =====================================

async function markMessagesRead(chatId) {
  if (!user) return;

  try {
    const snap = await getDocs(
      collection(db, "chats", chatId, "messages")
    );

    const jobs = [];

    snap.forEach(item => {
      const data = item.data();

      if (
        data.senderId !== user.uid &&
        !(data.readBy || []).includes(user.uid)
      ) {
        jobs.push(
          updateDoc(item.ref, {
            readBy: arrayUnion(user.uid)
          })
        );
      }
    });

    await Promise.all(jobs);
  } catch (error) {
    logFirebaseError("READ RECEIPT ERROR", error);
  }
}

// =====================================
// CHAT LIST / HISTORY
// =====================================

function listenChats() {
  if (chatListUnsubscribe) {
    chatListUnsubscribe();
    chatListUnsubscribe = null;
  }

  if (!user) return;

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", user.uid)
  );

  chatListUnsubscribe = onSnapshot(q, async snapshot => {
    const chats = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => !hiddenChats.has(item.id))
      .sort((a, b) =>
        timestampMillis(b.updatedAt) -
        timestampMillis(a.updatedAt)
      );

    const container = $("chatList");
    if (!container) return;

    container.innerHTML = "";

    if (!chats.length) {
      container.innerHTML = `
        <div class="message-empty">
          <strong>Belum ada percakapan</strong>
          <span>Cari username untuk memulai chat.</span>
        </div>
      `;
      return;
    }

    const userCache = new Map();

    for (const chat of chats) {
      const otherUid = (chat.members || []).find(
        uid => uid !== user.uid
      );

      if (!otherUid) continue;

      let other = userCache.get(otherUid);

      if (!other) {
        try {
          const snap = await getDoc(doc(db, "users", otherUid));
          other = snap.exists()
            ? { uid: otherUid, ...snap.data() }
            : { uid: otherUid, name: "Pengguna" };

          userCache.set(otherUid, other);
        } catch (error) {
          logFirebaseError("CHAT USER LOAD ERROR", error);
          other = { uid: otherUid, name: "Pengguna" };
        }
      }

      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-list-item";
      item.innerHTML = `
        <span class="chat-list-avatar">
          ${escapeHTML(initials(other.name || other.username))}
        </span>
        <span class="chat-list-content">
          <strong>
            ${verifiedName(
              other.name || other.username || "Pengguna",
              other.verified === true
            )}
          </strong>
          <small>${escapeHTML(chat.lastMessage || "Mulai percakapan")}</small>
        </span>
        <span class="chat-list-time">
          ${formatDate(chat.updatedAt)}
        </span>
      `;

      item.onclick = () => startPrivate(otherUid, other);
      container.appendChild(item);
    }
  }, error => {
    logFirebaseError("CHAT LIST ERROR", error);
    toast("Gagal memuat daftar chat: " + error.code, "error");
  });
}

// =====================================
// SEARCH USERS
// =====================================

async function searchUsers() {
  const input = $("searchUser");
  const container = $("searchResults");

  if (!input || !container) return;

  const username = normalizeUsername(input.value);

  if (!username) {
    container.innerHTML = "";
    return;
  }

  if (!validUsername(username)) {
    container.innerHTML = `
      <div class="message-empty">
        Username harus 3–20 karakter.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="message-empty">Mencari pengguna...</div>
  `;

  try {
    const result = await getUserByUsername(username);

    if (!result) {
      container.innerHTML = `
        <div class="message-empty">
          Pengguna tidak ditemukan.
        </div>
      `;
      return;
    }

    if (result.uid === user.uid) {
      container.innerHTML = `
        <div class="message-empty">
          Itu akun lu sendiri.
        </div>
      `;
      return;
    }

    container.innerHTML = "";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-result";

    item.innerHTML = `
      <span class="chat-list-avatar">
        ${escapeHTML(initials(result.name))}
      </span>
      <span class="chat-list-content">
        <strong>
          ${verifiedName(
            result.name || result.username,
            result.verified === true
          )}
        </strong>
        <small>@${escapeHTML(result.username)}</small>
      </span>
      <span class="search-open">Chat</span>
    `;

    item.onclick = () => startPrivate(result.uid, result);
    container.appendChild(item);
  } catch (error) {
    logFirebaseError("SEARCH USER ERROR", error);

    container.innerHTML = `
      <div class="message-empty">
        Pencarian gagal: ${escapeHTML(error.code || error.message)}
      </div>
    `;
  }
}

// =====================================
// HIDE CHAT
// =====================================

async function hideCurrentChat() {
  if (!activeChat || activeChatType !== "private") return;

  const approved = await zoraConfirm(
    "Sembunyikan percakapan ini dari daftar chat?",
    { confirmText: "Sembunyikan" }
  );

  if (!approved) return;

  hiddenChats.add(activeChat);
  closeChat();
  listenChats();
}

// =====================================
// TYPING INDICATOR
// =====================================

async function updateTyping(isTyping) {
  if (!activeChat || activeChatType !== "private") return;

  const typingRef = doc(
    db,
    "chats",
    activeChat,
    "typing",
    user.uid
  );

  if (isTyping) {
    await setDoc(typingRef, {
      uid: user.uid,
      name: profile.name || profile.username,
      updatedAt: serverTimestamp()
    });
  } else {
    await deleteDoc(typingRef);
  }
}

function listenTyping(chatId) {
  if (typingUnsubscribe) typingUnsubscribe();

  const typingCollection = collection(
    db,
    "chats",
    chatId,
    "typing"
  );

  typingUnsubscribe = onSnapshot(
    typingCollection,
    snapshot => {
      const otherTyping = snapshot.docs.some(item => {
        const data = item.data();

        return (
          data.uid !== user.uid &&
          Date.now() - timestampMillis(data.updatedAt) < 10000
        );
      });

      if ($("typingIndicator")) {
        $("typingIndicator").hidden = !otherTyping;
        $("typingIndicator").textContent =
          otherTyping ? "Sedang mengetik..." : "";
      }
    },
    error => logFirebaseError("TYPING LISTENER ERROR", error)
  );
}

// =====================================
// PRESENCE
// =====================================

function setupPresence() {
  if (!user) return;

  const statusRef = dbRef(rtdb, `status/${user.uid}`);

  const connectedRef = dbRef(rtdb, ".info/connected");

  onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true) return;

    try {
      await onDisconnect(statusRef).set({
        state: "offline",
        lastChanged: rtdbTimestamp()
      });

      await rtdbSet(statusRef, {
        state: "online",
        lastChanged: rtdbTimestamp()
      });
    } catch (error) {
      console.error("PRESENCE ERROR", error);
    }
  });
}

function listenPresence(otherUid) {
  if (!otherUid) return;

  if (presenceUnsubscribe) presenceUnsubscribe();

  const statusRef = dbRef(rtdb, `status/${otherUid}`);

  presenceUnsubscribe = onValue(statusRef, snapshot => {
    const data = snapshot.val();

    if ($("chatPresence")) {
      $("chatPresence").textContent =
        data?.state === "online"
          ? "Online"
          : "Offline";
    }
  }, error => {
    console.error("PRESENCE LISTENER ERROR", error);
  });
}

// =====================================
// GROUPS
// =====================================

function listenGroups() {
  if (groupUnsubscribe) {
    groupUnsubscribe();
    groupUnsubscribe = null;
  }

  if (!user) return;

  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", user.uid)
  );

  groupUnsubscribe = onSnapshot(q, snapshot => {
    const groups = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) =>
        timestampMillis(b.updatedAt) -
        timestampMillis(a.updatedAt)
      );

    const container = $("groupList");
    if (!container) return;

    container.innerHTML = "";

    if (!groups.length) {
      container.innerHTML = `
        <div class="message-empty">
          <strong>Belum ada grup</strong>
          <span>Buat grup untuk mulai ngobrol bersama.</span>
        </div>
      `;
      return;
    }

    groups.forEach(group => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-list-item";

      item.innerHTML = `
        <span class="chat-list-avatar">
          ${escapeHTML(initials(group.name))}
        </span>
        <span class="chat-list-content">
          <strong>${escapeHTML(group.name || "Grup")}</strong>
          <small>${escapeHTML(group.lastMessage || "Belum ada pesan")}</small>
        </span>
        <span class="chat-list-time">
          ${formatDate(group.updatedAt)}
        </span>
      `;

      item.onclick = () => openConversation(group.id, {
        ...group,
        type: "group"
      });

      container.appendChild(item);
    });
  }, error => {
    logFirebaseError("GROUP LIST ERROR", error);
    toast("Gagal memuat grup: " + error.code, "error");
  });
}

async function createGroup() {
  try {
    const name = await zoraPrompt(
      "Masukkan nama grup.",
      { title: "Buat grup", placeholder: "Nama grup" }
    );

    if (!name) return;

    const cleanName = name.trim();

    if (cleanName.length < 2 || cleanName.length > 50) {
      throw new Error("Nama grup harus 2–50 karakter.");
    }

    const groupRef = await addDoc(collection(db, "groups"), {
      name: cleanName,
      ownerId: user.uid,
      members: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastSenderId: ""
    });

    toast("Grup berhasil dibuat.");

    await openConversation(groupRef.id, {
      id: groupRef.id,
      name: cleanName,
      ownerId: user.uid,
      members: [user.uid],
      type: "group"
    });
  } catch (error) {
    logFirebaseError("CREATE GROUP ERROR", error);
    toast("Gagal membuat grup: " + error.message, "error");
  }
}

async function inviteGroupMember() {
  if (!activeChat || activeChatType !== "group") return;

  try {
    const username = await zoraPrompt(
      "Masukkan username anggota yang ingin ditambahkan.",
      { title: "Tambah anggota", placeholder: "@username" }
    );

    if (!username) return;

    const found = await getUserByUsername(username);

    if (!found) throw new Error("Pengguna tidak ditemukan.");

    const groupRef = doc(db, "groups", activeChat);
    const snap = await getDoc(groupRef);

    if (!snap.exists()) throw new Error("Grup tidak ditemukan.");

    const data = snap.data();

    if (data.ownerId !== user.uid && !isAdmin()) {
      throw new Error("Hanya pemilik grup yang dapat menambah anggota.");
    }

    if ((data.members || []).includes(found.uid)) {
      throw new Error("Pengguna sudah menjadi anggota.");
    }

    await updateDoc(groupRef, {
      members: arrayUnion(found.uid),
      updatedAt: serverTimestamp()
    });

    toast("Anggota berhasil ditambahkan.");
  } catch (error) {
    logFirebaseError("INVITE GROUP ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// CHANNELS
// =====================================

function listenChannels() {
  if (channelUnsubscribe) {
    channelUnsubscribe();
    channelUnsubscribe = null;
  }

  if (!user) return;

  channelUnsubscribe = onSnapshot(
    collection(db, "channels"),
    snapshot => {
      const channels = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .sort((a, b) =>
          timestampMillis(b.updatedAt) -
          timestampMillis(a.updatedAt)
        );

      const container = $("channelList");
      if (!container) return;

      container.innerHTML = "";

      if (!channels.length) {
        container.innerHTML = `
          <div class="message-empty">
            Belum ada saluran.
          </div>
        `;
        return;
      }

      channels.forEach(channel => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "chat-list-item";

        item.innerHTML = `
          <span class="chat-list-avatar">
            ${escapeHTML(initials(channel.name || channel.title))}
          </span>
          <span class="chat-list-content">
            <strong>${escapeHTML(channel.name || channel.title || "Saluran")}</strong>
            <small>${escapeHTML(channel.description || "Saluran ZORAAPP")}</small>
          </span>
          <span class="chat-list-time">
            ${Number(channel.followers || 0)} pengikut
          </span>
        `;

        item.onclick = () => openConversation(channel.id, {
          ...channel,
          type: "channel"
        });

        container.appendChild(item);
      });
    },
    error => {
      logFirebaseError("CHANNEL LIST ERROR", error);
      toast("Gagal memuat saluran: " + error.code, "error");
    }
  );
}

async function createChannel() {
  try {
    const name = await zoraPrompt(
      "Masukkan nama saluran.",
      { title: "Buat saluran" }
    );

    if (!name) return;

    const description = await zoraPrompt(
      "Masukkan deskripsi saluran.",
      { title: "Deskripsi saluran" }
    );

    const channelRef = await addDoc(collection(db, "channels"), {
      name: name.trim(),
      title: name.trim(),
      description: description || "",
      ownerId: user.uid,
      followers: 0,
      followerIds: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");

    await openConversation(channelRef.id, {
      id: channelRef.id,
      name: name.trim(),
      title: name.trim(),
      ownerId: user.uid,
      type: "channel",
      followers: 0,
      followerIds: [user.uid]
    });
  } catch (error) {
    logFirebaseError("CREATE CHANNEL ERROR", error);
    toast(error.message, "error");
  }
}

async function toggleFollowChannel() {
  if (!activeChat || activeChatType !== "channel") return;

  try {
    const channelRef = doc(db, "channels", activeChat);
    const snap = await getDoc(channelRef);

    if (!snap.exists()) throw new Error("Saluran tidak ditemukan.");

    const data = snap.data();
    const followers = data.followerIds || [];
    const alreadyFollowing = followers.includes(user.uid);

    const nextFollowers = alreadyFollowing
      ? followers.filter(uid => uid !== user.uid)
      : [...followers, user.uid];

    await updateDoc(channelRef, {
      followerIds: nextFollowers,
      followers: nextFollowers.length,
      updatedAt: serverTimestamp()
    });

    toast(
      alreadyFollowing
        ? "Berhenti mengikuti saluran."
        : "Berhasil mengikuti saluran."
    );
  } catch (error) {
    logFirebaseError("FOLLOW CHANNEL ERROR", error);
    toast(error.message, "error");
  }
}

async function sendChannelPost() {
  if (!activeChat || activeChatType !== "channel") return;

  try {
    const input = $("channelMessageInput");
    const text = input?.value.trim();

    if (!text) return;

    if (activeChatData?.ownerId !== user.uid && !isAdmin()) {
      throw new Error("Hanya pemilik saluran yang dapat mengirim postingan.");
    }

    await addDoc(
      collection(db, "channels", activeChat, "posts"),
      {
        senderId: user.uid,
        senderName: profile.name || profile.username,
        text,
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(doc(db, "channels", activeChat), {
      lastMessage: text,
      updatedAt: serverTimestamp()
    });

    input.value = "";
    toast("Postingan berhasil dikirim.");
  } catch (error) {
    logFirebaseError("CHANNEL POST ERROR", error);
    toast(error.message, "error");
  }
}

async function deleteChannel(id, data) {
  if (data.ownerId !== user.uid && !isAdmin()) {
    toast("Tidak memiliki izin.", "error");
    return;
  }

  const approved = await zoraConfirm(
    "Hapus saluran ini?",
    { danger: true, confirmText: "Hapus saluran" }
  );

  if (!approved) return;

  try {
    await deleteDoc(doc(db, "channels", id));
    closeChat();
    toast("Saluran berhasil dihapus.");
  } catch (error) {
    logFirebaseError("DELETE CHANNEL ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// STATUS
// =====================================

function listenStatuses() {
  if (statusUnsubscribe) {
    statusUnsubscribe();
    statusUnsubscribe = null;
  }

  if (!user) return;

  statusUnsubscribe = onSnapshot(
    collection(db, "statuses"),
    snapshot => {
      const statuses = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(item => {
          const expires = timestampMillis(item.expiresAt);
          return !expires || expires > Date.now();
        })
        .sort((a, b) =>
          timestampMillis(b.createdAt) -
          timestampMillis(a.createdAt)
        );

      const container = $("statusList");
      if (!container) return;

      container.innerHTML = "";

      if (!statuses.length) {
        container.innerHTML = `
          <div class="message-empty">Belum ada status.</div>
        `;
        return;
      }

      statuses.forEach(status => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "status-item";

        item.innerHTML = `
          <span class="status-avatar">
            ${escapeHTML(initials(status.name))}
          </span>
          <span>
            <strong>${escapeHTML(status.name || "Pengguna")}</strong>
            <small>${formatDate(status.createdAt)}</small>
          </span>
        `;

        item.onclick = () => viewStatus(status);
        container.appendChild(item);
      });
    },
    error => {
      logFirebaseError("STATUS LISTENER ERROR", error);
    }
  );
}

async function createStatus() {
  try {
    const text = await zoraPrompt(
      "Tulis status yang ingin dibagikan.",
      { title: "Buat status" }
    );

    if (!text) return;

    if (text.length > 500) {
      throw new Error("Status maksimal 500 karakter.");
    }

    await addDoc(collection(db, "statuses"), {
      uid: user.uid,
      name: profile.name || profile.username,
      text,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    toast("Status berhasil dibagikan.");
  } catch (error) {
    logFirebaseError("CREATE STATUS ERROR", error);
    toast(error.message, "error");
  }
}

function viewStatus(status) {
  const modal = $("statusViewer");
  const content = $("statusViewerContent");

  if (!modal || !content) {
    toast(status.text || "Status", "normal");
    return;
  }

  content.innerHTML = `
    <div class="status-viewer-author">
      <strong>${escapeHTML(status.name || "Pengguna")}</strong>
      <small>${formatDate(status.createdAt)}</small>
    </div>
    <p>${escapeHTML(status.text || "")}</p>
  `;

  modal.hidden = false;
}

// =====================================
// ADMIN PANEL
// =====================================

function listenAdminAppeals() {
  if (!isAdmin()) return;

  if (appealUnsubscribe) appealUnsubscribe();

  appealUnsubscribe = onSnapshot(
    collection(db, "appeals"),
    snapshot => {
      const appeals = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .sort((a, b) =>
          timestampMillis(b.createdAt) -
          timestampMillis(a.createdAt)
        );

      const container = $("appealList");
      if (!container) return;

      container.innerHTML = "";

      if (!appeals.length) {
        container.innerHTML = `
          <div class="message-empty">Tidak ada permohonan.</div>
        `;
        return;
      }

      appeals.forEach(appeal => {
        const item = document.createElement("div");
        item.className = "admin-appeal";

        item.innerHTML = `
          <div>
            <strong>${escapeHTML(appeal.name || appeal.username || "Pengguna")}</strong>
            <p>${escapeHTML(appeal.message || "")}</p>
            <small>Status: ${escapeHTML(appeal.status || "pending")}</small>
          </div>
          <div class="admin-actions">
            <button type="button" data-action="approve">Terima</button>
            <button type="button" data-action="reject">Tolak</button>
          </div>
        `;

        item.querySelector('[data-action="approve"]').onclick = () =>
          resolveAppeal(appeal, "approved");

        item.querySelector('[data-action="reject"]').onclick = () =>
          resolveAppeal(appeal, "rejected");

        container.appendChild(item);
      });
    },
    error => {
      logFirebaseError("ADMIN APPEALS ERROR", error);
      toast("Gagal memuat permohonan.", "error");
    }
  );
}

async function resolveAppeal(appeal, status) {
  if (!isAdmin()) return;

  try {
    await updateDoc(doc(db, "appeals", appeal.id), {
      status,
      reviewedBy: user.uid,
      reviewedAt: serverTimestamp()
    });

    toast("Permohonan diperbarui.");
  } catch (error) {
    logFirebaseError("RESOLVE APPEAL ERROR", error);
    toast(error.message, "error");
  }
}

async function submitAppeal() {
  try {
    const message = $("appealMessage")?.value.trim();

    if (!message) {
      throw new Error("Isi alasan permohonan.");
    }

    await addDoc(collection(db, "appeals"), {
      uid: user.uid,
      name: profile.name || profile.username,
      username: profile.username,
      message,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealMessage").value = "";
    toast("Permohonan berhasil dikirim.");
  } catch (error) {
    logFirebaseError("SUBMIT APPEAL ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// ADMIN VERIFIED ACCOUNT
// =====================================

async function setUserVerified(uid, verified) {
  if (!isAdmin()) {
    toast("Akses ditolak.", "error");
    return;
  }

  try {
    await updateDoc(doc(db, "users", uid), {
      verified: Boolean(verified),
      verifiedAt: verified ? serverTimestamp() : null,
      verifiedBy: verified ? user.uid : null
    });

    toast(
      verified
        ? "Akun berhasil diverifikasi."
        : "Verifikasi akun dicabut."
    );
  } catch (error) {
    logFirebaseError("SET VERIFIED ERROR", error);
    toast(error.message, "error");
  }
}

async function searchAdminUser() {
  if (!isAdmin()) return;

  const username = normalizeUsername(
    $("adminSearchUsername")?.value
  );

  const container = $("adminUserResult");
  if (!container) return;

  if (!username) {
    container.innerHTML = "";
    return;
  }

  try {
    const found = await getUserByUsername(username);

    if (!found) {
      container.textContent = "Pengguna tidak ditemukan.";
      return;
    }

    container.innerHTML = `
      <div class="admin-user-card">
        <strong>${escapeHTML(found.name || found.username)}</strong>
        <small>@${escapeHTML(found.username)}</small>
        <p>Status: ${found.verified ? "Terverifikasi" : "Belum terverifikasi"}</p>
        <button type="button" id="adminVerifyToggle">
          ${found.verified ? "Cabut centang biru" : "Verifikasi akun"}
        </button>
      </div>
    `;

    $("adminVerifyToggle").onclick = () =>
      setUserVerified(found.uid, !found.verified);
  } catch (error) {
    logFirebaseError("ADMIN USER SEARCH ERROR", error);
    container.textContent = error.message;
  }
}

// =====================================
// ACCOUNT STATUS
// =====================================

async function checkAccountStatus() {
  if (!user) return;

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    showOnly("recoveredScreen");
    return;
  }

  profile = { uid: user.uid, ...snap.data() };

  if (profile.status === "hold") {
    showOnly("holdScreen");
    return;
  }

  if (profile.status === "permanent") {
    showOnly("permanentScreen");
    return;
  }

  if (profile.status === "recovered") {
    showOnly("recoveredScreen");
    return;
  }

  showOnly("appScreen");
}

// =====================================
// APP INITIALIZATION
// =====================================

async function enterApp() {
  if (!user) return;

  try {
    profile = await loadProfile(user.uid);

    if (!profile) {
      showOnly("recoveredScreen");
      return;
    }

    if (profile.status === "hold") {
      showOnly("holdScreen");
      return;
    }

    if (profile.status === "permanent") {
      showOnly("permanentScreen");
      return;
    }

    if (profile.status === "recovered") {
      showOnly("recoveredScreen");
      return;
    }

    showOnly("appScreen");

    updateProfileUI();

    listenChats();
    listenGroups();
    listenChannels();
    listenStatuses();

    setupPresence();

    if (isAdmin()) {
      listenAdminAppeals();
    }

    showPage("chatPage");
  } catch (error) {
    logFirebaseError("ENTER APP ERROR", error);
    toast("Gagal membuka aplikasi: " + error.message, "error");
  }
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
  const approved = await zoraConfirm(
    "Yakin ingin keluar dari akun?",
    { confirmText: "Keluar", danger: true }
  );

  if (!approved) return;

  try {
    cleanupConversation();

    if (chatListUnsubscribe) chatListUnsubscribe();
    if (groupUnsubscribe) groupUnsubscribe();
    if (channelUnsubscribe) channelUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();
    if (appealUnsubscribe) appealUnsubscribe();

    await signOut(auth);

    user = null;
    profile = null;

    showOnly("authScreen");
    toast("Berhasil keluar.");
  } catch (error) {
    logFirebaseError("LOGOUT ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// EVENT LISTENERS
// =====================================

function bind(id, event, callback) {
  const el = $(id);
  if (el) el.addEventListener(event, callback);
}

function bindEvents() {
  // Authentication
  bind("loginBtn", "click", loginEmail);
  bind("registerBtn", "click", registerEmail);
  bind("forgotPassword", "click", forgotPassword);
  bind("sendPhoneOtp", "click", sendPhoneOTP);
  bind("verifyPhoneOtp", "click", verifyPhoneOTP);
  bind("completePhoneProfile", "click", completePhoneProfile);
  bind("sendLinkPhoneOtp", "click", sendLinkPhoneOTP);
  bind("verifyLinkPhoneOtp", "click", verifyLinkPhoneOTP);

  // Profile
  bind("saveProfileBtn", "click", saveProfile);
  bind("logoutBtn", "click", logout);

  // Search
  bind("searchUserBtn", "click", searchUsers);

  bind("searchUser", "keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchUsers();
    }
  });

  bind("searchUser", "input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchUsers, 450);
  });

  // Message
  bind("sendMessageBtn", "click", sendMessage);

  bind("messageInput", "keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  bind("messageInput", "input", () => {
    updateTyping(true).catch(error =>
      console.error("TYPING UPDATE ERROR", error)
    );
  });

  bind("messageInput", "blur", () => {
    updateTyping(false).catch(() => {});
  });

  bind("imageInput", "change", () => {
    const file = $("imageInput")?.files?.[0];

    if (file && file.size > MAX_IMAGE_SIZE) {
      toast("Ukuran gambar maksimal 5 MB.", "error");
      $("imageInput").value = "";
    }
  });

  // Navigation
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
    });
  });

  bind("backToChats", "click", closeChat);
  bind("hideChatBtn", "click", hideCurrentChat);

  // Groups
  bind("createGroupBtn", "click", createGroup);
  bind("inviteGroupMember", "click", inviteGroupMember);

  // Channels
  bind("createChannelBtn", "click", createChannel);
  bind("sendChannelPostBtn", "click", sendChannelPost);

  bind("channelMessageInput", "keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChannelPost();
    }
  });

  // Status
  bind("createStatusBtn", "click", createStatus);
  bind("closeStatusViewer", "click", () => {
    if ($("statusViewer")) $("statusViewer").hidden = true;
  });

  // Admin
  bind("adminSearchBtn", "click", searchAdminUser);
  bind("submitAppealBtn", "click", submitAppeal);

  // Theme
  bind("themeToggle", "click", setTheme);

  // Modals
  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", () => {
      closeModal(button.dataset.closeModal);
    });
  });

  bind("openProfile", "click", () => openModal("profileModal"));
  bind("openAdmin", "click", () => {
    if (isAdmin()) showPage("adminPage");
  });
}

// =====================================
// AUTH STATE
// =====================================

onAuthStateChanged(auth, async currentUser => {
  user = currentUser;

  if (!currentUser) {
    cleanupConversation();
    showOnly("authScreen");
    return;
  }

  await enterApp();
});

// =====================================
// START APPLICATION
// =====================================

function initialize() {
  installZoraDialog();
  installVerifiedStyle();
  installPremiumButtonStyle();
  loadTheme();
  bindEvents();
}

initialize();
