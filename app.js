
import { auth, db, storage, rtdb } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where,
  orderBy, onSnapshot, serverTimestamp, limit,
  runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

import {
  ref as dbRef,
  set,
  onValue,
  onDisconnect,
  remove,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";


/* =====================================================
   ZORAAPP CORE
===================================================== */

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let activeChat = null;
let activeChatType = null;
let activeChannel = null;

let unsubscribers = [];
let typingTimeout = null;
let typingUnsubscribe = null;
let presenceUnsubscribe = null;

let currentTheme = localStorage.getItem("zora-theme") || "dark";

const THEMES = ["neon", "dark", "light", "purple"];

function el(id) {
  return $(id);
}

function safeText(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toast(message, duration = 2800) {
  const node = el("toast");
  if (!node) return;

  node.textContent = message;
  node.classList.add("show");

  clearTimeout(node._timer);
  node._timer = setTimeout(() => {
    node.classList.remove("show");
  }, duration);
}

function setError(id, message) {
  const node = el(id);
  if (node) node.textContent = message || "";
}

function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLastSeen(timestamp) {
  if (!timestamp) return "Terakhir dilihat tidak diketahui";

  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return `Terakhir dilihat hari ini pukul ${formatTime(date)}`;
  }

  return `Terakhir dilihat ${date.toLocaleDateString("id-ID")} pukul ${formatTime(date)}`;
}

function avatarHTML(profile = {}) {
  const name = safeText(profile.name || profile.username || "?");

  if (profile.photoURL) {
    return `<img class="avatar-photo" src="${safeText(profile.photoURL)}" alt="${name}">`;
  }

  return `<span>${name.charAt(0).toUpperCase()}</span>`;
}

function isAdmin() {
  return currentUser?.uid === ADMIN_UID;
}

function clearListeners() {
  unsubscribers.forEach(fn => {
    try { fn(); } catch {}
  });

  unsubscribers = [];

  if (typingUnsubscribe) {
    typingUnsubscribe();
    typingUnsubscribe = null;
  }

  if (presenceUnsubscribe) {
    presenceUnsubscribe();
    presenceUnsubscribe = null;
  }
}

function listen(unsubscribe) {
  unsubscribers.push(unsubscribe);
}


/* =====================================================
   THEME
===================================================== */

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "dark";

  currentTheme = theme;
  localStorage.setItem("zora-theme", theme);

  document.body.classList.remove(
    "theme-neon",
    "theme-dark",
    "theme-light",
    "theme-purple"
  );

  document.body.classList.add(`theme-${theme}`);
}

function toggleTheme() {
  const index = THEMES.indexOf(currentTheme);
  applyTheme(THEMES[(index + 1) % THEMES.length]);
}

applyTheme(currentTheme);

el("themeBtn")?.addEventListener("click", toggleTheme);
el("settingsThemeBtn")?.addEventListener("click", toggleTheme);


/* =====================================================
   AUTHENTICATION
===================================================== */

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));

  if (!snap.exists()) {
    throw new Error("Profil pengguna tidak ditemukan.");
  }

  currentProfile = {
    uid,
    ...snap.data()
  };

  return currentProfile;
}

function showAuth() {
  el("authScreen")?.classList.remove("hidden");
  el("appScreen")?.classList.add("hidden");
}

function showApp() {
  el("authScreen")?.classList.add("hidden");
  el("appScreen")?.classList.remove("hidden");
}

el("loginBtn")?.addEventListener("click", async () => {
  const email = el("authEmail")?.value.trim();
  const password = el("authPassword")?.value;

  if (!email || !password) {
    setError("authError", "Isi email dan password terlebih dahulu.");
    return;
  }

  try {
    setError("authError", "");
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setError("authError", error.message);
  }
});

