
import { auth, db } from "./firebase.js";

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
  runTransaction
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const $ = id => document.getElementById(id);
const exists = id => Boolean($(id));

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

const THEMES = ["neon", "dark", "light", "purple"];

function on(id, event, callback) {
  if (exists(id)) $(id).addEventListener(event, callback);
}

function setText(id, value) {
  if (exists(id)) $(id).textContent = value ?? "";
}

function setHidden(id, hidden) {
  if (exists(id)) $(id).hidden = hidden;
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

// USERNAME

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

    if (oldNormalized && oldNormalized !== normalized) {
      const oldRef = doc(db, "usernames", oldNormalized);
      const oldSnap = await transaction.get(oldRef);

      if (oldSnap.exists() && oldSnap.data().uid === uid) {
        transaction.delete(oldRef);
      }
    }

    transaction.set(newRef, {
      uid,
      username: normalized,
      updatedAt: serverTimestamp()
    });
  });

  return normalized;
}

// AUTH

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
      verified: false,
      status: "active",
      createdAt: serverTimestamp()
    });

    await signOut(auth);

    $("authName").value = "";
    $("registerEmail").value = "";
    $("registerPassword").value = "";

    if (exists("registerUsername")) {
      $("registerUsername").value = "";
    }

    if (exists("authEmail")) {
      $("authEmail").value = email;
    }

    if (exists("authPassword")) {
      $("authPassword").value = "";
    }

    setHidden("registerMode", true);
    setHidden("loginMode", false);

    toast("AKUN BERHASIL DIBUAT, SILAHKAN MASUK");

  } catch (error) {
    setText("registerError", errorMessage(error));

    if (credential) {
      console.error(
        "Akun Auth berhasil dibuat, tetapi proses penyimpanan profil gagal."
      );
    }

  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
});

// AUTH STATE

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
            bio: "",
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
      setText(
        "myAvatar",
        (currentProfile.name || "Z")[0].toUpperCase()
      );

      setHidden("openAdmin", !isAdmin());

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

// ACCOUNT ACTIONS

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

// ACCOUNT VERIFICATION
// Hanya mengubah status. Jangan menambahkan verifiedAt.

on("verifyAccountBtn", "click", async () => {
  if (!currentUser) {
    toast("Silakan masuk terlebih dahulu.");
    return;
  }

  if (currentProfile?.status !== "recovered") {
    toast("Status akun tidak memenuhi syarat verifikasi.");
    return;
  }

  const button = $("verifyAccountBtn");

  if (button) {
    button.disabled = true;
    button.textContent = "MEMVERIFIKASI...";
  }

  try {
    await updateDoc(
      doc(db, "users", currentUser.uid),
      {
        status: "active"
      }
    );

    toast("AKUN BERHASIL DIAKTIFKAN KEMBALI");

  } catch (error) {
    console.error("VERIFICATION ERROR:", error);
    toast(errorMessage(error));

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "VERIFIKASI";
    }
  }
});

// NAVIGATION

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

// THEMES

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

// CHAT

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

  try {
    await setDoc(
      doc(db, "chats", id),
      {
        members: [currentUser.uid, other.uid],
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

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

    listenMessages("chats", id);

  } catch (error) {
    toast(errorMessage(error));
  }
}

function showConversation(name, verified = "") {
  setHidden("emptyChat", true);
  setHidden("chatPanel", false);

  setText("chatName", name);
  setText("chatVerified", verified);
  setText(
    "chatAvatar",
    (name || "Z")[0].toUpperCase()
  );

  if (window.innerWidth <= 800) {
    $("appScreen")?.classList.add("chat-open");
  }
}

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

        const bubble = safeElement(
          "div",
          "bubble" + (mine ? " mine" : "")
        );

        if (data.text) {
          bubble.append(
            safeElement("div", "", data.text)
          );
        }

        bubble.append(
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

async function sendMessage(text) {
  if (!activeChat || !currentUser) {
    throw new Error("Pilih percakapan terlebih dahulu.");
  }

  if (!text.trim()) return;

  if (activeChatType === "channel") {
    if (
      !isAdmin() &&
      activeChat.owner !== currentUser.uid
    ) {
      throw new Error(
        "Hanya pemilik saluran atau admin yang dapat posting."
      );
    }

    await addDoc(
      collection(
        db,
        "channels",
        activeChat.id,
        "posts"
      ),
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

// IMAGE UPLOAD DISABLED

on("imageInput", "change", event => {
  event.target.value = "";

  toast(
    "Upload gambar sementara dinonaktifkan. Chat teks tetap tersedia."
  );
});

// USER SEARCH

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

  const value = normalizeUsername(
    $("searchUser").value
  );

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
            const row = safeElement(
              "div",
              "user-item"
            );

            row.append(
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

on("newChatBtn", "click", () => {
  $("searchUser")?.focus();
  toast("Cari username untuk memulai chat.");
});

// CHAT LIST

function listenChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where(
      "members",
      "array-contains",
      currentUser.uid
    )
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

          const row = safeElement(
            "div",
            "chat-item"
          );

          const avatar = safeElement(
            "div",
            "avatar",
            (user.name || "Z")[0].toUpperCase()
          );

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
              data.lastMessage || "Mulai percakapan"
            )
          );

          row.append(avatar, details);

          row.onclick = () => openPrivateChat(user);

          list.append(row);

        } catch (error) {
          console.error(error);
        }
      }
    },
    error => toast(errorMessage(error))
  );

  unsubscribers.push(unsubscribe);
}

