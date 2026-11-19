
import { auth, db, storage } from "./firebase.js";

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
  runTransaction, arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
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
let firstMessageSnapshot = true;
let lastNotificationTime = 0;

function on(id, event, callback) {
  if (exists(id)) $(id).addEventListener(event, callback);
}

function setText(id, value) {
  if (exists(id)) $(id).textContent = value ?? "";
}

function setHidden(id, hidden) {
  if (exists(id)) $(id).hidden = hidden;
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
    "unavailable": "Layanan sedang tidak tersedia. Coba lagi."
  };

  return messages[code] || error?.message || "Terjadi kesalahan.";
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

function cleanup() {
  unsubscribers.forEach(unsubscribe => {
    try { unsubscribe(); } catch {}
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
// THEME
// ======================================================

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "dark";

  document.body.classList.remove(
    "dark", "theme-neon", "theme-dark",
    "theme-light", "theme-purple"
  );

  document.body.classList.add(`theme-${theme}`);
  if (theme === "dark") document.body.classList.add("dark");

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
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

async function claimUsername(username, uid, oldUsername = "") {
  const normalized = normalizeUsername(username);
  const oldNormalized = normalizeUsername(oldUsername);

  if (!validUsername(normalized)) {
    throw new Error("Username harus 3–20 karakter, huruf kecil, angka, atau underscore.");
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
    toast("Link reset password sudah dikirim ke email.");
  } catch (error) {
    setText("authError", errorMessage(error));
  }
});

on("registerBtn", "click", async () => {
  const name = $("authName")?.value.trim();
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value;
  const username = normalizeUsername($("registerUsername")?.value);

  setText("registerError", "");

  if (!name || !email || !password) {
    setText("registerError", "Semua kolom wajib diisi.");
    return;
  }

  if (name.length < 3 || password.length < 8) {
    setText("registerError", "Nama minimal 3 karakter dan password minimal 8 karakter.");
    return;
  }

  if (!validUsername(username)) {
    setText("registerError", "Username harus 3–20 karakter: huruf kecil, angka, atau underscore.");
    return;
  }

  $("registerBtn").disabled = true;
  registrationInProgress = true;

  let credential = null;

  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
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
      console.error("Auth berhasil dibuat, tetapi profil gagal disimpan.", error);
    }
  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
});

// ======================================================
// AVATAR + PROFILE PHOTO
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

function createProfilePhotoControls() {
  const modal = $("profileModal");
  if (!modal || exists("profilePhotoControls")) return;

  const controls = safeElement("div", "profile-photo-editor");
  controls.id = "profilePhotoControls";

  const preview = safeElement("div", "profile-photo-preview");
  preview.id = "profilePhotoPreview";

  const label = safeElement("label", "photo-upload-button", "Ganti Foto Profil");
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
  if (!currentUser || !file) return;

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
    const imageRef = ref(storage, `profilePhotos/${currentUser.uid}/avatar`);
    await uploadBytes(imageRef, file, { contentType: file.type });

    const photoURL = await getDownloadURL(imageRef);

    await updateDoc(doc(db, "users", currentUser.uid), { photoURL });

    currentProfile.photoURL = photoURL;

    renderAvatar("profilePhotoPreview", photoURL, currentProfile.name);
    renderAvatar("myAvatar", photoURL, currentProfile.name);

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
    ["appScreen", "holdScreen", "recoveredScreen", "permanentScreen"].forEach(id => setHidden(id, true));
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

      ["appScreen", "holdScreen", "recoveredScreen", "permanentScreen"].forEach(id => setHidden(id, true));

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
      renderAvatar("myAvatar", currentProfile.photoURL, currentProfile.name);

      setHidden("openAdmin", !isAdmin());
      createProfilePhotoControls();
      renderAvatar("profilePhotoPreview", currentProfile.photoURL, currentProfile.name);

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
// LOGOUT + ACCOUNT
// ======================================================

async function logout() {
  try {
    cleanup();
    await signOut(auth);
  } catch (error) {
    toast(errorMessage(error));
  }
}

["logoutBtn", "logoutHold", "logoutRecovered", "newAccountBtn", "settingsLogoutBtn"]
  .forEach(id => on(id, "click", logout));

on("verifyAccountBtn", "click", async () => {
  if (!currentUser || currentProfile?.status !== "recovered") return;

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      status: "active",
      verifiedAt: serverTimestamp()
    });
    toast("Akun berhasil diaktifkan kembali.");
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
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  $("appScreen")?.classList.remove("chat-open");
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => openPage(button.dataset.page));
});