el("registerBtn")?.addEventListener("click", async () => {
  const name = el("authName")?.value.trim();
  const email = el("registerEmail")?.value.trim();
  const password = el("registerPassword")?.value;
  const username = el("registerUsername")?.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  if (!name || !email || !password || !username) {
    setError("registerError", "Lengkapi semua data.");
    return;
  }

  if (username.length < 3) {
    setError("registerError", "Username minimal 3 karakter.");
    return;
  }

  if (password.length < 6) {
    setError("registerError", "Password minimal 6 karakter.");
    return;
  }

  try {
    setError("registerError", "");

    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const uid = credential.user.uid;

    await runTransaction(db, async transaction => {
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await transaction.get(usernameRef);

      if (usernameSnap.exists()) {
        throw new Error("Username sudah digunakan.");
      }

      transaction.set(usernameRef, { uid });

      transaction.set(doc(db, "users", uid), {
        uid,
        name,
        username,
        email,
        bio: "",
        photoURL: "",
        createdAt: serverTimestamp(),
        status: "active",
        verified: false
      });
    });

    await updateProfile(credential.user, {
      displayName: name
    });

    toast("Akun berhasil dibuat.");
  } catch (error) {
    setError("registerError", error.message);
  }
});

el("forgotPassword")?.addEventListener("click", async () => {
  const email = el("authEmail")?.value.trim();

  if (!email) {
    toast("Masukkan email terlebih dahulu.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password telah dikirim.");
  } catch (error) {
    toast(error.message);
  }
});

async function logout() {
  try {
    await setOffline();
    clearListeners();
    await signOut(auth);
  } catch (error) {
    toast(error.message);
  }
}

[
  "logoutBtn",
  "logoutHold",
  "logoutRecovered",
  "settingsLogoutBtn"
].forEach(id => {
  el(id)?.addEventListener("click", logout);
});


/* =====================================================
   USER PROFILE
===================================================== */

function renderProfile() {
  if (!currentProfile) return;

  if (el("myName")) {
    el("myName").textContent = currentProfile.name || "";
  }

  if (el("myEmail")) {
    el("myEmail").textContent = currentProfile.email || "";
  }

  if (el("myAvatar")) {
    el("myAvatar").innerHTML = avatarHTML(currentProfile);
  }

  if (el("profileName")) {
    el("profileName").value = currentProfile.name || "";
  }

  if (el("profileBio")) {
    el("profileBio").value = currentProfile.bio || "";
  }

  if (el("profileUsername")) {
    el("profileUsername").value = currentProfile.username || "";
  }

  if (el("profilePhotoPreview")) {
    el("profilePhotoPreview").innerHTML = avatarHTML(currentProfile);
  }

  el("openAdmin")?.classList.toggle("hidden", !isAdmin());
}

el("profileBtn")?.addEventListener("click", () => {
  el("profileModal")?.classList.remove("hidden");
});

el("editProfileBtn")?.addEventListener("click", () => {
  el("profileModal")?.classList.remove("hidden");
});

el("closeProfile")?.addEventListener("click", () => {
  el("profileModal")?.classList.add("hidden");
});

el("saveProfile")?.addEventListener("click", async () => {
  if (!currentUser) return;

  const name = el("profileName")?.value.trim();
  const bio = el("profileBio")?.value.trim();

  if (!name) {
    toast("Nama tidak boleh kosong.");
    return;
  }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      bio,
      updatedAt: serverTimestamp()
    });

    currentProfile.name = name;
    currentProfile.bio = bio;

    await updateProfile(currentUser, {
      displayName: name
    });

    renderProfile();
    el("profileModal")?.classList.add("hidden");
    toast("Profil berhasil diperbarui.");
  } catch (error) {
    toast(error.message);
  }
});

el("profilePhotoInput")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file || !currentUser) return;

  if (!file.type.startsWith("image/")) {
    toast("File harus berupa gambar.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    toast("Ukuran foto maksimal 5 MB.");
    return;
  }

  try {
    const path = storageRef(
      storage,
      `profilePhotos/${currentUser.uid}/avatar`
    );

    await uploadBytes(path, file);
    const url = await getDownloadURL(path);

    await updateDoc(doc(db, "users", currentUser.uid), {
      photoURL: url
    });

    currentProfile.photoURL = url;
    renderProfile();

    toast("Foto profil berhasil diperbarui.");
  } catch (error) {
    toast(error.message);
  }
});


