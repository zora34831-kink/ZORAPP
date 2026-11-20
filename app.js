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
  doc,
  getDoc,
  setDoc,
  updateDoc,
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
  arrayUnion
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

/* =========================================
   CONFIGURATION
========================================= */

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";
const MAX_IMAGE = 5 * 1024 * 1024;

const $ = id => document.getElementById(id);

let user = null;
let profile = null;

let activeId = null;
let activeType = null;

let otpResult = null;
let linkResult = null;

let recaptcha = null;
let linkCaptcha = null;

let rootUnsubs = [];
let chatUnsubs = [];

let presenceUnsub = null;

let busy = false;
let toastTimer = null;
let searchTimer = null;
let profilePromise = null;
let typingTimer = null;

const on = (id, event, fn) => {
  $(id)?.addEventListener(event, fn);
};

const show = el => {
  if (el) el.hidden = false;
};

const hide = el => {
  if (el) el.hidden = true;
};

const msg = (id, value = "") => {
  if ($(id)) $(id).textContent = value;
};

/* =========================================
   UTILITIES
========================================= */

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2800);
}

function setBusy(button, state, label = "MEMPROSES...") {
  if (!button) return;

  button.disabled = state;

  if (state) {
    button.dataset.oldText ??= button.textContent;
    button.textContent = label;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    delete button.dataset.oldText;
  }
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function authError(error) {
  const messages = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Akun tidak ditemukan.",
    "auth/wrong-password": "Password salah.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/email-already-in-use": "Email sudah digunakan.",
    "auth/weak-password": "Password terlalu lemah.",
    "auth/network-request-failed": "Periksa koneksi internet.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/operation-not-allowed": "Metode login belum diaktifkan di Firebase.",
    "auth/invalid-phone-number": "Nomor HP tidak valid.",
    "auth/quota-exceeded": "Kuota SMS Firebase tercapai.",
    "auth/captcha-check-failed": "Verifikasi reCAPTCHA gagal.",
    "auth/invalid-verification-code": "Kode OTP salah.",
    "auth/code-expired": "Kode OTP kedaluwarsa.",
    "auth/credential-already-in-use": "Nomor HP sudah terhubung ke akun lain.",
    "auth/provider-already-linked": "Nomor HP sudah terhubung."
  };

  return messages[error?.code] || error?.message || "Terjadi kesalahan.";
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/[\s()-]/g, "");

  if (phone.startsWith("08")) {
    phone = "+62" + phone.slice(1);
  } else if (phone.startsWith("8")) {
    phone = "+62" + phone;
  }

  return phone;
}

function stamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  return new Date(value).getTime() || 0;
}

/* =========================================
   SCREEN MANAGEMENT
========================================= */

function showAuth() {
  show($("authScreen"));
  hide($("appScreen"));

  [
    "holdScreen",
    "recoveredScreen",
    "permanentScreen"
  ].forEach(id => hide($(id)));
}

function showApp() {
  hide($("authScreen"));

  [
    "holdScreen",
    "recoveredScreen",
    "permanentScreen"
  ].forEach(id => hide($(id)));

  show($("appScreen"));
}

function showAccountStatus(status) {
  [
    "appScreen",
    "authScreen",
    "holdScreen",
    "recoveredScreen",
    "permanentScreen"
  ].forEach(id => hide($(id)));

  if (status === "hold") {
    show($("holdScreen"));
  } else if (status === "permanent") {
    show($("permanentScreen"));
  } else {
    show($("recoveredScreen"));
  }
}

/* =========================================
   LISTENER MANAGEMENT
========================================= */

function clearChatListeners() {
  chatUnsubs.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  chatUnsubs = [];

  if (presenceUnsub) {
    presenceUnsub();
    presenceUnsub = null;
  }

  if (activeId && activeType && user) {
    stopTyping(activeId, activeType).catch(() => {});
  }
}

function clearListeners() {
  clearChatListeners();

  rootUnsubs.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  rootUnsubs = [];
}

function listen(unsubscribe, chat = false) {
  if (typeof unsubscribe !== "function") return;

  if (chat) {
    chatUnsubs.push(unsubscribe);
  } else {
    rootUnsubs.push(unsubscribe);
  }
}

/* =========================================
   LOGIN TAB
========================================= */

function switchLoginTab(type) {
  const email = type === "email";

  $("emailLoginPanel").hidden = !email;
  $("phoneLoginPanel").hidden = email;

  $("emailLoginTab").classList.toggle("active", email);
  $("phoneLoginTab").classList.toggle("active", !email);

  msg("authError");
}

on("emailLoginTab", "click", () => {
  switchLoginTab("email");
});

on("phoneLoginTab", "click", () => {
  switchLoginTab("phone");
});

on("showRegister", "click", () => {
  hide($("loginMode"));
  show($("registerMode"));

  msg("authError");
  msg("registerError");
});

on("showLogin", "click", () => {
  hide($("registerMode"));
  show($("loginMode"));

  msg("authError");
  msg("registerError");
});

/* =========================================
   EMAIL LOGIN
========================================= */

on("loginBtn", "click", async () => {
  if (busy) return;

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    return msg("authError", "Masukkan email dan password.");
  }

  busy = true;

  setBusy($("loginBtn"), true, "SEDANG MASUK...");
  msg("authError");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    msg("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("loginBtn"), false);
  }
});

/* =========================================
   REGISTER
========================================= */

