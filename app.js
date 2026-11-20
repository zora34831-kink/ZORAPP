
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
  PhoneAuthProvider,
  linkWithCredential
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
  arrayUnion,
  arrayRemove
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


/* ==================================================
   CONFIGURATION
================================================== */

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MESSAGE_LIMIT = 100;

let currentUser = null;
let currentProfile = null;
let activeConversation = null;
let activeConversationType = null;

let confirmationResult = null;
let recaptchaVerifier = null;
let linkConfirmation = null;
let linkRecaptcha = null;

let listeners = [];
let presenceListener = null;
let typingTimer = null;
let toastTimer = null;
let busy = false;


/* ==================================================
   DOM HELPERS
================================================== */

const $ = id => document.getElementById(id);

function on(id, event, callback) {
  $(id)?.addEventListener(event, callback);
}

function show(element) {
  if (element) element.hidden = false;
}

function hide(element) {
  if (element) element.hidden = true;
}

function errorText(id, message = "") {
  if ($(id)) $(id).textContent = message;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toast(message) {
  const element = $("toast");
  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 2800);
}

function setBusy(button, state, text) {
  if (!button) return;

  button.disabled = state;

  if (state) {
    button.dataset.oldText = button.textContent;
    button.textContent = text || "MEMPROSES...";
  } else {
    button.textContent = button.dataset.oldText || text || "LANJUTKAN";
  }
}


/* ==================================================
   AUTH SCREEN
================================================== */

function showAuth() {
  show($("authScreen"));
  hide($("appScreen"));
}

function showApp() {
  hide($("authScreen"));
  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));
  show($("appScreen"));
}

function switchLoginTab(type) {
  const email = type === "email";

  $("emailLoginPanel").hidden = !email;
  $("phoneLoginPanel").hidden = email;

  $("emailLoginTab").classList.toggle("active", email);
  $("phoneLoginTab").classList.toggle("active", !email);

  errorText("authError");
}

on("emailLoginTab", "click", () => switchLoginTab("email"));
on("phoneLoginTab", "click", () => switchLoginTab("phone"));


/* ==================================================
   EMAIL LOGIN
================================================== */

async function handleLogin() {
  if (busy) return;

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    errorText("authError", "Masukkan email dan password.");
    return;
  }

  busy = true;
  setBusy($("loginBtn"), true, "SEDANG MASUK...");
  errorText("authError");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error("Login error:", error);
    errorText("authError", authErrorMessage(error));
  } finally {
    busy = false;
    setBusy($("loginBtn"), false);
  }
}

on("loginBtn", "click", handleLogin);


/* ==================================================
   AUTH ERROR MESSAGES
================================================== */

function authErrorMessage(error) {
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
    "auth/quota-exceeded": "Kuota SMS Firebase sudah tercapai.",
    "auth/captcha-check-failed": "Verifikasi reCAPTCHA gagal.",
    "auth/invalid-verification-code": "Kode OTP salah.",
    "auth/code-expired": "Kode OTP kedaluwarsa.",
    "auth/session-expired": "Sesi OTP berakhir. Kirim kode kembali.",
    "auth/credential-already-in-use": "Nomor HP sudah terhubung ke akun lain.",
    "auth/provider-already-linked": "Nomor HP sudah terhubung.",
    "auth/operation-not-supported-in-this-environment": "Operasi tidak didukung pada lingkungan ini."
  };

  return messages[error?.code] || error?.message || "Terjadi kesalahan.";
}


/* ==================================================
   REGISTRATION
================================================== */

