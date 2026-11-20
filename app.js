
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

// =====================================
// CONFIG
// =====================================

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

// =====================================
// GENERAL HELPERS
// =====================================

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
// VERIFIED BADGE
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

  if ($("profileName")) {
    $("profileName").value = profile.name || "";
  }

  if ($("profileUsername")) {
    $("profileUsername").value = profile.username || "";
  }

  if ($("profileBio")) {
    $("profileBio").value = profile.bio || "";
  }

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
// CUSTOM ZORAAPP DIALOG
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
    #zoraDialog .zd-title{
      font-size:18px;font-weight:700;margin:0 0 8px;
    }
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
    #zoraDialog .zd-cancel{
      color:inherit;background:rgba(255,255,255,.09);
    }
    #zoraDialog .zd-ok{
      color:white;background:#3978e8;
    }
    #zoraDialog .zd-danger{background:#d94350}
    #zoraDialog .zd-choices{
      display:flex;flex-wrap:wrap;gap:9px;margin:0 0 18px;
    }
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

      ok.onclick = () => {
        finish(input ? inputElement.value : true);
      };

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
      auth,
      phone,
      recaptcha
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
      user,
      phone,
      linkRecaptcha
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

  const usernameSnap = await getDoc(
    doc(db, "usernames", username)
  );

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

    if ($("searchResults")) {
      $("searchResults").innerHTML = "";
    }

    if ($("searchUser")) {
      $("searchUser").value = "";
    }
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

  const version = ++conversationVersion;

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
      $("chatName").textContent =
        data.name || data.title || "Percakapan";
    }
  }

  if ($("chatAvatar")) {
    $("chatAvatar").textContent = initials(
      data.otherName || data.name || data.title
    );
  }

  if ($("chatPresence")) {
    $("chatPresence").textContent = "";
  }

  if ($("typingIndicator")) {
    $("typingIndicator").hidden = true;
  }

  const isChannel = type === "channel";
  const isOwner = data.ownerId === user.uid;

  if ($("composer")) {
    $("composer").hidden = isChannel;
  }

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
// LIVE VERIFIED STATUS FOR OPEN CHAT
// =====================================