on("registerBtn", "click", async () => {
  if (busy) return;

  const name = $("authName").value.trim();
  const username = $("registerUsername").value.trim().toLowerCase();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  if (!name || !username || !email || !password) {
    return msg("registerError", "Lengkapi semua kolom.");
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return msg(
      "registerError",
      "Username 3–20 karakter, huruf kecil, angka, underscore."
    );
  }

  if (password.length < 8) {
    return msg("registerError", "Password minimal 8 karakter.");
  }

  busy = true;
  setBusy($("registerBtn"), true, "MEMBUAT AKUN...");

  let createdUser = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    createdUser = credential.user;

    await updateProfile(createdUser, {
      displayName: name
    });

    await runTransaction(db, async transaction => {
      const usernameRef = doc(db, "usernames", username);
      const profileRef = doc(db, "users", createdUser.uid);

      const usernameSnap = await transaction.get(usernameRef);

      if (usernameSnap.exists()) {
        throw Error("Username sudah digunakan.");
      }

      transaction.set(usernameRef, {
        uid: createdUser.uid,
        username,
        createdAt: serverTimestamp()
      });

      transaction.set(profileRef, {
        uid: createdUser.uid,
        name,
        username,
        email,
        phoneNumber: "",
        bio: "",
        photoURL: "",
        createdAt: serverTimestamp(),
        status: "active",
        verified: false,
        role: "user"
      });
    });

    toast("Akun berhasil dibuat.");
  } catch (error) {
    console.error(error);

    msg("registerError", authError(error));

    if (createdUser) {
      try {
        await signOut(auth);
      } catch {}
    }
  } finally {
    busy = false;
    setBusy($("registerBtn"), false);
  }
});

/* =========================================
   FORGOT PASSWORD
========================================= */

on("forgotPassword", "click", async () => {
  const email = $("authEmail").value.trim();

  if (!email) {
    return msg("authError", "Masukkan email terlebih dahulu.");
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password dikirim ke email.");
  } catch (error) {
    msg("authError", authError(error));
  }
});

/* =========================================
   PHONE OTP
========================================= */

function clearCaptcha(link = false) {
  try {
    (link ? linkCaptcha : recaptcha)?.clear();
  } catch {}

  if (link) {
    linkCaptcha = null;
  } else {
    recaptcha = null;
  }
}

function makeCaptcha(id) {
  if (!$(id)) {
    throw Error("Elemen reCAPTCHA tidak ditemukan.");
  }

  return new RecaptchaVerifier(auth, id, {
    size: "normal",
    callback: () => {},
    "expired-callback": () => {
      toast("reCAPTCHA kedaluwarsa. Coba lagi.");
    }
  });
}

on("sendPhoneOtp", "click", async () => {
  if (busy) return;

  const phone = normalizePhone($("phoneNumber").value);

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return msg("authError", "Gunakan format +6281234567890.");
  }

  busy = true;

  setBusy($("sendPhoneOtp"), true, "MENGIRIM SMS...");

  try {
    clearCaptcha();

    recaptcha = makeCaptcha("recaptcha-container");

    otpResult = await signInWithPhoneNumber(
      auth,
      phone,
      recaptcha
    );

    $("phoneNumber").readOnly = true;

    show($("otpPanel"));

    msg("authError");
    toast("Kode OTP dikirim melalui SMS.");
  } catch (error) {
    console.error(error);

    clearCaptcha();
    otpResult = null;

    msg("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("sendPhoneOtp"), false);
  }
});

on("verifyPhoneOtp", "click", async () => {
  if (!otpResult || busy) return;

  const code = $("phoneOtp").value.trim();

  if (!/^\d{6}$/.test(code)) {
    return msg("authError", "Masukkan kode OTP 6 digit.");
  }

  busy = true;

  setBusy($("verifyPhoneOtp"), true, "MEMVERIFIKASI...");

  try {
    await otpResult.confirm(code);

    otpResult = null;
    clearCaptcha();

    toast("Nomor HP berhasil diverifikasi.");
  } catch (error) {
    msg("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("verifyPhoneOtp"), false);
  }
});

on("resendPhoneOtp", "click", () => {
  $("phoneNumber").readOnly = false;
  $("phoneOtp").value = "";

  hide($("otpPanel"));

  otpResult = null;
  clearCaptcha();

  $("sendPhoneOtp").click();
});

/* =========================================
   PHONE PROFILE
========================================= */

async function ensurePhoneProfile(currentUser) {
  if (profilePromise) return profilePromise;

  profilePromise = new Promise(resolve => {
    const modal = $("phoneProfileModal");
    const button = $("completePhoneProfile");

    if (!modal || !button) {
      profilePromise = null;
      resolve(false);
      return;
    }

    show(modal);
    msg("phoneProfileError");

    button.onclick = async () => {
      const name = $("phoneProfileName").value.trim();

      const username = $("phoneProfileUsername")
        .value.trim()
        .toLowerCase();

      if (!name || !/^[a-z0-9_]{3,20}$/.test(username)) {
        return msg(
          "phoneProfileError",
          "Isi nama dan username valid (3–20 karakter)."
        );
      }

      if (busy) return;

      busy = true;

      setBusy(button, true, "MENYIMPAN...");

      try {
        await runTransaction(db, async transaction => {
          const usernameRef = doc(db, "usernames", username);
          const profileRef = doc(db, "users", currentUser.uid);

          const usernameSnap = await transaction.get(usernameRef);
          const profileSnap = await transaction.get(profileRef);

          if (profileSnap.exists()) return;

          if (usernameSnap.exists()) {
            throw Error("Username sudah digunakan.");
          }

          transaction.set(usernameRef, {
            uid: currentUser.uid,
            username,
            createdAt: serverTimestamp()
          });

          transaction.set(profileRef, {
            uid: currentUser.uid,
            name,
            username,
            email: currentUser.email || "",
            phoneNumber: currentUser.phoneNumber || "",
            bio: "",
            photoURL: "",
            createdAt: serverTimestamp(),
            status: "active",
            verified: false,
            role: "user"
          });
        });

        await updateProfile(currentUser, {
          displayName: name
        });

        const snap = await getDoc(
          doc(db, "users", currentUser.uid)
        );

        if (!snap.exists()) {
          throw Error("Profil belum tersimpan.");
        }

        profile = {
          uid: currentUser.uid,
          ...snap.data()
        };

        hide(modal);

        profilePromise = null;
        resolve(true);
      } catch (error) {
        msg(
          "phoneProfileError",
          error.message || authError(error)
        );
      } finally {
        busy = false;
        setBusy(button, false);
      }
    };
  });

  return profilePromise;
}

/* =========================================
   PROFILE
========================================= */

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));

  if (!snap.exists()) {
    throw Error("Profil pengguna belum tersedia.");
  }

  profile = {
    uid,
    ...snap.data()
  };

  return profile;
}

