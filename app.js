
import { auth, db, storage } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where,
  orderBy, onSnapshot, serverTimestamp,
  getDocs, limit
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

// ==========================================
// CONFIG
// ==========================================

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let activeChat = null;

let profileUnsubscribe = null;
let chatUnsubscribe = null;
let messageUnsubscribe = null;
let statusUnsubscribe = null;

let searchTimer = null;
let authReady = false;

// ==========================================
// UTILITIES
// ==========================================

function showScreen(id) {
  ["authScreen", "holdScreen", "permanentScreen", "appScreen"]
    .forEach(screen => {
      $(screen).hidden = screen !== id;
    });
}

function setError(id, message) {
  if ($(id)) $(id).textContent = message || "";
}

function errorMessage(error) {
  console.error(error);
  return error?.message || "Terjadi kesalahan.";
}

function isAdmin() {
  return currentUser?.uid === ADMIN_UID;
}

function cleanupListeners() {
  [
    profileUnsubscribe,
    chatUnsubscribe,
    messageUnsubscribe,
    statusUnsubscribe
  ].forEach(unsubscribe => {
    if (unsubscribe) unsubscribe();
  });

  profileUnsubscribe = null;
  chatUnsubscribe = null;
  messageUnsubscribe = null;
  statusUnsubscribe = null;
}

function safeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// ==========================================
// LOGIN
// ==========================================

$("loginBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  setError("authError", "");

  if (!email || !password) {
    setError("authError", "Email dan password wajib diisi.");
    return;
  }

  $("loginBtn").disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setError("authError", errorMessage(error));
  } finally {
    $("loginBtn").disabled = false;
  }
};

// ==========================================
// REGISTER
// ==========================================

$("registerBtn").onclick = async () => {
  const name = $("authName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  setError("registerError", "");

  if (!name || !email || !password) {
    setError("registerError", "Semua kolom wajib diisi.");
    return;
  }

  if (name.length < 3) {
    setError("registerError", "Nama minimal 3 karakter.");
    return;
  }

  if (password.length < 8) {
    setError("registerError", "Password minimal 8 karakter.");
    return;
  }

  $("registerBtn").disabled = true;

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
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

    $("authName").value = "";
    $("registerEmail").value = "";
    $("registerPassword").value = "";

  } catch (error) {
    setError("registerError", errorMessage(error));
  } finally {
    $("registerBtn").disabled = false;
  }
};

// ==========================================
// AUTH STATE
// ==========================================

onAuthStateChanged(auth, user => {
  cleanupListeners();

  currentUser = user;
  currentProfile = null;
  activeChat = null;

  if (!user) {
    showScreen("authScreen");
    return;
  }

  const userRef = doc(db, "users", user.uid);

  profileUnsubscribe = onSnapshot(userRef, snap => {
    if (!snap.exists()) {
      showScreen("authScreen");
      setError("authError", "Profil akun tidak ditemukan.");
      return;
    }

    currentProfile = snap.data();

    if (currentProfile.status === "permanent") {
      showScreen("permanentScreen");
      return;
    }

    if (currentProfile.status === "held") {
      showScreen("holdScreen");
      return;
    }

    if (currentProfile.status !== "active") {
      showScreen("holdScreen");
      return;
    }

    showScreen("appScreen");

    $("myName").textContent = currentProfile.name || "Pengguna";
    $("myEmail").textContent = user.email || "";

    $("myAvatar").textContent =
      (currentProfile.name || "Z")[0].toUpperCase();

    $("adminLink").hidden = !isAdmin();

    listenChats();
    listenStatuses();

  }, error => {
    console.error("Profile listener:", error);
    showScreen("authScreen");
    setError("authError", errorMessage(error));
  });
});

// ==========================================
// LOGOUT
// ==========================================

async function logout() {
  try {
    await signOut(auth);
    $("authPassword").value = "";
    $("registerPassword").value = "";
    setError("authError", "");
  } catch (error) {
    alert(errorMessage(error));
  }
}

$("logoutBtn").onclick = logout;
$("logoutHold").onclick = logout;
$("newAccountBtn").onclick = logout;