on("backToChats", "click", () => {
  $("appScreen")?.classList.remove("chat-open");
  openPage("chatsPage");
});

// ======================================================
// CHAT HEADER + HONEST ENCRYPTION NOTICE
// ======================================================

function createChatSecurityNotice() {
  const panel = $("chatPanel");
  if (!panel || exists("chatSecurityNotice")) return;

  const notice = safeElement("div", "chat-security-notice");
  notice.id = "chatSecurityNotice";

  const mark = safeElement("span", "security-mark", "i");
  const text = safeElement("div", "security-copy");

  text.append(
    safeElement("strong", "", "Privasi percakapan"),
    safeElement("small", "", "Koneksi menggunakan Firebase. Enkripsi end-to-end belum aktif.")
  );

  notice.append(mark, text);

  const header = panel.querySelector(".conversation-header");
  if (header) header.after(notice);
  else panel.prepend(notice);
}

function showConversation(name, verified = "") {
  setHidden("emptyChat", true);
  setHidden("chatPanel", false);

  setText("chatName", name);
  setText("chatVerified", verified);

  renderAvatar("chatAvatar", activeChat?.photoURL, name);
  createChatSecurityNotice();

  if (window.innerWidth <= 800) {
    $("appScreen")?.classList.add("chat-open");
  }
}

// ======================================================
// PRIVATE CHAT: REUSE EXISTING CHAT, NO DUPLICATES
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
    return members.includes(otherUid) && members.length === 2;
  });

  if (!matches.length) return null;

  matches.sort((a, b) => {
    const at = a.data().updatedAt?.toMillis?.() || 0;
    const bt = b.data().updatedAt?.toMillis?.() || 0;
    return bt - at;
  });

  return matches[0];
}

async function openPrivateChat(other) {
  if (!currentUser || !other?.uid) return;

  if (other.status && other.status !== "active") {
    toast("Pengguna tidak tersedia.");
    return;
  }

  try {
    const existing = await findExistingPrivateChat(other.uid);
    const id = existing?.id || privateChatId(currentUser.uid, other.uid);
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
        if (!members.includes(currentUser.uid) || !members.includes(other.uid)) {
          throw new Error("Anggota percakapan tidak valid.");
        }
      }
    }

    const hiddenRef = doc(db, "users", currentUser.uid, "hiddenChats", id);
    const hiddenSnap = await getDoc(hiddenRef);
    if (hiddenSnap.exists()) await deleteDoc(hiddenRef);

    activeChat = {
      id,
      uid: other.uid,
      name: other.name || "Pengguna",
      photoURL: other.photoURL || "",
      verified: Boolean(other.verified)
    };

    activeChatType = "private";
    setText("sendBtn", "Kirim");
    showConversation(activeChat.name, other.verified ? "Akun terverifikasi" : "");
    listenMessages("chats", id);
  } catch (error) {
    console.error("OPEN CHAT ERROR:", error);
    toast(errorMessage(error));
  }
}

// ======================================================
// MESSAGE MENU
// ======================================================

