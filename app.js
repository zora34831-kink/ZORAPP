
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

// =====================================
// CONFIGURATION
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

let confirmationResult = null;
let linkConfirmationResult = null;
let recaptcha = null;
let linkRecaptcha = null;

let toastTimer = null;
let searchTimer = null;
let currentPage = "chatsPage";
let currentStatus = null;

const hiddenChats = new Set();

// =====================================
// HELPERS
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

function toast(message, type = "normal") {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3500);
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

function showPage(pageId) {
  currentPage = pageId;

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

function updateHeader() {
  const name = profile?.username
    ? `@${profile.username}`
    : profile?.name || user?.displayName || "Pengguna";

  if ($("headerUsername")) {
    $("headerUsername").textContent = name;
  }
}

function updateProfileUI() {
  if (!profile || !user) return;

  updateHeader();

  if ($("myName")) {
    $("myName").textContent = profile.name || "Pengguna";
  }

  if ($("myEmail")) {
    $("myEmail").textContent = user.email || "";
  }

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
      : initials(profile.name);
  }

  if ($("openAdmin")) {
    $("openAdmin").hidden = user.uid !== ADMIN_UID;
  }
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
// PROFILE
// =====================================

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));

  if (!snap.exists()) return null;

  return {
    uid,
    ...snap.data()
  };
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

    if (
      existing.exists() &&
      existing.data().uid !== uid
    ) {
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
    throw new Error(
      "Username harus 3–20 karakter, huruf kecil, angka, atau garis bawah."
    );
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
    "auth/operation-not-allowed": "Metode login belum diaktifkan di Firebase."
  };

  return messages[error?.code] ||
    error?.message ||
    "Terjadi kesalahan.";
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
    const username = normalizeUsername(
      $("registerUsername").value
    );
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
      auth,
      email,
      password
    );

    await updateProfile(credential.user, {
      displayName: name
    });

    await createUserProfile(credential.user.uid, {
      name,
      username
    });

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
    showError(
      "authError",
      "Masukkan email terlebih dahulu."
    );
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
// PHONE AUTHENTICATION
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
      throw new Error(
        "Gunakan format nomor +628xxxxxxxxxx."
      );
    }

    recaptcha = setupRecaptcha(
      "recaptcha-container",
      recaptcha
    );

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
    showError(
      "phoneProfileError",
      authErrorMessage(error)
    );
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
    showError(
      "linkPhoneError",
      authErrorMessage(error)
    );
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
    showError(
      "linkPhoneError",
      authErrorMessage(error)
    );
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

  const path =
    `${folder}/${user.uid}/${Date.now()}_${safeName}`;

  const target = storageRef(storage, path);

  await uploadBytes(target, file);

  return await getDownloadURL(target);
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

    const file = $("profilePhotoInput").files[0];

    if (file) {
      photoURL = await uploadImage(file, "profile");
    }

    await updateDoc(doc(db, "users", user.uid), {
      name,
      photoURL,
      bio: $("profileBio").value.trim(),
      updatedAt: serverTimestamp()
    });

    await updateProfile(user, {
      displayName: name
    });

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
    document.body.dataset.theme === "dark"
      ? "light"
      : "dark";

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