/* =====================================================
   PRESENCE / ONLINE / LAST SEEN
===================================================== */

async function setupPresence() {
  if (!currentUser) return;

  const statusRef = dbRef(rtdb, `status/${currentUser.uid}`);

  await onDisconnect(statusRef).set({
    state: "offline",
    lastChanged: rtdbTimestamp()
  });

  await set(statusRef, {
    state: "online",
    lastChanged: rtdbTimestamp()
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await set(statusRef, {
        state: "online",
        lastChanged: rtdbTimestamp()
      }).catch(() => {});
    }
  });
}

async function setOffline() {
  if (!currentUser) return;

  await set(
    dbRef(rtdb, `status/${currentUser.uid}`),
    {
      state: "offline",
      lastChanged: rtdbTimestamp()
    }
  ).catch(() => {});
}

function listenPresence(uid, callback) {
  return onValue(dbRef(rtdb, `status/${uid}`), snapshot => {
    callback(snapshot.val());
  });
}

function renderPresence(status) {
  const node = el("chatPresence");
  if (!node) return;

  if (status?.state === "online") {
    node.textContent = "Online";
    node.classList.add("is-online");
  } else {
    node.textContent = status?.lastChanged
      ? formatLastSeen(status.lastChanged)
      : "Offline";

    node.classList.remove("is-online");
  }
}


/* =====================================================
   NAVIGATION
===================================================== */

function openPage(page) {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle(
      "active",
      section.id === `${page}Page`
    );
  });

  document.body.classList.remove("chat-open");
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

el("backToChats")?.addEventListener("click", () => {
  document.body.classList.remove("chat-open");
});


/* =====================================================
   PRIVATE CHAT
===================================================== */

function privateChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

async function openPrivateChat(otherUid, otherProfile = null) {
  if (!currentUser || otherUid === currentUser.uid) return;

  try {
    let profile = otherProfile;

    if (!profile) {
      const snap = await getDoc(doc(db, "users", otherUid));

      if (!snap.exists()) {
        toast("Pengguna tidak ditemukan.");
        return;
      }

      profile = snap.data();
    }

    const chatId = privateChatId(currentUser.uid, otherUid);
    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        members: [currentUser.uid, otherUid],
        type: "private",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else if (!chatSnap.data().members?.includes(currentUser.uid)) {
      toast("Akses chat ditolak.");
      return;
    }

    activeChat = chatId;
    activeChatType = "private";
    activeChannel = null;

    showConversation(profile.name || profile.username, profile);

    listenMessages(chatId, "chats");
    startTypingListener("private", chatId);

    presenceUnsubscribe = listenPresence(otherUid, renderPresence);
  } catch (error) {
    toast("Gagal membuka chat: " + error.message);
  }
}


/* =====================================================
   GROUP CHAT
===================================================== */

async function openGroup(groupId, groupName = "") {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));

    if (!groupSnap.exists()) {
      toast("Grup tidak ditemukan.");
      return;
    }

    const group = groupSnap.data();

    if (!group.members?.includes(currentUser.uid)) {
      toast("Lu bukan anggota grup ini.");
      return;
    }

    activeChat = groupId;
    activeChatType = "group";
    activeChannel = null;

    showConversation(group.name || groupName || "Grup", null);

    listenMessages(groupId, "groups");
    startTypingListener("group", groupId);
  } catch (error) {
    toast("Gagal membuka grup: " + error.message);
  }
}

