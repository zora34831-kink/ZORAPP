
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
  collection, addDoc, getDocs,
  query, where, orderBy, onSnapshot,
  serverTimestamp, limit, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

// CONFIG
const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let activeChat = null;
let activeChatType = "private";
let unsubscribers = [];
let toastTimer = null;
let registrationInProgress = false;

// TOAST
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function errorMessage(error) {
  console.error(error);
  const messages = {
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Password terlalu lemah.",
    "auth/user-disabled": "Akun dinonaktifkan.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "permission-denied": "Akses ditolak. Periksa Firebase Rules."
  };
  return messages[error.code] || error.message || "Terjadi kesalahan.";
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
  unsubscribers.forEach(fn => fn());
  unsubscribers = [];
  activeChat = null;
}

// AUTH LOGIN
$("loginBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  $("authError").textContent = "";

  if (!email || !password) {
    $("authError").textContent = "Email dan password wajib diisi.";
    return;
  }

  $("loginBtn").disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    $("authError").textContent = errorMessage(error);
  } finally {
    $("loginBtn").disabled = false;
  }
};

// FORGOT PASSWORD
$("forgotPassword").onclick = async () => {
  const email = $("authEmail").value.trim();

  if (!email) {
    $("authError").textContent = "Masukkan email terlebih dahulu.";
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("LINK RESET PASSWORD TELAH DIKIRIM KE EMAIL");
    $("authError").textContent = "";
  } catch (error) {
    $("authError").textContent = errorMessage(error);
  }
};