function avatar(name = "U", photo = "", extraClass = "") {
  return `
    <div class="avatar ${extraClass}"
      ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>
      ${photo ? "" : esc(name.charAt(0).toUpperCase())}
    </div>
  `;
}

function renderProfile() {
  if (!profile || !user) return;

  const name = profile.name || "Pengguna";
  const photo = profile.photoURL || "";

  if ($("myName")) {
    $("myName").textContent = name;
  }

  if ($("myEmail")) {
    $("myEmail").textContent = profile.email || "";
  }

  if ($("myPhone")) {
    $("myPhone").textContent = profile.phoneNumber || "";
  }

  if ($("myAvatar")) {
    $("myAvatar").textContent = photo ? "" : name[0].toUpperCase();

    $("myAvatar").style.backgroundImage = photo
      ? `url("${photo}")`
      : "none";
  }

  if ($("openAdmin")) {
    $("openAdmin").hidden = user.uid !== ADMIN_UID;
  }

  $("profileName").value = name;
  $("profileUsername").value = profile.username || "";
  $("profileBio").value = profile.bio || "";

  $("profilePhotoPreview").textContent = photo
    ? ""
    : name[0].toUpperCase();

  $("profilePhotoPreview").style.backgroundImage = photo
    ? `url("${photo}")`
    : "none";
}

on("profileBtn", "click", () => {
  renderProfile();
  show($("profileModal"));
});

on("editProfileBtn", "click", () => {
  renderProfile();
  show($("profileModal"));
});

on("closeProfile", "click", () => {
  hide($("profileModal"));
});

/* =========================================
   IMAGE UPLOAD
========================================= */

async function uploadImage(file, folder) {
  if (!file || !file.type.startsWith("image/")) {
    throw Error("File harus berupa gambar.");
  }

  if (file.size > MAX_IMAGE) {
    throw Error("Ukuran gambar maksimal 5 MB.");
  }

  const path = `${folder}/${user.uid}/${Date.now()}_${file.name.replace(/[^\w.-]/g, "_")}`;

  const reference = storageRef(storage, path);

  await uploadBytes(reference, file);

  return getDownloadURL(reference);
}

on("profilePhotoInput", "change", event => {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/") || file.size > MAX_IMAGE) {
    toast("Pilih gambar maksimal 5 MB.");
    event.target.value = "";
    return;
  }

  const url = URL.createObjectURL(file);

  $("profilePhotoPreview").style.backgroundImage = `url("${url}")`;
  $("profilePhotoPreview").textContent = "";
});

on("saveProfile", "click", async () => {
  if (busy || !user || !profile) return;

  const name = $("profileName").value.trim();
  const bio = $("profileBio").value.trim();

  if (!name) {
    return toast("Nama tidak boleh kosong.");
  }

  busy = true;

  setBusy($("saveProfile"), true, "MENYIMPAN...");

  try {
    let photoURL = profile.photoURL || "";

    const file = $("profilePhotoInput").files?.[0];

    if (file) {
      photoURL = await uploadImage(file, "profiles");
    }

    await updateDoc(doc(db, "users", user.uid), {
      name,
      bio,
      photoURL,
      updatedAt: serverTimestamp()
    });

    await updateProfile(user, {
      displayName: name,
      photoURL
    });

    await loadProfile(user.uid);

    renderProfile();

    $("profilePhotoInput").value = "";

    hide($("profileModal"));

    toast("Profil diperbarui.");
  } catch (error) {
    toast("Gagal menyimpan: " + error.message);
  } finally {
    busy = false;
    setBusy($("saveProfile"), false);
  }
});

/* =========================================
   LINK PHONE NUMBER
========================================= */

on("linkPhoneBtn", "click", () => {
  show($("linkPhoneModal"));
});

on("closeLinkPhone", "click", () => {
  hide($("linkPhoneModal"));
});

on("sendLinkPhoneOtp", "click", async () => {
  const phone = normalizePhone($("linkPhoneNumber").value);

  if (!user) {
    return msg("linkPhoneError", "Kamu belum login.");
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return msg("linkPhoneError", "Nomor HP tidak valid.");
  }

  try {
    clearCaptcha(true);

    linkCaptcha = makeCaptcha("link-recaptcha-container");

    linkResult = await linkWithPhoneNumber(
      user,
      phone,
      linkCaptcha
    );

    show($("linkPhoneOtpPanel"));

    msg("linkPhoneError");

    toast("SMS OTP dikirim.");
  } catch (error) {
    msg("linkPhoneError", authError(error));
    clearCaptcha(true);
  }
});

on("verifyLinkPhoneOtp", "click", async () => {
  if (!linkResult || !user) return;

  const code = $("linkPhoneOtp").value.trim();

  if (!/^\d{6}$/.test(code)) {
    return msg("linkPhoneError", "Kode OTP harus 6 digit.");
  }

  try {
    const credential = await linkResult.confirm(code);

    user = credential.user;

    await updateDoc(doc(db, "users", user.uid), {
      phoneNumber: user.phoneNumber || "",
      updatedAt: serverTimestamp()
    });

    await loadProfile(user.uid);

    renderProfile();

    linkResult = null;

    clearCaptcha(true);

    hide($("linkPhoneModal"));

    toast("Nomor HP berhasil ditautkan.");
  } catch (error) {
    msg("linkPhoneError", authError(error));
  }
});

/* =========================================
   LOGOUT
========================================= */

async function logout() {
  clearListeners();

  if (user) {
    await remove(
      dbRef(rtdb, `status/${user.uid}`)
    ).catch(() => {});
  }

  await signOut(auth);

  user = null;
  profile = null;
  activeId = null;
  activeType = null;

  showAuth();
}

[
  "logoutBtn",
  "settingsLogoutBtn",
  "logoutHold",
  "logoutRecovered",
  "newAccountBtn"
].forEach(id => {
  on(id, "click", () => {
    logout().catch(error => toast(error.message));
  });
});

/* =========================================
   ACCOUNT RECOVERY
========================================= */