el("createGroupBtn")?.addEventListener("click", async () => {
  const name = prompt("Nama grup:");

  if (!name?.trim()) return;

  try {
    const groupRef = await addDoc(collection(db, "groups"), {
      name: name.trim(),
      owner: currentUser.uid,
      members: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    toast("Grup berhasil dibuat.");
    await openGroup(groupRef.id, name);
  } catch (error) {
    toast(error.message);
  }
});

el("inviteGroupMember")?.addEventListener("click", async () => {
  if (activeChatType !== "group") {
    toast("Buka grup terlebih dahulu.");
    return;
  }

  const username = prompt("Masukkan username anggota:");

  if (!username?.trim()) return;

  try {
    const usernameSnap = await getDoc(
      doc(db, "usernames", username.trim().toLowerCase())
    );

    if (!usernameSnap.exists()) {
      toast("Username tidak ditemukan.");
      return;
    }

    const uid = usernameSnap.data().uid;

    const groupRef = doc(db, "groups", activeChat);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) return;

    if (!groupSnap.data().members?.includes(currentUser.uid)) {
      toast("Akses ditolak.");
      return;
    }

    await updateDoc(groupRef, {
      members: arrayUnion(uid)
    });

    toast("Anggota berhasil ditambahkan.");
  } catch (error) {
    toast(error.message);
  }
});


/* =====================================================
   CONVERSATION HEADER
===================================================== */

function showConversation(name, profile = null) {
  const chatPanel = el("chatPanel");

  chatPanel?.classList.remove("hidden");
  document.body.classList.add("chat-open");

  if (el("chatName")) {
    el("chatName").textContent = name;
  }

  if (el("chatAvatar")) {
    el("chatAvatar").innerHTML = avatarHTML(profile || { name });
  }

  const messages = el("messages");
  if (messages) messages.innerHTML = "";

  const presence = el("chatPresence");
  if (presence) presence.textContent = "";

  const security = document.querySelector(".chat-security-notice");

  if (security) {
    security.textContent =
      "Privasi percakapan: koneksi menggunakan Firebase. Enkripsi end-to-end belum diaktifkan.";
  }
}


/* =====================================================
   MESSAGE LISTENER
===================================================== */

function listenMessages(id, collectionName) {
  const messagesRef = collection(
    db,
    collectionName,
    id,
    "messages"
  );

  const q = query(
    messagesRef,
    orderBy("createdAt", "asc"),
    limit(150)
  );

  const unsubscribe = onSnapshot(q, snapshot => {
    const container = el("messages");
    if (!container) return;

    container.innerHTML = "";

    snapshot.forEach(messageDoc => {
      const message = messageDoc.data();

      const own = message.senderId === currentUser.uid;

      const item = document.createElement("div");
      item.className = `message ${own ? "own" : "received"}`;

      const text = safeText(message.text || "");

      item.innerHTML = `
        <div class="message-bubble">
          ${activeChatType === "group" && !own
            ? `<div class="message-sender">${safeText(message.senderName || "Anggota")}</div>`
            : ""}
          <div class="message-content">${text}</div>
          <div class="message-meta">
            <span>${formatTime(message.createdAt)}</span>
            ${own ? `<span class="message-ticks">${message.readBy?.length > 1 ? "✓✓" : "✓"}</span>` : ""}
          </div>
        </div>
      `;

      container.appendChild(item);

      if (!own && !message.readBy?.includes(currentUser.uid)) {
        updateDoc(
          doc(db, collectionName, id, "messages", messageDoc.id),
          { readBy: arrayUnion(currentUser.uid) }
        ).catch(() => {});
      }
    });

    container.scrollTop = container.scrollHeight;
  }, error => {
    toast("Gagal memuat pesan: " + error.message);
  });

  listen(unsubscribe);
}


/* =====================================================
   SEND MESSAGE
===================================================== */

async function sendMessage() {
  const input = el("messageInput");
  const text = input?.value.trim();

  if (!text || !activeChat || !activeChatType) return;

  const collectionName = activeChatType === "group"
    ? "groups"
    : "chats";

  try {
    const parentRef = doc(db, collectionName, activeChat);
    const parentSnap = await getDoc(parentRef);

    if (!parentSnap.exists()) {
      toast("Percakapan tidak ditemukan.");
      return;
    }

    const data = parentSnap.data();

    if (!data.members?.includes(currentUser.uid)) {
      toast("Akses ditolak: lu bukan anggota percakapan.");
      return;
    }

    await addDoc(
      collection(db, collectionName, activeChat, "messages"),
      {
        text,
        senderId: currentUser.uid,
        senderName: currentProfile.name,
        createdAt: serverTimestamp(),
        readBy: [currentUser.uid],
        type: "text"
      }
    );

    await updateDoc(parentRef, {
      lastMessage: text,
      updatedAt: serverTimestamp()
    });

    input.value = "";
    stopTyping();
  } catch (error) {
    toast("Pesan gagal dikirim: " + error.message);
  }
}

el("sendBtn")?.addEventListener("click", sendMessage);

el("messageInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});


/* =====================================================
   TYPING INDICATOR
===================================================== */

function typingPath(type, id, uid) {
  return `typing/${type}_${id}/${uid}`;
}

function startTyping() {
  if (!activeChat || !activeChatType || !currentUser) return;

  set(
    dbRef(rtdb, typingPath(activeChatType, activeChat, currentUser.uid)),
    {
      name: currentProfile.name,
      typing: true
    }
  ).catch(() => {});

  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(stopTyping, 2500);
}

function stopTyping() {
  if (!activeChat || !activeChatType || !currentUser) return;

  remove(
    dbRef(rtdb, typingPath(activeChatType, activeChat, currentUser.uid))
  ).catch(() => {});
}

function startTypingListener(type, id) {
  if (typingUnsubscribe) typingUnsubscribe();

  const path = `typing/${type}_${id}`;

  typingUnsubscribe = onValue(dbRef(rtdb, path), snapshot => {
    const users = snapshot.val() || {};

    const typingUsers = Object.entries(users)
      .filter(([uid, value]) =>
        uid !== currentUser.uid && value?.typing
      )
      .map(([, value]) => value.name || "Seseorang");

    const indicator = el("typingIndicator");

    if (indicator) {
      indicator.textContent = typingUsers.length
        ? `${typingUsers.join(", ")} sedang mengetik...`
        : "";
    }
  });
}

el("messageInput")?.addEventListener("input", startTyping);


/* =====================================================
   CHANNELS
===================================================== */

async function openChannel(channelId) {
  try {
    const channelSnap = await getDoc(doc(db, "channels", channelId));

    if (!channelSnap.exists()) {
      toast("Saluran tidak ditemukan.");
      return;
    }

    const channel = channelSnap.data();

    activeChannel = channelId;
    activeChat = channelId;
    activeChatType = "channel";

    clearListeners();

    const panel = el("chatPanel");
    panel?.classList.remove("hidden");

    document.body.classList.add("chat-open");

    if (el("chatName")) {
      el("chatName").textContent = channel.name || "Saluran";
    }

    const followers = channel.followers || [];
    const isOwner = channel.owner === currentUser.uid;
    const isFollowing = followers.includes(currentUser.uid);

    if (el("chatPresence")) {
      el("chatPresence").textContent =
        `${followers.length} pengikut`;
    }

    const composer = document.querySelector(".composer");
    if (composer) {
      composer.classList.toggle("hidden", !isOwner);
    }

    renderChannelControls(channel, isOwner, isFollowing);
    listenChannelPosts(channelId);
  } catch (error) {
    toast(error.message);
  }
}

function renderChannelControls(channel, isOwner, isFollowing) {
  let controls = el("channelControls");

  if (!controls) {
    controls = document.createElement("div");
    controls.id = "channelControls";
    controls.className = "channel-controls";

    el("chatPanel")?.appendChild(controls);
  }

  controls.innerHTML = "";

  if (!isOwner && !isFollowing) {
    const follow = document.createElement("button");
    follow.className = "channel-follow-btn";
    follow.textContent = "Ikuti saluran";

    follow.addEventListener("click", () => followChannel(activeChannel));

    controls.appendChild(follow);
  }

  if (!isOwner && isFollowing) {
    const unfollow = document.createElement("button");
    unfollow.className = "secondary-btn";
    unfollow.textContent = "Berhenti mengikuti";

    unfollow.addEventListener("click", () => unfollowChannel(activeChannel));

    controls.appendChild(unfollow);
  }
}

async function followChannel(channelId) {
  try {
    await updateDoc(doc(db, "channels", channelId), {
      followers: arrayUnion(currentUser.uid)
    });

    toast("Berhasil mengikuti saluran.");
    openChannel(channelId);
  } catch (error) {
    toast(error.message);
  }
}

async function unfollowChannel(channelId) {
  try {
    await updateDoc(doc(db, "channels", channelId), {
      followers: arrayRemove(currentUser.uid)
    });

    toast("Berhenti mengikuti saluran.");
    openChannel(channelId);
  } catch (error) {
    toast(error.message);
  }
}

function listenChannelPosts(channelId) {
  const postsRef = collection(db, "channels", channelId, "posts");

  const q = query(postsRef, orderBy("createdAt", "asc"), limit(100));

  const unsubscribe = onSnapshot(q, snapshot => {
    const container = el("messages");
    if (!container) return;

    container.innerHTML = "";

    snapshot.forEach(postDoc => {
      const post = postDoc.data();

      const item = document.createElement("article");
      item.className = "channel-post";

      item.innerHTML = `
        <div class="channel-post-content">
          <strong>${safeText(post.senderName || "Admin")}</strong>
          <p>${safeText(post.text || "")}</p>
          ${post.imageURL
            ? `<img class="channel-post-image" src="${safeText(post.imageURL)}" alt="Foto saluran">`
            : ""}
          <small>${formatTime(post.createdAt)}</small>
        </div>
        <div class="channel-reactions" data-post="${postDoc.id}">
          ${["👍", "❤️", "😂", "😮", "😢", "🔥"].map(reaction => `
            <button class="channel-reaction" data-reaction="${reaction}">
              ${reaction}
              ${(post.reactions?.[reaction] || []).length}
            </button>
          `).join("")}
        </div>
      `;

      item.querySelectorAll(".channel-reaction").forEach(button => {
        button.addEventListener("click", () => {
          toggleChannelReaction(
            channelId,
            postDoc.id,
            button.dataset.reaction
          );
        });
      });

      container.appendChild(item);
    });

    container.scrollTop = container.scrollHeight;
  }, error => {
    toast("Gagal memuat saluran: " + error.message);
  });

  listen(unsubscribe);
}

async function toggleChannelReaction(channelId, postId, reaction) {
  const postRef = doc(
    db,
    "channels",
    channelId,
    "posts",
    postId
  );

  try {
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(postRef);

      if (!snap.exists()) return;

      const reactions = snap.data().reactions || {};
      const users = reactions[reaction] || [];

      const next = users.includes(currentUser.uid)
        ? users.filter(uid => uid !== currentUser.uid)
        : [...users, currentUser.uid];

      transaction.update(postRef, {
        [`reactions.${reaction}`]: next
      });
    });
  } catch (error) {
    toast(error.message);
  }
}