function createMessageActionMenu(messageRef, messageData, root, chatId, messageId) {
  const wrapper = safeElement("div", "message-actions");
  const trigger = safeElement("button", "message-menu-trigger", "⋯");
  trigger.type = "button";
  trigger.title = "Opsi pesan";

  const menu = safeElement("div", "message-menu");
  menu.hidden = true;

  trigger.onclick = event => {
    event.stopPropagation();
    document.querySelectorAll(".message-menu").forEach(el => {
      if (el !== menu) el.hidden = true;
    });
    menu.hidden = !menu.hidden;
  };

  const hideForMe = safeElement("button", "", "Hapus untuk saya");
  hideForMe.type = "button";
  hideForMe.onclick = async () => {
    menu.hidden = true;
    try {
      await updateDoc(messageRef, {
        deletedFor: arrayUnion(currentUser.uid)
      });
      toast("Pesan dihapus dari tampilan akun lu.");
    } catch (error) {
      toast(errorMessage(error));
    }
  };

  menu.append(hideForMe);

  const isMine = messageData.sender === currentUser.uid;
  if (isMine && !messageData.deleted) {
    const deleteAll = safeElement("button", "danger-option", "Hapus untuk semua orang");
    deleteAll.type = "button";

    deleteAll.onclick = async () => {
      menu.hidden = true;

      if (!confirm("Pesan ini akan diganti untuk semua orang. Lanjutkan?")) return;

      try {
        await updateDoc(messageRef, {
          text: "Pesan ini telah dihapus",
          deleted: true,
          deletedBy: currentUser.uid,
          deletedAt: serverTimestamp()
        });
        toast("Pesan dihapus untuk semua orang.");
      } catch (error) {
        toast(errorMessage(error));
      }
    };

    menu.append(deleteAll);
  }

  wrapper.append(trigger, menu);
  return wrapper;
}

// ======================================================
// MESSAGE LISTENER + READ RECEIPTS + NOTIFICATIONS
// ======================================================

function makeDoubleTick(isRead) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 22 16");
  svg.setAttribute("width", "19");
  svg.setAttribute("height", "14");
  svg.setAttribute("class", `message-ticks${isRead ? " read" : ""}`);
  svg.setAttribute("aria-label", isRead ? "Dibaca" : "Terkirim");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M1 8.5 5.2 12.5 13.3 3.5 M8.5 8.5 12.5 12.5 21 3.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.append(path);
  return svg;
}

function notifyIncomingMessage(data) {
  const now = Date.now();
  if (now - lastNotificationTime < 500) return;
  lastNotificationTime = now;

  const sender = data.senderName || "Pesan baru";
  const preview = data.text || "Mengirim pesan";

  toast(`${sender}: ${preview.slice(0, 65)}`);

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(`Pesan dari ${sender}`, {
        body: preview.slice(0, 100),
        tag: `zora-${activeChat?.id || "message"}`
      });
    } catch {}
  }
}

function listenMessages(root, id) {
  stopMessageListener();
  firstMessageSnapshot = true;

  const messageQuery = query(
    collection(db, root, id, "messages"),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  messageUnsubscribe = onSnapshot(
    messageQuery,
    async snap => {
      const container = $("messages");
      if (!container) return;

      if (!firstMessageSnapshot) {
        snap.docChanges().forEach(change => {
          if (change.type !== "added") return;

          const data = change.doc.data();
          if (data.sender !== currentUser.uid) {
            const viewingThisChat =
              activeChat?.id === id &&
              !document.hidden;

            if (!viewingThisChat) notifyIncomingMessage(data);
          }
        });
      }

      firstMessageSnapshot = false;
      container.replaceChildren();

      const pendingReads = [];

      snap.forEach(item => {
        const data = item.data();
        const mine = data.sender === currentUser.uid;
        const deletedFor = data.deletedFor || [];

        if (deletedFor.includes(currentUser.uid)) return;

        if (
          !mine &&
          !data.deleted &&
          !(data.readBy || []).includes(currentUser.uid)
        ) {
          pendingReads.push(
            updateDoc(item.ref, {
              readBy: arrayUnion(currentUser.uid)
            }).catch(error => console.warn("Read receipt:", error))
          );
        }

        const bubble = safeElement(
          "div",
          `bubble${mine ? " mine" : ""}${data.deleted ? " deleted-message" : ""}`
        );

        if (activeChatType === "group" && !mine) {
          bubble.append(safeElement("strong", "message-sender", data.senderName || "Pengguna"));
        }

        const bodyText = data.deleted
          ? "Pesan ini telah dihapus"
          : (data.text || "");

        if (bodyText) {
          bubble.append(safeElement("div", "message-body", bodyText));
        }

        if (data.imageURL && !data.deleted) {
          const image = document.createElement("img");
          image.src = data.imageURL;
          image.alt = "Gambar pesan";
          image.loading = "lazy";
          bubble.append(image);
        }

        const footer = safeElement("div", "message-footer");

        const time = data.createdAt?.toDate
          ? data.createdAt.toDate().toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit"
            })
          : "Mengirim...";

        footer.append(safeElement("small", "", time));

        if (mine && activeChatType === "private" && !data.deleted) {
          const read = (data.readBy || []).includes(activeChat.uid);
          footer.append(makeDoubleTick(read));
        }

        bubble.append(footer);

        if (!data.deleted) {
          bubble.append(
            createMessageActionMenu(
              item.ref, data, root, id, item.id
            )
          );
        }

        container.append(bubble);
      });

      if (pendingReads.length) await Promise.all(pendingReads);
      container.scrollTop = container.scrollHeight;
    },
    error => toast(errorMessage(error))
  );
}