on("verifyAccountBtn", "click", async () => {
  if (!user) return showAuth();

  try {
    await loadProfile(user.uid);

    if (profile.status !== "active") {
      toast(
        "Akun sudah dipulihkan, tetapi masih menunggu aktivasi administrator."
      );
      return;
    }

    showApp();

    renderProfile();

    setupPresence();
    listenChats();
    listenGroups();
    listenChannels();
    listenStatuses();

    openPage("chatsPage");
  } catch (error) {
    toast("Gagal memeriksa akun: " + error.message);
  }
});

/* =========================================
   NAVIGATION
========================================= */

function openPage(id) {
  document.querySelectorAll(".page").forEach(page => {
    const active = page.id === id;

    page.classList.toggle("active", active);
    page.hidden = !active;
  });

  document.querySelectorAll(".nav-button[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === id
    );
  });

  if (id !== "chatsPage" && window.innerWidth <= 700) {
    $("appScreen").classList.remove("mobile-chat-open");

    hide($("chatPanel"));
    show($("emptyChat"));
  }
}

document.querySelectorAll(".nav-button[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

/* =========================================
   THEME
========================================= */

function setTheme(theme) {
  document.body.dataset.theme = theme;

  try {
    localStorage.setItem("zora-theme", theme);
  } catch {}
}

function toggleTheme() {
  setTheme(
    document.body.dataset.theme === "light"
      ? "dark"
      : "light"
  );
}

on("themeBtn", "click", toggleTheme);
on("settingsThemeBtn", "click", toggleTheme);

try {
  setTheme(localStorage.getItem("zora-theme") || "dark");
} catch {
  setTheme("dark");
}

/* =========================================
   PRIVATE CHAT
========================================= */

function chatId(a, b) {
  return [a, b].sort().join("_");
}

async function startPrivate(uid) {
  if (!uid || uid === user.uid) return;

  try {
    const profileSnap = await getDoc(doc(db, "users", uid));

    if (!profileSnap.exists()) {
      throw Error("Pengguna tidak ditemukan.");
    }

    const target = profileSnap.data();

    const id = chatId(user.uid, uid);

    const chatRef = doc(db, "chats", id);

    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        members: [user.uid, uid],
        type: "private",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: ""
      });
    }

    openConversation(id, "private", {
      uid,
      name: target.name || "Pengguna",
      photoURL: target.photoURL || ""
    });
  } catch (error) {
    toast("Tidak bisa membuka chat: " + error.message);
  }
}

function listenChats() {
  const chatsQuery = query(
    collection(db, "chats"),
    where("members", "array-contains", user.uid)
  );

  listen(
    onSnapshot(chatsQuery, async snapshot => {
      const list = await Promise.all(
        snapshot.docs.map(async chatDoc => {
          const other = chatDoc.data().members?.find(
            uid => uid !== user.uid
          );

          if (!other) return null;

          const profileSnap = await getDoc(
            doc(db, "users", other)
          );

          if (!profileSnap.exists()) return null;

          const data = profileSnap.data();

          return {
            id: chatDoc.id,
            uid: other,
            name: data.name || "Pengguna",
            photoURL: data.photoURL || "",
            lastMessage: chatDoc.data().lastMessage || "Mulai percakapan",
            updatedAt: chatDoc.data().updatedAt
          };
        })
      );

      const valid = list
        .filter(Boolean)
        .sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt));

      const element = $("chatList");

      element.innerHTML = "";

      if (!valid.length) {
        element.innerHTML =
          '<div class="empty-state">Belum ada percakapan.</div>';

        return;
      }

      valid.forEach(chat => {
        const button = document.createElement("button");

        button.className = "chat-item";

        button.innerHTML =
          avatar(chat.name, chat.photoURL) +
          `<div class="chat-item-details">
            <strong>${esc(chat.name)}</strong>
            <span>${esc(chat.lastMessage)}</span>
          </div>`;

        button.onclick = () => startPrivate(chat.uid);

        element.append(button);
      });
    }, error => {
      console.error(error);
      toast("Gagal memuat chat: " + error.message);
    })
  );
}

/* =========================================
   GROUPS
========================================= */

function listenGroups() {
  const groupsQuery = query(
    collection(db, "groups"),
    where("members", "array-contains", user.uid)
  );

  listen(
    onSnapshot(groupsQuery, snapshot => {
      const element = $("groupList");

      element.innerHTML = "";

      if (snapshot.empty) {
        element.innerHTML =
          '<div class="empty-state">Belum ada grup.</div>';

        return;
      }

      snapshot.forEach(groupDoc => {
        const data = groupDoc.data();

        const button = document.createElement("button");

        button.className = "chat-item";

        button.innerHTML =
          avatar(data.name || "G") +
          `<div class="chat-item-details">
            <strong>${esc(data.name || "Grup")}</strong>
            <span>${esc(data.lastMessage || "Grup baru")}</span>
          </div>`;

        button.onclick = () => {
          openConversation(groupDoc.id, "group", {
            name: data.name,
            ownerId: data.ownerId
          });
        };

        element.append(button);
      });
    }, error => {
      toast("Gagal memuat grup: " + error.message);
    })
  );
}

on("createGroupBtn", "click", async () => {
  const name = prompt("Masukkan nama grup:");

  if (!name?.trim()) return;

  try {
    const result = await addDoc(collection(db, "groups"), {
      name: name.trim(),
      ownerId: user.uid,
      members: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: ""
    });

    toast("Grup berhasil dibuat.");

    openConversation(result.id, "group", {
      name: name.trim(),
      ownerId: user.uid
    });
  } catch (error) {
    toast("Gagal membuat grup: " + error.message);
  }
});