el("createChannelBtn")?.addEventListener("click", async () => {
  const name = prompt("Nama saluran:");
  if (!name?.trim()) return;

  const description = prompt("Deskripsi saluran:") || "";

  try {
    const channelRef = await addDoc(collection(db, "channels"), {
      name: name.trim(),
      description,
      owner: currentUser.uid,
      followers: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");
    openChannel(channelRef.id);
  } catch (error) {
    toast(error.message);
  }
});


/* =====================================================
   CREATE CHANNEL POST
===================================================== */

async function createChannelPost(text, file = null) {
  if (!activeChannel) {
    toast("Pilih saluran terlebih dahulu.");
    return;
  }

  try {
    const channelRef = doc(db, "channels", activeChannel);
    const channelSnap = await getDoc(channelRef);

    if (!channelSnap.exists()) return;

    if (channelSnap.data().owner !== currentUser.uid) {
      toast("Hanya admin saluran yang bisa mengirim postingan.");
      return;
    }

    let imageURL = "";

    if (file) {
      const imageRef = storageRef(
        storage,
        `channelPosts/${activeChannel}/${Date.now()}_${file.name}`
      );

      await uploadBytes(imageRef, file);
      imageURL = await getDownloadURL(imageRef);
    }

    if (!text.trim() && !imageURL) return;

    await addDoc(
      collection(db, "channels", activeChannel, "posts"),
      {
        text: text.trim(),
        imageURL,
        senderId: currentUser.uid,
        senderName: currentProfile.name,
        reactions: {},
        createdAt: serverTimestamp()
      }
    );

    toast("Postingan berhasil dikirim.");
  } catch (error) {
    toast("Gagal mengirim postingan: " + error.message);
  }
}


/* =====================================================
   SEARCH USERS
===================================================== */

el("searchUser")?.addEventListener("input", async event => {
  const value = event.target.value.trim().toLowerCase();
  const results = el("searchResults");

  if (!results) return;

  if (value.length < 2) {
    results.innerHTML = "";
    return;
  }

  try {
    const q = query(
      collection(db, "users"),
      where("username", ">=", value),
      where("username", "<=", value + "\uf8ff"),
      limit(12)
    );

    const snapshot = await getDocs(q);

    results.innerHTML = "";

    snapshot.forEach(userDoc => {
      const user = userDoc.data();

      if (user.uid === currentUser.uid) return;

      const button = document.createElement("button");
      button.className = "user-item";

      button.innerHTML = `
        <div class="avatar">${avatarHTML(user)}</div>
        <div class="user-item-details">
          <strong>${safeText(user.name)}</strong>
          <span>@${safeText(user.username)}</span>
        </div>
      `;

      button.addEventListener("click", () => {
        openPrivateChat(user.uid, user);
      });

      results.appendChild(button);
    });

    if (!results.children.length) {
      results.innerHTML = `<p class="search-empty">Pengguna tidak ditemukan.</p>`;
    }
  } catch (error) {
    toast(error.message);
  }
});


/* =====================================================
   CHAT LIST
===================================================== */

function listenChats() {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, async snapshot => {
    const container = el("chatList");
    if (!container) return;

    container.innerHTML = "";

    const rendered = new Set();

    for (const chatDoc of snapshot.docs) {
      const chat = chatDoc.data();

      const otherUid = chat.members?.find(
        uid => uid !== currentUser.uid
      );

      if (!otherUid || rendered.has(otherUid)) continue;
      rendered.add(otherUid);

      const userSnap = await getDoc(doc(db, "users", otherUid));
      if (!userSnap.exists()) continue;

      const user = userSnap.data();

      const item = document.createElement("button");
      item.className = "chat-item";

      item.innerHTML = `
        <div class="avatar">${avatarHTML(user)}</div>
        <div class="chat-item-details">
          <strong>${safeText(user.name || user.username)}</strong>
          <span>${safeText(chat.lastMessage || "Mulai percakapan")}</span>
        </div>
      `;

      item.addEventListener("click", () => {
        openPrivateChat(otherUid, user);
      });

      container.appendChild(item);
    }
  });

  listen(unsubscribe);
}

function listenGroups() {
  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, snapshot => {
    const container = el("groupList");
    if (!container) return;

    container.innerHTML = "";

    snapshot.forEach(groupDoc => {
      const group = groupDoc.data();

      const button = document.createElement("button");
      button.className = "chat-item";

      button.innerHTML = `
        <div class="avatar">${safeText((group.name || "G").charAt(0))}</div>
        <div class="chat-item-details">
          <strong>${safeText(group.name || "Grup")}</strong>
          <span>${group.members?.length || 0} anggota</span>
        </div>
      `;

      button.addEventListener("click", () => {
        openGroup(groupDoc.id, group.name);
      });

      container.appendChild(button);
    });
  });

  listen(unsubscribe);
}