async function handleRegister() {
  if (busy) return;

  const name = $("authName").value.trim();
  const username = $("registerUsername").value.trim().toLowerCase();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;

  if (!name || !username || !email || !password) {
    errorText("registerError", "Lengkapi semua kolom.");
    return;
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    errorText("registerError", "Username 3–20 karakter, hanya huruf, angka, dan underscore.");
    return;
  }

  if (password.length < 8) {
    errorText("registerError", "Password minimal 8 karakter.");
    return;
  }

  busy = true;
  setBusy($("registerBtn"), true, "MEMBUAT AKUN...");
  errorText("registerError");

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
      const userRef = doc(db, "users", createdUser.uid);

      const usernameSnap = await transaction.get(usernameRef);

      if (usernameSnap.exists()) {
        throw new Error("Username sudah digunakan.");
      }

      transaction.set(usernameRef, {
        uid: createdUser.uid,
        username,
        createdAt: serverTimestamp()
      });

      transaction.set(userRef, {
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
    console.error("Registration error:", error);

    if (createdUser) {
      try {
        await signOut(auth);
      } catch {}
    }

    errorText("registerError", error.message || authErrorMessage(error));

  } finally {
    busy = false;
    setBusy($("registerBtn"), false);
  }
}

on("registerBtn", "click", handleRegister);


/* ==================================================
   PASSWORD RESET
================================================== */

on("forgotPassword", "click", async () => {
  const email = $("authEmail").value.trim();

  if (!email) {
    errorText("authError", "Masukkan email terlebih dahulu.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password dikirim ke email.");
  } catch (error) {
    errorText("authError", authErrorMessage(error));
  }
});


/* ==================================================
   PHONE OTP LOGIN
================================================== */

function normalizePhone(value) {
  let phone = String(value || "").replace(/[\s()-]/g, "");

  if (phone.startsWith("08")) {
    phone = "+62" + phone.slice(1);
  } else if (phone.startsWith("8")) {
    phone = "+62" + phone;
  }

  return phone;
}

function resetRecaptcha() {
  try {
    recaptchaVerifier?.clear();
  } catch (error) {
    console.warn(error);
  }

  recaptchaVerifier = null;
}

function createRecaptcha(container) {
  return new RecaptchaVerifier(auth, container, {
    size: "normal",
    callback: () => {
      console.log("reCAPTCHA verified");
    },
    "expired-callback": () => {
      toast("reCAPTCHA kedaluwarsa. Silakan coba lagi.");
    }
  });
}

async function sendPhoneOtp() {
  if (busy) return;

  const phone = normalizePhone($("phoneNumber").value);

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    errorText("authError", "Gunakan format nomor internasional, contoh +6281234567890.");
    return;
  }

  busy = true;
  setBusy($("sendPhoneOtp"), true, "MENGIRIM SMS...");
  errorText("authError");

  try {
    resetRecaptcha();

    recaptchaVerifier = createRecaptcha("recaptcha-container");

    confirmationResult = await signInWithPhoneNumber(
      auth,
      phone,
      recaptchaVerifier
    );

    $("phoneNumber").readOnly = true;
    show($("otpPanel"));

    toast("Kode OTP dikirim melalui SMS.");

  } catch (error) {
    console.error("OTP send error:", error);
    resetRecaptcha();
    errorText("authError", authErrorMessage(error));

  } finally {
    busy = false;
    setBusy($("sendPhoneOtp"), false);
  }
}

on("sendPhoneOtp", "click", sendPhoneOtp);


/* ==================================================
   PHONE PROFILE CREATION
================================================== */

let pendingPhoneUser = null;

async function ensurePhoneProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  if (snapshot.exists()) {
    return snapshot.data();
  }

  pendingPhoneUser = user;

  show($("authScreen"));
  show($("phoneProfileModal"));

  return new Promise((resolve, reject) => {
    const button = $("completePhoneProfile");

    const handler = async () => {
      if (busy) return;

      const name = $("phoneProfileName").value.trim();
      const username = $("phoneProfileUsername").value.trim().toLowerCase();

      if (!name || !/^[a-z0-9_]{3,20}$/.test(username)) {
        errorText("phoneProfileError", "Nama dan username valid wajib diisi.");
        return;
      }

      busy = true;
      setBusy(button, true, "MENYIMPAN...");

      try {
        await runTransaction(db, async transaction => {
          const usernameRef = doc(db, "usernames", username);
          const usernameSnap = await transaction.get(usernameRef);

          if (usernameSnap.exists()) {
            throw new Error("Username sudah digunakan.");
          }

          transaction.set(usernameRef, {
            uid: user.uid,
            username,
            createdAt: serverTimestamp()
          });

          transaction.set(userRef, {
            uid: user.uid,
            name,
            username,
            email: user.email || "",
            phoneNumber: user.phoneNumber || "",
            bio: "",
            photoURL: "",
            createdAt: serverTimestamp(),
            status: "active",
            verified: false,
            role: "user"
          });
        });

        await updateProfile(user, {
          displayName: name
        });

        hide($("phoneProfileModal"));
        pendingPhoneUser = null;

        resolve(true);

      } catch (error) {
        errorText("phoneProfileError", error.message);
        reject(error);

      } finally {
        busy = false;
        setBusy(button, false);
      }
    };

    button.onclick = handler;
  });
}


