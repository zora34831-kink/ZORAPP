
import { auth, db, storage } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
  runTransaction,
  increment,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

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
let registrationInProgress = false;
let searchTimer = null;

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

function errorMessage(error) {
  console.error(error);

  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Password minimal 8 karakter.",
    "auth/user-disabled": "Akun dinonaktifkan.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/network-request-failed": "Koneksi internet bermasalah.",
    "permission-denied": "Akses Firestore ditolak. Periksa Firestore Rules.",
    "storage/unauthorized": "Akses foto ditolak. Periksa Storage Rules.",
    "storage/canceled": "Upload foto dibatalkan.",
    "storage/retry-limit-exceeded": "Upload gagal. Periksa koneksi internet.",
    "unavailable": "Layanan sedang tidak tersedia. Coba lagi."
  };

  return messages[code] ||
    messages[code.replace(/^firestore\//, "")] ||
    error?.message ||
    "Terjadi kesalahan.";
}

function safeElement(tag, className, text) {
  const el = document.createElement(tag);

  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;

  return el;
}

function isAdmin() {
  return currentUser?.uid === ADMIN_UID;
}

function cleanup() {
  unsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  unsubscribers = [];

  stopMessageListener();

  activeChat = null;
  appListenersStarted = false;
}

function stopMessageListener() {
  if (messageUnsubscribe) {
    messageUnsubscribe();
    messageUnsubscribe = null;
  }
}

// ======================================================
// DYNAMIC MODALS
// ======================================================

function createStatusModal() {
  if (exists("statusModal")) return;

  const modal = safeElement("div", "zora-modal");
  modal.id = "statusModal";
  modal.hidden = true;

  const card = safeElement("div", "zora-modal-card");

  const heading = safeElement("div", "zora-modal-heading");

  const headingText = safeElement("div");

  headingText.append(
    safeElement("small", "", "MOMENTS"),
    safeElement("h2", "", "Buat Status")
  );

  const close = safeElement("button", "zora-modal-close", "×");
  close.type = "button";
  close.onclick = closeStatusModal;

  heading.append(headingText, close);

  const textarea = safeElement("textarea");
  textarea.id = "statusInput";
  textarea.maxLength = 500;
  textarea.placeholder = "Apa yang sedang kamu pikirkan?";

  const actions = safeElement("div", "zora-modal-actions");

  const cancel = safeElement("button", "secondary-btn", "Batal");
  cancel.type = "button";
  cancel.onclick = closeStatusModal;

  const publish = safeElement(
    "button",
    "primary-btn",
    "Bagikan Status"
  );

  publish.type = "button";
  publish.id = "publishStatus";
  publish.onclick = publishStatus;

  actions.append(cancel, publish);
  card.append(heading, textarea, actions);
  modal.append(card);

  modal.addEventListener("click", event => {
    if (event.target === modal) closeStatusModal();
  });

  document.body.append(modal);
}

function openStatusModal() {
  createStatusModal();

  $("statusInput").value = "";
  setHidden("statusModal", false);

  setTimeout(() => $("statusInput")?.focus(), 100);
}

function closeStatusModal() {
  setHidden("statusModal", true);
}

async function publishStatus() {
  const text = $("statusInput")?.value.trim();

  if (!text) {
    toast("Tulis status terlebih dahulu.");
    return;
  }

  if (!currentUser) return;

  const button = $("publishStatus");
  button.disabled = true;

  try {
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      name: currentProfile?.name || "Pengguna",
      text,
      createdAt: serverTimestamp()
    });

    closeStatusModal();
    toast("Status berhasil dibuat.");
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

on("createStatusBtn", "click", openStatusModal);

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
    throw new Error(
      "Username harus 3–20 karakter, hanya huruf, angka, dan underscore."
    );
  }

  await runTransaction(db, async transaction => {
    const newRef = doc(db, "usernames", normalized);
    const newSnap = await transaction.get(newRef);

    if (newSnap.exists() && newSnap.data().uid !== uid) {
      throw new Error("Username sudah digunakan.");
    }

    let oldRef = null;
    let oldSnap = null;

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

  setText("authError", "");

  if (!email) {
    setText("authError", "Masukkan email terlebih dahulu.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("LINK RESET PASSWORD TELAH DIKIRIM KE EMAIL");
  } catch (error) {
    setText("authError", errorMessage(error));
  }
});

on("registerBtn", "click", async () => {
  const name = $("authName")?.value.trim();
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value;
  const username = normalizeUsername(
    $("registerUsername")?.value || ""
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
    setText(
      "registerError",
      "Username wajib 3–20 karakter: huruf kecil, angka, atau underscore."
    );
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
    $("authPassword").value = "";

    setHidden("registerMode", true);
    setHidden("loginMode", false);

    toast("AKUN BERHASIL DIBUAT, SILAHKAN MASUK");
  } catch (error) {
    setText("registerError", errorMessage(error));

    if (credential) {
      console.error(
        "Auth berhasil dibuat, tetapi penyimpanan profil gagal.",
        error
      );
    }
  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
});

// ======================================================
// AVATAR / PROFILE PHOTO
// ======================================================

function renderAvatar(elementId, photoURL, name = "Z") {
  const element = $(elementId);
  if (!element) return;

  element.replaceChildren();

  if (photoURL) {
    const image = document.createElement("img");

    image.src = photoURL;
    image.alt = "Foto profil";
    image.className = "avatar-photo";

    image.onerror = () => {
      element.textContent = (name || "Z")[0].toUpperCase();
    };

    element.append(image);
  } else {
    element.textContent = (name || "Z")[0].toUpperCase();
  }
}

function createProfilePhotoControls() {
  const modal = $("profileModal");
  if (!modal || exists("profilePhotoControls")) return;

  const controls = safeElement("div", "profile-photo-editor");
  controls.id = "profilePhotoControls";

  const preview = safeElement("div", "profile-photo-preview");
  preview.id = "profilePhotoPreview";

  const initial = safeElement("span", "", "Z");
  initial.id = "profilePhotoInitial";
  preview.append(initial);

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

  input.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) uploadProfilePhoto(file);
  });

  const note = safeElement(
    "small",
    "",
    "JPG, PNG, atau WEBP. Maksimal 5 MB."
  );

  controls.append(preview, label, input, note);

  const content = modal.querySelector(
    ".modal-content, .profile-modal-content, .modal-card"
  );

  (content || modal).prepend(controls);
}