// REGISTER
$("registerBtn").onclick = async () => {
  const name = $("authName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  $("registerError").textContent = "";

  if (!name || !email || !password) {
    $("registerError").textContent = "Semua kolom wajib diisi.";
    return;
  }

  if (name.length < 3 || password.length < 8) {
    $("registerError").textContent =
      "Nama minimal 3 karakter dan password minimal 8 karakter.";
    return;
  }

  $("registerBtn").disabled = true;
  registrationInProgress = true;

  try {
    const credential = await createUserWithEmailAndPassword(
      auth, email, password
    );

    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      name,
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

    $("registerMode").hidden = true;
    $("loginMode").hidden = false;
    $("authEmail").value = email;
    $("authPassword").value = "";

    toast("AKUN BERHASIL DIBUAT, SILAHKAN MASUK");

  } catch (error) {
    $("registerError").textContent = errorMessage(error);
  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
};

// AUTH STATE
onAuthStateChanged(auth, async user => {
  cleanup();
  currentUser = user;
  currentProfile = null;

  if (!user) {
    $("appScreen").hidden = true;
    $("holdScreen").hidden = true;
    $("permanentScreen").hidden = true;
    $("authScreen").hidden = false;
    return;
  }

  $("authScreen").hidden = true;

  const userRef = doc(db, "users", user.uid);

  const unsubscribe = onSnapshot(userRef, async snap => {
    if (!snap.exists()) {
      if (registrationInProgress) return;

      try {
        await setDoc(userRef, {
          uid: user.uid,
          name: user.email?.split("@")[0] || "Pengguna",
          email: user.email || "",
          bio: "",
          verified: false,
          status: "active",
          createdAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        toast(errorMessage(error));
      }
      return;
    }

    currentProfile = snap.data();

    $("appScreen").hidden = true;
    $("holdScreen").hidden = true;
    $("permanentScreen").hidden = true;

    if (currentProfile.status === "permanent") {
      $("permanentScreen").hidden = false;
      return;
    }

    if (currentProfile.status !== "active") {
      $("holdScreen").hidden = false;
      return;
    }

    $("appScreen").hidden = false;
    $("myName").textContent = currentProfile.name || "Pengguna";
    $("myEmail").textContent = user.email || "";
    $("myAvatar").textContent =
      (currentProfile.name || "Z")[0].toUpperCase();

    $("openAdmin").hidden = !isAdmin();

    listenChats();
    listenStatuses();
    listenGroups();
    listenChannels();
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
});

// LOGOUT
async function logout() {
  try {
    await signOut(auth);
    toast("Berhasil keluar.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

$("logoutBtn").onclick = logout;
$("logoutHold").onclick = logout;
$("newAccountBtn").onclick = logout;
$("settingsLogoutBtn").onclick = logout;

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

  $("appScreen").classList.remove("chat-open");
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.onclick = () => openPage(button.dataset.page);
});

$("backToChats").onclick = () => {
  $("appScreen").classList.remove("chat-open");
  openPage("chatsPage");
};

// THEME
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "zora-theme",
    document.body.classList.contains("dark") ? "dark" : "light"
  );
}

$("themeBtn").onclick = toggleTheme;
$("settingsThemeBtn").onclick = toggleTheme;

if (localStorage.getItem("zora-theme") === "dark") {
  document.body.classList.add("dark");
}

// PRIVATE CHAT
function privateChatId(a, b) {
  return [a, b].sort().join("_");
}

async function openPrivateChat(other) {
  if (!currentUser || !other?.uid) return;
  if (other.status !== "active") return toast("Pengguna tidak tersedia.");

  const id = privateChatId(currentUser.uid, other.uid);

  try {
    await setDoc(doc(db, "chats", id), {
      members: [currentUser.uid, other.uid],
      updatedAt: serverTimestamp()
    }, { merge: true });

    activeChat = { id, uid: other.uid, name: other.name };
    activeChatType = "private";

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
  $("emptyChat").hidden = true;
  $("chatPanel").hidden = false;
  $("chatName").textContent = name;
  $("chatVerified").textContent = verified;
  $("chatAvatar").textContent = (name || "Z")[0].toUpperCase();

  if (window.innerWidth <= 800) {
    $("appScreen").classList.add("chat-open");
  }
}

// SEARCH USERS
let searchTimer;

$("searchUser").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 350);
};

async function searchUsers() {
  if (!currentUser) return;

  const value = $("searchUser").value.trim().toLowerCase();
  const results = $("searchResults");
  results.replaceChildren();

  if (value.length < 2) return;

  try {
    const snap = await getDocs(collection(db, "users"));

    snap.forEach(item => {
      const user = item.data();

      if (
        user.uid !== currentUser.uid &&
        user.status === "active" &&
        user.name?.toLowerCase().includes(value)
      ) {
        const row = safeElement("div", "user-item");
        row.append(
          safeElement(
            "strong", "",
            user.name + (user.verified ? " ✓" : "")
          )
        );
        row.onclick = () => openPrivateChat(user);
        results.append(row);
      }
    });
  } catch (error) {
    toast(errorMessage(error));
  }
}

$("newChatBtn").onclick = () => {
  $("searchUser").focus();
  toast("Cari nama pengguna untuk memulai chat.");
};

// MESSAGE LISTENER
function listenMessages(root, id) {
  const messageRef = collection(db, root, id, "messages");
  const q = query(
    messageRef,
    orderBy("createdAt", "asc"),
    limit(200)
  );

  const unsubscribe = onSnapshot(q, snap => {
    const container = $("messages");
    container.replaceChildren();

    snap.forEach(item => {
      const data = item.data();
      const mine = data.sender === currentUser.uid;

      const bubble = safeElement(
        "div",
        "bubble" + (mine ? " mine" : "")
      );

      if (data.type === "image" && data.image) {
        const img = document.createElement("img");
        img.src = data.image;
        img.alt = "Gambar pesan";
        bubble.append(img);
      } else {
        bubble.append(safeElement("div", "", data.text || ""));
      }

      bubble.append(safeElement(
        "small",
        "",
        data.createdAt?.toDate
          ? data.createdAt.toDate().toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit"
            })
          : "Mengirim..."
      ));

      if (mine) {
        const actions = safeElement("div", "bubble-actions");
        const del = safeElement("button", "", "Hapus");
        del.onclick = () => deleteMessage(root, id, item.id);
        actions.append(del);
        bubble.append(actions);
      }

      container.append(bubble);
    });

    container.scrollTop = container.scrollHeight;
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

// DELETE MESSAGE
async function deleteMessage(root, id, messageId) {
  if (!confirm("Hapus pesan ini?")) return;

  try {
    await deleteDoc(doc(db, root, id, "messages", messageId));
    toast("Pesan berhasil dihapus.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

// SEND MESSAGE
async function sendMessage(text, imageUrl = null) {
  if (!activeChat || !currentUser) {
    throw new Error("Pilih percakapan terlebih dahulu.");
  }

  const root = activeChatType === "group" ? "groups" : "chats";

  await addDoc(
    collection(db, root, activeChat.id, "messages"),
    {
      sender: currentUser.uid,
      senderName: currentProfile.name || "Pengguna",
      text: text || "",
      type: imageUrl ? "image" : "text",
      image: imageUrl,
      createdAt: serverTimestamp()
    }
  );

  await updateDoc(doc(db, root, activeChat.id), {
    lastMessage: imageUrl ? "Foto" : text,
    updatedAt: serverTimestamp()
  });
}

$("sendBtn").onclick = async () => {
  const text = $("messageInput").value.trim();
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
};

$("messageInput").onkeydown = event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("sendBtn").click();
  }
};

// IMAGE MESSAGE
$("imageInput").onchange = async event => {
  const file = event.target.files[0];
  if (!file || !activeChat) return;

  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    toast("Pilih gambar dengan ukuran maksimal 5 MB.");
    event.target.value = "";
    return;
  }

  try {
    const path =
      `chat-media/${currentUser.uid}/${Date.now()}-${file.name}`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);

    const url = await getDownloadURL(storageRef);
    await sendMessage("", url);
    toast("Gambar terkirim.");
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    event.target.value = "";
  }
};

// CHAT LIST
function listenChats() {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, async snap => {
    const list = $("chatList");
    list.replaceChildren();

    for (const item of snap.docs) {
      const data = item.data();
      const otherId = data.members?.find(id => id !== currentUser.uid);
      if (!otherId) continue;

      const userSnap = await getDoc(doc(db, "users", otherId));
      if (!userSnap.exists()) continue;

      const user = userSnap.data();
      if (user.status !== "active") continue;

      const row = safeElement("div", "chat-item");
      const avatar = safeElement(
        "div", "avatar", (user.name || "Z")[0].toUpperCase()
      );
      const details = safeElement("div");
      details.append(
        safeElement(
          "strong", "",
          user.name + (user.verified ? " ✓" : "")
        ),
        safeElement("small", "", data.lastMessage || "Mulai percakapan")
      );
      row.append(avatar, details);
      row.onclick = () => openPrivateChat(user);
      list.append(row);
    }
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

// STATUS
async function createStatus() {
  const text = prompt("Tulis status kamu:");
  if (!text?.trim()) return;

  try {
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      name: currentProfile.name,
      text: text.trim(),
      createdAt: serverTimestamp()
    });
    toast("Status berhasil dibuat.");
  } catch (error) {
    toast(errorMessage(error));
  }
}

$("createStatusBtn").onclick = createStatus;

function listenStatuses() {
  const q = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(80)
  );

  const unsubscribe = onSnapshot(q, snap => {
    const list = $("statusList");
    const mine = $("myStatuses");

    list.replaceChildren();
    mine.replaceChildren();

    snap.forEach(item => {
      const status = item.data();
      const row = safeElement("div", "user-item");

      row.append(
        safeElement("strong", "", status.name || "Pengguna"),
        safeElement("small", "", status.text || "")
      );

      row.onclick = () => toast(
        (status.name || "Pengguna") + ": " + (status.text || "")
      );

      if (status.uid === currentUser.uid) {
        const del = safeElement("button", "secondary-btn", "Hapus");
        del.onclick = async event => {
          event.stopPropagation();
          if (!confirm("Hapus status ini?")) return;

          try {
            await deleteDoc(doc(db, "statuses", item.id));
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
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

// CREATE GROUP
$("createGroupBtn").onclick = async () => {
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
};

function listenGroups() {
  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, snap => {
    const list = $("groupList");
    list.replaceChildren();

    snap.forEach(item => {
      const group = item.data();
      const row = safeElement("div", "chat-item");
      row.append(
        safeElement("div", "avatar", "G"),
        safeElement("strong", "", group.name)
      );
      row.onclick = () => openGroup(item.id, group.name);
      list.append(row);
    });
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

async function openGroup(id, name) {
  activeChat = { id, name };
  activeChatType = "group";
  showConversation(name, "Grup");
  listenMessages("groups", id);
}

// CREATE CHANNEL
$("createChannelBtn").onclick = async () => {
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
    openChannel(channel.id, name.trim());
  } catch (error) {
    toast(errorMessage(error));
  }
};

function listenChannels() {
  const q = query(
    collection(db, "channels"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  const unsubscribe = onSnapshot(q, snap => {
    const list = $("channelList");
    list.replaceChildren();

    snap.forEach(item => {
      const channel = item.data();
      const row = safeElement("div", "chat-item");

      row.append(
        safeElement("div", "avatar", "S"),
        safeElement("div", "", channel.name)
      );

      row.onclick = () => openChannel(item.id, channel.name);
      list.append(row);
    });
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);
}

async function openChannel(id, name) {
  activeChat = { id, name };
  activeChatType = "channel";
  showConversation(name, "Saluran");

  $("messages").replaceChildren();

  const postsQuery = query(
    collection(db, "channels", id, "posts"),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  const unsubscribe = onSnapshot(postsQuery, snap => {
    const container = $("messages");
    container.replaceChildren();

    snap.forEach(item => {
      const post = item.data();
      const bubble = safeElement("div", "bubble", post.text || "");

      bubble.append(
        safeElement("small", "", post.authorName || "Admin saluran")
      );

      if (post.uid === currentUser.uid) {
        const del = safeElement("button", "text-button", "Hapus");
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
  }, error => toast(errorMessage(error)));

  unsubscribers.push(unsubscribe);

  $("sendBtn").textContent = "Posting";
}

// SEND CHANNEL POST OR CHAT
const originalSend = $("sendBtn").onclick;

$("sendBtn").onclick = async () => {
  if (activeChatType !== "channel") {
    await originalSend();
    return;
  }

  const text = $("messageInput").value.trim();
  if (!text) return;

  try {
    if (activeChat.owner !== currentUser.uid) {
      toast("Hanya pemilik saluran yang dapat membuat postingan.");
      return;
    }

    await addDoc(
      collection(db, "channels", activeChat.id, "posts"),
      {
        uid: currentUser.uid,
        authorName: currentProfile.name,
        text,
        createdAt: serverTimestamp()
      }
    );

    $("messageInput").value = "";
    toast("Postingan saluran diterbitkan.");
  } catch (error) {
    toast(errorMessage(error));
  }
};

// PROFILE
function openProfile() {
  $("profileName").value = currentProfile?.name || "";
  $("profileBio").value = currentProfile?.bio || "";
  $("profileModal").hidden = false;
}

$("profileBtn").onclick = openProfile;
$("editProfileBtn").onclick = openProfile;
$("closeProfile").onclick = () => $("profileModal").hidden = true;

$("saveProfile").onclick = async () => {
  const name = $("profileName").value.trim();
  const bio = $("profileBio").value.trim();

  if (name.length < 3) return toast("Nama minimal 3 karakter.");

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name, bio
    });

    $("profileModal").hidden = true;
    toast("Profil berhasil diperbarui.");
  } catch (error) {
    toast(errorMessage(error));
  }
};

// APPEAL
$("appealBtn").onclick = async () => {
  const text = $("appealText").value.trim();

  if (text.length < 10) {
    $("appealMessage").textContent = "Minimal 10 karakter.";
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
    $("appealMessage").textContent = "Banding berhasil dikirim.";
  } catch (error) {
    $("appealMessage").textContent = errorMessage(error);
  }
};

// ADMIN
$("openAdmin").onclick = () => {
  if (!isAdmin()) return;
  $("adminScreen").hidden = false;
  loadAppeals();
};

$("closeAdmin").onclick = () => $("adminScreen").hidden = true;

$("findAdminUser").onclick = async () => {
  if (!isAdmin()) return toast("Akses ditolak.");

  const uid = $("adminSearch").value.trim();
  const result = $("adminUserResult");
  result.replaceChildren();

  if (!uid) return;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return result.textContent = "Pengguna tidak ditemukan.";

    const user = snap.data();
    result.append(safeElement(
      "p", "",
      `${user.name} — ${user.email} — ${user.status}`
    ));

    const actions = [
      ["Centang biru", { verified: true }],
      ["Cabut centang", { verified: false }],
      ["Tahan akun", { status: "held" }],
      ["Permanenkan akun", { status: "permanent" }],
      ["Pulihkan akun", { status: "active" }]
    ];

    actions.forEach(([label, changes]) => {
      const button = safeElement("button", "secondary-btn", label);

      button.onclick = async () => {
        if (uid === ADMIN_UID) return toast("Admin utama tidak dapat dimoderasi.");
        if (!confirm("Lanjutkan perubahan akun?")) return;

        try {
          await updateDoc(doc(db, "users", uid), {
            ...changes,
            moderatedAt: serverTimestamp(),
            moderatedBy: currentUser.uid
          });
          toast("Perubahan tersimpan.");
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      result.append(button);
    });
  } catch (error) {
    toast(errorMessage(error));
  }
};

async function loadAppeals() {
  const list = $("appealList");
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
        "div", "admin-user",
        `${appeal.email}: ${appeal.text}`
      );

      const approve = safeElement("button", "primary-btn", "Terima");
      approve.onclick = async () => {
        try {
          await updateDoc(doc(db, "users", appeal.uid), {
            status: "active"
          });
          await updateDoc(doc(db, "appeals", item.id), {
            status: "approved"
          });
          toast("Banding diterima.");
          loadAppeals();
        } catch (error) {
          toast(errorMessage(error));
        }
      };

      const reject = safeElement("button", "secondary-btn", "Tolak");
      reject.onclick = async () => {
        try {
          await updateDoc(doc(db, "appeals", item.id), {
            status: "rejected"
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

console.log("ZORAAPP WhatsApp-style loaded.");