/* ==================================================
   VERIFY PHONE OTP
================================================== */

async function verifyPhoneOtp() {
  if (!confirmationResult || busy) return;

  const code = $("phoneOtp").value.trim();

  if (!/^\d{6}$/.test(code)) {
    errorText("authError", "Masukkan kode OTP 6 digit.");
    return;
  }

  busy = true;
  setBusy($("verifyPhoneOtp"), true, "MEMVERIFIKASI...");
  errorText("authError");

  try {
    const result = await confirmationResult.confirm(code);

    const profileRef = doc(db, "users", result.user.uid);
const profileSnap = await getDoc(profileRef);

if (!profileSnap.exists()) {
  await ensurePhoneProfile(result.user);
}

    confirmationResult = null;
    resetRecaptcha();

    toast("Nomor HP berhasil diverifikasi.");

  } catch (error) {
    console.error("OTP verification error:", error);
    errorText("authError", authErrorMessage(error));

  } finally {
    busy = false;
    setBusy($("verifyPhoneOtp"), false);
  }
}

on("verifyPhoneOtp", "click", verifyPhoneOtp);


/* ==================================================
   RESEND OTP
================================================== */

on("resendPhoneOtp", "click", async () => {
  $("phoneNumber").readOnly = false;
  $("phoneOtp").value = "";

  hide($("otpPanel"));

  confirmationResult = null;
  resetRecaptcha();

  await sendPhoneOtp();
});


/* ==================================================
   PROFILE
================================================== */

async function loadProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));

  if (!snapshot.exists()) {
    throw new Error("Profil pengguna belum tersedia.");
  }

  currentProfile = {
    uid,
    ...snapshot.data()
  };

  return currentProfile;
}

function renderProfile() {
  if (!currentProfile) return;

  const name = currentProfile.name || "Pengguna";
  const username = currentProfile.username || "";
  const photo = currentProfile.photoURL || "";

  $("myName").textContent = name;
  $("myEmail").textContent = currentProfile.email || "";
  $("myPhone").textContent = currentProfile.phoneNumber || "";

  $("myAvatar").textContent = name.charAt(0).toUpperCase();
  $("chatAvatar").textContent = name.charAt(0).toUpperCase();

  if (photo) {
    $("myAvatar").style.backgroundImage = `url("${photo}")`;
    $("myAvatar").classList.add("has-photo");
  }

  $("openAdmin").hidden = currentUser.uid !== ADMIN_UID;

  $("profileName").value = name;
  $("profileUsername").value = username;
  $("profileBio").value = currentProfile.bio || "";

  $("profilePhotoPreview").textContent = name.charAt(0).toUpperCase();
  $("profilePhotoPreview").style.backgroundImage = photo
    ? `url("${photo}")`
    : "none";
}


/* ==================================================
   PROFILE MODAL
================================================== */

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

async function uploadImage(file, folder) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Ukuran gambar maksimal 5 MB.");
  }

  const path = `${folder}/${currentUser.uid}/${Date.now()}_${file.name}`;
  const imageRef = storageRef(storage, path);

  await uploadBytes(imageRef, file);

  return await getDownloadURL(imageRef);
}

on("profilePhotoInput", "change", event => {
  const file = event.target.files?.[0];
  if (!file) return;

  $("profilePhotoPreview").style.backgroundImage =
    `url("${URL.createObjectURL(file)}")`;

  $("profilePhotoPreview").textContent = "";
});