async function uploadProfilePhoto(file) {
  if (!currentUser || !file) return;

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
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

    await updateDoc(
      doc(db, "users", currentUser.uid),
      { photoURL }
    );

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

    toast("Foto profil berhasil diperbarui.");
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
    setHidden("appScreen", true);
    setHidden("holdScreen", true);
    setHidden("recoveredScreen", true);
    setHidden("permanentScreen", true);
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
            usernameLower: "",
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

      setHidden("appScreen", true);
      setHidden("holdScreen", true);
      setHidden("recoveredScreen", true);
      setHidden("permanentScreen", true);

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

      setText("myName", currentProfile.name || "Pengguna");
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
// LOGOUT / ACCOUNT
// ======================================================

async function logout() {
  try {
    cleanup();
    await signOut(auth);
  } catch (error) {
    toast(errorMessage(error));
  }
}

on("logoutBtn", "click", logout);
on("logoutHold", "click", logout);
on("logoutRecovered", "click", logout);
on("newAccountBtn", "click", logout);
on("settingsLogoutBtn", "click", logout);

on("verifyAccountBtn", "click", async () => {
  if (!currentUser || currentProfile?.status !== "recovered") {
    return;
  }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      status: "active",
      verifiedAt: serverTimestamp()
    });

    toast("AKUN BERHASIL DIAKTIFKAN KEMBALI");
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
  $("appScreen")?.classList.remove("chat-open");
  openPage("chatsPage");
});

// ======================================================
// THEMES
// ======================================================

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "light";

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
  setText(
    "settingsThemeBtn",
    `TEMA: ${theme.toUpperCase()}`
  );
}

function cycleTheme() {
  const current = localStorage.getItem("zora-theme") || "light";
  const index = THEMES.indexOf(current);
  const next = THEMES[(index + 1) % THEMES.length];

  applyTheme(next);
  toast(`TEMA ${next.toUpperCase()} AKTIF`);
}