function messagesCollection(id) {
  if (activeChatType === "group") {
    return collection(db, "groups", id, "messages");
  }

  if (activeChatType === "channel") {
    return collection(db, "channels", id, "posts");
  }

  return collection(db, "chats", id, "messages");
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
      otherName:
        otherProfile.name || otherProfile.username,
      otherUsername: otherProfile.username,
      otherPhoto: otherProfile.photoURL || ""
    });

  } catch (error) {
    logFirebaseError("START PRIVATE ERROR", error);

    toast(
      "Gagal membuka chat: " + error.message,
      "error"
    );
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

  $("emptyChat").hidden = true;
  $("chatPanel").hidden = false;

  $("chatName").textContent =
    data.name ||
    data.otherName ||
    data.title ||
    "Percakapan";

  $("chatAvatar").textContent = initials(
    data.otherName || data.name
  );

  $("chatPresence").textContent = "";
  $("typingIndicator").hidden = true;

  const isChannel = activeChatType === "channel";
  const isOwner = data.ownerId === user.uid;

  $("composer").hidden = isChannel;
  $("channelComposer").hidden = !isChannel;
  $("inviteGroupMember").hidden =
    activeChatType !== "group";

  $("channelControls").hidden = !isChannel;

  if (isChannel) {
    $("channelControls").innerHTML = `
      <div class="channel-info">
        <strong>${escapeHTML(
          data.title || data.name || "Saluran"
        )}</strong>
        <span>${Number(data.followers || 0)} pengikut</span>
      </div>

      ${isOwner
        ? '<span class="owner-label">PEMILIK SALURAN</span>'
        : ""}
    `;

    $("channelComposer").hidden = !isOwner;
  }

  document.querySelector(".app")?.classList.add("chat-open");

  listenMessages(id);

  if (activeChatType === "private") {
    listenPresence(data.otherUid);
    listenTyping(id);
    await markMessagesRead(id);
  }
}

function closeChat() {
  cleanupConversation();

  activeChat = null;
  activeChatData = null;

  if ($("chatPanel")) $("chatPanel").hidden = true;
  if ($("emptyChat")) $("emptyChat").hidden = false;

  document.querySelector(".app")?.classList.remove("chat-open");
}

function cleanupConversation() {
  if (activeChatUnsubscribe) {
    activeChatUnsubscribe();
  }

  if (typingUnsubscribe) {
    typingUnsubscribe();
  }

  if (presenceUnsubscribe) {
    presenceUnsubscribe();
  }

  activeChatUnsubscribe = null;
  typingUnsubscribe = null;
  presenceUnsubscribe = null;
}

// =====================================
// MESSAGE LISTENER
// =====================================