function listenOtherUserVerification(otherUid) {
  if (!otherUid) return;

  otherUserUnsubscribe = onSnapshot(
    doc(db, "users", otherUid),
    snapshot => {
      if (!snapshot.exists()) return;
      if (activeChatType !== "private") return;

      const other = snapshot.data();
      const name =
        other.name || other.username || "Pengguna";

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
    error => {
      logFirebaseError("VERIFICATION LISTENER ERROR", error);
    }
  );
}

// =====================================
// MESSAGE LISTENER
// =====================================

function listenMessages(id, type = activeChatType) {
  if (activeChatUnsubscribe) {
    activeChatUnsubscribe();
  }

  const target = messagesCollection(id, type);

  // Tidak memakai orderBy atau limit.
  // Pesan lama tanpa createdAt tetap dapat dimuat.
  activeChatUnsubscribe = onSnapshot(
    target,
    snapshot => {
      if (activeChat !== id || activeChatType !== type) return;

      const messages = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      messages.sort((a, b) => {
        return timestampMillis(a.createdAt) -
          timestampMillis(b.createdAt);
      });

      renderMessages(messages);

      if (type === "private") {
        markMessagesRead(id);
      }
    },
    error => {
      logFirebaseError("LOAD MESSAGES ERROR", error);

      toast(
        "Gagal memuat pesan: " +
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
        <button type="button" data-action="delete-me">
          Hapus untuk saya
        </button>
        ${mine
          ? '<button type="button" data-action="delete-all">Hapus untuk semua</button>'
          : ""}
      </div>
      <div class="reaction-list">
        ${renderReactions(message.reactions)}
      </div>
    `;

    node.querySelector('[data-action="react"]').onclick = () => {
      reactToMessage(message.id, message.reactions || {});
    };

    node.querySelector('[data-action="delete-me"]').onclick = () => {
      deleteForMe(message.id);
    };

    const deleteAllButton =
      node.querySelector('[data-action="delete-all"]');

    if (deleteAllButton) {
      deleteAllButton.onclick = () => {
        deleteForEveryone(message.id);
      };
    }

    node.querySelectorAll(".reaction-chip").forEach(button => {
      button.onclick = () => {
        reactToMessage(
          message.id,
          message.reactions || {},
          button.dataset.emoji
        );
      };
    });

    container.appendChild(node);
  });

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderReactions(reactions = {}) {
  return Object.entries(reactions)
    .filter(([, users]) =>
      Array.isArray(users) && users.length
    )
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
// SEND MESSAGE
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
      senderName: String(
        profile.name || profile.username || "Pengguna"
      ),
      text,
      imageURL,
      reactions: {},
      readBy: [user.uid],
      deletedFor: [],
      createdAt: serverTimestamp()
    };

    const target = messagesCollection(targetChat, targetType);

    await addDoc(target, payload);

    if (activeChat === targetChat) {
      if (input) input.value = "";
      if (imageInput) imageInput.value = "";
    }

    const parentCollection =
      targetType === "group" ? "groups" : "chats";

    await updateDoc(
      doc(db, parentCollection, targetChat),
      {
        lastMessage: text || "Mengirim gambar",
        lastSenderId: user.uid,
        updatedAt: serverTimestamp()
      }
    );

    await updateTyping(false).catch(() => {});

    toast("Pesan berhasil dikirim.");
  } catch (error) {
    logFirebaseError("SEND MESSAGE ERROR", error);

    toast(
      "Gagal mengirim pesan: " +
      (error.code || error.message),
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
    {
      danger: true,
      confirmText: "Hapus pesan"
    }
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

  if (index >= 0) {
    users.splice(index, 1);
  } else {
    users.push(user.uid);
  }

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
    // Ambil pesan tanpa orderBy agar pesan lama tetap terbaca.
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
// HIDDEN CHATS
// =====================================

async function hideChat(chatId) {
  try {
    await setDoc(
      doc(db, "users", user.uid, "hiddenChats", chatId),
      {
        chatId,
        hiddenAt: serverTimestamp()
      }
    );

    hiddenChats.add(chatId);
    closeChat();

    toast("Chat disembunyikan dari daftar lu.");
    listenChats();
  } catch (error) {
    logFirebaseError("HIDE CHAT ERROR", error);
    toast("Gagal menyembunyikan chat: " + error.message, "error");
  }
}

async function loadHiddenChats() {
  hiddenChats.clear();

  const snap = await getDocs(
    collection(db, "users", user.uid, "hiddenChats")
  );

  snap.forEach(item => hiddenChats.add(item.id));
}

// =====================================
// PRIVATE CHAT LIST
// =====================================

function listenChats() {
  if (chatListUnsubscribe) {
    chatListUnsubscribe();
  }

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", user.uid)
  );

  chatListUnsubscribe = onSnapshot(
    q,
    async snapshot => {
      const container = $("chatList");
      if (!container) return;

      const items = snapshot.docs
        .filter(item => !hiddenChats.has(item.id))
        .sort((a, b) => {
          return timestampMillis(b.data().updatedAt) -
            timestampMillis(a.data().updatedAt);
        });

      container.innerHTML = "";

      for (const item of items) {
        const data = item.data();

        const otherUid =
          data.members?.find(uid => uid !== user.uid);

        if (!otherUid) continue;

        let other = {};

        try {
          const otherSnap = await getDoc(
            doc(db, "users", otherUid)
          );

          if (otherSnap.exists()) {
            other = otherSnap.data();
          }
        } catch (error) {
          logFirebaseError("LOAD CHAT USER ERROR", error);
        }

        // Hindari menampilkan hasil lama jika snapshot berubah.
        if (!container.isConnected) return;

        const row = document.createElement("button");

        row.type = "button";
        row.className = "list-item";

        row.innerHTML = `
          <span class="avatar">
            ${escapeHTML(initials(other.name || other.username))}
          </span>
          <span class="list-copy">
            <strong>
              ${verifiedName(
                other.name || other.username || "Pengguna",
                other.verified === true
              )}
            </strong>
            <small>${escapeHTML(data.lastMessage || "Mulai percakapan")}</small>
          </span>
          <span class="list-time">
            ${formatTime(data.updatedAt)}
          </span>
        `;

        row.onclick = () => {
          openConversation(item.id, {
            ...data,
            type: "private",
            otherUid,
            otherName: other.name || other.username,
            otherUsername: other.username,
            otherPhoto: other.photoURL || "",
            otherVerified: other.verified === true
          });
        };

        row.oncontextmenu = async event => {
          event.preventDefault();

          if (await zoraConfirm(
            "Sembunyikan chat ini dari daftar?"
          )) {
            hideChat(item.id);
          }
        };

        container.appendChild(row);
      }

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">Belum ada percakapan.</div>
        `;
      }
    },
    error => {
      logFirebaseError("LOAD CHATS ERROR", error);
      toast("Gagal memuat chat: " + error.message, "error");
    }
  );
}

// =====================================
// SEARCH USERS
// =====================================

async function searchUsers() {
  const term = normalizeUsername($("searchUser")?.value);
  const output = $("searchResults");

  if (!output) return;

  output.innerHTML = "";

  if (term.length < 2) return;

  try {
    const q = query(
      collection(db, "usernames"),
      where("username", ">=", term),
      where("username", "<=", term + "\uf8ff"),
      limit(10)
    );

    const snap = await getDocs(q);

    for (const item of snap.docs) {
      const data = item.data();

      if (!data.uid || data.uid === user.uid) continue;

      const userSnap = await getDoc(
        doc(db, "users", data.uid)
      );

      if (!userSnap.exists()) continue;

      const target = userSnap.data();
      const button = document.createElement("button");

      button.className = "search-result";
      button.type = "button";

      button.innerHTML = `
        <span class="avatar">
          ${escapeHTML(initials(target.name))}
        </span>
        <span>
          <strong>
            ${verifiedName(
              target.name || "Pengguna",
              target.verified === true
            )}
          </strong>
          <small>@${escapeHTML(target.username || data.username)}</small>
        </span>
      `;

      button.onclick = () => startPrivate(data.uid, target);

      output.appendChild(button);
    }

    if (!output.children.length) {
      output.innerHTML = `
        <div class="empty-list">Pengguna tidak ditemukan.</div>
      `;
    }
  } catch (error) {
    logFirebaseError("SEARCH USERS ERROR", error);
    output.textContent = "Pencarian gagal: " + error.message;
  }
}

// =====================================
// TYPING
// =====================================

async function updateTyping(isTyping) {
  const chatId = activeChat;

  if (!chatId || activeChatType !== "private") return;

  const path = dbRef(
    rtdb,
    `typing/${chatId}/${user.uid}`
  );

  await rtdbSet(
    path,
    isTyping
      ? {
          typing: true,
          name: profile.name,
          updatedAt: rtdbTimestamp()
        }
      : null
  );
}

function listenTyping(chatId) {
  const path = dbRef(rtdb, `typing/${chatId}`);

  typingUnsubscribe = onValue(
    path,
    snapshot => {
      const data = snapshot.val() || {};

      const other = Object.entries(data).find(
        ([uid, value]) =>
          uid !== user.uid && value?.typing
      );

      if ($("typingIndicator")) {
        $("typingIndicator").hidden = !other;
      }
    },
    error => console.warn("TYPING ERROR:", error)
  );
}

// =====================================
// PRESENCE
// =====================================

function listenPresence(otherUid) {
  if (!otherUid) return;

  const path = dbRef(rtdb, `presence/${otherUid}`);

  presenceUnsubscribe = onValue(
    path,
    snapshot => {
      const data = snapshot.val();

      if ($("chatPresence")) {
        $("chatPresence").textContent =
          data?.state === "online" ? "Online" : "Offline";
      }
    },
    error => console.warn("PRESENCE ERROR:", error)
  );
}

async function setPresence(state) {
  if (!user) return;

  const path = dbRef(rtdb, `presence/${user.uid}`);

  if (state === "online") {
    await onDisconnect(path).set({
      state: "offline",
      lastChanged: rtdbTimestamp()
    });
  }

  await rtdbSet(path, {
    state,
    lastChanged: rtdbTimestamp()
  });
}

// =====================================
// GROUPS
// =====================================

async function resolveGroupMembers(input) {
  const values = input
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  const members = new Set([user.uid]);

  for (const value of values) {
    if (value === user.uid) continue;

    let uid = value;

    if (
      value.startsWith("@") ||
      /^[a-zA-Z0-9_]{3,20}$/.test(value)
    ) {
      const found = await getUserByUsername(value);

      if (found) {
        uid = found.uid;
      }
    }

    const userSnap = await getDoc(doc(db, "users", uid));

    if (!userSnap.exists()) {
      throw new Error(`Anggota tidak ditemukan: ${value}`);
    }

    members.add(uid);
  }

  return [...members];
}

async function createGroup() {
  const name = await zoraPrompt(
    "Masukkan nama grup:",
    {
      title: "Buat grup",
      placeholder: "Nama grup"
    }
  );

  if (!name) return;

  const memberText = await zoraPrompt(
    "Masukkan username atau UID anggota tambahan, pisahkan dengan koma.",
    {
      title: "Anggota grup",
      placeholder: "@username1, @username2"
    }
  );

  if (!memberText) {
    toast("Tambahkan minimal satu anggota.", "error");
    return;
  }

  try {
    const members = await resolveGroupMembers(memberText);

    if (members.length < 2) {
      throw new Error("Grup harus memiliki minimal 2 anggota.");
    }

    const groupRef = await addDoc(
      collection(db, "groups"),
      {
        name: name.trim(),
        ownerId: user.uid,
        members,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: "",
        lastSenderId: ""
      }
    );

    toast("Grup berhasil dibuat.");

    await openConversation(groupRef.id, {
      type: "group",
      name: name.trim(),
      members,
      ownerId: user.uid
    });
  } catch (error) {
    logFirebaseError("CREATE GROUP ERROR", error);
    toast("Gagal membuat grup: " + error.message, "error");
  }
}

function listenGroups() {
  if (groupUnsubscribe) {
    groupUnsubscribe();
  }

  if (!user) return;

  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", user.uid)
  );

  groupUnsubscribe = onSnapshot(
    q,
    snapshot => {
      const container = $("groupList");
      if (!container) return;

      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();
        const button = document.createElement("button");

        button.className = "list-item";
        button.type = "button";

        button.innerHTML = `
          <span class="avatar">G</span>
          <span class="list-copy">
            <strong>${escapeHTML(data.name || "Grup")}</strong>
            <small>${(data.members || []).length} anggota</small>
          </span>
        `;

        button.onclick = () => {
          openConversation(item.id, {
            ...data,
            type: "group"
          });
        };

        container.appendChild(button);
      });

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">Belum bergabung dengan grup.</div>
        `;
      }
    },
    error => {
      logFirebaseError("LOAD GROUPS ERROR", error);
      toast(
        "Gagal memuat grup: " + (error.code || error.message),
        "error"
      );
    }
  );
}

async function inviteGroupMember() {
  if (!activeChat || activeChatType !== "group") return;

  const groupId = activeChat;

  const value = await zoraPrompt(
    "Masukkan username atau UID pengguna yang ingin ditambahkan:",
    {
      title: "Tambah anggota",
      placeholder: "@username atau UID"
    }
  );

  if (!value) return;

  if (activeChat !== groupId || activeChatType !== "group") {
    return;
  }

  try {
    let uid = value;

    const found = await getUserByUsername(value);

    if (found) uid = found.uid;

    const userSnap = await getDoc(doc(db, "users", uid));

    if (!userSnap.exists()) {
      throw new Error("Pengguna tidak ditemukan.");
    }

    await updateDoc(doc(db, "groups", groupId), {
      members: arrayUnion(uid)
    });

    toast("Anggota berhasil ditambahkan.");
  } catch (error) {
    logFirebaseError("INVITE MEMBER ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// CHANNELS
// =====================================

async function createChannel() {
  const title = await zoraPrompt(
    "Masukkan nama saluran:",
    {
      title: "Buat saluran",
      placeholder: "Nama saluran"
    }
  );

  if (!title) return;

  try {
    const channelRef = await addDoc(
      collection(db, "channels"),
      {
        title: title.trim(),
        ownerId: user.uid,
        followers: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    toast("Saluran berhasil dibuat.");

    await openConversation(channelRef.id, {
      type: "channel",
      title: title.trim(),
      ownerId: user.uid,
      followers: 0
    });
  } catch (error) {
    logFirebaseError("CREATE CHANNEL ERROR", error);
    toast("Gagal membuat saluran: " + error.message, "error");
  }
}

function listenChannels() {
  if (channelUnsubscribe) {
    channelUnsubscribe();
  }

  channelUnsubscribe = onSnapshot(
    collection(db, "channels"),
    snapshot => {
      const container = $("channelList");
      if (!container) return;

      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();
        const button = document.createElement("button");

        button.className = "list-item";
        button.type = "button";

        button.innerHTML = `
          <span class="avatar">Z</span>
          <span class="list-copy">
            <strong>${escapeHTML(data.title || "Saluran")}</strong>
            <small>${Number(data.followers || 0)} pengikut</small>
          </span>
        `;

        button.onclick = () => {
          openConversation(item.id, {
            ...data,
            type: "channel",
            name: data.title
          });
        };

        container.appendChild(button);
      });

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">Belum ada saluran.</div>
        `;
      }
    },
    error => {
      logFirebaseError("LOAD CHANNELS ERROR", error);
      toast(
        "Gagal memuat saluran: " +
        (error.code || error.message),
        "error"
      );
    }
  );
}

