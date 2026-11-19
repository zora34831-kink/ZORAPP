
import { auth, db, storage } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

// ======================================
// KONFIGURASI
// ======================================

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let activeChat = null;

let profileUnsubscribe = null;
let activeUnsubscribe = null;
let chatUnsubscribe = null;
let statusUnsubscribe = null;

let registrationInProgress = false;
let searchTimer = null;

const show = id => {
  ["authScreen", "holdScreen", "permanentScreen", "appScreen"]
    .forEach(x => {
      $(x).hidden = x !== id;
    });
};

const isAdmin = () => currentUser?.uid === ADMIN_UID;

function showError(message) {
  $("authError").textContent = message || "";
}

function reportError(error) {
  console.error(error);
  return error?.message || "Terjadi kesalahan. Silakan coba lagi.";
}

function cleanupListeners() {
  [
    profileUnsubscribe,
    activeUnsubscribe,
    chatUnsubscribe,
    statusUnsubscribe
  ].forEach(unsubscribe => {
    if (unsubscribe) unsubscribe();
  });

  profileUnsubscribe = null;
  activeUnsubscribe = null;
  chatUnsubscribe = null;
  statusUnsubscribe = null;
}

// ======================================
// LOGIN
// ======================================

$("loginBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    showError("Email dan password harus diisi.");
    return;
  }

  $("loginBtn").disabled = true;
  showError("");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    showError(reportError(e));
  } finally {
    $("loginBtn").disabled = false;
  }
};

// ======================================
// REGISTER
// ======================================

$("registerBtn").onclick = async () => {
  const name = $("authName").value.trim();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!name || !email || !password) {
    showError("Semua kolom harus diisi.");
    return;
  }

  if (password.length < 8) {
    showError("Password minimal 8 karakter.");
    return;
  }

  $("registerBtn").disabled = true;
  showError("");
  registrationInProgress = true;

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
    $("authPassword").value = "";
  } catch (e) {
    showError(reportError(e));
  } finally {
    registrationInProgress = false;
    $("registerBtn").disabled = false;
  }
};

// ======================================
// AUTH STATE DAN PROFIL REALTIME
// ======================================

onAuthStateChanged(auth, user => {
  cleanupListeners();

  currentUser = user;
  currentProfile = null;
  activeChat = null;

  if (!user) {
    show("authScreen");
    return;
  }

  const profileRef = doc(db, "users", user.uid);

  profileUnsubscribe = onSnapshot(
    profileRef,
    snap => {
      if (!snap.exists()) {
        if (!registrationInProgress) {
          show("authScreen");
          showError("Profil pengguna tidak ditemukan.");
        }
        return;
      }

      currentProfile = snap.data();

      if (currentProfile.status === "permanent") {
        show("permanentScreen");
        return;
      }

      if (currentProfile.status === "held") {
        show("holdScreen");
        return;
      }

      if (currentProfile.status !== "active") {
        show("holdScreen");
        return;
      }

      show("appScreen");

      $("myName").textContent = currentProfile.name || "Pengguna";
      $("myEmail").textContent = user.email || "";
      $("myAvatar").textContent =
        (currentProfile.name || "Z")[0].toUpperCase();

      $("adminLink").hidden = !isAdmin();

      listenChats();
      listenStatuses();
    },
    e => {
      showError(reportError(e));
      show("authScreen");
    }
  );
});

// ======================================
// LOGOUT
// ======================================

async function logout() {
  try {
    await signOut(auth);
    $("authPassword").value = "";
    showError("");
  } catch (e) {
    alert(reportError(e));
  }
}

$("logoutBtn").onclick = logout;
$("logoutHold").onclick = logout;
$("newAccountBtn").onclick = logout;

// ======================================
// TEMA
// ======================================

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

// ======================================
// PENCARIAN PENGGUNA
// ======================================

$("searchUser").oninput = () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(searchUsers, 400);
};

async function searchUsers() {
  if (!currentUser || !currentProfile) return;

  const value = $("searchUser").value.trim().toLowerCase();
  const results = $("searchResults");

  results.replaceChildren();

  if (value.length < 2) return;

  try {
    const snap = await getDocs(collection(db, "users"));

    snap.forEach(d => {
      const u = d.data();

      if (
        u.uid !== currentUser.uid &&
        u.status === "active" &&
        u.name?.toLowerCase().includes(value)
      ) {
        const item = document.createElement("div");
        item.className = "user-item";

        const name = document.createElement("strong");
        name.textContent = (u.name || "Pengguna") +
          (u.verified ? " ✓" : "");

        item.append(name);
        item.onclick = () => openChat(u);

        results.append(item);
      }
    });
  } catch (e) {
    console.error("Pencarian:", e);
  }
}