function listenChannels() {
  const unsubscribe = onSnapshot(
    collection(db, "channels"),
    snapshot => {
      const container = el("channelList");
      if (!container) return;

      container.innerHTML = "";

      snapshot.forEach(channelDoc => {
        const channel = channelDoc.data();

        const button = document.createElement("button");
        button.className = "chat-item channel-item";

        button.innerHTML = `
          <div class="avatar">${safeText((channel.name || "C").charAt(0))}</div>
          <div class="channel-item-details">
            <strong class="channel-name">${safeText(channel.name || "Saluran")}</strong>
            <span class="channel-followers">${channel.followers?.length || 0} pengikut</span>
          </div>
        `;

        button.addEventListener("click", () => {
          openChannel(channelDoc.id);
        });

        container.appendChild(button);
      });
    }
  );

  listen(unsubscribe);
}


/* =====================================================
   STATUS
===================================================== */

el("createStatusBtn")?.addEventListener("click", () => {
  el("statusModal")?.classList.remove("hidden");
});

el("publishStatus")?.addEventListener("click", async () => {
  const text = el("statusInput")?.value.trim();

  if (!text) {
    toast("Isi status terlebih dahulu.");
    return;
  }

  try {
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      name: currentProfile.name,
      text,
      createdAt: serverTimestamp()
    });

    el("statusInput").value = "";
    el("statusModal")?.classList.add("hidden");

    toast("Status berhasil dipublikasikan.");
  } catch (error) {
    toast(error.message);
  }
});