function listenMessages(id) {
  const target = messagesCollection(id);

  const q = query(
    target,
    orderBy("createdAt", "asc"),
    limit(300)
  );

  activeChatUnsubscribe = onSnapshot(
    q,

    snapshot => {
      if (activeChat !== id) return;

      const messages = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderMessages(messages);

      if (activeChatType === "private") {
        markMessagesRead(id);
      }

    },

    error => {
      logFirebaseError("LOAD MESSAGES ERROR", error);

      toast(
        "Gagal memuat pesan: " + error.message,
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

  container.innerHTML = "";

  if (!messages.length) {
    container.innerHTML = `
      <div class="message-empty">
        <strong>Belum ada pesan</strong>
        <span>Mulai percakapan sekarang.</span>
      </div>
    `;

    return;
  }

  messages.forEach(message => {
    const mine = message.senderId === user.uid;

    const deletedFor = message.deletedFor || [];

    if (deletedFor.includes(user.uid)) return;

    const deletedAll =
      message.deletedForEveryone === true;

    const readByOthers = (message.readBy || []).some(
      uid => uid !== message.senderId
    );

    const tick = mine
      ? `<span class="message-tick ${
          readByOthers ? "read" : ""
        }">${
          readByOthers ? "✓✓" : "✓"
        }</span>`
      : "";

    const image = message.imageURL
      ? `
        <img
          class="message-image"
          src="${escapeHTML(message.imageURL)}"
          alt="Gambar pesan"
        >
      `
      : "";

    const content = deletedAll
      ? `
        <em class="deleted-message">
          Pesan ini telah dihapus.
        </em>
      `
      : `
        ${image}
        ${
          message.text
            ? `<div>${escapeHTML(message.text)}</div>`
            : ""
        }
      `;

    const node = document.createElement("article");

    node.className =
      `message ${mine ? "mine" : "theirs"}`;

    node.dataset.messageId = message.id;

    node.innerHTML = `
      ${
        !mine
          ? `
            <small class="message-sender">
              ${escapeHTML(message.senderName || "Pengguna")}
            </small>
          `
          : ""
      }

      <div class="message-bubble">
        ${content}

        <div class="message-meta">
          <time>${formatTime(message.createdAt)}</time>
          ${tick}
        </div>
      </div>

      <div class="message-actions">
        <button type="button" data-action="react">
          Reaksi
        </button>

        <button type="button" data-action="delete-me">
          Hapus untuk saya
        </button>

        ${
          mine
            ? `
              <button type="button" data-action="delete-all">
                Hapus untuk semua
              </button>
            `
            : ""
        }
      </div>

      <div class="reaction-list">
        ${renderReactions(message.reactions)}
      </div>
    `;

    node.querySelector(
      '[data-action="react"]'
    ).onclick = () => {
      reactToMessage(
        message.id,
        message.reactions || {}
      );
    };

    node.querySelector(
      '[data-action="delete-me"]'
    ).onclick = () => {
      deleteForMe(message.id);
    };

    const deleteAllButton = node.querySelector(
      '[data-action="delete-all"]'
    );

    if (deleteAllButton) {
      deleteAllButton.onclick = () => {
        deleteForEveryone(message.id);
      };
    }

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
        class="reaction-chip ${
          users.includes(user.uid) ? "selected" : ""
        }"
        data-emoji="${escapeHTML(emoji)}"
        type="button"
      >
        ${escapeHTML(emoji)} ${users.length}
      </button>
    `)
    .join("");
}

// =====================================
// SEND MESSAGE
// =====================================

async function sendMessage() {
  if (!activeChat || activeChatType === "channel") return;

  const text = $("messageInput").value.trim();

  const file = $("imageInput").files[0];

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
      senderName: profile.name || profile.username,
      text,
      imageURL,
      reactions: {},
      readBy: [user.uid],
      createdAt: serverTimestamp()
    };

    const target = targetType === "group"
      ? collection(db, "groups", targetChat, "messages")
      : collection(db, "chats", targetChat, "messages");

    // Simpan pesan terlebih dahulu.
    await addDoc(target, payload);

    // Kosongkan input setelah pesan tersimpan.
    if (activeChat === targetChat) {
      $("messageInput").value = "";
      $("imageInput").value = "";
    }

    // Preview chat diperbarui secara terpisah.
    try {
      const chatRef = doc(
        db,
        targetType === "group" ? "groups" : "chats",
        targetChat
      );

      await updateDoc(chatRef, {
        lastMessage: text || "Mengirim gambar",
        lastSenderId: user.uid,
        updatedAt: serverTimestamp()
      });

    } catch (previewError) {
      logFirebaseError(
        "CHAT PREVIEW UPDATE ERROR",
        previewError
      );

      toast(
        "Pesan tersimpan, tetapi preview chat gagal diperbarui.",
        "error"
      );
    }

    await updateTyping(false);

  } catch (error) {
    logFirebaseError("SEND MESSAGE ERROR", error);

    toast(
      "Pesan gagal dikirim: " + error.message,
      "error"
    );
  }
}

// =====================================
// DELETE MESSAGE
// =====================================

async function deleteForMe(messageId) {
  if (!activeChat) return;

  try {
    await updateDoc(
      doc(messagesCollection(activeChat), messageId),
      {
        deletedFor: arrayUnion(user.uid)
      }
    );

    toast("Pesan dihapus dari tampilan lu.");

  } catch (error) {
    logFirebaseError("DELETE FOR ME ERROR", error);

    toast(
      "Gagal menghapus pesan: " + error.message,
      "error"
    );
  }
}

async function deleteForEveryone(messageId) {
  if (!activeChat) return;

  if (!confirm("Hapus pesan ini untuk semua orang?")) {
    return;
  }

  try {
    await updateDoc(
      doc(messagesCollection(activeChat), messageId),
      {
        deletedForEveryone: true,
        text: "",
        imageURL: ""
      }
    );

    toast("Pesan dihapus untuk semua orang.");

  } catch (error) {
    logFirebaseError("DELETE EVERYONE ERROR", error);

    toast(
      "Gagal menghapus pesan: " + error.message,
      "error"
    );
  }
}

// =====================================
// REACTIONS
// =====================================

async function reactToMessage(messageId, reactions) {
  const choices = [
    "👍",
    "❤️",
    "😂",
    "😮",
    "😢",
    "🙏"
  ];

  const selected = prompt(
    "Pilih reaksi:\n" + choices.join(" ")
  );

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
      doc(messagesCollection(activeChat), messageId),
      {
        [`reactions.${selected}`]: users
      }
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

    toast(
      "Gagal menyembunyikan chat: " + error.message,
      "error"
    );
  }
}

async function loadHiddenChats() {
  hiddenChats.clear();

  const snap = await getDocs(
    collection(db, "users", user.uid, "hiddenChats")
  );

  snap.forEach(item => {
    hiddenChats.add(item.id);
  });
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
      const items = snapshot.docs
        .filter(item => !hiddenChats.has(item.id))
        .sort((a, b) => {
          const ta =
            a.data().updatedAt?.toMillis?.() || 0;

          const tb =
            b.data().updatedAt?.toMillis?.() || 0;

          return tb - ta;
        });

      const container = $("chatList");

      container.innerHTML = "";

      for (const item of items) {
        const data = item.data();

        const otherUid = data.members?.find(
          uid => uid !== user.uid
        );

        if (!otherUid) continue;

        let other = {};

        try {
          const snap = await getDoc(
            doc(db, "users", otherUid)
          );

          if (snap.exists()) {
            other = snap.data();
          }

        } catch (error) {
          logFirebaseError(
            "LOAD CHAT USER ERROR",
            error
          );
        }

        const row = document.createElement("button");

        row.type = "button";
        row.className = "list-item";

        row.innerHTML = `
          <span class="avatar">
            ${escapeHTML(
              initials(other.name || other.username)
            )}
          </span>

          <span class="list-copy">
            <strong>
              ${escapeHTML(
                other.name || other.username || "Pengguna"
              )}
            </strong>

            <small>
              ${escapeHTML(
                data.lastMessage || "Mulai percakapan"
              )}
            </small>
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
            otherUsername: other.username
          });
        };

        row.oncontextmenu = event => {
          event.preventDefault();

          if (confirm("Sembunyikan chat ini dari daftar?")) {
            hideChat(item.id);
          }
        };

        container.appendChild(row);
      }

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">
            Belum ada percakapan.
          </div>
        `;
      }
    },

    error => {
      logFirebaseError("LOAD CHATS ERROR", error);

      toast(
        "Gagal memuat chat: " + error.message,
        "error"
      );
    }
  );
}

// =====================================
// SEARCH USERS
// =====================================

async function searchUsers() {
  const term = normalizeUsername(
    $("searchUser").value
  );

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
          <strong>${escapeHTML(target.name)}</strong>
          <small>@${escapeHTML(target.username)}</small>
        </span>
      `;

      button.onclick = () => {
        startPrivate(data.uid, target);
      };

      output.appendChild(button);
    }

    if (!output.children.length) {
      output.innerHTML = `
        <div class="empty-list">
          Pengguna tidak ditemukan.
        </div>
      `;
    }

  } catch (error) {
    logFirebaseError("SEARCH USERS ERROR", error);

    output.textContent =
      "Pencarian gagal: " + error.message;
  }
}