// ==========================================
// THEME
// ==========================================

$("themeBtn").onclick = () => {
  document.body.classList.toggle("dark");

  localStorage.setItem(
    "zora-theme",
    document.body.classList.contains("dark") ? "dark" : "light"
  );
};

if (localStorage.getItem("zora-theme") === "dark") {
  document.body.classList.add("dark");
}

// ==========================================
// SEARCH USERS
// ==========================================

$("searchUser").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 400);
};

async function searchUsers() {
  if (!currentUser) return;

  const value = $("searchUser").value.trim().toLowerCase();
  const results = $("searchResults");

  results.replaceChildren();

  if (value.length < 2) return;

  try {
    const snap = await getDocs(collection(db, "users"));

    snap.forEach(document => {
      const user = document.data();

      if (
        user.uid !== currentUser.uid &&
        user.status === "active" &&
        user.name?.toLowerCase().includes(value)
      ) {
        const item = safeElement("div", "user-item");

        const name = safeElement(
          "strong",
          "",
          user.name + (user.verified ? " ✓" : "")
        );

        item.append(name);
        item.onclick = () => openChat(user);

        results.append(item);
      }
    });

  } catch (error) {
    console.error("Search:", error);
  }
}

// ==========================================
// CHAT
// ==========================================

function chatId(a, b) {
  return [a, b].sort().join("_");
}

async function openChat(other) {
  if (!currentUser || !other?.uid) return;

  if (other.status !== "active") {
    alert("Pengguna ini tidak tersedia.");
    return;
  }

  try {
    activeChat = other;

    const id = chatId(currentUser.uid, other.uid);

    await setDoc(doc(db, "chats", id), {
      members: [currentUser.uid, other.uid],
      updatedAt: serverTimestamp()
    }, { merge: true });

    $("emptyChat").hidden = true;
    $("chatPanel").hidden = false;

    $("chatName").textContent = other.name || "Pengguna";

    $("chatAvatar").textContent =
      (other.name || "U")[0].toUpperCase();

    $("chatVerified").textContent =
      other.verified ? "✓ Akun terverifikasi" : "";

    $("chatVerified").className =
      other.verified ? "verified" : "";

    if (messageUnsubscribe) messageUnsubscribe();

    const messagesRef = collection(
      db,
      "chats",
      id,
      "messages"
    );

    const q = query(
      messagesRef,
      orderBy("createdAt", "asc"),
      limit(200)
    );

    messageUnsubscribe = onSnapshot(q, snap => {
      const container = $("messages");
      container.replaceChildren();

      snap.forEach(document => {
        const message = document.data();

        const bubble = safeElement(
          "div",
          "bubble" +
          (message.sender === currentUser.uid ? " mine" : "")
        );

        if (message.type === "image" && message.image) {
          const image = document.createElement("img");
          image.src = message.image;
          image.alt = "Gambar pesan";
          image.loading = "lazy";
          bubble.append(image);
        } else {
          bubble.append(
            safeElement("div", "", message.text || "")
          );
        }

        const time = safeElement(
          "small",
          "",
          message.createdAt?.toDate
            ? message.createdAt.toDate().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit"
              })
            : "Mengirim..."
        );

        bubble.append(time);
        container.append(bubble);
      });

      container.scrollTop = container.scrollHeight;

    }, error => {
      alert(errorMessage(error));
    });

  } catch (error) {
    alert(errorMessage(error));
  }
}

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage(text, imageUrl = null) {
  if (!activeChat || !currentUser) {
    throw new Error("Pilih percakapan terlebih dahulu.");
  }

  const id = chatId(currentUser.uid, activeChat.uid);

  await addDoc(
    collection(db, "chats", id, "messages"),
    {
      sender: currentUser.uid,
      text: text || "",
      type: imageUrl ? "image" : "text",
      image: imageUrl,
      createdAt: serverTimestamp()
    }
  );

  await updateDoc(doc(db, "chats", id), {
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
    alert(errorMessage(error));
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

// ==========================================
// SEND IMAGE
// ==========================================

$("imageInput").onchange = async event => {
  const file = event.target.files[0];

  if (!file || !activeChat || !currentUser) return;

  if (!file.type.startsWith("image/")) {
    alert("File harus berupa gambar.");
    event.target.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert("Ukuran gambar maksimal 5 MB.");
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

    alert("Gambar berhasil dikirim.");

  } catch (error) {
    alert(errorMessage(error));
  } finally {
    event.target.value = "";
  }
};

// ==========================================
// CHAT LIST
// ==========================================

function listenChats() {
  if (!currentUser) return;

  if (chatUnsubscribe) chatUnsubscribe();

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  chatUnsubscribe = onSnapshot(q, async snap => {
    const list = $("chatList");
    list.replaceChildren();

    try {
      const users = await Promise.all(
        snap.docs.map(async document => {
          const data = document.data();

          const otherId = data.members?.find(
            id => id !== currentUser.uid
          );

          if (!otherId) return null;

          const userSnap = await getDoc(doc(db, "users", otherId));

          if (!userSnap.exists()) return null;

          const user = userSnap.data();

          return user.status === "active" ? user : null;
        })
      );

      users.filter(Boolean).forEach(user => {
        const item = safeElement("div", "chat-item");

        const name = safeElement(
          "strong",
          "",
          user.name + (user.verified ? " ✓" : "")
        );

        item.append(name);
        item.onclick = () => openChat(user);

        list.append(item);
      });

    } catch (error) {
      console.error("Chat list:", error);
    }
  });
}

// ==========================================
// PROFILE
// ==========================================

$("profileBtn").onclick = () => {
  if (!currentProfile) return;

  $("profileName").value = currentProfile.name || "";
  $("profileBio").value = currentProfile.bio || "";

  $("profileModal").hidden = false;
};

$("closeProfile").onclick = () => {
  $("profileModal").hidden = true;
};

$("saveProfile").onclick = async () => {
  if (!currentUser) return;

  const name = $("profileName").value.trim();
  const bio = $("profileBio").value.trim();

  if (name.length < 3) {
    alert("Nama minimal 3 karakter.");
    return;
  }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      bio
    });

    $("profileModal").hidden = true;

  } catch (error) {
    alert(errorMessage(error));
  }
};