async function deleteChannel(channelId, channelData) {
  if (!user || !channelData) return;

  if (!isAdmin() && channelData.ownerId !== user.uid) {
    toast(
      "Hanya pemilik atau admin yang bisa menghapus saluran.",
      "error"
    );
    return;
  }

  const approved = await zoraConfirm(
    "Hapus saluran ini beserta semua postingan dan follower?",
    {
      danger: true,
      confirmText: "Hapus saluran"
    }
  );

  if (!approved) return;

  try {
    const posts = await getDocs(
      collection(db, "channels", channelId, "posts")
    );

    for (const item of posts.docs) {
      await deleteDoc(item.ref);
    }

    const followers = await getDocs(
      collection(db, "channels", channelId, "followers")
    );

    for (const item of followers.docs) {
      await deleteDoc(item.ref);
    }

    await deleteDoc(doc(db, "channels", channelId));

    if (activeChat === channelId) {
      closeChat();
    }

    toast("Saluran berhasil dihapus.");
  } catch (error) {
    logFirebaseError("DELETE CHANNEL ERROR", error);
    toast(
      "Gagal menghapus saluran: " +
      (error.code || error.message),
      "error"
    );
  }
}

// =====================================
// CHANNEL POSTS
// =====================================

async function sendChannelPost() {
  if (!activeChat || activeChatType !== "channel") return;

  if (activeChatData.ownerId !== user.uid) {
    toast(
      "Hanya pemilik saluran yang dapat membuat postingan.",
      "error"
    );
    return;
  }

  const channelId = activeChat;
  const text = $("channelPostInput").value.trim();
  const file = $("channelImageInput")?.files?.[0];

  if (!text && !file) return;

  try {
    const imageURL = file
      ? await uploadImage(file, "channels")
      : "";

    await addDoc(
      collection(db, "channels", channelId, "posts"),
      {
        senderId: user.uid,
        senderName: profile.name,
        text,
        imageURL,
        reactions: {},
        readBy: [user.uid],
        createdAt: serverTimestamp()
      }
    );

    if (activeChat === channelId) {
      $("channelPostInput").value = "";
      $("channelImageInput").value = "";
    }

    toast("Postingan diterbitkan.");
  } catch (error) {
    logFirebaseError("CHANNEL POST ERROR", error);
    toast(error.message, "error");
  }
}