// =====================================
// TYPING INDICATOR
// =====================================

async function updateTyping(isTyping) {
  if (!activeChat || activeChatType !== "private") {
    return;
  }

  const path = dbRef(
    rtdb,
    `typing/${activeChat}/${user.uid}`
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

      $("typingIndicator").hidden = !other;
    },

    error => {
      console.warn("TYPING ERROR:", error);
    }
  );
}

// =====================================
// PRESENCE
// =====================================

function listenPresence(otherUid) {
  if (!otherUid) return;

  const path = dbRef(
    rtdb,
    `presence/${otherUid}`
  );

  presenceUnsubscribe = onValue(
    path,

    snapshot => {
      const data = snapshot.val();

      $("chatPresence").textContent =
        data?.state === "online"
          ? "Online"
          : "Offline";
    },

    error => {
      console.warn("PRESENCE ERROR:", error);
    }
  );
}

async function setPresence(state) {
  if (!user) return;

  const path = dbRef(
    rtdb,
    `presence/${user.uid}`
  );

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

// =====================================
// GROUPS
// =====================================

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
    const members = [
      ...new Set([
        user.uid,
        ...memberText
          .split(",")
          .map(value => value.trim())
          .filter(Boolean)
      ])
    ];

    if (members.length < 2) {
      throw new Error(
        "Grup harus memiliki minimal 2 anggota."
      );
    }

    const ref = await addDoc(
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

    await openConversation(ref.id, {
      type: "group",
      name: name.trim(),
      members,
      ownerId: user.uid
    });

  } catch (error) {
    logFirebaseError("CREATE GROUP ERROR", error);

    toast(
      "Gagal membuat grup: " + error.message,
      "error"
    );
  }
}