on("themeBtn", "click", cycleTheme);
on("settingsThemeBtn", "click", cycleTheme);

applyTheme(localStorage.getItem("zora-theme") || "light");

// ======================================================
// PRIVATE CHAT
// ======================================================

function privateChatId(a, b) {
  return [a, b].sort().join("_");
}

async function openPrivateChat(other) {
  if (!currentUser || !other?.uid) return;

  if (other.status !== "active") {
    toast("Pengguna tidak tersedia.");
    return;
  }

  const id = privateChatId(currentUser.uid, other.uid);
  const chatRef = doc(db, "chats", id);

  try {
    const chatSnap = await getDoc(chatRef);

    if (chatSnap.exists()) {
      const members = chatSnap.data().members || [];

      if (
        !members.includes(currentUser.uid) ||
        !members.includes(other.uid)
      ) {
        throw new Error("Anggota percakapan tidak valid.");
      }
    } else {
      await setDoc(chatRef, {
        members: [currentUser.uid, other.uid],
        lastMessage: "",
        updatedAt: serverTimestamp()
      });
    }

    activeChat = {
      id,
      uid: other.uid,
      name: other.name
    };

    activeChatType = "private";

    setText("sendBtn", "Kirim");

    showConversation(
      other.name,
      other.verified ? "Akun terverifikasi" : ""
    );

    const unreadRef = doc(
      db,
      "chats",
      id,
      "unreadCounts",
      currentUser.uid
    );

    const unreadSnap = await getDoc(unreadRef);

    if (unreadSnap.exists()) {
      await updateDoc(unreadRef, { count: 0 });
    }

    listenMessages("chats", id);
  } catch (error) {
    console.error("OPEN CHAT ERROR:", error);
    toast(errorMessage(error));
  }
}

function showConversation(name, verified = "") {
  setHidden("emptyChat", true);
  setHidden("chatPanel", false);

  setText("chatName", name);
  setText("chatVerified", verified);

  renderAvatar("chatAvatar", activeChat?.photoURL, name);

  if (window.innerWidth <= 800) {
    $("appScreen")?.classList.add("chat-open");
  }
}

// ======================================================
// MESSAGE LISTENER / READ RECEIPTS
// ======================================================