async function toggleFollowChannel() {
  if (!activeChat || activeChatType !== "channel") return;

  const channelId = activeChat;

  const followRef = doc(
    db,
    "channels",
    channelId,
    "followers",
    user.uid
  );

  const channelRef = doc(db, "channels", channelId);

  try {
    await runTransaction(db, async transaction => {
      const existing = await transaction.get(followRef);
      const channel = await transaction.get(channelRef);

      if (!channel.exists()) {
        throw new Error("Saluran tidak ditemukan.");
      }

      const count = Number(channel.data().followers || 0);

      if (existing.exists()) {
        transaction.delete(followRef);

        transaction.update(channelRef, {
          followers: Math.max(0, count - 1)
        });
      } else {
        transaction.set(followRef, {
          uid: user.uid,
          createdAt: serverTimestamp()
        });

        transaction.update(channelRef, {
          followers: count + 1
        });
      }
    });

    toast("Status mengikuti saluran diperbarui.");
  } catch (error) {
    logFirebaseError("FOLLOW CHANNEL ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// STATUSES
// =====================================

async function createStatus() {
  const text = $("statusInput").value.trim();

  if (!text) {
    toast("Tulis status terlebih dahulu.");
    return;
  }

  try {
    await addDoc(
      collection(db, "statuses"),
      {
        uid: user.uid,
        name: profile.name,
        username: profile.username,
        text,
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + 86400000
      }
    );

    $("statusInput").value = "";
    closeModal("statusModal");

    toast("Status berhasil dipublikasikan.");
  } catch (error) {
    logFirebaseError("CREATE STATUS ERROR", error);
    toast("Gagal membuat status: " + error.message, "error");
  }
}

function listenStatuses() {
  if (statusUnsubscribe) {
    statusUnsubscribe();
  }

  const statusQuery = query(
    collection(db, "statuses"),
    limit(100)
  );

  statusUnsubscribe = onSnapshot(
    statusQuery,
    snapshot => {
      const mine = $("myStatuses");
      const others = $("statusList");

      if (!mine || !others) return;

      mine.innerHTML = "";
      others.innerHTML = "";

      const statuses = snapshot.docs
        .map(item => ({
          id: item.id,
          ...item.data()
        }))
        .filter(data => Number(data.expiresAt || 0) >= Date.now())
        .sort((a, b) =>
          timestampMillis(b.createdAt) -
          timestampMillis(a.createdAt)
        );

      statuses.forEach(data => {
        const button = document.createElement("button");

        button.className = "status-item";
        button.type = "button";

        button.innerHTML = `
          <span class="status-ring">
            ${escapeHTML(initials(data.name))}
          </span>
          <span>
            <strong>${escapeHTML(data.name || "Pengguna")}</strong>
            <small>${formatDate(data.createdAt)}</small>
          </span>
        `;

        button.onclick = () => {
          currentStatus = data;

          $("viewStatusName").textContent =
            data.name || "Status";

          $("viewStatusText").textContent =
            data.text || "";

          const deleteButton = $("deleteStatusBtn");

          if (deleteButton) {
            deleteButton.hidden =
              data.uid !== user.uid && !isAdmin();
          }

          openModal("viewStatusModal");
        };

        if (data.uid === user.uid) {
          mine.appendChild(button);
        } else {
          others.appendChild(button);
        }
      });
    },
    error => {
      logFirebaseError("LOAD STATUSES ERROR", error);
      toast("Gagal memuat status: " + error.message, "error");
    }
  );
}

async function deleteStatus() {
  if (!currentStatus?.id) return;

  if (currentStatus.uid !== user.uid && !isAdmin()) {
    toast(
      "Lu tidak memiliki izin menghapus status ini.",
      "error"
    );
    return;
  }

  const approved = await zoraConfirm(
    "Yakin ingin menghapus status ini?",
    {
      danger: true,
      confirmText: "Hapus status"
    }
  );

  if (!approved) return;

  try {
    await deleteDoc(
      doc(db, "statuses", currentStatus.id)
    );

    currentStatus = null;
    closeModal("viewStatusModal");

    toast("Status berhasil dihapus.");
  } catch (error) {
    logFirebaseError("DELETE STATUS ERROR", error);
    toast(
      "Gagal menghapus status: " +
      (error.code || error.message),
      "error"
    );
  }
}

// =====================================
// APPEALS
// =====================================

async function sendAppeal() {
  const text = $("appealText").value.trim();

  if (text.length < 10) {
    $("appealMessage").textContent =
      "Alasan banding minimal 10 karakter.";
    return;
  }

  try {
    await addDoc(
      collection(db, "appeals"),
      {
        uid: user.uid,
        username: profile?.username || "",
        name: profile?.name || "",
        reason: text,
        status: "pending",
        createdAt: serverTimestamp()
      }
    );

    $("appealText").value = "";

    $("appealMessage").textContent =
      "Banding berhasil dikirim dan menunggu peninjauan.";

    toast("Banding berhasil dikirim.");
  } catch (error) {
    logFirebaseError("APPEAL ERROR", error);

    $("appealMessage").textContent =
      "Gagal mengirim banding: " + error.message;
  }
}

// =====================================
// ADMIN SEARCH
// =====================================

async function findAdminUser() {
  if (!isAdmin()) return;

  const term = $("adminSearch").value.trim();
  const output = $("adminUserResult");

  output.innerHTML = "";

  if (!term) {
    output.textContent = "Masukkan UID atau username.";
    return;
  }

  try {
    let found = null;

    if (term.length > 25 && !term.startsWith("@")) {
      const snap = await getDoc(doc(db, "users", term));

      if (snap.exists()) {
        found = {
          uid: snap.id,
          ...snap.data()
        };
      }
    }

    if (!found && !term.includes("@")) {
      const username = normalizeUsername(term);

      const usernameSnap = await getDoc(
        doc(db, "usernames", username)
      );

      if (usernameSnap.exists()) {
        const uid = usernameSnap.data().uid;
        const snap = await getDoc(doc(db, "users", uid));

        if (snap.exists()) {
          found = {
            uid: snap.id,
            ...snap.data()
          };
        }
      }
    }

    if (!found) {
      output.innerHTML = `
        <div class="empty-list">Pengguna tidak ditemukan.</div>
      `;
      return;
    }

    output.innerHTML = `
      <div class="admin-user-card">
        <strong>
          ${verifiedName(
            found.name || "Pengguna",
            found.verified === true
          )}
        </strong>
        <span>@${escapeHTML(found.username || "-")}</span>
        <small>UID: ${escapeHTML(found.uid)}</small>
        <small>Status: ${escapeHTML(found.status || "active")}</small>
        <small>Email: ${escapeHTML(found.email || "-")}</small>
        <small>
          Verifikasi:
          ${found.verified ? "Terverifikasi" : "Belum terverifikasi"}
        </small>
        <div class="admin-actions">
          <button data-status="hold">Tahan sementara</button>
          <button data-status="permanent">Nonaktifkan permanen</button>
          <button data-status="active">Pulihkan akun</button>
          <button data-verify="true">Verifikasi</button>
          <button data-verify="false">Cabut verifikasi</button>
        </div>
      </div>
    `;

    output.querySelectorAll("[data-status]").forEach(button => {
      button.onclick = () => {
        updateUserStatus(
          found.uid,
          button.dataset.status
        );
      };
    });

    output.querySelectorAll("[data-verify]").forEach(button => {
      button.onclick = () => {
        setVerification(
          found.uid,
          button.dataset.verify === "true"
        );
      };
    });
  } catch (error) {
    logFirebaseError("ADMIN SEARCH ERROR", error);
    output.textContent = "Pencarian gagal: " + error.message;
  }
}

// =====================================
// ADMIN USER MANAGEMENT
// =====================================

async function updateUserStatus(uid, status) {
  if (!isAdmin()) return;

  const labels = {
    active: "memulihkan akun",
    hold: "menahan sementara akun",
    permanent: "menonaktifkan akun secara permanen"
  };

  if (!labels[status]) return;

  const approved = await zoraConfirm(
    `Yakin ingin ${labels[status]}?`,
    {
      danger: status !== "active"
    }
  );

  if (!approved) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      updatedAt: serverTimestamp()
    });

    toast("Status pengguna berhasil diperbarui.");
    findAdminUser();
  } catch (error) {
    logFirebaseError("ADMIN STATUS ERROR", error);
    toast("Gagal mengubah status: " + error.message, "error");
  }
}