on("saveProfile", "click", async () => {
  if (busy) return;

  const name = $("profileName").value.trim();
  const bio = $("profileBio").value.trim();

  if (!name) {
    toast("Nama tidak boleh kosong.");
    return;
  }

  busy = true;
  setBusy($("saveProfile"), true, "MENYIMPAN...");

  try {
    let photoURL = currentProfile.photoURL || "";

    const file = $("profilePhotoInput").files?.[0];

    if (file) {
      photoURL = await uploadImage(file, "profiles");
    }

    await updateDoc(doc(db, "users", currentUser.uid), {
      name,
      bio,
      photoURL,
      updatedAt: serverTimestamp()
    });

    await updateProfile(currentUser, {
      displayName: name,
      photoURL
    });

    await loadProfile(currentUser.uid);
    renderProfile();

    hide($("profileModal"));
    toast("Profil berhasil diperbarui.");

  } catch (error) {
    console.error(error);
    toast(error.message);

  } finally {
    busy = false;
    setBusy($("saveProfile"), false);
  }
});


/* ==================================================
   PHONE NUMBER LINKING
================================================== */

on("linkPhoneBtn", "click", () => {
  show($("linkPhoneModal"));
});

function resetLinkRecaptcha() {
  try {
    linkRecaptcha?.clear();
  } catch {}

  linkRecaptcha = null;
}

on("sendLinkPhoneOtp", "click", async () => {
  const phone = normalizePhone($("linkPhoneNumber").value);

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    errorText("linkPhoneError", "Nomor HP tidak valid.");
    return;
  }

  try {
    resetLinkRecaptcha();

    linkRecaptcha = createRecaptcha("link-recaptcha-container");

    linkConfirmation = await signInWithPhoneNumber(
      auth,
      phone,
      linkRecaptcha
    );

    show($("linkPhoneOtpPanel"));

    toast("SMS OTP dikirim.");

  } catch (error) {
    errorText("linkPhoneError", authErrorMessage(error));
    resetLinkRecaptcha();
  }
});

on("verifyLinkPhoneOtp", "click", async () => {
  if (!linkConfirmation) return;

  const code = $("linkPhoneOtp").value.trim();

  if (!/^\d{6}$/.test(code)) {
    errorText("linkPhoneError", "Kode OTP harus 6 digit.");
    return;
  }

  try {
    /*
      Untuk menautkan nomor HP ke akun yang sedang login,
      gunakan PhoneAuthProvider dan linkWithCredential.
    */

    const verificationId = linkConfirmation.verificationId;

    const credential = PhoneAuthProvider.credential(
      verificationId,
      code
    );

    await linkWithCredential(currentUser, credential);

    await updateDoc(doc(db, "users", currentUser.uid), {
      phoneNumber: currentUser.phoneNumber || "",
      updatedAt: serverTimestamp()
    });

    await loadProfile(currentUser.uid);
    renderProfile();

    hide($("linkPhoneModal"));

    toast("Nomor HP berhasil ditautkan.");

  } catch (error) {
    console.error(error);
    errorText("linkPhoneError", authErrorMessage(error));
  }
});


/* ==================================================
   LOGOUT
================================================== */

async function logout() {
  try {
    clearListeners();
    await signOut(auth);

    currentUser = null;
    currentProfile = null;

    showAuth();

  } catch (error) {
    toast(error.message);
  }
}

on("logoutBtn", "click", logout);
on("settingsLogoutBtn", "click", logout);
on("logoutHold", "click", logout);
on("logoutRecovered", "click", logout);
on("newAccountBtn", "click", logout);


/* ==================================================
   LISTENER MANAGEMENT
================================================== */

function addListener(unsubscribe) {
  if (typeof unsubscribe === "function") {
    listeners.push(unsubscribe);
  }
}

function clearListeners() {
  listeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn("Listener cleanup:", error);
    }
  });

  listeners = [];

  if (presenceListener) {
    presenceListener();
    presenceListener = null;
  }

  if (currentUser) {
    remove(dbRef(rtdb, `status/${currentUser.uid}/typing`))
      .catch(() => {});
  }
}