on("inviteGroupMember", "click", async () => {
  if (activeType !== "group") return;

  const username = prompt("Masukkan username anggota:")
    ?.trim()
    .toLowerCase();

  if (!username) return;

  try {
    const groupRef = doc(db, "groups", activeId);

    const groupSnap = await getDoc(groupRef);

    if (
      !groupSnap.exists() ||
      groupSnap.data().ownerId !== user.uid
    ) {
      throw Error("Hanya pemilik grup yang bisa mengundang.");
    }

    const usernameSnap = await getDoc(
      doc(db, "usernames", username)
    );

    if (!usernameSnap.exists()) {
      throw Error("Username tidak ditemukan.");
    }

    const targetUid = usernameSnap.data().uid;

    if (targetUid === user.uid) {
      throw Error("Kamu sudah menjadi anggota.");
    }

    await updateDoc(groupRef, {
      members: arrayUnion(targetUid)
    });

    toast("Anggota berhasil ditambahkan.");
  } catch (error) {
    toast(error.message);
  }
});

/* =========================================
   CHANNELS
========================================= */

function listenChannels() {
  const channelsQuery = query(
    collection(db, "channels"),
    orderBy("createdAt", "desc")
  );

  listen(
    onSnapshot(channelsQuery, snapshot => {
      const element = $("channelList");

      element.innerHTML = "";

      if (snapshot.empty) {
        element.innerHTML =
          '<div class="empty-state">Belum ada saluran.</div>';

        return;
      }

      snapshot.forEach(channelDoc => {
        const data = channelDoc.data();

        const button = document.createElement("button");

        button.className = "chat-item";

        button.innerHTML =
          avatar(data.name || "S") +
          `<div class="channel-item-details">
            <strong>${esc(data.name || "Saluran")}</strong>
            <span>${Number(data.followerCount || 0)} PENGIKUT</span>
          </div>`;

        button.onclick = () => openChannel(channelDoc.id);

        element.append(button);
      });
    }, error => {
      toast("Gagal memuat saluran: " + error.message);
    })
  );
}

async function openChannel(id) {
  try {
    const channelSnap = await getDoc(
      doc(db, "channels", id)
    );

    if (!channelSnap.exists()) {
      throw Error("Saluran tidak ditemukan.");
    }

    const data = channelSnap.data();

    const isOwner = data.ownerId === user.uid;

    const followerSnap = await getDoc(
      doc(db, "channels", id, "followers", user.uid)
    );

    openConversation(id, "channel", {
      name: data.name,
      ownerId: data.ownerId,
      isOwner,
      isFollowing: followerSnap.exists(),
      followerCount: data.followerCount || 0
    });
  } catch (error) {
    toast(error.message);
  }
}

async function changeChannelFollow(id, follow) {
  const channelRef = doc(db, "channels", id);

  const followerRef = doc(
    db,
    "channels",
    id,
    "followers",
    user.uid
  );

  try {
    await runTransaction(db, async transaction => {
      const channelSnap = await transaction.get(channelRef);
      const followerSnap = await transaction.get(followerRef);

      if (!channelSnap.exists()) {
        throw Error("Saluran tidak ditemukan.");
      }

      const count = Number(
        channelSnap.data().followerCount || 0
      );

      if (follow && !followerSnap.exists()) {
        transaction.set(followerRef, {
          uid: user.uid,
          name: profile.name,
          followedAt: serverTimestamp()
        });

        transaction.update(channelRef, {
          followerCount: count + 1
        });
      } else if (!follow && followerSnap.exists()) {
        transaction.delete(followerRef);

        transaction.update(channelRef, {
          followerCount: Math.max(0, count - 1)
        });
      }
    });

    toast(
      follow
        ? "Berhasil mengikuti saluran."
        : "Berhenti mengikuti saluran."
    );

    await openChannel(id);
  } catch (error) {
    toast("Gagal memperbarui pengikut: " + error.message);
  }
}