// ==========================================
// STATUS
// ==========================================

function createStatusButton() {
  const button = safeElement("button", "", "+ Buat status");

  button.id = "addStatus";
  button.onclick = async () => {
    const text = prompt("Tulis status:");

    if (!text?.trim() || !currentUser || !currentProfile) return;

    try {
      await addDoc(collection(db, "statuses"), {
        uid: currentUser.uid,
        name: currentProfile.name,
        text: text.trim(),
        createdAt: serverTimestamp()
      });

      alert("Status berhasil dibuat.");

    } catch (error) {
      alert(errorMessage(error));
    }
  };

  return button;
}

function listenStatuses() {
  if (!currentUser) return;

  if (statusUnsubscribe) statusUnsubscribe();

  const list = $("statusList");

  list.replaceChildren(createStatusButton());

  const q = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  statusUnsubscribe = onSnapshot(q, snap => {
    list.replaceChildren(createStatusButton());

    snap.forEach(document => {
      const status = document.data();

      const item = safeElement("div", "user-item");

      const name = safeElement(
        "strong",
        "",
        status.name || "Pengguna"
      );

      const content = safeElement(
        "small",
        "",
        status.text || ""
      );

      item.append(name, content);

      item.onclick = () => {
        alert((status.name || "Pengguna") + ": " + (status.text || ""));
      };

      list.append(item);
    });

  }, error => {
    console.error("Status:", error);
  });
}

// ==========================================
// APPEAL
// ==========================================