function listenMessages(root, id) {
  stopMessageListener();

  const messageRef = collection(
    db,
    root,
    id,
    "messages"
  );

  const messageQuery = query(
    messageRef,
    orderBy("createdAt", "asc"),
    limit(200)
  );

  messageUnsubscribe = onSnapshot(
    messageQuery,
    snap => {
      const container = $("messages");
      if (!container) return;

      container.replaceChildren();

      snap.forEach(item => {
        const data = item.data();
        const mine = data.sender === currentUser.uid;
        const readBy = data.readBy || [];

        if (
          !mine &&
          activeChatType === "private" &&
          !readBy.includes(currentUser.uid)
        ) {
          updateDoc(item.ref, {
            readBy: arrayUnion(currentUser.uid)
          }).catch(error => {
            console.error("READ RECEIPT ERROR:", error);
          });
        }

        const bubble = safeElement(
          "div",
          "bubble" + (mine ? " mine" : "")
        );

        if (data.text) {
          bubble.append(
            safeElement("div", "", data.text)
          );
        }

        const footer = safeElement("div", "message-footer");

        footer.append(
          safeElement(
            "small",
            "",
            data.createdAt?.toDate
              ? data.createdAt.toDate().toLocaleTimeString(
                  "id-ID",
                  {
                    hour: "2-digit",
                    minute: "2-digit"
                  }
                )
              : "Mengirim..."
          )
        );

        if (mine && activeChatType === "private") {
          const isRead = Boolean(
            activeChat?.uid &&
            readBy.includes(activeChat.uid)
          );

          footer.append(
            safeElement(
              "span",
              "message-ticks" + (isRead ? " read" : ""),
              "✓✓"
            )
          );
        }

        bubble.append(footer);

        if (mine || isAdmin()) {
          const del = safeElement(
            "button",
            "message-delete",
            "Hapus"
          );

          del.onclick = () => {
            deleteMessage(root, id, item.id);
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

async function deleteMessage(root, id, messageId) {
  if (!confirm("Hapus pesan ini?")) return;

  try {
    await deleteDoc(
      doc(db, root, id, "messages", messageId)
    );

    toast("Pesan berhasil dihapus.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

// ======================================================
// SEND MESSAGE
// ======================================================

async function sendMessage(text) {
  if (!activeChat || !currentUser) {
    throw new Error("Pilih percakapan terlebih dahulu.");
  }

  if (!text.trim()) return;

  if (activeChatType === "channel") {
    if (!isAdmin() && activeChat.owner !== currentUser.uid) {
      throw new Error(
        "Hanya pemilik saluran atau admin yang dapat posting."
      );
    }

    await addDoc(
      collection(db, "channels", activeChat.id, "posts"),
      {
        uid: currentUser.uid,
        authorName: currentProfile?.name || "Pengguna",
        text: text.trim(),
        createdAt: serverTimestamp()
      }
    );

    return;
  }

  const root =
    activeChatType === "group" ? "groups" : "chats";

  await addDoc(
    collection(db, root, activeChat.id, "messages"),
    {
      sender: currentUser.uid,
      senderName: currentProfile?.name || "Pengguna",
      text: text.trim(),
      type: "text",
      readBy: [currentUser.uid],
      createdAt: serverTimestamp()
    }
  );

  await updateDoc(
    doc(db, root, activeChat.id),
    {
      lastMessage: text.trim(),
      updatedAt: serverTimestamp()
    }
  );

  if (
    activeChatType === "private" &&
    activeChat.uid
  ) {
    const unreadRef = doc(
      db,
      "chats",
      activeChat.id,
      "unreadCounts",
      activeChat.uid
    );

    await setDoc(
      unreadRef,
      {
        count: increment(1)
      },
      { merge: true }
    );
  }
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

// ======================================================
// IMAGE MESSAGE NOTICE
// ======================================================

on("imageInput", "change", event => {
  event.target.value = "";
  toast("Upload gambar chat belum diaktifkan.");
});

// ======================================================
// USER SEARCH
// ======================================================

on("searchUser", "input", () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(searchUsers, 350);
});

async function searchUsers() {
  if (
    !currentUser ||
    !exists("searchUser") ||
    !exists("searchResults")
  ) {
    return;
  }

  const value = normalizeUsername($("searchUser").value);
  const results = $("searchResults");

  results.replaceChildren();

  if (value.length < 3) return;

  try {
    const usernameSnap = await getDoc(
      doc(db, "usernames", value)
    );

    if (usernameSnap.exists()) {
      const uid = usernameSnap.data().uid;

      if (uid !== currentUser.uid) {
        const userSnap = await getDoc(
          doc(db, "users", uid)
        );

        if (userSnap.exists()) {
          const user = userSnap.data();

          if (user.status === "active") {
            const row = safeElement("div", "user-item");

            const avatar = safeElement("div", "avatar");
            renderAvatarInto(avatar, user.photoURL, user.name);

            const details = safeElement("div");

            details.append(
              safeElement(
                "strong",
                "",
                `${user.name || "Pengguna"}${user.verified ? " ✓" : ""}`
              ),
              safeElement(
                "small",
                "",
                `@${user.username || value}`
              )
            );

            row.append(avatar, details);

            row.onclick = () => openPrivateChat(user);

            results.append(row);
            return;
          }
        }
      }
    }

    results.append(
      safeElement(
        "small",
        "search-empty",
        "Username tidak ditemukan."
      )
    );
  } catch (error) {
    toast(errorMessage(error));
  }
}

function renderAvatarInto(element, photoURL, name = "Z") {
  element.replaceChildren();

  if (photoURL) {
    const image = document.createElement("img");
    image.src = photoURL;
    image.alt = "Foto profil";
    image.className = "avatar-photo";
    element.append(image);
  } else {
    element.textContent = (name || "Z")[0].toUpperCase();
  }
}

on("newChatBtn", "click", () => {
  $("searchUser")?.focus();
  toast("Cari username untuk memulai chat.");
});

// ======================================================
// CHAT LIST + UNREAD BADGE
// ======================================================

function listenChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    chatsQuery,
    async snap => {
      const list = $("chatList");
      if (!list) return;

      list.replaceChildren();

      for (const item of snap.docs) {
        const data = item.data();

        const otherId = data.members?.find(
          id => id !== currentUser.uid
        );

        if (!otherId) continue;

        try {
          const userSnap = await getDoc(
            doc(db, "users", otherId)
          );

          if (!userSnap.exists()) continue;

          const user = userSnap.data();

          if (user.status !== "active") continue;

          const unreadSnap = await getDoc(
            doc(
              db,
              "chats",
              item.id,
              "unreadCounts",
              currentUser.uid
            )
          );

          const unreadCount = unreadSnap.exists()
            ? Number(unreadSnap.data().count || 0)
            : 0;

          const row = safeElement("div", "chat-item");

          const avatar = safeElement("div", "avatar");
          renderAvatarInto(
            avatar,
            user.photoURL,
            user.name
          );

          const details = safeElement(
            "div",
            "chat-item-details"
          );

          details.append(
            safeElement(
              "strong",
              "",
              `${user.name || "Pengguna"}${user.verified ? " ✓" : ""}`
            ),
            safeElement(
              "small",
              "",
              data.lastMessage || "Mulai percakapan"
            )
          );

          row.append(avatar, details);

          if (unreadCount > 0) {
            row.append(
              safeElement(
                "span",
                "unread-badge",
                unreadCount > 99
                  ? "99+"
                  : String(unreadCount)
              )
            );
          }

          row.onclick = () => openPrivateChat(user);

          list.append(row);
        } catch (error) {
          console.error("CHAT LIST ERROR:", error);
        }
      }
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

// ======================================================
// STATUS LISTENER
// ======================================================

function listenStatuses() {
  const statusesQuery = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(80)
  );

  const unsubscribe = onSnapshot(
    statusesQuery,
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

        const ownerProfile =
          isMine ? currentProfile : null;

        renderAvatarInto(
          avatar,
          ownerProfile?.photoURL,
          status.name
        );

        const details = safeElement(
          "div",
          "status-details"
        );

        details.append(
          safeElement(
            "strong",
            "",
            status.name || "Pengguna"
          ),
          safeElement(
            "small",
            "",
            status.text || ""
          )
        );

        row.append(avatar, details);

        row.onclick = () => {
          toast(
            `${status.name || "Pengguna"}: ${status.text || ""}`
          );
        };

        if (isMine) {
          const del = safeElement(
            "button",
            "secondary-btn",
            "Hapus"
          );

          del.onclick = async event => {
            event.stopPropagation();

            if (!confirm("Hapus status ini?")) return;

            try {
              await deleteDoc(
                doc(db, "statuses", item.id)
              );

              toast("Status berhasil dihapus.");
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
// GROUPS
// ======================================================

on("createGroupBtn", "click", async () => {
  const name = prompt("Nama grup:");
  if (!name?.trim()) return;

  try {
    const group = await addDoc(
      collection(db, "groups"),
      {
        name: name.trim(),
        owner: currentUser.uid,
        members: [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    toast("Grup berhasil dibuat.");
    openGroup(group.id, name.trim());
  } catch (error) {
    toast(errorMessage(error));
  }
});

function listenGroups() {
  const groupsQuery = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    groupsQuery,
    snap => {
      const list = $("groupList");
      if (!list) return;

      list.replaceChildren();

      snap.forEach(item => {
        const group = item.data();
        const row = safeElement("div", "chat-item");

        row.append(
          safeElement("div", "avatar", "G"),
          safeElement("strong", "", group.name || "Grup")
        );

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

function openGroup(id, name) {
  activeChat = { id, name };
  activeChatType = "group";

  setText("sendBtn", "Kirim");

  showConversation(name, "Grup");
  listenMessages("groups", id);
}

// ======================================================
// CHANNELS
// ======================================================

on("createChannelBtn", "click", async () => {
  const name = prompt("Nama saluran:");
  if (!name?.trim()) return;

  const description = prompt("Deskripsi saluran:") || "";

  try {
    const channel = await addDoc(
      collection(db, "channels"),
      {
        name: name.trim(),
        description,
        owner: currentUser.uid,
        followers: [currentUser.uid],
        createdAt: serverTimestamp()
      }
    );

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
  const channelsQuery = query(
    collection(db, "channels"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  const unsubscribe = onSnapshot(
    channelsQuery,
    snap => {
      const list = $("channelList");
      if (!list) return;

      list.replaceChildren();

      snap.forEach(item => {
        const channel = item.data();
        const row = safeElement("div", "chat-item");

        row.append(
          safeElement("div", "avatar", "S"),
          safeElement(
            "div",
            "",
            channel.name || "Saluran"
          )
        );

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

function openChannel(id, name, owner) {
  activeChat = { id, name, owner };
  activeChatType = "channel";

  showConversation(name, "Saluran");
  setText("sendBtn", "Posting");

  stopMessageListener();

  const postsQuery = query(
    collection(db, "channels", id, "posts"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  messageUnsubscribe = onSnapshot(
    postsQuery,
    snap => {
      const container = $("messages");
      if (!container) return;

      container.replaceChildren();

      snap.forEach(item => {
        const post = item.data();
        const bubble = safeElement("div", "bubble");

        if (post.text) {
          bubble.append(
            safeElement("div", "", post.text)
          );
        }

        bubble.append(
          safeElement(
            "small",
            "",
            post.authorName || "Pengguna"
          )
        );

        if (post.uid === currentUser.uid || isAdmin()) {
          const del = safeElement(
            "button",
            "message-delete",
            "Hapus"
          );

          del.onclick = async () => {
            if (!confirm("Hapus postingan ini?")) return;

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
    $("profileUsername").value =
      currentProfile.username || "";
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
    toast(
      "Username harus 3–20 karakter, huruf kecil, angka, atau underscore."
    );
    return;
  }

  try {
    if (
      newUsername !== normalizeUsername(oldUsername)
    ) {
      await claimUsername(
        newUsername,
        currentUser.uid,
        oldUsername
      );
    }

    await updateDoc(
      doc(db, "users", currentUser.uid),
      {
        name,
        bio,
        username: newUsername,
        usernameLower: newUsername
      }
    );

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
// ADMIN PANEL
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

  if (!result) return;

  result.replaceChildren();

  if (!uid) return;

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
      const button = safeElement(
        "button",
        "secondary-btn",
        label
      );

      button.onclick = async () => {
        if (uid === ADMIN_UID) {
          toast("Admin utama tidak dapat dimoderasi.");
          return;
        }

        if (!confirm(`Lanjutkan tindakan: ${label}?`)) {
          return;
        }

        try {
          await updateDoc(
            doc(db, "users", uid),
            {
              ...changes,
              moderatedAt: serverTimestamp(),
              moderatedBy: currentUser.uid
            }
          );

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
    const appealsQuery = query(
      collection(db, "appeals"),
      where("status", "==", "pending")
    );

    const snap = await getDocs(appealsQuery);

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

      const approve = safeElement(
        "button",
        "primary-btn",
        "Terima"
      );

      approve.onclick = async () => {
        try {
          await updateDoc(
            doc(db, "users", appeal.uid),
            {
              status: "recovered",
              moderatedAt: serverTimestamp(),
              moderatedBy: currentUser.uid
            }
          );

          await updateDoc(
            doc(db, "appeals", item.id),
            {
              status: "approved",
              reviewedAt: serverTimestamp(),
              reviewedBy: currentUser.uid
            }
          );

          toast(
            "Banding diterima. Pengguna dapat melanjutkan verifikasi."
          );

          loadAppeals();
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      const reject = safeElement(
        "button",
        "secondary-btn",
        "Tolak"
      );

      reject.onclick = async () => {
        try {
          await updateDoc(
            doc(db, "appeals", item.id),
            {
              status: "rejected",
              reviewedAt: serverTimestamp(),
              reviewedBy: currentUser.uid
            }
          );

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

console.log("ZORAAPP — app.js berhasil dimuat.");