// STATUS

async function createStatus() {
  const text = prompt("Tulis status kamu:");

  if (!text?.trim()) return;

  try {
    await addDoc(
      collection(db, "statuses"),
      {
        uid: currentUser.uid,
        name: currentProfile?.name || "Pengguna",
        text: text.trim(),
        createdAt: serverTimestamp()
      }
    );

    toast("Status berhasil dibuat.");

  } catch (error) {
    toast(errorMessage(error));
  }
}

on("createStatusBtn", "click", createStatus);

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

        const row = safeElement(
          "div",
          "status-item"
        );

        const avatar = safeElement(
          "div",
          "status-avatar",
          (status.name || "Z")[0].toUpperCase()
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

// GROUPS

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
    where(
      "members",
      "array-contains",
      currentUser.uid
    )
  );

  const unsubscribe = onSnapshot(
    groupsQuery,
    snap => {
      const list = $("groupList");
      if (!list) return;

      list.replaceChildren();

      snap.forEach(item => {
        const group = item.data();

        const row = safeElement(
          "div",
          "chat-item"
        );

        row.append(
          safeElement("div", "avatar", "G"),
          safeElement(
            "strong",
            "",
            group.name || "Grup"
          )
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

// CHANNELS

on("createChannelBtn", "click", async () => {
  const name = prompt("Nama saluran:");

  if (!name?.trim()) return;

  const description = prompt(
    "Deskripsi saluran:"
  ) || "";

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

        const row = safeElement(
          "div",
          "chat-item"
        );

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

        const bubble = safeElement(
          "div",
          "bubble"
        );

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

        if (
          post.uid === currentUser.uid ||
          isAdmin()
        ) {
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

// PROFILE

function openProfile() {
  if (!currentProfile) return;

  if (exists("profileName")) {
    $("profileName").value =
      currentProfile.name || "";
  }

  if (exists("profileBio")) {
    $("profileBio").value =
      currentProfile.bio || "";
  }

  if (exists("profileUsername")) {
    $("profileUsername").value =
      currentProfile.username || "";
  }

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

// APPEAL

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
    await addDoc(
      collection(db, "appeals"),
      {
        uid: currentUser.uid,
        email: currentUser.email,
        text,
        status: "pending",
        createdAt: serverTimestamp()
      }
    );

    $("appealText").value = "";

    setText(
      "appealMessage",
      "Banding berhasil dikirim. Tunggu pemeriksaan admin."
    );

  } catch (error) {
    setText(
      "appealMessage",
      errorMessage(error)
    );
  }
});

// ADMIN PANEL

on("openAdmin", "click", () => {
  if (!isAdmin()) {
    return toast("Akses ditolak.");
  }

  setHidden("adminScreen", false);

  loadAppeals();
});

on("closeAdmin", "click", () => {
  setHidden("adminScreen", true);
});

on("findAdminUser", "click", async () => {
  if (!isAdmin()) {
    return toast("Akses ditolak.");
  }

  const uid = $("adminSearch")?.value.trim();
  const result = $("adminUserResult");

  if (!result) return;

  result.replaceChildren();

  if (!uid) return;

  try {
    const snap = await getDoc(
      doc(db, "users", uid)
    );

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
          return toast(
            "Admin utama tidak dapat dimoderasi."
          );
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
            "Banding diterima. Pengguna dapat mengaktifkan kembali akun."
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