// ======================================
// CHAT PRIBADI
// ======================================

function chatId(a, b) {
  return [a, b].sort().join("_");
}

async function openChat(other) {
  if (!currentUser || !other?.uid) return;
  if (other.status !== "active") return;

  try {
    activeChat = other;

    const id = chatId(currentUser.uid, other.uid);

    await setDoc(
      doc(db, "chats", id),
      {
        members: [currentUser.uid, other.uid],
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    $("emptyChat").hidden = true;
    $("chatPanel").hidden = false;

    $("chatName").textContent = other.name || "Pengguna";
    $("chatAvatar").textContent =
      (other.name || "U")[0].toUpperCase();

    $("chatVerified").textContent =
      other.verified ? "✓ Akun terverifikasi" : "";

    $("chatVerified").className =
      other.verified ? "verified" : "";

    if (activeUnsubscribe) activeUnsubscribe();

    const messagesRef = collection(db, "chats", id, "messages");

    const q = query(
      messagesRef,
      orderBy("createdAt", "asc"),
      limit(200)
    );

    activeUnsubscribe = onSnapshot(q, snap => {
      const messages = $("messages");
      messages.replaceChildren();

      snap.forEach(d => {
        const m = d.data();

        const bubble = document.createElement("div");

        bubble.className =
          "bubble" +
          (m.sender === currentUser.uid ? " mine" : "");

        if (m.type === "image" && m.image) {
          const img = document.createElement("img");
          img.src = m.image;
          img.alt = "Gambar pesan";
          img.loading = "lazy";
          bubble.append(img);
        } else {
          const content = document.createElement("div");
          content.textContent = m.text || "";
          bubble.append(content);
        }

        const time = document.createElement("small");

        time.textContent =
          m.createdAt?.toDate
            ? m.createdAt.toDate().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit"
              })
            : "Mengirim...";

        bubble.append(time);
        messages.append(bubble);
      });

      messages.scrollTop = messages.scrollHeight;
    }, e => {
      alert(reportError(e));
    });

  } catch (e) {
    alert(reportError(e));
  }
}

// ======================================
// KIRIM PESAN
// ======================================

async function sendMessage(text, imageUrl = null) {
  if (!activeChat || !currentUser) return;

  const id = chatId(currentUser.uid, activeChat.uid);

  await addDoc(
    collection(db, "chats", id, "messages"),
    {
      sender: currentUser.uid,
      text: text || "",
      type: imageUrl ? "image" : "text",
      image: imageUrl || null,
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
  } catch (e) {
    alert(reportError(e));
  } finally {
    $("sendBtn").disabled = false;
  }
};

$("messageInput").onkeydown = e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("sendBtn").click();
  }
};

// ======================================
// KIRIM GAMBAR
// ======================================

$("imageInput").onchange = async e => {
  const file = e.target.files[0];

  if (!file || !activeChat || !currentUser) return;

  if (!file.type.startsWith("image/")) {
    alert("File harus berupa gambar.");
    e.target.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert("Ukuran gambar maksimal 5 MB.");
    e.target.value = "";
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
  } catch (e) {
    alert(reportError(e));
  } finally {
    $("imageInput").value = "";
  }
};

// ======================================
// DAFTAR CHAT REALTIME
// ======================================

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
        snap.docs.map(async d => {
          const data = d.data();
          const otherId = data.members?.find(
            x => x !== currentUser.uid
          );

          if (!otherId) return null;

          const userSnap = await getDoc(doc(db, "users", otherId));

          if (!userSnap.exists()) return null;

          const u = userSnap.data();

          if (u.status !== "active") return null;

          return u;
        })
      );

      users.filter(Boolean).forEach(u => {
        const item = document.createElement("div");
        item.className = "chat-item";

        const name = document.createElement("strong");

        name.textContent =
          (u.name || "Pengguna") + (u.verified ? " ✓" : "");

        item.append(name);
        item.onclick = () => openChat(u);

        list.append(item);
      });
    } catch (e) {
      console.error("Daftar chat:", e);
    }
  });
}