function listenGroups() {
  if (groupUnsubscribe) {
    groupUnsubscribe();
  }

  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", user.uid)
  );

  groupUnsubscribe = onSnapshot(
    q,

    snapshot => {
      const container = $("groupList");

      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();

        const button = document.createElement("button");

        button.className = "list-item";
        button.type = "button";

        button.innerHTML = `
          <span class="avatar">G</span>

          <span class="list-copy">
            <strong>${escapeHTML(data.name)}</strong>
            <small>
              ${(data.members || []).length} anggota
            </small>
          </span>
        `;

        button.onclick = () => {
          openConversation(item.id, {
            ...data,
            type: "group",
            name: data.name
          });
        };

        container.appendChild(button);
      });

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">
            Belum bergabung dengan grup.
          </div>
        `;
      }
    },

    error => {
      logFirebaseError("LOAD GROUPS ERROR", error);

      toast(
        "Gagal memuat grup: " + error.message,
        "error"
      );
    }
  );
}

async function inviteGroupMember() {
  if (!activeChat || activeChatType !== "group") {
    return;
  }

  const uid = prompt(
    "Masukkan UID pengguna yang ingin ditambahkan:"
  );

  if (!uid?.trim()) return;

  try {
    await updateDoc(
      doc(db, "groups", activeChat),
      {
        members: arrayUnion(uid.trim())
      }
    );

    toast("Anggota ditambahkan.");

  } catch (error) {
    logFirebaseError("INVITE MEMBER ERROR", error);
    toast(error.message, "error");
  }
}

// =====================================
// CHANNELS
// =====================================

async function createChannel() {
  const title = prompt("Nama saluran:");

  if (!title?.trim()) return;

  try {
    const ref = await addDoc(
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

    await openConversation(ref.id, {
      type: "channel",
      title: title.trim(),
      ownerId: user.uid,
      followers: 0
    });

  } catch (error) {
    logFirebaseError("CREATE CHANNEL ERROR", error);

    toast(
      "Gagal membuat saluran: " + error.message,
      "error"
    );
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

      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();

        const button = document.createElement("button");

        button.className = "list-item";
        button.type = "button";

        button.innerHTML = `
          <span class="avatar">Z</span>

          <span class="list-copy">
            <strong>
              ${escapeHTML(data.title || "Saluran")}
            </strong>

            <small>
              ${Number(data.followers || 0)} pengikut
            </small>
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
          <div class="empty-list">
            Belum ada saluran.
          </div>
        `;
      }
    },

    error => {
      logFirebaseError("LOAD CHANNELS ERROR", error);

      toast(
        "Gagal memuat saluran: " + error.message,
        "error"
      );
    }
  );
}

// =====================================
// CHANNEL POSTS
// =====================================

async function sendChannelPost() {
  if (!activeChat || activeChatType !== "channel") {
    return;
  }

  if (activeChatData.ownerId !== user.uid) {
    toast(
      "Hanya pemilik saluran yang dapat membuat postingan.",
      "error"
    );

    return;
  }

  const text = $("channelPostInput").value.trim();

  const file = $("channelImageInput").files[0];

  if (!text && !file) return;

  try {
    const imageURL = file
      ? await uploadImage(file, "channels")
      : "";

    await addDoc(
      collection(db, "channels", activeChat, "posts"),
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

    $("channelPostInput").value = "";
    $("channelImageInput").value = "";

    toast("Postingan diterbitkan.");

  } catch (error) {
    logFirebaseError("CHANNEL POST ERROR", error);
    toast(error.message, "error");
  }
}

async function toggleFollowChannel() {
  if (!activeChat || activeChatType !== "channel") {
    return;
  }

  const followRef = doc(
    db,
    "channels",
    activeChat,
    "followers",
    user.uid
  );

  const channelRef = doc(
    db,
    "channels",
    activeChat
  );

  try {
    await runTransaction(db, async transaction => {
      const existing = await transaction.get(followRef);

      const channel = await transaction.get(channelRef);

      if (!channel.exists()) {
        throw new Error("Saluran tidak ditemukan.");
      }

      const count = Number(
        channel.data().followers || 0
      );

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

    toast(
      "Gagal membuat status: " + error.message,
      "error"
    );
  }
}

function listenStatuses() {
  if (statusUnsubscribe) {
    statusUnsubscribe();
    statusUnsubscribe = null;
  }

  const statusQuery = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
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

      snapshot.forEach(item => {
        const data = item.data();

        if (
          Number(data.expiresAt || 0) < Date.now()
        ) {
          return;
        }

        const button = document.createElement("button");

        button.className = "status-item";
        button.type = "button";

        button.innerHTML = `
          <span class="status-ring">
            ${escapeHTML(initials(data.name))}
          </span>

          <span>
            <strong>
              ${escapeHTML(data.name || "Pengguna")}
            </strong>

            <small>
              ${formatDate(data.createdAt)}
            </small>
          </span>
        `;

        button.onclick = () => {
          currentStatus = data;

          $("viewStatusName").textContent =
            data.name || "Status";

          $("viewStatusText").textContent =
            data.text || "";

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

      toast(
        "Gagal memuat status: " + error.message,
        "error"
      );
    }
  );
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
  if (user.uid !== ADMIN_UID) return;

  const term = $("adminSearch").value.trim();

  const output = $("adminUserResult");

  output.innerHTML = "";

  if (!term) {
    output.textContent =
      "Masukkan UID, username, atau email.";

    return;
  }

  try {
    let found = null;

    if (term.length > 25 && !term.startsWith("@")) {
      const snap = await getDoc(
        doc(db, "users", term)
      );

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

        const snap = await getDoc(
          doc(db, "users", uid)
        );

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
        <div class="empty-list">
          Pengguna tidak ditemukan.
        </div>
      `;

      return;
    }

    output.innerHTML = `
      <div class="admin-user-card">

        <strong>
          ${escapeHTML(found.name || "Pengguna")}
        </strong>

        <span>
          @${escapeHTML(found.username || "-")}
        </span>

        <small>
          UID: ${escapeHTML(found.uid)}
        </small>

        <small>
          Status: ${escapeHTML(found.status || "active")}
        </small>

        <small>
          Email: ${escapeHTML(found.email || "-")}
        </small>

        <small>
          Verifikasi:
          ${found.verified ? "Terverifikasi" : "Belum terverifikasi"}
        </small>

        <div class="admin-actions">
          <button data-status="hold">
            Tahan sementara
          </button>

          <button data-status="permanent">
            Nonaktifkan permanen
          </button>

          <button data-status="active">
            Pulihkan akun
          </button>

          <button data-verify="true">
            Verifikasi
          </button>

          <button data-verify="false">
            Cabut verifikasi
          </button>
        </div>

      </div>
    `;

    output.querySelectorAll("[data-status]").forEach(
      button => {
        button.onclick = () => {
          updateUserStatus(
            found.uid,
            button.dataset.status
          );
        };
      }
    );

    output.querySelectorAll("[data-verify]").forEach(
      button => {
        button.onclick = () => {
          setVerification(
            found.uid,
            button.dataset.verify === "true"
          );
        };
      }
    );

  } catch (error) {
    logFirebaseError("ADMIN SEARCH ERROR", error);

    output.textContent =
      "Pencarian gagal: " + error.message;
  }
}