/* ==================================================
   NAVIGATION
================================================== */

function openPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== pageId;
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-button[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (window.innerWidth <= 800) {
    hide($("chatPanel"));
    show($("emptyChat"));
  }
}

document.querySelectorAll(".nav-button[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

on("themeBtn", "click", toggleTheme);
on("settingsThemeBtn", "click", toggleTheme);

function toggleTheme() {
  const light = document.body.classList.toggle("theme-light");

  document.body.classList.toggle("theme-dark", !light);

  localStorage.setItem("zora-theme", light ? "light" : "dark");
}

(function restoreTheme() {
  const theme = localStorage.getItem("zora-theme");

  if (theme === "light") {
    document.body.classList.add("theme-light");
    document.body.classList.remove("theme-dark");
  }
})();


/* ==================================================
   AVATAR HELPERS
================================================== */

function avatarHTML(name, photoURL = "") {
  const safeName = escapeHTML(name || "U");

  if (photoURL) {
    return `
      <div class="avatar avatar-image">
        <img src="${escapeHTML(photoURL)}" alt="${safeName}">
      </div>
    `;
  }

  return `
    <div class="avatar">
      ${safeName.charAt(0).toUpperCase()}
    </div>
  `;
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

function formatLastSeen(timestamp) {
  if (!timestamp) return "Terakhir dilihat tidak diketahui";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  return "Terakhir dilihat " + date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}


/* ==================================================
   PRIVATE CHAT
================================================== */

function makeChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

async function startPrivateChat(targetUid) {
  if (!currentUser || targetUid === currentUser.uid) return;

  try {
    const targetSnap = await getDoc(doc(db, "users", targetUid));

    if (!targetSnap.exists()) {
      toast("Pengguna tidak ditemukan.");
      return;
    }

    const target = targetSnap.data();

    const chatId = makeChatId(currentUser.uid, targetUid);
    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        members: [currentUser.uid, targetUid].sort(),
        memberNames: {
          [currentUser.uid]: currentProfile.name,
          [targetUid]: target.name
        },
        type: "private",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: ""
      });
    }

    openConversation(chatId, "private", {
      name: target.name,
      photoURL: target.photoURL || "",
      uid: targetUid
    });

    openPage("chatsPage");

  } catch (error) {
    console.error("Start chat:", error);
    toast("Gagal membuka chat: " + error.message);
  }
}

function listenChats() {
  if (!currentUser) return;

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, async snapshot => {
    const list = $("chatList");
    if (!list) return;

    list.innerHTML = "";

    if (snapshot.empty) {
      list.innerHTML = `
        <div class="empty-list">
          Belum ada percakapan.
        </div>
      `;
      return;
    }

    const items = [];

    for (const item of snapshot.docs) {
      const data = item.data();

      const otherUid = (data.members || []).find(
        uid => uid !== currentUser.uid
      );

      if (!otherUid) continue;

      let other = data.memberNames?.[otherUid]
        ? { name: data.memberNames[otherUid] }
        : null;

      try {
        const userSnap = await getDoc(doc(db, "users", otherUid));

        if (userSnap.exists()) {
          other = userSnap.data();
        }
      } catch (error) {
        console.warn("Profile lookup:", error);
      }

      items.push({
        id: item.id,
        data,
        user: other || { name: "Pengguna" }
      });
    }

    list.innerHTML = "";

    items.sort((a, b) => {
      const at = a.data.updatedAt?.toMillis?.() || 0;
      const bt = b.data.updatedAt?.toMillis?.() || 0;
      return bt - at;
    });

    items.forEach(item => {
      const user = item.user;

      const button = document.createElement("button");
      button.className = "list-item";
      button.type = "button";

      button.innerHTML = `
        ${avatarHTML(user.name, user.photoURL)}
        <div class="list-item-info">
          <strong>${escapeHTML(user.name)}</strong>
          <small>${escapeHTML(item.data.lastMessage || "Mulai percakapan")}</small>
        </div>
        <span class="list-item-time">
          ${formatTime(item.data.updatedAt)}
        </span>
      `;

      button.addEventListener("click", () => {
        openConversation(item.id, "private", {
          ...user,
          uid: (item.data.members || []).find(
            uid => uid !== currentUser.uid
          )
        });
      });

      list.appendChild(button);
    });

  }, error => {
    console.error("Chat listener:", error);
    toast("Gagal memuat chat: " + error.message);
  });

  addListener(unsubscribe);
}