async function setVerification(uid, verified) {
  if (!isAdmin()) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      verified,
      updatedAt: serverTimestamp()
    });

    toast(
      verified
        ? "Lencana verifikasi diberikan."
        : "Verifikasi dicabut."
    );

    findAdminUser();
  } catch (error) {
    logFirebaseError("ADMIN VERIFY ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// ADMIN APPEALS
// =====================================

function listenAppeals() {
  if (!isAdmin()) return;

  if (appealUnsubscribe) {
    appealUnsubscribe();
  }

  appealUnsubscribe = onSnapshot(
    query(
      collection(db, "appeals"),
      limit(100)
    ),
    snapshot => {
      const container = $("appealList");
      if (!container) return;

      container.innerHTML = "";

      const pending = snapshot.docs
        .filter(item =>
          (item.data().status || "pending") === "pending"
        )
        .sort((a, b) =>
          timestampMillis(b.data().createdAt) -
          timestampMillis(a.data().createdAt)
        );

      pending.forEach(item => {
        const data = item.data();
        const card = document.createElement("div");

        card.className = "appeal-card";

        card.innerHTML = `
          <strong>
            ${escapeHTML(data.name || data.username || data.uid)}
          </strong>
          <small>UID: ${escapeHTML(data.uid)}</small>
          <p>${escapeHTML(data.reason)}</p>
          <span class="appeal-status">Menunggu peninjauan</span>
          <div class="admin-actions">
            <button data-appeal="approved">Setujui</button>
            <button data-appeal="rejected">Tolak</button>
          </div>
        `;

        card.querySelectorAll("[data-appeal]").forEach(button => {
          button.onclick = async () => {
            const status = button.dataset.appeal;

            const approved = await zoraConfirm(
              status === "approved"
                ? "Setujui banding dan pulihkan akun pengguna?"
                : "Tolak banding pengguna ini?",
              {
                danger: status === "rejected",
                confirmText:
                  status === "approved" ? "Setujui" : "Tolak"
              }
            );

            if (!approved) return;

            button.disabled = true;

            try {
              if (status === "approved") {
                await updateDoc(
                  doc(db, "users", data.uid),
                  {
                    status: "active",
                    updatedAt: serverTimestamp()
                  }
                );
              }

              await updateDoc(item.ref, {
                status,
                reviewedAt: serverTimestamp(),
                reviewedBy: user.uid
              });

              card.remove();

              if (!container.children.length) {
                container.innerHTML = `
                  <div class="empty-list">
                    Belum ada banding yang menunggu.
                  </div>
                `;
              }

              toast(
                status === "approved"
                  ? "Banding disetujui dan akun dipulihkan."
                  : "Banding ditolak."
              );
            } catch (error) {
              button.disabled = false;

              logFirebaseError(
                "UPDATE APPEAL ERROR",
                error
              );

              toast(
                "Gagal memproses banding: " + error.message,
                "error"
              );
            }
          };
        });

        container.appendChild(card);
      });

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">
            Belum ada banding yang menunggu.
          </div>
        `;
      }
    },
    error => {
      logFirebaseError("LOAD APPEALS ERROR", error);
      toast("Gagal memuat banding: " + error.message, "error");
    }
  );
}

function openAdmin() {
  if (!isAdmin()) return;

  openModal("adminScreen");
  listenAppeals();
}

// =====================================
// LOGOUT / CLEANUP
// =====================================

async function logout() {
  await setPresence("offline").catch(() => {});

  cleanupAllListeners();

  await signOut(auth);
}

function cleanupAllListeners() {
  cleanupConversation();

  if (chatListUnsubscribe) chatListUnsubscribe();
  if (groupUnsubscribe) groupUnsubscribe();
  if (channelUnsubscribe) channelUnsubscribe();
  if (statusUnsubscribe) statusUnsubscribe();
  if (appealUnsubscribe) appealUnsubscribe();

  chatListUnsubscribe = null;
  groupUnsubscribe = null;
  channelUnsubscribe = null;
  statusUnsubscribe = null;
  appealUnsubscribe = null;
}

// =====================================
// ENTER APP
// =====================================

async function enterApp() {
  profile = await loadProfile(user.uid);

  if (!profile) {
    if (user.phoneNumber) {
      showOnly("authScreen");
      openModal("phoneProfileModal");
      return;
    }

    throw new Error("Profil akun tidak ditemukan.");
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

  if (profile.status !== "active") {
    showOnly("holdScreen");
    return;
  }

  showOnly("appScreen");

  installVerifiedStyle();
  updateProfileUI();

  try {
    await loadHiddenChats();
  } catch (error) {
    logFirebaseError("LOAD HIDDEN CHATS ERROR", error);
    hiddenChats.clear();
  }

  try {
    await setPresence("online");
  } catch (error) {
    logFirebaseError("SET PRESENCE ERROR", error);
  }

  listenChats();
  listenGroups();
  listenChannels();
  listenStatuses();

  if (isAdmin()) {
    listenAppeals();
  }

  if ($("chatsPage")) {
    showPage("chatsPage");
  }
}

// =====================================
// SAFE EVENT BINDING
// =====================================

function bind(id, event, callback) {
  const element = $(id);

  if (!element) {
    console.warn(`Element #${id} tidak ditemukan.`);
    return;
  }

  element.addEventListener(event, callback);
}

// =====================================
// INITIALIZE
// =====================================

async function initialize() {
  installZoraDialog();
  installVerifiedStyle();
  loadTheme();

  // AUTH
  bind("loginBtn", "click", loginEmail);
  bind("registerBtn", "click", registerEmail);
  bind("forgotPassword", "click", forgotPassword);

  bind("showRegister", "click", () => {
    if ($("loginMode")) $("loginMode").hidden = true;
    if ($("registerMode")) $("registerMode").hidden = false;
    showError("registerError", "");
  });

  bind("showLogin", "click", () => {
    if ($("registerMode")) $("registerMode").hidden = true;
    if ($("loginMode")) $("loginMode").hidden = false;
    showError("authError", "");
  });

  // AUTH TABS
  bind("emailLoginTab", "click", () => {
    $("emailLoginTab").classList.add("active");
    $("phoneLoginTab").classList.remove("active");

    $("emailLoginPanel").hidden = false;
    $("phoneLoginPanel").hidden = true;
  });

  bind("phoneLoginTab", "click", () => {
    $("phoneLoginTab").classList.add("active");
    $("emailLoginTab").classList.remove("active");

    $("phoneLoginPanel").hidden = false;
    $("emailLoginPanel").hidden = true;
  });

  // PHONE
  bind("sendPhoneOtp", "click", sendPhoneOTP);
  bind("verifyPhoneOtp", "click", verifyPhoneOTP);
  bind("resendPhoneOtp", "click", sendPhoneOTP);
  bind("completePhoneProfile", "click", completePhoneProfile);
  bind("sendLinkPhoneOtp", "click", sendLinkPhoneOTP);
  bind("verifyLinkPhoneOtp", "click", verifyLinkPhoneOTP);

  // THEME
  bind("themeBtn", "click", setTheme);
  bind("settingsThemeBtn", "click", setTheme);

  // LOGOUT
  bind("logoutBtn", "click", logout);
  bind("settingsLogoutBtn", "click", logout);
  bind("logoutHold", "click", logout);
  bind("logoutRecovered", "click", logout);
  bind("newAccountBtn", "click", logout);

  // RECOVERY
  bind("verifyAccountBtn", "click", async () => {
    try {
      profile = await loadProfile(user.uid);

      if (profile?.status === "recovered") {
        await updateDoc(doc(db, "users", user.uid), {
          status: "active",
          updatedAt: serverTimestamp()
        });
      }

      await enterApp();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  // APPEALS
  bind("appealBtn", "click", sendAppeal);

  // SEARCH
  bind("searchUser", "input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchUsers, 350);
  });

  bind("newChatBtn", "click", () => {
    $("searchUser")?.focus();
    toast("Cari username untuk memulai chat.");
  });

  // MESSAGES
  bind("sendBtn", "click", sendMessage);

  bind("messageInput", "keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  bind("messageInput", "input", () => {
    updateTyping(true).catch(error => {
      console.warn("TYPING ERROR", error);
    });
  });

  bind("messageInput", "blur", () => {
    updateTyping(false).catch(() => {});
  });

  // CHAT CONTROLS
  bind("backToChats", "click", closeChat);
  bind("inviteGroupMember", "click", inviteGroupMember);
  bind("sendChannelPost", "click", sendChannelPost);

  // CREATE
  bind("createGroupBtn", "click", createGroup);
  bind("createChannelBtn", "click", createChannel);

  bind("createStatusBtn", "click", () => {
    openModal("statusModal");
  });

  bind("publishStatus", "click", createStatus);

  // PROFILE
  bind("editProfileBtn", "click", () => {
    openModal("profileModal");
  });

  bind("profileBtn", "click", () => {
    openModal("profileModal");
  });

  bind("saveProfile", "click", saveProfile);

  // CLOSE MODALS
  bind("closeProfile", "click", () => {
    closeModal("profileModal");
  });

  bind("closeStatus", "click", () => {
    closeModal("statusModal");
  });

  bind("closeViewStatus", "click", () => {
    closeModal("viewStatusModal");
  });

  bind("linkPhoneBtn", "click", () => {
    openModal("linkPhoneModal");
  });

  bind("closeLinkPhone", "click", () => {
    closeModal("linkPhoneModal");
  });

  // DELETE STATUS BUTTON
  let deleteStatusBtn = $("deleteStatusBtn");

  if (!deleteStatusBtn && $("viewStatusModal")) {
    deleteStatusBtn = document.createElement("button");
    deleteStatusBtn.id = "deleteStatusBtn";
    deleteStatusBtn.type = "button";
    deleteStatusBtn.className = "danger-btn";
    deleteStatusBtn.textContent = "Hapus Status";

    $("viewStatusModal").appendChild(deleteStatusBtn);
  }

  if (deleteStatusBtn) {
    deleteStatusBtn.onclick = deleteStatus;
  }

  // ADMIN
  bind("openAdmin", "click", openAdmin);

  bind("closeAdmin", "click", () => {
    closeModal("adminScreen");
  });

  bind("findAdminUser", "click", findAdminUser);

  // NAVIGATION
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
    });
  });

  // ESCAPE
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    if ($("zoraDialog") && !$("zoraDialog").hidden) {
      $("zoraDialog").hidden = true;
      return;
    }

    [
      "profileModal",
      "statusModal",
      "viewStatusModal",
      "adminScreen",
      "linkPhoneModal"
    ].forEach(closeModal);

    if (activeChat) closeChat();
  });

  // AUTH STATE
  onAuthStateChanged(auth, async currentUser => {
    user = currentUser;

    if (!currentUser) {
      cleanupAllListeners();
      showOnly("authScreen");
      return;
    }

    try {
      await enterApp();
    } catch (error) {
      logFirebaseError("ENTER APP ERROR", error);

      toast(
        "Gagal membuka aplikasi: " + error.message,
        "error"
      );

      showOnly("authScreen");
    }
  });

  // UNLOAD
  window.addEventListener("beforeunload", () => {
    if (user) {
      setPresence("offline").catch(() => {});
    }
  });
}

initialize();
