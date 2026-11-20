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
  orderBy, onSnapshot, serverTimestamp, limit,
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
let confirmationResult = null;
let linkConfirmationResult = null;
let recaptcha = null;
let linkRecaptcha = null;
let currentImageURL = "";
let toastTimer = null;
let searchTimer = null;
let currentPage = "chatsPage";
let currentStatus = null;

const hiddenChats = new Set();
const unreadCounts = new Map();

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#039;"
}[char]));

const initials = name =>
  String(name || "Z").trim().charAt(0).toUpperCase() || "Z";

function toast(message, type = "normal") {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
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
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function showOnly(screenId) {
  [
    "authScreen", "holdScreen", "recoveredScreen",
    "permanentScreen", "appScreen"
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
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit"
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("id-ID", {
    day: "numeric", month: "short"
  });
}

function showPage(pageId) {
  currentPage = pageId;
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== pageId;
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  closeChat();
}

function updateHeader() {
  const name = profile?.username
    ? `@${profile.username}`
    : profile?.name || user?.displayName || "Pengguna";

  if ($("headerUsername")) $("headerUsername").textContent = name;
}

function updateProfileUI() {
  if (!profile || !user) return;

  updateHeader();

  $("myName").textContent = profile.name || "Pengguna";
  $("myEmail").textContent = user.email || "";
  $("myPhone").textContent = user.phoneNumber || profile.phoneNumber || "";

  $("myAvatar").textContent = initials(profile.name);
  $("profileName").value = profile.name || "";
  $("profileUsername").value = profile.username || "";
  $("profileBio").value = profile.bio || "";

  $("profilePhotoPreview").innerHTML = profile.photoURL
    ? `<img src="${escapeHTML(profile.photoURL)}" alt="Foto profil">`
    : initials(profile.name);

  $("openAdmin").hidden = user.uid !== ADMIN_UID;
}

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
    throw new Error("Username harus 3–20 karakter, huruf kecil, angka, atau garis bawah.");
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

async function loginEmail() {
  const button = $("loginBtn");
  setLoading(button, true);

  try {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    if (!email || !password) throw new Error("Isi email dan password.");

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
      name, username
    });
  } catch (error) {
    showError("registerError", authErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
}

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
    "auth/operation-not-allowed": "Metode login belum diaktifkan di Firebase."
  };

  return messages[error?.code] || error?.message || "Terjadi kesalahan.";
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

function setupRecaptcha(containerId, existing) {
  if (existing) {
    try { existing.clear(); } catch {}
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
      throw new Error("Gunakan format nomor +628xxxxxxxxxx.");
    }

    recaptcha = setupRecaptcha("recaptcha-container", recaptcha);
    confirmationResult = await signInWithPhoneNumber(auth, phone, recaptcha);

    $("otpPanel").hidden = false;
    toast("Kode verifikasi telah dikirim.");
  } catch (error) {
    showError("authError", authErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
}

async function verifyPhoneOTP() {
  try {
    if (!confirmationResult) throw new Error("Kirim kode OTP terlebih dahulu.");

    const code = $("phoneOtp").value.trim();
    if (!/^\d{6}$/.test(code)) throw new Error("Masukkan 6 digit OTP.");

    await confirmationResult.confirm(code);
  } catch (error) {
    showError("authError", authErrorMessage(error));
  }
}

async function completePhoneProfile() {
  try {
    const name = $("phoneProfileName").value.trim();
    const username = normalizeUsername($("phoneProfileUsername").value);

    if (!name || !username) throw new Error("Lengkapi nama dan username.");

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

    await linkConfirmationResult.confirm($("linkPhoneOtp").value.trim());
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

async function uploadImage(file, folder) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Ukuran gambar maksimal 5 MB.");
  }

  const path = `${folder}/${user.uid}/${Date.now()}_${file.name}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, file);
  return getDownloadURL(target);
}

async function saveProfile() {
  try {
    const name = $("profileName").value.trim();
    if (!name) throw new Error("Nama tidak boleh kosong.");

    let photoURL = profile.photoURL || "";
    const file = $("profilePhotoInput").files[0];

    if (file) photoURL = await uploadImage(file, "profile");

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
    toast(authErrorMessage(error), "error");
  }
}

function setTheme() {
  const next = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  localStorage.setItem("zora-theme", next);
}

function loadTheme() {
  document.body.dataset.theme =
    localStorage.getItem("zora-theme") || "dark";
}

function chatIdFor(a, b) {
  return [a, b].sort().join("_");
}

async function startPrivate(otherUid, otherProfile) {
  try {
    if (!user || otherUid === user.uid) return;

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
    }

    await openConversation(id, {
      type: "private",
      members: [user.uid, otherUid],
      otherUid,
      otherName: otherProfile.name || otherProfile.username,
      otherUsername: otherProfile.username,
      otherPhoto: otherProfile.photoURL || ""
    });
  } catch (error) {
    toast("Gagal membuka chat: " + authErrorMessage(error), "error");
  }
}

async function openConversation(id, data) {
  cleanupConversation();

  activeChat = id;
  activeChatData = data;
  activeChatType = data.type || "private";

  $("emptyChat").hidden = true;
  $("chatPanel").hidden = false;
  $("chatName").textContent = data.name ||
    data.otherName || data.title || "Percakapan";

  $("chatAvatar").textContent = initials(data.otherName || data.name);
  $("chatPresence").textContent = "";
  $("typingIndicator").hidden = true;

  const isChannel = activeChatType === "channel";
  const isOwner = data.ownerId === user.uid;

  $("composer").hidden = isChannel;
  $("channelComposer").hidden = !isChannel;
  $("inviteGroupMember").hidden = activeChatType !== "group";
  $("channelControls").hidden = !isChannel;

  if (isChannel) {
    $("channelControls").innerHTML = `
      <div class="channel-info">
        <strong>${escapeHTML(data.title || data.name || "Saluran")}</strong>
        <span>${Number(data.followers || 0)} pengikut</span>
      </div>
      ${isOwner ? '<span class="owner-label">PEMILIK SALURAN</span>' : ""}
    `;
    $("channelComposer").hidden = !isOwner;
  }

  document.querySelector(".app")?.classList.add("chat-open");

  listenMessages(id);
  if (activeChatType === "private") {
    listenPresence(data.otherUid);
    markMessagesRead(id);
    listenTyping(id);
  }
}

function closeChat() {
  cleanupConversation();
  activeChat = null;
  activeChatData = null;
  $("chatPanel").hidden = true;
  $("emptyChat").hidden = false;
  document.querySelector(".app")?.classList.remove("chat-open");
}

function cleanupConversation() {
  if (activeChatUnsubscribe) activeChatUnsubscribe();
  if (typingUnsubscribe) typingUnsubscribe();
  if (presenceUnsubscribe) presenceUnsubscribe();

  activeChatUnsubscribe = null;
  typingUnsubscribe = null;
  presenceUnsubscribe = null;
}

function messagesCollection(id) {
  if (activeChatType === "group") {
    return collection(db, "groups", id, "messages");
  }
  if (activeChatType === "channel") {
    return collection(db, "channels", id, "posts");
  }
  return collection(db, "chats", id, "messages");
}

function listenMessages(id) {
  const target = messagesCollection(id);
  const q = query(target, orderBy("createdAt", "asc"), limit(300));

  activeChatUnsubscribe = onSnapshot(q, snapshot => {
    const messages = snapshot.docs.map(item => ({
      id: item.id, ...item.data()
    }));

    renderMessages(messages);

    if (activeChatType === "private") markMessagesRead(id);
  }, error => {
    toast("Gagal memuat pesan: " + error.message, "error");
  });
}

function renderMessages(messages) {
  const container = $("messages");
  container.innerHTML = "";

  if (!messages.length) {
    container.innerHTML = `
      <div class="message-empty">
        <strong>Belum ada pesan</strong>
        <span>Mulai percakapan sekarang.</span>
      </div>`;
    return;
  }

  messages.forEach(message => {
    const mine = message.senderId === user.uid;
    const deletedFor = message.deletedFor || [];

    if (deletedFor.includes(user.uid)) return;

    const deletedAll = message.deletedForEveryone === true;
    const readByOthers = (message.readBy || []).some(
      uid => uid !== message.senderId
    );

    const tick = mine
      ? `<span class="message-tick ${readByOthers ? "read" : ""}">${readByOthers ? "✓✓" : "✓"}</span>`
      : "";

    const image = message.imageURL
      ? `<img class="message-image" src="${escapeHTML(message.imageURL)}" alt="Gambar pesan">`
      : "";

    const content = deletedAll
      ? `<em class="deleted-message">Pesan ini telah dihapus.</em>`
      : `${image}${message.text ? `<div>${escapeHTML(message.text)}</div>` : ""}`;

    const node = document.createElement("article");
    node.className = `message ${mine ? "mine" : "theirs"}`;
    node.dataset.messageId = message.id;

    node.innerHTML = `
      ${!mine ? `<small class="message-sender">${escapeHTML(message.senderName || "Pengguna")}</small>` : ""}
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
        ${mine ? '<button type="button" data-action="delete-all">Hapus untuk semua</button>' : ""}
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
      <button class="reaction-chip ${users.includes(user.uid) ? "selected" : ""}"
        data-emoji="${escapeHTML(emoji)}" type="button">
        ${escapeHTML(emoji)} ${users.length}
      </button>
    `).join("");
}

async function sendMessage() {
  if (!activeChat || activeChatType === "channel") return;

  const text = $("messageInput").value.trim();
  const file = $("imageInput").files[0];

  if (!text && !file) return;

  try {
    let imageURL = "";
    if (file) imageURL = await uploadImage(file, "messages");

    const payload = {
      senderId: user.uid,
      senderName: profile.name || profile.username,
      text,
      imageURL,
      reactions: {},
      readBy: [user.uid],
      createdAt: serverTimestamp()
    };

    const target = messagesCollection(activeChat);
    await addDoc(target, payload);

    const chatRef = doc(db,
      activeChatType === "group" ? "groups" : "chats",
      activeChat
    );

    await updateDoc(chatRef, {
      lastMessage: text || "Mengirim gambar",
      lastSenderId: user.uid,
      updatedAt: serverTimestamp()
    });

    $("messageInput").value = "";
    $("imageInput").value = "";
    await updateTyping(false);
  } catch (error) {
    toast("Pesan gagal dikirim: " + error.message, "error");
  }
}

async function sendChannelPost() {
  if (!activeChat || activeChatType !== "channel") return;
  if (activeChatData.ownerId !== user.uid) {
    toast("Hanya pemilik saluran yang dapat membuat postingan.", "error");
    return;
  }

  const text = $("channelPostInput").value.trim();
  const file = $("channelImageInput").files[0];
  if (!text && !file) return;

  try {
    const imageURL = file ? await uploadImage(file, "channels") : "";

    await addDoc(collection(db, "channels", activeChat, "posts"), {
      senderId: user.uid,
      senderName: profile.name,
      text,
      imageURL,
      reactions: {},
      readBy: [user.uid],
      createdAt: serverTimestamp()
    });

    $("channelPostInput").value = "";
    $("channelImageInput").value = "";
    toast("Postingan diterbitkan.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteForMe(messageId) {
  if (!activeChat) return;

  try {
    const ref = doc(messagesCollection(activeChat), messageId);
    await updateDoc(ref, {
      deletedFor: arrayUnion(user.uid)
    });
    toast("Pesan dihapus dari tampilan lu.");
  } catch (error) {
    toast("Gagal menghapus pesan: " + error.message, "error");
  }
}

async function deleteForEveryone(messageId) {
  if (!activeChat) return;

  if (!confirm("Hapus pesan ini untuk semua orang?")) return;

  try {
    const ref = doc(messagesCollection(activeChat), messageId);
    await updateDoc(ref, {
      deletedForEveryone: true,
      text: "",
      imageURL: ""
    });
    toast("Pesan dihapus untuk semua orang.");
  } catch (error) {
    toast("Gagal menghapus pesan: " + error.message, "error");
  }
}

async function reactToMessage(messageId, reactions) {
  const choices = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
  const selected = prompt("Pilih reaksi:\n" + choices.join(" "));
  if (!choices.includes(selected)) return;

  const users = Array.isArray(reactions[selected])
    ? [...reactions[selected]]
    : [];

  const index = users.indexOf(user.uid);
  if (index >= 0) users.splice(index, 1);
  else users.push(user.uid);

  try {
    await updateDoc(doc(messagesCollection(activeChat), messageId), {
      [`reactions.${selected}`]: users
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function markMessagesRead(chatId) {
  try {
    const q = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const snap = await getDocs(q);
    const jobs = [];

    snap.forEach(item => {
      const data = item.data();
      if (data.senderId !== user.uid && !(data.readBy || []).includes(user.uid)) {
        jobs.push(updateDoc(item.ref, {
          readBy: arrayUnion(user.uid)
        }));
      }
    });

    await Promise.all(jobs);
  } catch (error) {
    console.warn("Read receipt:", error.message);
  }
}

async function hideChat(chatId) {
  try {
    await setDoc(doc(db, "users", user.uid, "hiddenChats", chatId), {
      chatId,
      hiddenAt: serverTimestamp()
    });
    hiddenChats.add(chatId);
    closeChat();
    toast("Chat disembunyikan dari daftar lu.");
    listenChats();
  } catch (error) {
    toast("Gagal menghapus chat: " + error.message, "error");
  }
}

async function loadHiddenChats() {
  hiddenChats.clear();
  const snap = await getDocs(
    collection(db, "users", user.uid, "hiddenChats")
  );
  snap.forEach(item => hiddenChats.add(item.id));
}

function listenChats() {
  if (chatListUnsubscribe) chatListUnsubscribe();

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", user.uid)
  );

  chatListUnsubscribe = onSnapshot(q, async snapshot => {
    const items = snapshot.docs
      .filter(item => !hiddenChats.has(item.id))
      .sort((a, b) => {
        const ta = a.data().updatedAt?.toMillis?.() || 0;
        const tb = b.data().updatedAt?.toMillis?.() || 0;
        return tb - ta;
      });

    const container = $("chatList");
    container.innerHTML = "";

    for (const item of items) {
      const data = item.data();
      const otherUid = data.members.find(uid => uid !== user.uid);
      if (!otherUid) continue;

      let other = {};
      try {
        const snap = await getDoc(doc(db, "users", otherUid));
        if (snap.exists()) other = snap.data();
      } catch {}

      const row = document.createElement("button");
      row.type = "button";
      row.className = "list-item";
      row.innerHTML = `
        <span class="avatar">${escapeHTML(initials(other.name || other.username))}</span>
        <span class="list-copy">
          <strong>${escapeHTML(other.name || other.username || "Pengguna")}</strong>
          <small>${escapeHTML(data.lastMessage || "Mulai percakapan")}</small>
        </span>
        <span class="list-time">${formatTime(data.updatedAt)}</span>
      `;

      row.onclick = () => openConversation(item.id, {
        ...data,
        type: "private",
        otherUid,
        otherName: other.name || other.username,
        otherUsername: other.username
      });

      row.oncontextmenu = event => {
        event.preventDefault();
        if (confirm("Sembunyikan chat ini dari daftar?")) hideChat(item.id);
      };

      container.appendChild(row);
    }

    if (!container.children.length) {
      container.innerHTML = `<div class="empty-list">Belum ada percakapan.</div>`;
    }
  }, error => toast("Gagal memuat chat: " + error.message, "error"));
}

async function searchUsers() {
  const term = normalizeUsername($("searchUser").value);
  const output = $("searchResults");
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
      if (data.uid === user.uid) continue;

      const userSnap = await getDoc(doc(db, "users", data.uid));
      if (!userSnap.exists()) continue;

      const target = userSnap.data();
      const button = document.createElement("button");
      button.className = "search-result";
      button.type = "button";
      button.innerHTML = `
        <span class="avatar">${escapeHTML(initials(target.name))}</span>
        <span><strong>${escapeHTML(target.name)}</strong>
        <small>@${escapeHTML(target.username)}</small></span>
      `;

      button.onclick = () => startPrivate(data.uid, target);
      output.appendChild(button);
    }

    if (!output.children.length) {
      output.innerHTML = `<div class="empty-list">Pengguna tidak ditemukan.</div>`;
    }
  } catch (error) {
    output.textContent = "Pencarian gagal: " + error.message;
  }
}

async function updateTyping(isTyping) {
  if (!activeChat || activeChatType !== "private") return;

  const path = dbRef(rtdb, `typing/${activeChat}/${user.uid}`);
  await rtdbSet(path, isTyping ? {
    typing: true,
    name: profile.name,
    updatedAt: rtdbTimestamp()
  } : null);
}

function listenTyping(chatId) {
  const path = dbRef(rtdb, `typing/${chatId}`);
  typingUnsubscribe = onValue(path, snapshot => {
    const data = snapshot.val() || {};
    const other = Object.entries(data).find(([uid, value]) =>
      uid !== user.uid && value?.typing
    );

    $("typingIndicator").hidden = !other;
  });
}

function listenPresence(otherUid) {
  const path = dbRef(rtdb, `presence/${otherUid}`);
  presenceUnsubscribe = onValue(path, snapshot => {
    const data = snapshot.val();
    $("chatPresence").textContent =
      data?.state === "online" ? "Online" : "Offline";
  });
}

async function setPresence(state) {
  if (!user) return;
  const path = dbRef(rtdb, `presence/${user.uid}`);

  await rtdbSet(path, {
    state,
    lastChanged: rtdbTimestamp()
  });

  if (state === "online") {
    onDisconnect(path).set({
      state: "offline",
      lastChanged: rtdbTimestamp()
    });
  }
}

async function createGroup() {
  const name = prompt("Nama grup:");
  if (!name?.trim()) return;

  const memberText = prompt(
    "Masukkan minimal 1 UID anggota tambahan, pisahkan dengan koma:"
  );

  if (!memberText?.trim()) {
    toast("Tambahkan minimal 1 anggota grup.", "error");
    return;
  }

  try {
    const members = [...new Set([
      user.uid,
      ...memberText.split(",")
        .map(value => value.trim())
        .filter(Boolean)
    ])];

    if (members.length < 2) {
      throw new Error("Grup harus memiliki minimal 2 anggota.");
    }

    const ref = await addDoc(collection(db, "groups"), {
      name: name.trim(),
      ownerId: user.uid,
      members,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastSenderId: ""
    });

    toast("Grup berhasil dibuat.");

    await openConversation(ref.id, {
      type: "group",
      name: name.trim(),
      members,
      ownerId: user.uid
    });

  } catch (error) {
    console.error("CREATE GROUP ERROR:", error);
    toast("Gagal membuat grup: " + error.message, "error");
  }
}


function listenGroups() {
  if (groupUnsubscribe) groupUnsubscribe();

  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", user.uid)
  );

  groupUnsubscribe = onSnapshot(q, snapshot => {
    const container = $("groupList");
    container.innerHTML = "";

    snapshot.forEach(item => {
      const data = item.data();
      const button = document.createElement("button");
      button.className = "list-item";
      button.innerHTML = `
        <span class="avatar">G</span>
        <span class="list-copy"><strong>${escapeHTML(data.name)}</strong>
        <small>${(data.members || []).length} anggota</small></span>
      `;
      button.onclick = () => openConversation(item.id, {
        ...data, type: "group", name: data.name
      });
      container.appendChild(button);
    });

    if (!container.children.length) {
      container.innerHTML = `<div class="empty-list">Belum bergabung dengan grup.</div>`;
    }
  });
}

async function inviteGroupMember() {
  if (!activeChat || activeChatType !== "group") return;

  const uid = prompt("Masukkan UID pengguna yang ingin ditambahkan:");
  if (!uid?.trim()) return;

  try {
    await updateDoc(doc(db, "groups", activeChat), {
      members: arrayUnion(uid.trim())
    });
    toast("Anggota ditambahkan.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function createChannel() {
  const title = prompt("Nama saluran:");
  if (!title?.trim()) return;

  try {
    const ref = await addDoc(collection(db, "channels"), {
      title: title.trim(),
      ownerId: user.uid,
      followers: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");
    openConversation(ref.id, {
      type: "channel",
      title: title.trim(),
      ownerId: user.uid,
      followers: 0
    });
  } catch (error) {
    toast("Gagal membuat saluran: " + error.message, "error");
  }
}

function listenChannels() {
  if (channelUnsubscribe) channelUnsubscribe();

  channelUnsubscribe = onSnapshot(collection(db, "channels"), snapshot => {
    const container = $("channelList");
    container.innerHTML = "";

    snapshot.forEach(item => {
      const data = item.data();
      const button = document.createElement("button");
      button.className = "list-item";
      button.innerHTML = `
        <span class="avatar">Z</span>
        <span class="list-copy">
          <strong>${escapeHTML(data.title || "Saluran")}</strong>
          <small>${Number(data.followers || 0)} pengikut</small>
        </span>
      `;

      button.onclick = () => openConversation(item.id, {
        ...data, type: "channel", name: data.title
      });

      container.appendChild(button);
    });

    if (!container.children.length) {
      container.innerHTML = `<div class="empty-list">Belum ada saluran.</div>`;
    }
  });
}

async function toggleFollowChannel() {
  if (!activeChat || activeChatType !== "channel") return;

  const followRef = doc(db, "channels", activeChat, "followers", user.uid);
  const channelRef = doc(db, "channels", activeChat);

  try {
    await runTransaction(db, async transaction => {
      const existing = await transaction.get(followRef);
      const channel = await transaction.get(channelRef);
      if (!channel.exists()) throw new Error("Saluran tidak ditemukan.");

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
    toast("Gagal mengikuti saluran: " + error.message, "error");
  }
}

async function createStatus() {
  const text = $("statusInput").value.trim();
  if (!text) {
    toast("Tulis status terlebih dahulu.");
    return;
  }

  try {
    await addDoc(collection(db, "statuses"), {
      uid: user.uid,
      name: profile.name,
      username: profile.username,
      text,
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 86400000
    });

    $("statusInput").value = "";
    closeModal("statusModal");
    toast("Status berhasil dipublikasikan.");
  } catch (error) {
    toast("Gagal membuat status: " + error.message, "error");
  }
}

function listenStatuses() {
  if (statusUnsubscribe) statusUnsubscribe();

  statusUnsubscribe = onSnapshot(
    query(collection(db, "statuses"), orderBy("createdAt", "desc"), limit(100)),
    snapshot => {
      const mine = $("myStatuses");
      const others = $("statusList");
      mine.innerHTML = "";
      others.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();
        if (Number(data.expiresAt || 0) < Date.now()) return;

        const button = document.createElement("button");
        button.className = "status-item";
        button.innerHTML = `
          <span class="status-ring">${escapeHTML(initials(data.name))}</span>
          <span><strong>${escapeHTML(data.name || "Pengguna")}</strong>
          <small>${formatDate(data.createdAt)}</small></span>
        `;

        button.onclick = () => {
          currentStatus = data;
          $("viewStatusName").textContent = data.name || "Status";
          $("viewStatusText").textContent = data.text || "";
          openModal("viewStatusModal");
        };

        (data.uid === user.uid ? mine : others).appendChild(button);
      });
    },
    error => toast("Gagal memuat status: " + error.message, "error")
  );
}

async function sendAppeal() {
  const text = $("appealText").value.trim();
  if (text.length < 10) {
    $("appealMessage").textContent = "Alasan banding minimal 10 karakter.";
    return;
  }

  try {
    await addDoc(collection(db, "appeals"), {
      uid: user.uid,
      username: profile?.username || "",
      name: profile?.name || "",
      reason: text,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealText").value = "";
    $("appealMessage").textContent = "Banding berhasil dikirim dan menunggu peninjauan.";
    toast("Banding berhasil dikirim.");
  } catch (error) {
    $("appealMessage").textContent = "Gagal mengirim banding: " + error.message;
  }
}

async function findAdminUser() {
  if (user.uid !== ADMIN_UID) return;

  const term = $("adminSearch").value.trim();
  const output = $("adminUserResult");
  output.innerHTML = "";

  if (!term) {
    output.textContent = "Masukkan UID, username, atau email.";
    return;
  }

  try {
    let found = null;

    if (term.includes("@") && !term.startsWith("@")) {
      const q = query(
        collection(db, "users"),
        where("email", "==", term.toLowerCase()),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        found = { uid: snap.docs[0].id, ...snap.docs[0].data() };
      }
    } else if (term.length > 25 && !term.startsWith("@")) {
      const snap = await getDoc(doc(db, "users", term));
      if (snap.exists()) found = { uid: snap.id, ...snap.data() };
    }

    if (!found) {
      const username = normalizeUsername(term);
      const usernameSnap = await getDoc(doc(db, "usernames", username));

      if (usernameSnap.exists()) {
        const uid = usernameSnap.data().uid;
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) found = { uid: snap.id, ...snap.data() };
      }
    }

    if (!found) {
      output.innerHTML = `<div class="empty-list">Pengguna tidak ditemukan.</div>`;
      return;
    }

    output.innerHTML = `
      <div class="admin-user-card">
        <strong>${escapeHTML(found.name || "Pengguna")}</strong>
        <span>@${escapeHTML(found.username || "-")}</span>
        <small>UID: ${escapeHTML(found.uid)}</small>
        <small>Status: ${escapeHTML(found.status || "active")}</small>
        <small>Email: ${escapeHTML(found.email || "-")}</small>
        <small>Verifikasi: ${found.verified ? "Terverifikasi" : "Belum terverifikasi"}</small>

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
      button.onclick = () => updateUserStatus(
        found.uid, button.dataset.status
      );
    });

    output.querySelectorAll("[data-verify]").forEach(button => {
      button.onclick = () => setVerification(
        found.uid, button.dataset.verify === "true"
      );
    });
  } catch (error) {
    output.textContent = "Pencarian gagal: " + error.message;
  }
}