// ======================================================
// DELETE CHAT FOR ME
// ======================================================

async function deleteChatForMe(chatId) {
  if (!currentUser || !chatId) return;

  if (!confirm("Hapus chat ini dari daftar akun lu? Riwayat pengguna lain tidak akan terhapus.")) {
    return;
  }

  try {
    await setDoc(
      doc(db, "users", currentUser.uid, "hiddenChats", chatId),
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

    toast("Chat dihapus dari daftar akun lu.");
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

  const cleanText = text.trim();
  if (!cleanText) return;

  if (activeChatType === "channel") {
    if (!isAdmin() && activeChat.owner !== currentUser.uid) {
      throw new Error("Hanya pemilik saluran atau admin yang dapat posting.");
    }

    await addDoc(collection(db, "channels", activeChat.id, "posts"), {
      uid: currentUser.uid,
      authorName: currentProfile?.name || "Pengguna",
      text: cleanText,
      createdAt: serverTimestamp()
    });
    return;
  }

  const root = activeChatType === "group" ? "groups" : "chats";
  const chatRef = doc(db, root, activeChat.id);

  await addDoc(collection(db, root, activeChat.id, "messages"), {
    sender: currentUser.uid,
    senderName: currentProfile?.name || "Pengguna",
    text: cleanText,
    type: "text",
    readBy: [currentUser.uid],
    deletedFor: [],
    deleted: false,
    createdAt: serverTimestamp()
  });

  await updateDoc(chatRef, {
    lastMessage: cleanText,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
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
// CHAT LIST + DEDUPLICATION + UNREAD BADGES
// ======================================================

function timestampMillis(value) {
  return value?.toMillis?.() || 0;
}

async function getUnreadCount(chatId) {
  try {
    const q = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const snap = await getDocs(q);
    let count = 0;

    snap.forEach(item => {
      const data = item.data();
      if (
        data.sender !== currentUser.uid &&
        !(data.readBy || []).includes(currentUser.uid) &&
        !(data.deletedFor || []).includes(currentUser.uid) &&
        !data.deleted
      ) {
        count++;
      }
    });

    return count;
  } catch (error) {
    console.warn("Unread count:", error);
    return 0;
  }
}

async function listenChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    chatsQuery,
    async snap => {
      const list = $("chatList");
      if (!list) return;

      const entries = [];

      for (const item of snap.docs) {
        const data = item.data();
        const otherId = data.members?.find(uid => uid !== currentUser.uid);
        if (!otherId) continue;

        try {
          const [userSnap, hiddenSnap] = await Promise.all([
            getDoc(doc(db, "users", otherId)),
            getDoc(doc(db, "users", currentUser.uid, "hiddenChats", item.id))
          ]);

          if (!userSnap.exists()) continue;

          const user = userSnap.data();
          if (user.status !== "active") continue;

          const lastActivity = timestampMillis(data.lastMessageAt || data.updatedAt);
          const hiddenAt = hiddenSnap.exists()
            ? timestampMillis(hiddenSnap.data().hiddenAt)
            : 0;

          if (hiddenSnap.exists() && lastActivity <= hiddenAt) continue;

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
          console.warn("Chat list item:", error);
        }
      }

      // Dedupe legacy chat docs: one visible row per other user.
      const unique = new Map();

      entries.forEach(entry => {
        const old = unique.get(entry.otherId);
        if (!old || entry.lastActivity > old.lastActivity) {
          unique.set(entry.otherId, entry);
        }
      });

      const sorted = [...unique.values()].sort(
        (a, b) => b.lastActivity - a.lastActivity
      );

      list.replaceChildren();

      if (!sorted.length) {
        list.append(safeElement("div", "chat-empty-note", "Belum ada percakapan. Cari username untuk memulai."));
        return;
      }

      for (const entry of sorted) {
        const unreadCount = await getUnreadCount(entry.id);
        const row = safeElement("div", "chat-item");

        const avatar = safeElement("div", "avatar");
        renderAvatarInto(avatar, entry.user.photoURL, entry.user.name);

        const details = safeElement("div", "chat-item-details");
        details.append(
          safeElement(
            "strong",
            "",
            `${entry.user.name || "Pengguna"}${entry.user.verified ? " ✓" : ""}`
          ),
          safeElement("small", "", entry.data.lastMessage || "Mulai percakapan")
        );

        const actions = safeElement("div", "chat-row-actions");

        if (unreadCount > 0) {
          actions.append(
            safeElement(
              "span",
              "unread-badge",
              unreadCount > 99 ? "99+" : String(unreadCount)
            )
          );
        }

        const more = safeElement("button", "chat-row-more", "⋯");
        more.type = "button";
        more.title = "Hapus chat";
        more.onclick = event => {
          event.stopPropagation();
          deleteChatForMe(entry.id);
        };

        actions.append(more);
        row.append(avatar, details, actions);

        row.onclick = () => openPrivateChat({
          uid: entry.otherId,
          name: entry.user.name,
          photoURL: entry.user.photoURL,
          verified: entry.user.verified,
          status: entry.user.status
        });

        list.append(row);
      }
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
  if (!currentUser || !exists("searchUser") || !exists("searchResults")) return;

  const value = normalizeUsername($("searchUser").value);
  const results = $("searchResults");
  results.replaceChildren();

  if (value.length < 3) return;

  try {
    const usernameSnap = await getDoc(doc(db, "usernames", value));

    if (!usernameSnap.exists()) {
      results.append(safeElement("small", "search-empty", "Username tidak ditemukan."));
      return;
    }

    const uid = usernameSnap.data().uid;
    if (uid === currentUser.uid) {
      results.append(safeElement("small", "search-empty", "Itu username akun lu sendiri."));
      return;
    }

    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists() || userSnap.data().status !== "active") {
      results.append(safeElement("small", "search-empty", "Pengguna tidak tersedia."));
      return;
    }

    const user = userSnap.data();
    const row = safeElement("div", "user-item");
    const avatar = safeElement("div", "avatar");
    renderAvatarInto(avatar, user.photoURL, user.name);

    const details = safeElement("div");
    details.append(
      safeElement("strong", "", `${user.name || "Pengguna"}${user.verified ? " ✓" : ""}`),
      safeElement("small", "", `@${user.username || value}`)
    );

    row.append(avatar, details);
    row.onclick = () => openPrivateChat(user);
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
  const headingText = safeElement("div");

  headingText.append(
    safeElement("small", "", "MOMENTS"),
    safeElement("h2", "", "Buat Status")
  );

  const close = safeElement("button", "zora-modal-close", "×");
  close.type = "button";
  close.onclick = () => setHidden("statusModal", true);

  heading.append(headingText, close);

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

  modal.addEventListener("click", event => {
    if (event.target === modal) setHidden("statusModal", true);
  });

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
  if (!text) return toast("Tulis status terlebih dahulu.");

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
  const q = query(collection(db, "statuses"), orderBy("createdAt", "desc"), limit(80));

  const unsubscribe = onSnapshot(q, snap => {
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
          if (!confirm("Hapus status ini?")) return;

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
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

// ======================================================
// GROUPS
// ======================================================

on("createGroupBtn", "click", async () => {
  const name = prompt("Nama grup:");
  if (!name?.trim()) return;

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
});

function listenGroups() {
  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, snap => {
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
      row.onclick = () => openGroup(item.id, group.name);
      list.append(row);
    });
  }, error => toast(errorMessage(error)));

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
    const channel = await addDoc(collection(db, "channels"), {
      name: name.trim(),
      description,
      owner: currentUser.uid,
      followers: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");
    openChannel(channel.id, name.trim(), currentUser.uid);
  } catch (error) {
    toast(errorMessage(error));
  }
});

function listenChannels() {
  const q = query(collection(db, "channels"), orderBy("createdAt", "desc"), limit(100));

  const unsubscribe = onSnapshot(q, snap => {
    const list = $("channelList");
    if (!list) return;

    list.replaceChildren();

    snap.forEach(item => {
      const channel = item.data();
      const row = safeElement("div", "chat-item");

      row.append(
        safeElement("div", "avatar", "S"),
        safeElement("div", "", channel.name || "Saluran")
      );

      row.onclick = () => openChannel(item.id, channel.name, channel.owner);
      list.append(row);
    });
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

function openChannel(id, name, owner) {
  activeChat = { id, name, owner };
  activeChatType = "channel";
  showConversation(name, "Saluran");
  setText("sendBtn", "Posting");
  stopMessageListener();

  const q = query(
    collection(db, "channels", id, "posts"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  messageUnsubscribe = onSnapshot(q, snap => {
    const container = $("messages");
    if (!container) return;

    container.replaceChildren();

    snap.forEach(item => {
      const post = item.data();
      const bubble = safeElement("div", "bubble");

      bubble.append(
        safeElement("div", "message-body", post.text || ""),
        safeElement("small", "", post.authorName || "Pengguna")
      );

      if (post.uid === currentUser.uid || isAdmin()) {
        const del = safeElement("button", "message-delete", "Hapus");
        del.type = "button";

        del.onclick = async () => {
          if (!confirm("Hapus postingan ini?")) return;

          try {
            await deleteDoc(doc(db, "channels", id, "posts", item.id));
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
  }, error => toast(errorMessage(error)));
}

// ======================================================
// PROFILE
// ======================================================

function openProfile() {
  if (!currentProfile) return;

  if (exists("profileName")) $("profileName").value = currentProfile.name || "";
  if (exists("profileBio")) $("profileBio").value = currentProfile.bio || "";
  if (exists("profileUsername")) $("profileUsername").value = currentProfile.username || "";

  createProfilePhotoControls();
  renderAvatar("profilePhotoPreview", currentProfile.photoURL, currentProfile.name);
  setHidden("profileModal", false);
}

on("profileBtn", "click", openProfile);
on("editProfileBtn", "click", openProfile);
on("closeProfile", "click", () => setHidden("profileModal", true));

on("saveProfile", "click", async () => {
  const name = $("profileName")?.value.trim();
  const bio = $("profileBio")?.value.trim() || "";
  const oldUsername = currentProfile?.username || "";
  const newUsername = normalizeUsername($("profileUsername")?.value || oldUsername);

  if (!name || name.length < 3) {
    toast("Nama minimal 3 karakter.");
    return;
  }

  if (!validUsername(newUsername)) {
    toast("Username harus 3–20 karakter, huruf kecil, angka, atau underscore.");
    return;
  }

  try {
    if (newUsername !== normalizeUsername(oldUsername)) {
      await claimUsername(newUsername, currentUser.uid, oldUsername);
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
    setText("appealMessage", "Jelaskan alasan banding minimal 10 karakter.");
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
    setText("appealMessage", "Banding berhasil dikirim. Tunggu pemeriksaan admin.");
  } catch (error) {
    setText("appealMessage", errorMessage(error));
  }
});

// ======================================================
// ADMIN
// ======================================================

on("openAdmin", "click", () => {
  if (!isAdmin()) return toast("Akses ditolak.");
  setHidden("adminScreen", false);
  loadAppeals();
});

on("closeAdmin", "click", () => setHidden("adminScreen", true));

on("findAdminUser", "click", async () => {
  if (!isAdmin()) return toast("Akses ditolak.");

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
      const button = safeElement("button", "secondary-btn", label);
      button.type = "button";

      button.onclick = async () => {
        if (uid === ADMIN_UID) return toast("Admin utama tidak dapat dimoderasi.");
        if (!confirm(`Lanjutkan tindakan: ${label}?`)) return;

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
    const q = query(collection(db, "appeals"), where("status", "==", "pending"));
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

console.log("ZORAAPP — app.js berhasil dimuat.");