// =====================================
// ADMIN USER MANAGEMENT
// =====================================

async function updateUserStatus(uid, status) {
  if (user.uid !== ADMIN_UID) return;

  const labels = {
    active: "memulihkan akun",
    hold: "menahan sementara akun",
    permanent: "menonaktifkan akun secara permanen"
  };

  if (!confirm(`Yakin ingin ${labels[status]}?`)) {
    return;
  }

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      updatedAt: serverTimestamp()
    });

    toast("Status pengguna berhasil diperbarui.");

    findAdminUser();

  } catch (error) {
    logFirebaseError("ADMIN STATUS ERROR", error);

    toast(
      "Gagal mengubah status: " + error.message,
      "error"
    );
  }
}

async function setVerification(uid, verified) {
  if (user.uid !== ADMIN_UID) return;

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
  if (user.uid !== ADMIN_UID) return;

  if (appealUnsubscribe) {
    appealUnsubscribe();
  }

  appealUnsubscribe = onSnapshot(
    query(
      collection(db, "appeals"),
      orderBy("createdAt", "desc"),
      limit(50)
    ),

    snapshot => {
      const container = $("appealList");

      container.innerHTML = "";

      snapshot.forEach(item => {
        const data = item.data();

        const card = document.createElement("div");

        card.className = "appeal-card";

        card.innerHTML = `
          <strong>
            ${escapeHTML(
              data.name || data.username || data.uid
            )}
          </strong>

          <small>
            UID: ${escapeHTML(data.uid)}
          </small>

          <p>
            ${escapeHTML(data.reason)}
          </p>

          <span class="appeal-status">
            ${escapeHTML(data.status || "pending")}
          </span>

          <div class="admin-actions">
            <button data-appeal="approved">
              Setujui
            </button>

            <button data-appeal="rejected">
              Tolak
            </button>
          </div>
        `;

        card.querySelectorAll("[data-appeal]").forEach(
          button => {
            button.onclick = async () => {
              const status = button.dataset.appeal;

              try {
                await updateDoc(item.ref, {
                  status,
                  reviewedAt: serverTimestamp(),
                  reviewedBy: user.uid
                });

                if (status === "approved") {
                  await updateUserStatus(
                    data.uid,
                    "active"
                  );
                }

                toast("Status banding diperbarui.");

              } catch (error) {
                logFirebaseError(
                  "UPDATE APPEAL ERROR",
                  error
                );

                toast(error.message, "error");
              }
            };
          }
        );

        container.appendChild(card);
      });

      if (!container.children.length) {
        container.innerHTML = `
          <div class="empty-list">
            Belum ada permohonan banding.
          </div>
        `;
      }
    },

    error => {
      logFirebaseError("LOAD APPEALS ERROR", error);

      toast(
        "Gagal memuat banding: " + error.message,
        "error"
      );
    }
  );
}