async function updateUserStatus(uid, status) {
  if (user.uid !== ADMIN_UID) return;

  const labels = {
    active: "memulihkan akun",
    hold: "menahan sementara akun",
    permanent: "menonaktifkan akun secara permanen"
  };

  if (!confirm(`Yakin ingin ${labels[status]}?`)) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      updatedAt: serverTimestamp()
    });

    toast("Status pengguna berhasil diperbarui.");
    findAdminUser();
  } catch (error) {
    toast("Gagal mengubah status: " + error.message, "error");
  }
}

async function setVerification(uid, verified) {
  if (user.uid !== ADMIN_UID) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      verified,
      updatedAt: serverTimestamp()
    });

    toast(verified ? "Lencana verifikasi diberikan." : "Verifikasi dicabut.");
    findAdminUser();
  } catch (error) {
    toast(error.message, "error");
  }
}

function listenAppeals() {
  if (user.uid !== ADMIN_UID) return;
  if (appealUnsubscribe) appealUnsubscribe();

  appealUnsubscribe = onSnapshot(
    query(collection(db, "appeals"), orderBy("createdAt", "desc"), limit(50)),
    snapshot => {
      const container = $("appealList");
      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();
        const card = document.createElement("div");
        card.className = "appeal-card";

        card.innerHTML = `
          <strong>${escapeHTML(data.name || data.username || data.uid)}</strong>
          <small>UID: ${escapeHTML(data.uid)}</small>
          <p>${escapeHTML(data.reason)}</p>
          <span class="appeal-status">${escapeHTML(data.status || "pending")}</span>
          <div class="admin-actions">
            <button data-appeal="approved">Setujui</button>
            <button data-appeal="rejected">Tolak</button>
          </div>
        `;

        card.querySelectorAll("[data-appeal]").forEach(button => {
          button.onclick = async () => {
            const status = button.dataset.appeal;
            try {
              await updateDoc(item.ref, {
                status,
                reviewedAt: serverTimestamp(),
                reviewedBy: user.uid
              });

              if (status === "approved") {
                await updateUserStatus(data.uid, "active");
              }

              toast("Status banding diperbarui.");
            } catch (error) {
              toast(error.message, "error");
            }
          };
        });

        container.appendChild(card);
      });

      if (!container.children.length) {
        container.innerHTML = `<div class="empty-list">Belum ada permohonan banding.</div>`;
      }
    }
  );
}