on("createChannelBtn", "click", async () => {
  const name = prompt("Nama saluran:")?.trim();

  if (!name) return;

  const description = prompt("Deskripsi saluran:") || "";

  try {
    const result = await addDoc(collection(db, "channels"), {
      name,
      description,
      ownerId: user.uid,
      followerCount: 0,
      createdAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");

    openChannel(result.id);
  } catch (error) {
    toast("Gagal membuat saluran: " + error.message);
  }
});

async function sendChannelPost(text = "", imageURL = "") {
  if (activeType !== "channel" || !activeId) return;

  const id = activeId;
  const clean = text.trim();

  if (!clean && !imageURL) return;

  try {
    const channelRef = doc(db, "channels", id);

    const channelSnap = await getDoc(channelRef);

    if (
      !channelSnap.exists() ||
      channelSnap.data().ownerId !== user.uid
    ) {
      throw Error("Hanya pemilik saluran yang bisa posting.");
    }

    await addDoc(
      collection(db, "channels", id, "posts"),
      {
        senderId: user.uid,
        senderName: profile.name,
        text: clean,
        imageURL,
        reactions: {},
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(channelRef, {
      updatedAt: serverTimestamp()
    });

    $("channelPostInput").value = "";
  } catch (error) {
    toast("Gagal posting: " + error.message);
  }
}

on("sendChannelPost", "click", () => {
  sendChannelPost($("channelPostInput").value);
});

on("channelImageInput", "change", async event => {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    const url = await uploadImage(file, "channel-posts");

    await sendChannelPost("", url);
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
});

/* =========================================
   STATUS
========================================= */

function listenStatuses() {
  const statusesQuery = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  listen(
    onSnapshot(statusesQuery, snapshot => {
      const element = $("statusList");

      element.innerHTML = "";

      const items = snapshot.docs
        .map(document => ({
          id: document.id,
          ...document.data()
        }))
        .filter(item => {
          return !item.expiresAt || item.expiresAt > Date.now();
        });

      if (!items.length) {
        element.innerHTML =
          '<div class="empty-state">Belum ada status.</div>';
      } else {
        items.forEach(item => {
          const button = document.createElement("button");

          button.className = "status-item";

          button.innerHTML =
            avatar(item.name || "U", item.photoURL) +
            `<div class="status-item-details">
              <strong>${esc(item.name || "Pengguna")}</strong>
              <span>${esc(item.text || "Status")}</span>
            </div>`;

          button.onclick = () => showStatus(item);

          element.append(button);
        });
      }

      const mine = items.filter(item => item.uid === user.uid);

      $("myStatuses").innerHTML = mine
        .map(item => `
          <div class="status-item">
            <strong>${esc(item.text)}</strong>
          </div>
        `)
        .join("") ||
        '<p class="input-hint">Belum ada status yang kamu bagikan.</p>';
    }, error => {
      toast("Gagal memuat status: " + error.message);
    })
  );
}

on("createStatusBtn", "click", () => {
  show($("statusModal"));
});

on("closeStatus", "click", () => {
  hide($("statusModal"));
});

on("publishStatus", "click", async () => {
  const text = $("statusInput").value.trim();

  if (!text) {
    return toast("Isi status terlebih dahulu.");
  }

  try {
    await addDoc(collection(db, "statuses"), {
      uid: user.uid,
      name: profile.name,
      photoURL: profile.photoURL || "",
      text,
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 86400000
    });

    $("statusInput").value = "";

    hide($("statusModal"));

    toast("Status berhasil dibagikan.");
  } catch (error) {
    toast("Gagal membagikan status: " + error.message);
  }
});

function showStatus(status) {
  $("viewStatusName").textContent = status.name || "Pengguna";
  $("viewStatusText").textContent = status.text || "";

  show($("viewStatusModal"));
}

on("closeViewStatus", "click", () => {
  hide($("viewStatusModal"));
});

/* =========================================
   CONVERSATION
========================================= */

function openConversation(id, type, info = {}) {
  clearChatListeners();

  activeId = id;
  activeType = type;

  show($("chatPanel"));
  hide($("emptyChat"));

  $("chatName").textContent = info.name || "Percakapan";

  $("chatAvatar").textContent =
    (info.name || "U")[0].toUpperCase();

  $("chatAvatar").style.backgroundImage = info.photoURL
    ? `url("${info.photoURL}")`
    : "none";

  msg("chatPresence");
  msg("typingIndicator");

  hide($("channelControls"));
  hide($("channelComposer"));

  show($("composer"));

  $("composer").hidden = type === "channel";

  $("messageInput").disabled = type === "channel";
  $("sendBtn").disabled = type === "channel";
  $("imageInput").disabled = type === "channel";

  hide($("inviteGroupMember"));

  if (type === "group") {
    $("inviteGroupMember").hidden =
      info.ownerId !== user.uid;
  }

  if (type === "channel") {
    const controls = $("channelControls");

    show(controls);

    const count = Number(info.followerCount || 0);

    controls.innerHTML = `
      <div class="channel-meta">
        <strong>${count} PENGIKUT</strong>
      </div>

      ${
        info.isOwner
          ? '<span class="channel-owner-label">ADMIN SALURAN</span>'
          : info.isFollowing
            ? '<button id="unfollowChannelBtn" class="secondary-btn" type="button">Berhenti mengikuti</button>'
            : '<button id="followChannelBtn" class="primary-btn" type="button">IKUTI SALURAN</button>'
      }
    `;

    if (info.isOwner) {
      show($("channelComposer"));
    }

    if (info.isFollowing || info.isOwner) {
      listenMessages(id, type);
    } else {
      $("messages").innerHTML = `
        <div class="empty-state">
          <h2>Ikuti saluran</h2>
          <p>Ikuti saluran ini untuk melihat postingannya.</p>
        </div>
      `;
    }

    const followButton = $("followChannelBtn");
    const unfollowButton = $("unfollowChannelBtn");

    if (followButton) {
      followButton.onclick = () => {
        changeChannelFollow(id, true);
      };
    }

    if (unfollowButton) {
      unfollowButton.onclick = () => {
        changeChannelFollow(id, false);
      };
    }
  } else {
    listenMessages(id, type);
    listenTyping(id, type);

    if (type === "private" && info.uid) {
      listenPresence(info.uid);
    }
  }

  if (innerWidth <= 700) {
    $("appScreen").classList.add("mobile-chat-open");
  }
}

on("backToChats", "click", () => {
  $("appScreen").classList.remove("mobile-chat-open");

  clearChatListeners();

  activeId = null;
  activeType = null;

  hide($("chatPanel"));
  show($("emptyChat"));
});

/* =========================================
   MESSAGES
========================================= */

function msgCol(id, type) {
  const parent =
    type === "group"
      ? "groups"
      : type === "channel"
        ? "channels"
        : "chats";

  const child = type === "channel" ? "posts" : "messages";

  return collection(db, parent, id, child);
}

function listenMessages(id, type) {
  const messagesQuery = query(
    msgCol(id, type),
    orderBy("createdAt", "asc"),
    limit(100)
  );

  listen(
    onSnapshot(messagesQuery, snapshot => {
      if (activeId !== id || activeType !== type) return;

      const element = $("messages");

      element.innerHTML = "";

      snapshot.forEach(document => {
        renderMessage(
          document.id,
          document.data(),
          type
        );
      });

      element.scrollTop = element.scrollHeight;

      if (type !== "channel") {
        markRead(snapshot.docs);
      }
    }, error => {
      console.error(error);

      toast(
        "Gagal memuat pesan. Periksa Firestore Rules: " +
        error.message
      );
    }),
    true
  );
}

function renderMessage(id, message, type) {
  const own = message.senderId === user.uid;

  const wrapper = document.createElement("div");

  wrapper.className = "message" + (own ? " own" : "");

  wrapper.innerHTML = `
    <div class="message-bubble">

      ${
        type === "group" && !own
          ? `<div class="message-sender">${esc(message.senderName || "Pengguna")}</div>`
          : ""
      }

      ${
        message.imageURL
          ? `<img class="message-image" src="${esc(message.imageURL)}" alt="Gambar pesan">`
          : ""
      }

      ${
        message.text
          ? `<div class="message-text">${esc(message.text)}</div>`
          : ""
      }

      <div class="message-footer">
        <span>
          ${
            message.createdAt?.toDate
              ? message.createdAt.toDate().toLocaleTimeString(
                  "id-ID",
                  {
                    hour: "2-digit",
                    minute: "2-digit"
                  }
                )
              : ""
          }
        </span>

        ${own ? "✓" : ""}
      </div>

      <div class="message-reactions">
        ${
          Object.entries(message.reactions || {})
            .filter(([, users]) => Array.isArray(users) && users.length)
            .map(([emoji, users]) => {
              return `<span>${esc(emoji)} ${users.length}</span>`;
            })
            .join(" ")
        }
      </div>

      <button class="reaction-button" type="button">
        + Reaksi
      </button>
    </div>
  `;

  wrapper.querySelector(".reaction-button").onclick = () => {
    react(id, type);
  };

  $("messages").append(wrapper);
}

async function markRead(documents) {
  for (const document of documents) {
    const data = document.data();

    if (
      data.senderId !== user.uid &&
      !(data.readBy || []).includes(user.uid)
    ) {
      updateDoc(document.ref, {
        readBy: arrayUnion(user.uid)
      }).catch(() => {});
    }
  }
}

async function sendMessage(text = "", imageURL = "") {
  if (!activeId || !user || activeType === "channel") return;

  const clean = text.trim();

  if (!clean && !imageURL) return;

  try {
    await addDoc(
      msgCol(activeId, activeType),
      {
        senderId: user.uid,
        senderName: profile.name || "Pengguna",
        text: clean,
        imageURL,
        reactions: {},
        readBy: [user.uid],
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(
      doc(
        db,
        activeType === "group" ? "groups" : "chats",
        activeId
      ),
      {
        lastMessage: clean || "Foto",
        updatedAt: serverTimestamp()
      }
    );

    $("messageInput").value = "";

    stopTyping(activeId, activeType);
  } catch (error) {
    toast("Pesan gagal dikirim: " + error.message);
  }
}

on("sendBtn", "click", () => {
  sendMessage($("messageInput").value);
});

on("messageInput", "keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();

    sendMessage($("messageInput").value);
  }
});

on("imageInput", "change", async event => {
  const file = event.target.files?.[0];

  if (!file || !activeId) return;

  try {
    const url = await uploadImage(file, "messages");

    await sendMessage("", url);
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
});

/* =========================================
   MESSAGE REACTIONS
========================================= */

async function react(id, type) {
  const emoji = prompt("Masukkan reaksi: ❤️ 😂 👍 😮 😢 🔥");

  if (!emoji || emoji.length > 8) return;

  try {
    const reference = doc(
      msgCol(activeId, type),
      id
    );

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);

      if (!snapshot.exists()) return;

      const data = snapshot.data();

      const reactions = {
        ...(data.reactions || {})
      };

      const users = [
        ...(reactions[emoji] || [])
      ];

      reactions[emoji] = users.includes(user.uid)
        ? users.filter(uid => uid !== user.uid)
        : [...users, user.uid];

      transaction.update(reference, {
        reactions
      });
    });
  } catch (error) {
    toast("Gagal memberi reaksi: " + error.message);
  }
}

/* =========================================
   TYPING INDICATOR
========================================= */

function typingRef(id, type, uid) {
  return dbRef(
    rtdb,
    `typing/${type}/${id}/${uid}`
  );
}

async function typeOn() {
  if (!activeId || !activeType || activeType === "channel") {
    return;
  }

  set(
    typingRef(activeId, activeType, user.uid),
    {
      name: profile.name,
      typing: true,
      updatedAt: rtdbTimestamp()
    }
  ).catch(() => {});

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    stopTyping(activeId, activeType);
  }, 2200);
}