$("appealBtn").onclick = async () => {
  if (!currentUser) return;

  const text = $("appealText").value.trim();

  if (text.length < 10) {
    $("appealMessage").textContent =
      "Jelaskan banding minimal 10 karakter.";
    return;
  }

  $("appealBtn").disabled = true;

  try {
    await addDoc(collection(db, "appeals"), {
      uid: currentUser.uid,
      email: currentUser.email,
      text,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealMessage").textContent =
      "Banding berhasil dikirim.";

    $("appealText").value = "";

  } catch (error) {
    $("appealMessage").textContent = errorMessage(error);
    $("appealBtn").disabled = false;
  }
};

// ==========================================
// ADMIN PANEL
// ==========================================

$("openAdmin").onclick = () => {
  if (!isAdmin()) return;

  $("adminScreen").hidden = false;
  loadAppeals();
};

$("closeAdmin").onclick = () => {
  $("adminScreen").hidden = true;
};

$("findAdminUser").onclick = async () => {
  if (!isAdmin()) {
    alert("Akses ditolak.");
    return;
  }

  const uid = $("adminSearch").value.trim();
  const result = $("adminUserResult");

  result.replaceChildren();

  if (!uid) return;

  try {
    const snap = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
      result.textContent = "Pengguna tidak ditemukan.";
      return;
    }

    const user = snap.data();

    const card = safeElement("div", "admin-user");

    card.append(
      safeElement(
        "strong",
        "",
        (user.name || "Pengguna") + " — " + (user.email || "")
      ),
      safeElement("p", "", "Status: " + user.status)
    );

    function addAction(label, callback) {
      const button = safeElement("button", "", label);
      button.onclick = callback;
      card.append(button);
    }

    addAction("Centang biru", () =>
      moderate(uid, { verified: true })
    );

    addAction("Cabut centang", () =>
      moderate(uid, { verified: false })
    );

    addAction("Tahan sementara", () => {
      const reason = prompt("Alasan penahanan:");

      if (reason?.trim()) {
        moderate(uid, {
          status: "held",
          reason: reason.trim()
        });
      }
    });

    addAction("Permanenkan", () => {
      if (confirm("Permanenkan akun ini?")) {
        moderate(uid, {
          status: "permanent",
          reason: "Penonaktifan permanen"
        });
      }
    });

    addAction("Pulihkan akun", () => {
      if (confirm("Pulihkan akun ini?")) {
        moderate(uid, {
          status: "active",
          reason: ""
        });
      }
    });

    result.append(card);

  } catch (error) {
    result.textContent = errorMessage(error);
  }
};

// ==========================================
// MODERATION
// ==========================================

async function moderate(uid, changes) {
  if (!isAdmin()) {
    alert("Akses ditolak.");
    return;
  }

  try {
    await updateDoc(doc(db, "users", uid), {
      ...changes,
      moderatedAt: serverTimestamp(),
      moderatedBy: currentUser.uid
    });

    alert("Perubahan berhasil disimpan.");
    $("findAdminUser").click();

  } catch (error) {
    alert(errorMessage(error));
  }
}

// ==========================================
// ADMIN APPEALS
// ==========================================

async function loadAppeals() {
  if (!isAdmin()) return;

  const list = $("appealList");
  list.textContent = "Memuat banding...";

  try {
    const q = query(
      collection(db, "appeals"),
      where("status", "==", "pending")
    );

    const snap = await getDocs(q);

    list.replaceChildren();

    if (snap.empty) {
      list.textContent = "Belum ada permohonan banding.";
      return;
    }

    snap.forEach(document => {
      const appeal = document.data();

      const card = safeElement("div", "admin-user");

      const details = safeElement(
        "p",
        "",
        (appeal.email || "Tanpa email") + " — " + (appeal.text || "")
      );

      const approve = safeElement("button", "", "Terima banding");

      approve.onclick = async () => {
        try {
          await moderate(appeal.uid, {
            status: "active",
            reason: ""
          });

          await updateDoc(doc(db, "appeals", document.id), {
            status: "approved"
          });

          loadAppeals();

        } catch (error) {
          alert(errorMessage(error));
        }
      };

      const reject = safeElement("button", "", "Tolak banding");

      reject.onclick = async () => {
        try {
          await updateDoc(doc(db, "appeals", document.id), {
            status: "rejected"
          });

          loadAppeals();

        } catch (error) {
          alert(errorMessage(error));
        }
      };

      card.append(details, approve, reject);
      list.append(card);
    });

  } catch (error) {
    list.textContent = errorMessage(error);
  }
}

// ==========================================
// READY
// ==========================================

console.log("ZORAAPP app.js loaded.");