/* ==================================================
   OPEN CONVERSATION
================================================== */

function openConversation(id, type, info = {}) {
  activeConversation = id;
  activeConversationType = type;

  hide($("emptyChat"));
  show($("chatPanel"));

  $("chatName").textContent = info.name || "Percakapan";
  $("chatAvatar").textContent =
    (info.name || "U").charAt(0).toUpperCase();

  $("chatAvatar").style.backgroundImage = info.photoURL
    ? `url("${info.photoURL}")`
    : "none";

  $("messages").innerHTML = `
    <div class="empty-list">Memuat pesan...</div>
  `;

  $("channelControls").innerHTML = "";
  $("channelComposer").hidden = true;
  $("composer").hidden = false;

  $("messageInput").disabled = false;
  $("sendBtn").disabled = false;

  $("inviteGroupMember").hidden = type !== "group";

  if (type === "channel") {
    $("composer").hidden = true;
    $("channelComposer").hidden = !info.isOwner;

    $("channelControls").innerHTML = `
      <div class="channel-member-info">
        ${Number(info.followers || 0)} PENGIKUT
      </div>
    `;
  }

  listenMessages(id, type);

  if (type === "private" || type === "group") {
    listenTyping(id, type);
  }

  if (type === "private" && info.uid) {
    listenChatPresence(info.uid);
  } else {
    $("chatPresence").textContent = "";
  }

  if (window.innerWidth <= 800) {
    document.querySelector(".content-area").classList.add("mobile-hidden");
  }
}

on("backToChats", "click", () => {
  hide($("chatPanel"));
  show($("emptyChat"));

  document.querySelector(".content-area")
    ?.classList.remove("mobile-hidden");

  activeConversation = null;
  activeConversationType = null;
});


/* ==================================================
   MESSAGE COLLECTION
================================================== */

function messageCollection(id, type) {
  if (type === "group") {
    return collection(db, "groups", id, "messages");
  }

  if (type === "channel") {
    return collection(db, "channels", id, "posts");
  }

  return collection(db, "chats", id, "messages");
}