async function stopTyping(id, type) {
  if (user && id && type) {
    remove(
      typingRef(id, type, user.uid)
    ).catch(() => {});
  }
}

on("messageInput", "input", typeOn);

function listenTyping(id, type) {
  const reference = dbRef(
    rtdb,
    `typing/${type}/${id}`
  );

  const unsubscribe = onValue(reference, snapshot => {
    const names = Object.entries(snapshot.val() || {})
      .filter(([uid, value]) => {
        return uid !== user.uid && value.typing;
      })
      .map(([, value]) => value.name || "Pengguna");

    msg(
      "typingIndicator",
      names.length
        ? names.join(", ") + " sedang mengetik..."
        : ""
    );
  });

  listen(unsubscribe, true);
}

/* =========================================
   ONLINE / LAST SEEN
========================================= */

function listenPresence(uid) {
  const unsubscribe = onValue(
    dbRef(rtdb, `status/${uid}`),
    snapshot => {
      const value = snapshot.val();

      msg(
        "chatPresence",
        !value
          ? ""
          : value.state === "online"
            ? "Online"
            : "Terakhir dilihat " +
              new Date(
                value.lastChanged || Date.now()
              ).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              })
      );
    }
  );

  presenceUnsub = unsubscribe;

  listen(unsubscribe, true);
}

function setupPresence() {
  const connectedRef = dbRef(rtdb, ".info/connected");

  const unsubscribe = onValue(
    connectedRef,
    async snapshot => {
      if (snapshot.val() !== true || !user) return;

      const reference = dbRef(
        rtdb,
        `status/${user.uid}`
      );

      try {
        await onDisconnect(reference).set({
          state: "offline",
          lastChanged: rtdbTimestamp()
        });

        await set(reference, {
          state: "online",
          lastChanged: rtdbTimestamp()
        });
      } catch (error) {
        console.warn(error);
      }
    }
  );

  listen(unsubscribe);
}

/* =========================================
   SEARCH USERS
========================================= */

on("searchUser", "input", event => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    searchUsers(event.target.value);
  }, 300);
});

async function searchUsers(term) {
  const element = $("searchResults");

  const key = term
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  element.innerHTML = "";

  if (key.length < 2) return;

  try {
    const results = await getDocs(
      query(
        collection(db, "usernames"),
        where("username", ">=", key),
        where("username", "<=", key + "\uf8ff"),
        limit(20)
      )
    );

    if (results.empty) {
      element.innerHTML =
        '<div class="empty-state">Pengguna tidak ditemukan.</div>';

      return;
    }

    for (const document of results.docs) {
      const uid = document.data().uid;

      if (uid === user.uid) continue;

      const profileSnap = await getDoc(
        doc(db, "users", uid)
      );

      if (!profileSnap.exists()) continue;

      const data = profileSnap.data();

      const button = document.createElement("button");

      button.className = "chat-item";

      button.innerHTML =
        avatar(data.name || "U", data.photoURL) +
        `<div class="chat-item-details">
          <strong>${esc(data.name || "Pengguna")}</strong>
          <span>@${esc(data.username || "")}</span>
        </div>`;

      button.onclick = () => startPrivate(uid);

      element.append(button);
    }
  } catch (error) {
    toast("Pencarian gagal: " + error.message);
  }
}