function openAdmin() {
  if (user.uid !== ADMIN_UID) return;

  openModal("adminScreen");

  listenAppeals();
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
  cleanupConversation();

  if (chatListUnsubscribe) chatListUnsubscribe();
  if (groupUnsubscribe) groupUnsubscribe();
  if (channelUnsubscribe) channelUnsubscribe();
  if (statusUnsubscribe) statusUnsubscribe();
  if (appealUnsubscribe) appealUnsubscribe();

  await setPresence("offline").catch(() => {});

  await signOut(auth);
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

  updateProfileUI();

  // Hidden chats.
  try {
    await loadHiddenChats();
  } catch (error) {
    logFirebaseError("LOAD HIDDEN CHATS ERROR", error);
    hiddenChats.clear();
  }

  // Presence.
  try {
    await setPresence("online");
  } catch (error) {
    logFirebaseError("SET PRESENCE ERROR", error);
  }

  // Listeners.
  listenChats();
  listenGroups();
  listenChannels();
  listenStatuses();

  showPage("chatsPage");
}

// =====================================
// CLEANUP
// =====================================

function cleanupAllListeners() {
  cleanupConversation();

  [
    "chatListUnsubscribe",
    "groupUnsubscribe",
    "channelUnsubscribe",
    "statusUnsubscribe",
    "appealUnsubscribe"
  ].forEach(key => {
    if (key === "chatListUnsubscribe" && chatListUnsubscribe) {
      chatListUnsubscribe();
      chatListUnsubscribe = null;
    }

    if (key === "groupUnsubscribe" && groupUnsubscribe) {
      groupUnsubscribe();
      groupUnsubscribe = null;
    }

    if (key === "channelUnsubscribe" && channelUnsubscribe) {
      channelUnsubscribe();
      channelUnsubscribe = null;
    }

    if (key === "statusUnsubscribe" && statusUnsubscribe) {
      statusUnsubscribe();
      statusUnsubscribe = null;
    }

    if (key === "appealUnsubscribe" && appealUnsubscribe) {
      appealUnsubscribe();
      appealUnsubscribe = null;
    }
  });
}