function listenMessages(id, type) {
  const messagesRef = messageCollection(id, type);

  const q = query(
    messagesRef,
    orderBy("createdAt", "asc"),
    limit(MESSAGE_LIMIT)
  );

  const unsubscribe = onSnapshot(q, snapshot => {
    if (activeConversation !== id) return;

    const container = $("messages");
    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-list">
          Belum ada pesan. Mulai percakapan!
        </div>
      `;
      return;
    }

    snapshot.forEach(item => {
      const data = item.data();
      const own = data.senderId === currentUser.uid;

      const message = document.createElement("article");
      message.className = own
        ? "message own-message"
        : "message";

      const text = escapeHTML(data.text || "");

      const image = data.imageURL
        ? `<img class="message-image" src="${escapeHTML(data.imageURL)}" alt="Gambar pesan">`
        : "";

      const reactions = renderReactions(data.reactions || {});

      message.innerHTML = `
        <div class="message-content">
          ${!own && type !== "private"
            ? `<small>${escapeHTML(data.senderName || "Pengguna")}</small>`
            : ""}
          ${text ? `<p>${text}</p>` : ""}
          ${image}
          <div class="message-meta">
            <time>${formatTime(data.createdAt)}</time>
          </div>
          ${reactions}
          <button
            class="reaction-button"
            data-reaction-id="${item.id}"
            type="button"
          >+ Reaksi</button>
        </div>
      `;

      const reactionButton = message.querySelector(".reaction-button");

      reactionButton?.addEventListener("click", () => {
        reactToMessage(id, type, item.id);
      });

      container.appendChild(message);
    });

    container.scrollTop = container.scrollHeight;

    if (type !== "channel") {
      markMessagesRead(id, type, snapshot.docs);
    }

  }, error => {
    console.error("Message listener:", error);
    toast("Gagal memuat pesan: " + error.message);
  });

  addListener(unsubscribe);
}


/* ==================================================
   SEND MESSAGE
================================================== */

async function sendMessage() {
  if (!activeConversation || !currentUser || busy) return;

  const text = $("messageInput").value.trim();

  if (!text) return;

  if (activeConversationType === "channel") {
    toast("Gunakan fitur postingan saluran.");
    return;
  }

  busy = true;
  $("sendBtn").disabled = true;

  try {
    const chatId = activeConversation;
    const type = activeConversationType;

    const collectionRef = messageCollection(chatId, type);

    await addDoc(collectionRef, {
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text,
      imageURL: "",
      reactions: {},
      readBy: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    const parent = doc(
      db,
      type === "group" ? "groups" : "chats",
      chatId
    );

    await updateDoc(parent, {
      lastMessage: text.slice(0, 100),
      updatedAt: serverTimestamp()
    });

    $("messageInput").value = "";

    stopTyping(chatId);

  } catch (error) {
    console.error("Send message:", error);
    toast("Pesan gagal dikirim: " + error.message);

  } finally {
    busy = false;
    $("sendBtn").disabled = false;
  }
}

on("sendBtn", "click", sendMessage);

on("messageInput", "keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});


/* ==================================================
   SEND IMAGE MESSAGE
================================================== */

on("imageInput", "change", async event => {
  const file = event.target.files?.[0];

  if (!file || !activeConversation) return;

  if (activeConversationType === "channel") {
    toast("Gunakan unggahan saluran.");
    event.target.value = "";
    return;
  }

  try {
    busy = true;

    const imageURL = await uploadImage(file, "messages");

    const type = activeConversationType;
    const id = activeConversation;

    await addDoc(messageCollection(id, type), {
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text: "",
      imageURL,
      reactions: {},
      readBy: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    await updateDoc(
      doc(db, type === "group" ? "groups" : "chats", id),
      {
        lastMessage: "Mengirim gambar",
        updatedAt: serverTimestamp()
      }
    );

    toast("Gambar berhasil dikirim.");

  } catch (error) {
    console.error(error);
    toast("Gagal mengirim gambar: " + error.message);

  } finally {
    busy = false;
    event.target.value = "";
  }
});


/* ==================================================
   READ RECEIPTS
================================================== */

async function markMessagesRead(id, type, messages) {
  const unread = messages.filter(message => {
    const data = message.data();

    return data.senderId !== currentUser.uid &&
      !(data.readBy || []).includes(currentUser.uid);
  });

  for (const message of unread) {
    try {
      await updateDoc(
        doc(messageCollection(id, type), message.id),
        {
          readBy: arrayUnion(currentUser.uid)
        }
      );
    } catch (error) {
      console.warn("Read receipt:", error);
    }
  }
}


/* ==================================================
   MESSAGE REACTIONS
================================================== */

function renderReactions(reactions) {
  const entries = Object.entries(reactions || {});

  if (!entries.length) return "";

  return `
    <div class="reaction-list">
      ${entries.map(([emoji, users]) => `
        <span class="reaction-chip">
          ${escapeHTML(emoji)} ${Array.isArray(users) ? users.length : 0}
        </span>
      `).join("")}
    </div>
  `;
}

async function reactToMessage(parentId, type, messageId) {
  const choices = ["👍", "❤️", "😂", "😮", "👏"];

  const selected = prompt(
    "Pilih reaksi:\n1. 👍\n2. ❤️\n3. 😂\n4. 😮\n5. 👏"
  );

  const index = Number(selected) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    return;
  }

  const emoji = choices[index];

  try {
    const messageRef = doc(
      messageCollection(parentId, type),
      messageId
    );

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(messageRef);

      if (!snapshot.exists()) return;

      const data = snapshot.data();
      const reactions = data.reactions || {};
      const users = reactions[emoji] || [];

      reactions[emoji] = users.includes(currentUser.uid)
        ? users.filter(uid => uid !== currentUser.uid)
        : [...users, currentUser.uid];

      transaction.update(messageRef, {
        reactions
      });
    });

  } catch (error) {
    toast("Gagal memberikan reaksi: " + error.message);
  }
}


/* ==================================================
   TYPING INDICATOR
================================================== */

function typingPath(id, type, uid) {
  return `typing/${type}/${id}/${uid}`;
}

async function updateTyping(id, type) {
  if (!currentUser) return;

  try {
    const path = dbRef(
      rtdb,
      typingPath(id, type, currentUser.uid)
    );

    await set(path, {
      name: currentProfile.name,
      typing: true,
      updatedAt: rtdbTimestamp()
    });

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      stopTyping(id, type);
    }, 2500);

  } catch (error) {
    console.warn("Typing:", error);
  }
}

async function stopTyping(id, type = activeConversationType) {
  if (!currentUser || !id || !type) return;

  try {
    await remove(
      dbRef(rtdb, typingPath(id, type, currentUser.uid))
    );
  } catch {}
}

function listenTyping(id, type) {
  const path = dbRef(rtdb, `typing/${type}/${id}`);

  const unsubscribe = onValue(path, snapshot => {
    const values = snapshot.val() || {};

    const other = Object.entries(values).find(([uid, data]) =>
      uid !== currentUser.uid && data?.typing
    );

    $("typingIndicator").textContent = other
      ? `${other[1].name || "Pengguna"} sedang mengetik...`
      : "";
  });

  addListener(unsubscribe);
}

on("messageInput", "input", () => {
  if (
    activeConversation &&
    ["private", "group"].includes(activeConversationType)
  ) {
    updateTyping(activeConversation, activeConversationType);
  }
});


/* ==================================================
   GROUPS
================================================== */

function listenGroups() {
  if (!currentUser) return;

  const q = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(q, snapshot => {
    const container = $("groupList");
    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-list">
          Kamu belum bergabung dengan grup.
        </div>
      `;
      return;
    }

    snapshot.forEach(item => {
      const data = item.data();

      const button = document.createElement("button");
      button.className = "list-item";
      button.type = "button";

      button.innerHTML = `
        <div class="avatar">
          ${escapeHTML((data.name || "G").charAt(0).toUpperCase())}
        </div>
        <div class="list-item-info">
          <strong>${escapeHTML(data.name || "Grup")}</strong>
          <small>${(data.members || []).length} anggota</small>
        </div>
      `;

      button.addEventListener("click", () => {
        openConversation(item.id, "group", {
          name: data.name
        });
      });

      container.appendChild(button);
    });

  }, error => {
    console.error("Group listener:", error);
    toast("Gagal memuat grup: " + error.message);
  });

  addListener(unsubscribe);
}


/* ==================================================
   CREATE GROUP
================================================== */

on("createGroupBtn", "click", async () => {
  const name = prompt("Masukkan nama grup:");

  if (!name?.trim()) return;

  try {
    const groupRef = await addDoc(collection(db, "groups"), {
      name: name.trim(),
      ownerId: currentUser.uid,
      members: [currentUser.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: ""
    });

    toast("Grup berhasil dibuat.");

    openConversation(groupRef.id, "group", {
      name: name.trim()
    });

  } catch (error) {
    console.error(error);
    toast("Gagal membuat grup: " + error.message);
  }
});


/* ==================================================
   INVITE GROUP MEMBER
================================================== */

on("inviteGroupMember", "click", async () => {
  if (activeConversationType !== "group") return;

  const username = prompt("Masukkan username anggota:");

  if (!username?.trim()) return;

  try {
    const usernameRef = doc(
      db,
      "usernames",
      username.trim().toLowerCase()
    );

    const usernameSnap = await getDoc(usernameRef);

    if (!usernameSnap.exists()) {
      toast("Username tidak ditemukan.")