on("newChatBtn", "click", () => {
  $("searchUser").focus();

  toast("Cari username untuk memulai chat.");
});

/* =========================================
   APPEALS
========================================= */

on("appealBtn", "click", async () => {
  const message = $("appealText").value.trim();

  if (!message) {
    return msg(
      "appealMessage",
      "Tulis alasan banding terlebih dahulu."
    );
  }

  try {
    await addDoc(collection(db, "appeals"), {
      uid: user.uid,
      username: profile.username || "",
      message,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealText").value = "";

    msg(
      "appealMessage",
      "Banding berhasil dikirim."
    );
  } catch (error) {
    msg(
      "appealMessage",
      "Gagal mengirim: " + error.message
    );
  }
});

/* =========================================
   ADMIN PANEL
========================================= */

function openAdmin() {
  if (user?.uid !== ADMIN_UID) {
    return toast("Akses ditolak.");
  }

  show($("adminScreen"));

  loadAppeals();
}

on("openAdmin", "click", openAdmin);

on("closeAdmin", "click", () => {
  hide($("adminScreen"));
});

on("findAdminUser", "click", async () => {
  if (user?.uid !== ADMIN_UID) return;

  const username = $("adminSearch")
    .value.trim()
    .toLowerCase()
    .replace(/^@/, "");

  if (!username) {
    return toast("Masukkan username.");
  }

  try {
    const usernameSnap = await getDoc(
      doc(db, "usernames", username)
    );

    if (!usernameSnap.exists()) {
      throw Error("Pengguna tidak ditemukan.");
    }

    const uid = usernameSnap.data().uid;

    const profileSnap = await getDoc(
      doc(db, "users", uid)
    );

    if (!profileSnap.exists()) {
      throw Error("Profil tidak ditemukan.");
    }

    const data = profileSnap.data();

    const element = $("adminUserResult");

    element.innerHTML = `
      <div class="admin-user-card">

        <strong>${esc(data.name)}</strong>

        <span>@${esc(data.username)}</span>

        <span>${esc(data.email || "")}</span>

        <span>Status: ${esc(data.status || "active")}</span>

        <div class="admin-user-actions">
          <button data-status="hold">Tahan akun</button>
          <button data-status="active">Aktifkan</button>
          <button data-status="permanent">Nonaktifkan permanen</button>
          <button data-status="recovered">Pulihkan</button>
        </div>

      </div>
    `;

    element.querySelectorAll("[data-status]").forEach(button => {
      button.onclick = () => {
        updateUserStatus(
          uid,
          button.dataset.status
        );
      };
    });
  } catch (error) {
    toast(error.message);
  }
});

async function updateUserStatus(uid, status) {
  if (user?.uid !== ADMIN_UID) return;

  const allowed = [
    "active",
    "hold",
    "permanent",
    "recovered"
  ];

  if (!allowed.includes(status)) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: user.uid
    });

    toast("Status akun diperbarui.");
  } catch (error) {
    toast("Gagal memperbarui: " + error.message);
  }
}

async function loadAppeals() {
  if (user?.uid !== ADMIN_UID) return;

  const element = $("appealList");

  element.textContent = "Memuat...";

  try {
    const results = await getDocs(
      query(
        collection(db, "appeals"),
        where("status", "==", "pending"),
        orderBy("createdAt", "desc"),
        limit(50)
      )
    );

    element.innerHTML = "";

    if (results.empty) {
      element.textContent = "Tidak ada pengajuan baru.";
      return;
    }

    results.forEach(document => {
      const data = document.data();

      const card = document.createElement("div");

      card.className = "appeal-card";

      card.innerHTML = `
        <strong>@${esc(data.username || "pengguna")}</strong>
        <p>${esc(data.message || "")}</p>
        <button type="button">Tandai selesai</button>
      `;

      card.querySelector("button").onclick = async () => {
        try {
          await updateDoc(document.ref, {
            status: "reviewed",
            reviewedBy: user.uid,
            reviewedAt: serverTimestamp()
          });

          card.remove();
        } catch (error) {
          toast(error.message);
        }
      };

      element.append(card);
    });
  } catch (error) {
    element.textContent =
      "Gagal memuat pengajuan: " + error.message;
  }
}

/* =========================================
   AUTH STATE
========================================= */

onAuthStateChanged(auth, async currentUser => {
  clearListeners();

  user = currentUser;

  profile = null;
  activeId = null;
  activeType = null;

  if (!currentUser) {
    showAuth();
    hide($("phoneProfileModal"));
    return;
  }

  try {
    let profileSnap = await getDoc(
      doc(db, "users", currentUser.uid)
    );

    if (!profileSnap.exists() && currentUser.phoneNumber) {
      const completed = await ensurePhoneProfile(currentUser);

      if (!completed) return;

      profileSnap = await getDoc(
        doc(db, "users", currentUser.uid)
      );
    }

    if (!profileSnap.exists()) {
      throw Error(
        "Data profil tidak ditemukan. Silakan hubungi admin."
      );
    }

    profile = {
      uid: currentUser.uid,
      ...profileSnap.data()
    };

    const status = profile.status || "active";

    if (status !== "active") {
      showAccountStatus(status);
      return;
    }

    showApp();

    renderProfile();

    setupPresence();

    listenChats();
    listenGroups();
    listenChannels();
    listenStatuses();

    openPage("chatsPage");
  } catch (error) {
    console.error("Auth state", error);

    showAuth();

    toast("Gagal memuat akun: " + error.message);
  }
});

console.log("ZORAAPP initialized");