function listenStatuses() {
  const q = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const unsubscribe = onSnapshot(q, snapshot => {
    const container = el("statusList");
    if (!container) return;

    container.innerHTML = "";

    snapshot.forEach(statusDoc => {
      const status = statusDoc.data();

      const item = document.createElement("button");
      item.className = "status-item";

      item.innerHTML = `
        <div class="status-avatar">
          ${safeText((status.name || "?").charAt(0))}
        </div>
        <div class="status-details">
          <strong>${safeText(status.name)}</strong>
          <span>${safeText(status.text)}</span>
        </div>
      `;

      item.addEventListener("click", () => {
        alert(`${status.name}\n\n${status.text}`);
      });

      container.appendChild(item);
    });
  });

  listen(unsubscribe);
}


/* =====================================================
   ADMIN PANEL
===================================================== */

el("openAdmin")?.addEventListener("click", () => {
  if (!isAdmin()) {
    toast("Akses admin ditolak.");
    return;
  }

  el("adminScreen")?.classList.remove("hidden");
});

el("closeAdmin")?.addEventListener("click", () => {
  el("adminScreen")?.classList.add("hidden");
});

el("findAdminUser")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const value = el("adminSearch")?.value.trim().toLowerCase();

  if (!value) return;

  try {
    const usernameSnap = await getDoc(doc(db, "usernames", value));

    if (!usernameSnap.exists()) {
      toast("Pengguna tidak ditemukan.");
      return;
    }

    const uid = usernameSnap.data().uid;
    const userSnap = await getDoc(doc(db, "users", uid));

    if (!userSnap.exists()) return;

    const user = userSnap.data();
    const result = el("adminUserResult");

    if (!result) return;

    result.innerHTML = `
      <div class="admin-user">
        <strong>${safeText(user.name)}</strong>
        <span>@${safeText(user.username)}</span>
        <span>${safeText(user.email)}</span>
        <span>Status: ${safeText(user.status || "active")}</span>
      </div>
    `;
  } catch (error) {
    toast(error.message);
  }
});


/* =====================================================
   AUTH STATE
===================================================== */

onAuthStateChanged(auth, async user => {
  clearListeners();

  currentUser = user;
  currentProfile = null;

  if (!user) {
    showAuth();
    return;
  }

  try {
    await loadProfile(user.uid);

    if (currentProfile.status === "hold") {
      showAuth();
      el("holdScreen")?.classList.remove("hidden");
      return;
    }

    if (currentProfile.status === "permanent") {
      showAuth();
      el("permanentScreen")?.classList.remove("hidden");
      return;
    }

    showApp();
    renderProfile();

    await setupPresence();

    listenChats();
    listenGroups();
    listenChannels();
    listenStatuses();

    openPage("chats");
  } catch (error) {
    console.error("ZORAAPP initialization:", error);
    toast("Gagal memuat akun: " + error.message);
  }
});


console.log("ZORAAPP — app.js loaded.");