function openAdmin() {
  if (user.uid !== ADMIN_UID) return;
  openModal("adminScreen");
  listenAppeals();
}

async function logout() {
  cleanupConversation();
  await setPresence("offline").catch(() => {});
  await signOut(auth);
}

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
  updateProfileUI();

  // Jangan biarkan fitur tambahan menggagalkan pembukaan aplikasi.
  try {
    await loadHiddenChats();
  } catch (error) {
    console.warn("Hidden chats:", error);
    hiddenChats.clear();
  }

  try {
    await setPresence("online");
  } catch (error) {
    console.warn("Presence:", error);
  }

  listenChats();
  listenGroups();
  listenChannels();
  listenStatuses();

  showPage("chatsPage");
}

async function initialize() {
  loadTheme();

  $("loginBtn").onclick = loginEmail;
  $("registerBtn").onclick = registerEmail;
  $("forgotPassword").onclick = forgotPassword;

  $("showRegister").onclick = () => {
    $("loginMode").hidden = true;
    $("registerMode").hidden = false;
    showError("registerError", "");
  };

  $("showLogin").onclick = () => {
    $("registerMode").hidden = true;
    $("loginMode").hidden = false;
    showError("authError", "");
  };

  $("emailLoginTab").onclick = () => {
    $("emailLoginTab").classList.add("active");
    $("phoneLoginTab").classList.remove("active");
    $("emailLoginPanel").hidden = false;
    $("phoneLoginPanel").hidden = true;
  };

  $("phoneLoginTab").onclick = () => {
    $("phoneLoginTab").classList.add("active");
    $("emailLoginTab").classList.remove("active");
    $("phoneLoginPanel").hidden = false;
    $("emailLoginPanel").hidden = true;
  };

  $("sendPhoneOtp").onclick = sendPhoneOTP;
  $("verifyPhoneOtp").onclick = verifyPhoneOTP;
  $("resendPhoneOtp").onclick = sendPhoneOTP;
  $("completePhoneProfile").onclick = completePhoneProfile;

  $("sendLinkPhoneOtp").onclick = sendLinkPhoneOTP;
  $("verifyLinkPhoneOtp").onclick = verifyLinkPhoneOTP;

  $("themeBtn").onclick = setTheme;
  $("settingsThemeBtn").onclick = setTheme;
  $("logoutBtn").onclick = logout;
  $("settingsLogoutBtn").onclick = logout;
  $("logoutHold").onclick = logout;
  $("logoutRecovered").onclick = logout;
  $("newAccountBtn").onclick = logout;

  $("verifyAccountBtn").onclick = async () => {
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
  };

  $("appealBtn").onclick = sendAppeal;

  $("searchUser").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchUsers, 350);
  });

  $("newChatBtn").onclick = () => {
    $("searchUser").focus();
    toast("Cari username untuk memulai chat.");
  };

  $("sendBtn").onclick = sendMessage;
  $("messageInput").addEventListener("keydown", event => {
    if (event.key === "Enter") sendMessage();
  });

  $("messageInput").addEventListener("input", () => updateTyping(true));
  $("messageInput").addEventListener("blur", () => updateTyping(false));

  $("backToChats").onclick = closeChat;
  $("inviteGroupMember").onclick = inviteGroupMember;
  $("sendChannelPost").onclick = sendChannelPost;

  $("createGroupBtn").onclick = createGroup;
  $("createChannelBtn").onclick = createChannel;

  $("createStatusBtn").onclick = () => openModal("statusModal");
  $("publishStatus").onclick = createStatus;

  $("editProfileBtn").onclick = () => openModal("profileModal");
  $("profileBtn").onclick = () => openModal("profileModal");
  $("saveProfile").onclick = saveProfile;

  $("closeProfile").onclick = () => closeModal("profileModal");
  $("closeStatus").onclick = () => closeModal("statusModal");
  $("closeViewStatus").onclick = () => closeModal("viewStatusModal");

  $("linkPhoneBtn").onclick = () => openModal("linkPhoneModal");
  $("closeLinkPhone").onclick = () => closeModal("linkPhoneModal");

  $("openAdmin").onclick = openAdmin;
  $("closeAdmin").onclick = () => closeModal("adminScreen");
  $("findAdminUser").onclick = findAdminUser;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal("profileModal");
      closeModal("statusModal");
      closeModal("viewStatusModal");
      closeModal("adminScreen");
      closeModal("linkPhoneModal");
      if (activeChat) closeChat();
    }
  });

  onAuthStateChanged(auth, async currentUser => {
    user = currentUser;

    if (!currentUser) {
      cleanupConversation();
      showOnly("authScreen");
      return;
    }

    try {
      await enterApp();
    } catch (error) {
      toast("Gagal membuka aplikasi: " + error.message, "error");
      showOnly("authScreen");
    }
  });

  window.addEventListener("beforeunload", () => {
    if (user) setPresence("offline").catch(() => {});
  });
}

initialize();