// ======================================
// PROFIL
// ======================================

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

  if (!name) {
    alert("Nama harus diisi.");
    return;
  }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      bio
    });

    $("profileModal").hidden = true;
  } catch (e) {
    alert(reportError(e));
  }
};

// ======================================
// STATUS TEKS
// ======================================

function createStatusButton() {
  const button = document.createElement("button");

  button.id = "addStatus";
  button.textContent = "+ Buat status";

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
    } catch (e) {
      alert(reportError(e));
    }
  };

  return button;
}

function listenStatuses() {
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

    snap.forEach(d => {
      const s = d.data();

      const item = document.createElement("div");
      item.className = "user-item";

      const name = document.createElement("strong");
      name.textContent = s.name || "Pengguna";

      const content = document.createElement("small");
      content.textContent = s.text || "";

      item.append(name, content);

      item.onclick = () => {
        alert((s.name || "Pengguna") + ": " + (s.text || ""));
      };

      list.append(item);
    });
  }, e => {
    console.error("Status:", e);
  });
}

// ======================================
// BANDING AKUN
// ======================================

$("appealBtn").onclick = async () => {
  const text = $("appealText").value.trim();

  if (!currentUser) return;

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
  } catch (e) {
    $("appealMessage").textContent = reportError(e);
    $("appealBtn").disabled = false;
  }
};

// ======================================
// PANEL ADMIN
// ======================================

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

  if (!uid) return;

  const result = $("adminUserResult");
  result.replaceChildren();

  try {
    const snap = await getDoc(doc(db, "users", uid));

    if (!snap.exists()) {
      result.textContent = "Pengguna tidak ditemukan.";
      return;
    }

    const u = snap.data();

    const card = document.createElement("div");
    card.className = "admin-user";

    const title = document.createElement("strong");
    title.textContent = (u.name || "Pengguna") + " — " + (u.email || "");

    const status = document.createElement("p");
    status.textContent = "Status: " + (u.status || "unknown");

    card.append(title, status);

    function action(label, callback) {
      const button = document.createElement("button");
      button.textContent = label;
      button.onclick = callback;
      card.append(button);
    }

    action("Centang biru", () =>
      moderate(uid, { verified: true })
    );

    action("Cabut centang", () =>
      moderate(uid, { verified: false })
    );

    action("Tahan sementara", () => {
      const reason = prompt("Alasan penahanan:");

      if (reason?.trim()) {
        moderate(uid, {
          status: "held",
          reason: reason.trim()
        });
      }
    });

    action("Permanenkan", () => {
      if (confirm("Permanenkan akun ini?")) {
        moderate(uid, {
          status: "permanent",
          reason: "Penonaktifan permanen"
        });
      }
    });

    action("Pulihkan akun", () => {
      if (confirm("Pulihkan akun ini?")) {
        moderate(uid, {
          status: "active",
          reason: ""
        });
      }
    });

    result.append(card);
  } catch (e) {
    result.textContent = reportError(e);
  }
};

// ======================================
// MODERASI
// ======================================

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
  } catch (e) {
    alert(reportError(e));
  }
}

// ======================================
// DAFTAR BANDING ADMIN
// ======================================

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

    snap.forEach(d => {
      const a = d.data();

      const card = document.createElement("div");
      card.className = "admin-user";

      const details = document.createElement("p");
      details.textContent =
        (a.email || "Email tidak tersedia") + " — " + (a.text || "");

      const approve = document.createElement("button");
      approve.textContent = "Terima banding";

      approve.onclick = async () => {
        try {
          await moderate(a.uid, {
            status: "active",
            reason: ""
          });

          await updateDoc(doc(db, "appeals", d.id), {
            status: "approved"
          });

          loadAppeals();
        } catch (e) {
          alert(reportError(e));
        }
      };

      const reject = document.createElement("button");
      reject.textContent = "Tolak banding";

      reject.onclick = async () => {
        try {
          await updateDoc(doc(db, "appeals", d.id), {
            status: "rejected"
          });

          loadAppeals();
        } catch (e) {
          alert(reportError(e));
        }
      };

      card.append(details, approve, reject);
      list.append(card);
    });
  } catch (e) {
    list.textContent = reportError(e);
  }
}

// ======================================
// SELESAI
// ======================================

console.log("ZORAAPP initialized successfully.");