// =====================================
// INITIALIZE
// =====================================

async function initialize() {
  loadTheme();

  // Authentication.
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

  // Auth tabs.
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

  // Phone authentication.
  $("sendPhoneOtp").onclick = sendPhoneOTP;
  $("verifyPhoneOtp").onclick = verifyPhoneOTP;
  $("resendPhoneOtp").onclick = sendPhoneOTP;
  $("completePhoneProfile").onclick = completePhoneProfile;

  $("sendLinkPhoneOtp").onclick = sendLinkPhoneOTP;
  $("verifyLinkPhoneOtp").onclick = verifyLinkPhoneOTP;

  // Theme.
  $("themeBtn").onclick = setTheme;
  $("settingsThemeBtn").onclick = setTheme;

  // Logout.
  $("logoutBtn").onclick = logout;
  $("settingsLogoutBtn").onclick = logout;
  $("logoutHold").onclick = logout;
  $("logoutRecovered").onclick = logout;
  $("newAccountBtn").onclick = logout;

  // Account recovery.
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

  // Appeals.
  $("appealBtn").onclick = sendAppeal;

  // Search.
  $("searchUser").addEventListener("input", () => {
    clearTimeout(searchTimer);

    searchTimer = setTimeout(searchUsers, 350);
  });

  $("newChatBtn").onclick = () => {
    $("searchUser").focus();
    toast("Cari username untuk memulai chat.");
  };

  // Messaging.
  $("sendBtn").onclick = sendMessage;

  $("messageInput").addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }
    }
  );

  $("messageInput").addEventListener(
    "input",
    () => updateTyping(true)
  );

  $("messageInput").addEventListener(
    "blur",
    () => updateTyping(false)
  );

  // Chat controls.
  $("backToChats").onclick = closeChat;
  $("inviteGroupMember").onclick = inviteGroupMember;
  $("sendChannelPost").onclick = sendChannelPost;

  // Create features.
  $("createGroupBtn").onclick = createGroup;
  $("createChannelBtn").onclick = createChannel;

  $("createStatusBtn").onclick = () => {
    openModal("statusModal");
  };

  $("publishStatus").onclick = createStatus;

  // Profile.
  $("editProfileBtn").onclick = () => {
    openModal("profileModal");
  };

  $("profileBtn").onclick = () => {
    openModal("profileModal");
  };

  $("saveProfile").onclick = saveProfile;

  // Close modals.
  $("closeProfile").onclick = () => {
    closeModal("profileModal");
  };

  $("closeStatus").onclick = () => {
    closeModal("statusModal");
  };

  $("closeViewStatus").onclick = () => {
    closeModal("viewStatusModal");
  };

  $("linkPhoneBtn").onclick = () => {
    openModal("linkPhoneModal");
  };

  $("closeLinkPhone").onclick = () => {
    closeModal("linkPhoneModal");
  };

  // Admin.
  $("openAdmin").onclick = openAdmin;

  $("closeAdmin").onclick = () => {
    closeModal("adminScreen");
  };

  $("findAdminUser").onclick = findAdminUser;

  // Navigation.
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
    });
  });

  // Escape.
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

  // Auth state.
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

  // Unload.
  window.addEventListener("beforeunload", () => {
    if (user) {
      setPresence("offline").catch(() => {});
    }
  });
}

initialize();
