
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
let conversationListeners = [];
let presenceListener = null;
let typingTimer = null;
let toastTimer = null;
let searchDelay = null;

let busy = false;
let pendingProfilePromise = null;


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
    if (!button.dataset.oldText) {
      button.dataset.oldText = button.textContent;
    }

    button.textContent = text || "MEMPROSES...";
  } else {
    button.textContent = button.dataset.oldText || text || "LANJUTKAN";
    delete button.dataset.oldText;
  }
}

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
    "auth/invalid-verification-id": "Sesi verifikasi tidak valid."
  };

  return messages[error?.code] || error?.message || "Terjadi kesalahan.";
}


/* ==================================================
   AUTH SCREEN
================================================== */

function showAuth() {
  show($("authScreen"));
  hide($("appScreen"));
  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));
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

  if ($("emailLoginPanel")) {
    $("emailLoginPanel").hidden = !email;
  }

  if ($("phoneLoginPanel")) {
    $("phoneLoginPanel").hidden = email;
  }

  $("emailLoginTab")?.classList.toggle("active", email);
  $("phoneLoginTab")?.classList.toggle("active", !email);

  errorText("authError");
}

on("emailLoginTab", "click", () => switchLoginTab("email"));
on("phoneLoginTab", "click", () => switchLoginTab("phone"));


/* ==================================================
   EMAIL LOGIN
================================================== */

async function handleLogin() {
  if (busy) return;

  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

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
   REGISTRATION
================================================== */

async function handleRegister() {
  if (busy) return;

  const name = $("authName")?.value.trim();
  const username = $("registerUsername")?.value.trim().toLowerCase();
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value;

  if (!name || !username || !email || !password) {
    errorText("registerError", "Lengkapi semua kolom.");
    return;
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    errorText(
      "registerError",
      "Username 3–20 karakter, hanya huruf, angka, dan underscore."
    );
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
      } catch (signOutError) {
        console.warn("Sign out after registration error:", signOutError);
      }
    }

    errorText(
      "registerError",
      error.message || authErrorMessage(error)
    );

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
  const email = $("authEmail")?.value.trim();

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
   PHONE NUMBER HELPERS
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
    console.warn("reCAPTCHA cleanup:", error);
  }

  recaptchaVerifier = null;
}

function resetLinkRecaptcha() {
  try {
    linkRecaptcha?.clear();
  } catch (error) {
    console.warn("Link reCAPTCHA cleanup:", error);
  }

  linkRecaptcha = null;
}

function createRecaptcha(containerId) {
  const container = $(containerId);

  if (!container) {
    throw new Error(`Elemen ${containerId} tidak ditemukan di HTML.`);
  }

  return new RecaptchaVerifier(auth, containerId, {
    size: "normal",
    callback: () => {
      console.log("reCAPTCHA verified");
    },
    "expired-callback": () => {
      toast("reCAPTCHA kedaluwarsa. Silakan coba lagi.");
    }
  });
}


/* ==================================================
   PHONE OTP LOGIN
================================================== */

async function sendPhoneOtp() {
  if (busy) return;

  const phone = normalizePhone($("phoneNumber")?.value);

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    errorText(
      "authError",
      "Gunakan format nomor internasional, contoh +6281234567890."
    );
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
    confirmationResult = null;

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

function ensurePhoneProfile(user) {
  if (pendingProfilePromise) {
    return pendingProfilePromise;
  }

  pendingPhoneUser = user;

  pendingProfilePromise = new Promise(resolve => {
    const modal = $("phoneProfileModal");
    const button = $("completePhoneProfile");

    if (!modal || !button) {
      pendingProfilePromise = null;
      resolve(false);
      throw new Error("Modal profil nomor HP tidak ditemukan di HTML.");
    }

    show($("authScreen"));
    show(modal);

    errorText("phoneProfileError");

    button.onclick = async () => {
      if (busy) return;

      const name = $("phoneProfileName")?.value.trim();
      const username = $("phoneProfileUsername")?.value.trim().toLowerCase();

      if (!name || !/^[a-z0-9_]{3,20}$/.test(username || "")) {
        errorText(
          "phoneProfileError",
          "Isi nama dan username 3–20 karakter (huruf, angka, underscore)."
        );
        return;
      }

      busy = true;
      setBusy(button, true, "MENYIMPAN...");
      errorText("phoneProfileError");

      try {
        await runTransaction(db, async transaction => {
          const usernameRef = doc(db, "usernames", username);
          const userRef = doc(db, "users", user.uid);

          const usernameSnap = await transaction.get(usernameRef);
          const userSnap = await transaction.get(userRef);

          if (userSnap.exists()) {
            return;
          }

          if (usernameSnap.exists()) {
            throw new Error("Username sudah digunakan. Pilih username lain.");
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

        const profileSnap = await getDoc(doc(db, "users", user.uid));

        if (!profileSnap.exists()) {
          throw new Error("Profil belum berhasil dibuat. Coba lagi.");
        }

        currentProfile = {
          uid: user.uid,
          ...profileSnap.data()
        };

        hide(modal);
        pendingPhoneUser = null;

        const finish = resolve;
        pendingProfilePromise = null;
        finish(true);

      } catch (error) {
        console.error("Phone profile:", error);
        errorText("phoneProfileError", error.message || "Gagal menyimpan profil.");

      } finally {
        busy = false;
        setBusy(button, false);
      }
    };
  });

  return pendingProfilePromise;
}


/* ==================================================
   VERIFY PHONE OTP
================================================== */

async function verifyPhoneOtp() {
  if (!confirmationResult || busy) return;

  const code = $("phoneOtp")?.value.trim();

  if (!/^\d{6}$/.test(code || "")) {
    errorText("authError", "Masukkan kode OTP 6 digit.");
    return;
  }

  busy = true;
  setBusy($("verifyPhoneOtp"), true, "MEMVERIFIKASI...");
  errorText("authError");

  try {
    await confirmationResult.confirm(code);

    confirmationResult = null;
    resetRecaptcha();

    toast("Nomor HP berhasil diverifikasi.");

    /*
      Pembuatan profil ditangani oleh onAuthStateChanged.
      Jangan panggil ensurePhoneProfile di sini agar tidak
      terjadi dua proses pembuatan profil secara bersamaan.
    */

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
  if (busy) return;

  if ($("phoneNumber")) {
    $("phoneNumber").readOnly = false;
  }

  if ($("phoneOtp")) {
    $("phoneOtp").value = "";
  }

  hide($("otpPanel"));

  confirmationResult = null;
  resetRecaptcha();

  await sendPhoneOtp();
});


/* ==================================================
   PROFILE DATA
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
  if (!currentProfile || !currentUser) return;

  const name = currentProfile.name || "Pengguna";
  const username = currentProfile.username || "";
  const photo = currentProfile.photoURL || "";

  if ($("myName")) $("myName").textContent = name;
  if ($("myEmail")) $("myEmail").textContent = currentProfile.email || "";
  if ($("myPhone")) $("myPhone").textContent = currentProfile.phoneNumber || "";

  if ($("myAvatar")) {
    $("myAvatar").textContent = name.charAt(0).toUpperCase();
    $("myAvatar").style.backgroundImage = photo
      ? `url("${photo}")`
      : "none";

    $("myAvatar").classList.toggle("has-photo", Boolean(photo));
  }

  if ($("chatAvatar")) {
    $("chatAvatar").textContent = name.charAt(0).toUpperCase();
  }

  if ($("openAdmin")) {
    $("openAdmin").hidden = currentUser.uid !== ADMIN_UID;
  }

  if ($("profileName")) $("profileName").value = name;
  if ($("profileUsername")) $("profileUsername").value = username;
  if ($("profileBio")) $("profileBio").value = currentProfile.bio || "";

  if ($("profilePhotoPreview")) {
    $("profilePhotoPreview").textContent = photo
      ? ""
      : name.charAt(0).toUpperCase();

    $("profilePhotoPreview").style.backgroundImage = photo
      ? `url("${photo}")`
      : "none";
  }
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


/* ==================================================
   IMAGE UPLOAD
================================================== */

async function uploadImage(file, folder) {
  if (!currentUser) {
    throw new Error("Kamu belum login.");
  }

  if (!file || !file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Ukuran gambar maksimal 5 MB.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${currentUser.uid}/${Date.now()}_${safeName}`;
  const imageRef = storageRef(storage, path);

  await uploadBytes(imageRef, file);

  return await getDownloadURL(imageRef);
}

on("profilePhotoInput", "change", event => {
  const file = event.target.files?.[0];

  if (!file || !$("profilePhotoPreview")) return;

  if (!file.type.startsWith("image/")) {
    toast("Pilih file gambar.");
    event.target.value = "";
    return;
  }

  if (file.size > MAX_IMAGE_SIZE) {
    toast("Ukuran gambar maksimal 5 MB.");
    event.target.value = "";
    return;
  }

  const previewURL = URL.createObjectURL(file);

  $("profilePhotoPreview").style.backgroundImage =
    `url("${previewURL}")`;

  $("profilePhotoPreview").textContent = "";
});


/* ==================================================
   SAVE PROFILE
================================================== */

on("saveProfile", "click", async () => {
  if (busy || !currentUser || !currentProfile) return;

  const name = $("profileName")?.value.trim();
  const bio = $("profileBio")?.value.trim();

  if (!name) {
    toast("Nama tidak boleh kosong.");
    return;
  }

  busy = true;
  setBusy($("saveProfile"), true, "MENYIMPAN...");

  try {
    let photoURL = currentProfile.photoURL || "";

    const file = $("profilePhotoInput")?.files?.[0];

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

    if ($("profilePhotoInput")) {
      $("profilePhotoInput").value = "";
    }

    hide($("profileModal"));
    toast("Profil berhasil diperbarui.");

  } catch (error) {
    console.error("Save profile:", error);
    toast("Gagal menyimpan profil: " + error.message);

  } finally {
    busy = false;
    setBusy($("saveProfile"), false);
  }
});


/* ==================================================
   LINK PHONE NUMBER TO EXISTING ACCOUNT
================================================== */

on("linkPhoneBtn", "click", () => {
  show($("linkPhoneModal"));
});

on("sendLinkPhoneOtp", "click", async () => {
  if (!currentUser) {
    errorText("linkPhoneError", "Kamu belum login.");
    return;
  }

  const phone = normalizePhone($("linkPhoneNumber")?.value);

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    errorText("linkPhoneError", "Nomor HP tidak valid.");
    return;
  }

  try {
    resetLinkRecaptcha();

    linkRecaptcha = createRecaptcha("link-recaptcha-container");

    /*
      linkWithPhoneNumber mempertahankan akun yang sedang login.
      signInWithPhoneNumber akan mencoba login sebagai akun baru.
    */

    linkConfirmation = await linkWithPhoneNumber(
      currentUser,
      phone,
      linkRecaptcha
    );

    show($("linkPhoneOtpPanel"));
    errorText("linkPhoneError");

    toast("SMS OTP untuk menautkan nomor berhasil dikirim.");

  } catch (error) {
    console.error("Link phone send:", error);
    errorText("linkPhoneError", authErrorMessage(error));
    resetLinkRecaptcha();
  }
});


/* ==================================================
   VERIFY LINK PHONE OTP
================================================== */

on("verifyLinkPhoneOtp", "click", async () => {
  if (!linkConfirmation || !currentUser) return;

  const code = $("linkPhoneOtp")?.value.trim();

  if (!/^\d{6}$/.test(code || "")) {
    errorText("linkPhoneError", "Kode OTP harus 6 digit.");
    return;
  }

  try {
    /*
      Konfirmasi ini menautkan nomor ke akun yang sedang login.
    */

    const credential = await linkConfirmation.confirm(code);
    currentUser = credential.user;

    await updateDoc(doc(db, "users", currentUser.uid), {
      phoneNumber: currentUser.phoneNumber || "",
      updatedAt: serverTimestamp()
    });

    await loadProfile(currentUser.uid);
    renderProfile();

    linkConfirmation = null;
    resetLinkRecaptcha();

    hide($("linkPhoneModal"));
    hide($("linkPhoneOtpPanel"));

    toast("Nomor HP berhasil ditautkan.");

  } catch (error) {
    console.error("Link phone verify:", error);
    errorText("linkPhoneError", authErrorMessage(error));
  }
});


/* ==================================================
   LOGOUT
================================================== */

async function logout() {
  try {
    clearListeners();

    if (currentUser) {
      await remove(dbRef(rtdb, `status/${currentUser.uid}`)).catch(() => {});
    }

    await signOut(auth);

    currentUser = null;
    currentProfile = null;
    activeConversation = null;
    activeConversationType = null;

    confirmationResult = null;
    linkConfirmation = null;

    resetRecaptcha();
    resetLinkRecaptcha();

    showAuth();

  } catch (error) {
    console.error("Logout:", error);
    toast("Gagal keluar: " + error.message);
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

function addConversationListener(unsubscribe) {
  if (typeof unsubscribe === "function") {
    conversationListeners.push(unsubscribe);
  }
}

function clearConversationListeners() {
  conversationListeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn("Conversation listener cleanup:", error);
    }
  });

  conversationListeners = [];

  clearTimeout(typingTimer);
  typingTimer = null;

  if (activeConversation && activeConversationType && currentUser) {
    stopTyping(activeConversation, activeConversationType).catch(() => {});
  }

  if (presenceListener) {
    try {
      presenceListener();
    } catch (error) {
      console.warn(error);
    }

    presenceListener = null;
  }
}

function clearListeners() {
  clearConversationListeners();

  listeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn("Listener cleanup:", error);
    }
  });

  listeners = [];

  if (currentUser) {
    remove(dbRef(rtdb, `status/${currentUser.uid}/typing`)).catch(() => {});
  }
}


/* ==================================================
   NAVIGATION
================================================== */

function openPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-button[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });

  const chatPanel = $("chatPanel");
  const emptyChat = $("emptyChat");

  if (pageId !== "chatsPage") {
    hide(chatPanel);
    show(emptyChat);
  } else if (window.innerWidth <= 760) {
    hide(chatPanel);
    show(emptyChat);
  }
}

document.querySelectorAll(".nav-button[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});


/* ==================================================
   THEME
================================================== */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;

  try {
    localStorage.setItem("zora-theme", theme);
  } catch (error) {
    console.warn("Theme storage unavailable:", error);
  }

  const label = theme === "light" ? "Mode Terang" : "Mode Gelap";

  if ($("themeLabel")) {
    $("themeLabel").textContent = label;
  }
}

try {
  setTheme(localStorage.getItem("zora-theme") || "dark");
} catch {
  setTheme("dark");
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  setTheme(current === "dark" ? "light" : "dark");
}

on("themeBtn", "click", toggleTheme);
on("settingsThemeBtn", "click", toggleTheme);


/* ==================================================
   AVATAR AND DATE HELPERS
================================================== */

function avatarHTML(name = "U", photoURL = "", className = "") {
  const initial = escapeHTML(name.charAt(0).toUpperCase());

  if (photoURL) {
    return `
      <div class="avatar ${className}"
           style="background-image:url('${escapeHTML(photoURL)}')">
      </div>
    `;
  }

  return `
    <div class="avatar ${className}">
      ${initial}
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

  if (Number.isNaN(date.getTime())) return "";

  return "Terakhir dilihat " + date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getTimestamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  return new Date(value).getTime() || 0;
}


/* ==================================================
   PRIVATE CHAT ID
================================================== */

function makeChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}


/* ==================================================
   START PRIVATE CHAT
================================================== */

async function startPrivateChat(uid) {
  if (!currentUser || !uid || uid === currentUser.uid) return;

  try {
    const profileSnap = await getDoc(doc(db, "users", uid));

    if (!profileSnap.exists()) {
      toast("Pengguna tidak ditemukan.");
      return;
    }

    const target = profileSnap.data();
    const chatId = makeChatId(currentUser.uid, uid);

    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        members: [currentUser.uid, uid],
        memberNames: {
          [currentUser.uid]: currentProfile?.name || "Pengguna",
          [uid]: target.name || "Pengguna"
        },
        type: "private",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: ""
      });
    }

    openConversation(chatId, "private", {
      uid,
      name: target.name || "Pengguna",
      username: target.username || "",
      photoURL: target.photoURL || ""
    });

  } catch (error) {
    console.error("Start private chat:", error);
    toast("Tidak bisa membuka chat: " + error.message);
  }
}


/* ==================================================
   CHAT LIST
================================================== */

function listenChats() {
  if (!currentUser) return;

  const chatsQuery = query(
    collection(db, "chats"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(chatsQuery, async snapshot => {
    if (!currentUser) return;

    const chats = await Promise.all(snapshot.docs.map(async item => {
      const data = item.data();

      const otherUid = (data.members || []).find(
        uid => uid !== currentUser.uid
      );

      if (!otherUid) return null;

      try {
        const profileSnap = await getDoc(doc(db, "users", otherUid));

        if (!profileSnap.exists()) return null;

        const profile = profileSnap.data();

        return {
          id: item.id,
          type: "private",
          uid: otherUid,
          name: profile.name || "Pengguna",
          username: profile.username || "",
          photoURL: profile.photoURL || "",
          lastMessage: data.lastMessage || "",
          updatedAt: data.updatedAt
        };
      } catch (error) {
        console.warn("Chat profile:", error);
        return null;
      }
    }));

    chats.sort((a, b) =>
      getTimestamp(b?.updatedAt) - getTimestamp(a?.updatedAt)
    );

    const container = $("chatList");
    if (!container) return;

    container.innerHTML = "";

    const validChats = chats.filter(Boolean);

    if (!validChats.length) {
      container.innerHTML = `
        <div class="empty-state">
          Belum ada percakapan.
        </div>
      `;
      return;
    }

    validChats.forEach(chat => {
      const button = document.createElement("button");
      button.className = "chat-item";

      button.innerHTML = `
        ${avatarHTML(chat.name, chat.photoURL)}
        <div class="chat-item-details">
          <strong>${escapeHTML(chat.name)}</strong>
          <span>${escapeHTML(chat.lastMessage || "Mulai percakapan")}</span>
        </div>
      `;

      button.addEventListener("click", () => {
        startPrivateChat(chat.uid);
      });

      container.appendChild(button);
    });
  }, error => {
    console.error("Listen chats:", error);
    toast("Gagal memuat daftar chat.");
  });

  addListener(unsubscribe);
}


/* ==================================================
   OPEN CONVERSATION
================================================== */

function openConversation(id, type, info = {}) {
  if (!currentUser || !id) return;

  clearConversationListeners();

  activeConversation = id;
  activeConversationType = type;

  hide($("emptyChat"));
  show($("chatPanel"));

  if ($("chatName")) {
    $("chatName").textContent = info.name || "Percakapan";
  }

  if ($("chatAvatar")) {
    $("chatAvatar").textContent =
      (info.name || "P").charAt(0).toUpperCase();

    $("chatAvatar").style.backgroundImage = info.photoURL
      ? `url("${info.photoURL}")`
      : "none";
  }

  if ($("chatPresence")) {
    $("chatPresence").textContent = "";
  }

  if ($("messages")) {
    $("messages").innerHTML = "";
  }

  if ($("typingIndicator")) {
    $("typingIndicator").textContent = "";
  }

  hide($("channelControls"));
  hide($("channelComposer"));

  const composer = $("composer");

  if (composer) {
    composer.hidden = type === "channel" && !info.isOwner;
  }

  if ($("messageInput")) {
    $("messageInput").disabled = type === "channel" && !info.isOwner;
    $("messageInput").value = "";
  }

  if ($("sendBtn")) {
    $("sendBtn").disabled = type === "channel" && !info.isOwner;
  }

  if ($("imageInput")) {
    $("imageInput").disabled = type === "channel" && !info.isOwner;
  }

  if (type === "channel") {
    show($("channelControls"));

    if (info.isOwner) {
      show($("channelComposer"));
      if (composer) composer.hidden = true;
    }

    if ($("channelFollowerCount")) {
      $("channelFollowerCount").textContent =
        `${Number(info.followerCount || 0)} PENGIKUT`;
    }

    if ($("channelName")) {
      $("channelName").textContent = info.name || "Saluran";
    }
  }

  if (type === "group") {
    const isOwner = info.ownerId === currentUser.uid;

    if ($("inviteGroupMember")) {
      $("inviteGroupMember").hidden = !isOwner;
    }
  }

  listenMessages(id, type);

  if (type === "private" || type === "group") {
    listenTyping(id, type);
  }

  if (type === "private" && info.uid) {
    listenChatPresence(info.uid);
  }

  if (window.innerWidth <= 760) {
    $("chatPanel")?.classList.add("mobile-active");
    $("contentArea")?.classList.add("mobile-chat-open");
  }
}


/* ==================================================
   BACK TO CHAT LIST ON MOBILE
================================================== */

on("backToChats", "click", () => {
  clearConversationListeners();

  activeConversation = null;
  activeConversationType = null;

  hide($("chatPanel"));
  show($("emptyChat"));

  $("chatPanel")?.classList.remove("mobile-active");
  $("contentArea")?.classList.remove("mobile-chat-open");
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


/* ==================================================
   LISTEN MESSAGES
================================================== */

function listenMessages(id, type) {
  const messagesQuery = query(
    messageCollection(id, type),
    orderBy("createdAt", "asc"),
    limit(MESSAGE_LIMIT)
  );

  const unsubscribe = onSnapshot(messagesQuery, snapshot => {
    if (
      activeConversation !== id ||
      activeConversationType !== type
    ) return;

    const container = $("messages");
    if (!container) return;

    container.innerHTML = "";

    snapshot.docs.forEach(item => {
      const message = item.data();

      renderMessage(item.id, message, type);
    });

    container.scrollTop = container.scrollHeight;

    if (type !== "channel") {
      markMessagesRead(id, type, snapshot.docs);
    }

  }, error => {
    console.error("Listen messages:", error);
    toast("Gagal memuat pesan. Periksa Firestore Rules.");
  });

  addConversationListener(unsubscribe);
}


/* ==================================================
   RENDER MESSAGE
================================================== */

function renderMessage(messageId, message, type) {
  const container = $("messages");
  if (!container) return;

  const own = message.senderId === currentUser?.uid;

  const wrapper = document.createElement("div");
  wrapper.className = own ? "message own" : "message";

  const image = message.imageURL
    ? `<img class="message-image"
             src="${escapeHTML(message.imageURL)}"
             alt="Gambar pesan"
             loading="lazy">`
    : "";

  const text = message.text
    ? `<div class="message-text">${escapeHTML(message.text)}</div>`
    : "";

  const sender = type === "group" && !own
    ? `<div class="message-sender">${escapeHTML(message.senderName || "Pengguna")}</div>`
    : "";

  wrapper.innerHTML = `
    <div class="message-bubble">
      ${sender}
      ${image}
      ${text}
      <div class="message-footer">
        <span>${formatTime(message.createdAt)}</span>
        ${own ? `<span class="message-tick">✓</span>` : ""}
      </div>
      <div class="message-reactions">
        ${renderReactions(message.reactions)}
      </div>
      <button class="reaction-button" type="button">
        + Reaksi
      </button>
    </div>
  `;

  wrapper.querySelector(".reaction-button")
    ?.addEventListener("click", () => {
      reactToMessage(messageId, type);
    });

  container.appendChild(wrapper);
}


/* ==================================================
   MARK MESSAGES READ
================================================== */

async function markMessagesRead(id, type, documents) {
  if (!currentUser) return;

  const unread = documents.filter(item => {
    const data = item.data();

    return (
      data.senderId !== currentUser.uid &&
      !(data.readBy || []).includes(currentUser.uid)
    );
  });

  for (const item of unread) {
    try {
      await updateDoc(item.ref, {
        readBy: arrayUnion(currentUser.uid)
      });
    } catch (error) {
      console.warn("Mark read:", error);
    }
  }
}


/* ==================================================
   SEND MESSAGE
================================================== */

async function sendMessage(text = "", imageURL = "") {
  if (!currentUser || !activeConversation) return;

  const cleanText = String(text || "").trim();

  if (!cleanText && !imageURL) return;

  if (activeConversationType === "channel") {
    toast("Gunakan fitur kirim postingan saluran.");
    return;
  }

  try {
    const parentRef = doc(
      db,
      activeConversationType === "group" ? "groups" : "chats",
      activeConversation
    );

    const messagesRef = messageCollection(
      activeConversation,
      activeConversationType
    );

    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      senderName: currentProfile?.name || "Pengguna",
      text: cleanText,
      imageURL,
      reactions: {},
      readBy: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    await updateDoc(parentRef, {
      lastMessage: cleanText || "Foto",
      updatedAt: serverTimestamp()
    });

    if ($("messageInput")) {
      $("messageInput").value = "";
    }

    stopTyping(activeConversation, activeConversationType);

  } catch (error) {
    console.error("Send message:", error);
    toast("Pesan gagal dikirim: " + error.message);
  }
}

on("sendBtn", "click", () => {
  sendMessage($("messageInput")?.value || "");
});

on("messageInput", "keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage($("messageInput")?.value || "");
  }
});


/* ==================================================
   SEND MESSAGE IMAGE
================================================== */

on("imageInput", "change", async event => {
  const file = event.target.files?.[0];

  if (!file || !currentUser || !activeConversation) return;

  try {
    const imageURL = await uploadImage(file, "messages");

    if (activeConversationType === "channel") {
      await sendChannelPost("", imageURL);
    } else {
      await sendMessage("", imageURL);
    }

    toast("Foto berhasil dikirim.");

  } catch (error) {
    console.error("Message image:", error);
    toast("Gagal mengirim foto: " + error.message);

  } finally {
    event.target.value = "";
  }
});


/* ==================================================
   REACTIONS
================================================== */

function renderReactions(reactions = {}) {
  return Object.entries(reactions || {})
    .filter(([, users]) => Array.isArray(users) && users.length)
    .map(([emoji, users]) => `
      <span class="reaction-item">
        ${escapeHTML(emoji)} ${users.length}
      </span>
    `)
    .join("");
}

async function reactToMessage(messageId, type) {
  if (!currentUser || !activeConversation) return;

  const emoji = prompt("Masukkan reaksi: ❤️ 😂 👍 😮 😢 🔥");

  if (!emoji || emoji.length > 8) return;

  try {
    const collectionRef = messageCollection(
      activeConversation,
      type
    );

    const messageRef = doc(collectionRef, messageId);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(messageRef);

      if (!snapshot.exists()) {
        throw new Error("Pesan tidak ditemukan.");
      }

      const data = snapshot.data();
      const reactions = { ...(data.reactions || {}) };

      const users = Array.isArray(reactions[emoji])
        ? [...reactions[emoji]]
        : [];

      if (users.includes(currentUser.uid)) {
        reactions[emoji] = users.filter(
          uid => uid !== currentUser.uid
        );
      } else {
        users.push(currentUser.uid);
        reactions[emoji] = users;
      }

      transaction.update(messageRef, { reactions });
    });

  } catch (error) {
    console.error("Reaction:", error);
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
  if (!currentUser || !id) return;

  try {
    await set(dbRef(rtdb, typingPath(id, type, currentUser.uid)), {
      name: currentProfile?.name || "Pengguna",
      typing: true,
      updatedAt: rtdbTimestamp()
    });
  } catch (error) {
    console.warn("Update typing:", error);
  }

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    stopTyping(id, type);
  }, 2500);
}

async function stopTyping(id, type) {
  if (!currentUser || !id || !type) return;

  clearTimeout(typingTimer);
  typingTimer = null;

  try {
    await remove(dbRef(rtdb, typingPath(id, type, currentUser.uid)));
  } catch (error) {
    console.warn("Stop typing:", error);
  }
}

function listenTyping(id, type) {
  const typingRef = dbRef(rtdb, `typing/${type}/${id}`);

  const unsubscribe = onValue(typingRef, snapshot => {
    if (
      activeConversation !== id ||
      activeConversationType !== type
    ) return;

    const users = snapshot.val() || {};

    const typingUsers = Object.entries(users)
      .filter(([uid, data]) =>
        uid !== currentUser?.uid && data?.typing
      )
      .map(([, data]) => data.name || "Pengguna");

    if ($("typingIndicator")) {
      $("typingIndicator").textContent = typingUsers.length
        ? `${typingUsers.join(", ")} sedang mengetik...`
        : "";
    }
  });

  addConversationListener(() => {
    unsubscribe();
  });
}

on("messageInput", "input", () => {
  if (
    activeConversation &&
    (activeConversationType === "private" ||
     activeConversationType === "group")
  ) {
    updateTyping(activeConversation, activeConversationType);
  }
});


/* ==================================================
   GROUP LIST
================================================== */

function listenGroups() {
  if (!currentUser) return;

  const groupsQuery = query(
    collection(db, "groups"),
    where("members", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(groupsQuery, snapshot => {
    const container = $("groupList");
    if (!container) return;

    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state">Belum ada grup.</div>
      `;
      return;
    }

    snapshot.docs.forEach(item => {
      const data = item.data();

      const button = document.createElement("button");
      button.className = "chat-item";

      button.innerHTML = `
        ${avatarHTML(data.name || "G")}
        <div class="chat-item-details">
          <strong>${escapeHTML(data.name || "Grup")}</strong>
          <span>${escapeHTML(data.lastMessage || "Grup baru")}</span>
        </div>
      `;

      button.addEventListener("click", () => {
        openConversation(item.id, "group", {
          name: data.name || "Grup",
          ownerId: data.ownerId,
          members: data.members || []
        });
      });

      container.appendChild(button);
    });

  }, error => {
    console.error("Listen groups:", error);
    toast("Gagal memuat daftar grup.");
  });

  addListener(unsubscribe);
}


/* ==================================================
   CREATE GROUP
================================================== */

on("createGroupBtn", "click", async () => {
  if (!currentUser) return;

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
      name: name.trim(),
      ownerId: currentUser.uid,
      members: [currentUser.uid]
    });

  } catch (error) {
    console.error("Create group:", error);
    toast("Gagal membuat grup: " + error.message);
  }
});


/* ==================================================
   INVITE GROUP MEMBER
================================================== */

on("inviteGroupMember", "click", async () => {
  if (
    !currentUser ||
    !activeConversation ||
    activeConversationType !== "group"
  ) return;

  const username = prompt("Masukkan username anggota:");

  if (!username?.trim()) return;

  try {
    const groupRef = doc(db, "groups", activeConversation);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      throw new Error("Grup tidak ditemukan.");
    }

    const group = groupSnap.data();

    if (group.ownerId !== currentUser.uid) {
      throw new Error("Hanya pemilik grup yang bisa mengundang anggota.");
    }

    const usernameSnap = await getDoc(
      doc(db, "usernames", username.trim().toLowerCase())
    );

    if (!usernameSnap.exists()) {
      throw new Error("Username tidak ditemukan.");
    }

    const targetUid = usernameSnap.data().uid;

    if (targetUid === currentUser.uid) {
      throw new Error("Kamu sudah menjadi anggota grup.");
    }

    await updateDoc(groupRef, {
      members: arrayUnion(targetUid)
    });

    toast("Anggota berhasil ditambahkan.");

  } catch (error) {
    console.error("Invite group:", error);
    toast(error.message);
  }
});


/* ==================================================
   CHANNEL LIST
================================================== */

function listenChannels() {
  if (!currentUser) return;

  const channelsQuery = query(
    collection(db, "channels"),
    orderBy("createdAt", "desc")
  );

  const unsubscribe = onSnapshot(channelsQuery, snapshot => {
    const container = $("channelList");
    if (!container) return;

    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state">Belum ada saluran.</div>
      `;
      return;
    }

    snapshot.docs.forEach(item => {
      const data = item.data();

      const button = document.createElement("button");
      button.className = "chat-item";

      button.innerHTML = `
        ${avatarHTML(data.name || "S")}
        <div class="channel-item-details">
          <strong>${escapeHTML(data.name || "Saluran")}</strong>
          <span>${Number(data.followerCount || 0)} PENGIKUT</span>
        </div>
      `;

      button.addEventListener("click", () => {
        openChannel(item.id);
      });

      container.appendChild(button);
    });

  }, error => {
    console.error("Listen channels:", error);
    toast("Gagal memuat saluran.");
  });

  addListener(unsubscribe);
}


/* ==================================================
   OPEN CHANNEL
================================================== */

async function openChannel(id) {
  if (!currentUser) return;

  try {
    const channelSnap = await getDoc(doc(db, "channels", id));

    if (!channelSnap.exists()) {
      toast("Saluran tidak ditemukan.");
      return;
    }

    const channel = channelSnap.data();

    const isOwner = channel.ownerId === currentUser.uid;

    const followerSnap = await getDoc(
      doc(db, "channels", id, "followers", currentUser.uid)
    );

    const isFollower = followerSnap.exists();

    if (!isOwner && !isFollower) {
      clearConversationListeners();

      activeConversation = id;
      activeConversationType = "channel";

      show($("chatPanel"));
      hide($("emptyChat"));

      if ($("chatName")) {
        $("chatName").textContent = channel.name || "Saluran";
      }

      if ($("channelFollowerCount")) {
        $("channelFollowerCount").textContent =
          `${Number(channel.followerCount || 0)} PENGIKUT`;
      }

      if ($("messages")) {
        $("messages").innerHTML = `
          <div class="empty-state">
            Ikuti saluran ini untuk melihat postingannya.
          </div>
        `;
      }

      hide($("composer"));
      hide($("channelComposer"));
      show($("channelControls"));

      if ($("followChannelBtn")) {
        $("followChannelBtn").hidden = false;
        $("followChannelBtn").textContent = "IKUTI SALURAN";
      }

      if ($("unfollowChannelBtn")) {
        hide($("unfollowChannelBtn"));
      }

      return;
    }

    openConversation(id, "channel", {
      name: channel.name || "Saluran",
      ownerId: channel.ownerId,
      isOwner,
      followerCount: channel.followerCount || 0
    });

    if ($("followChannelBtn")) {
      hide($("followChannelBtn"));
    }

    if ($("unfollowChannelBtn")) {
      $("unfollowChannelBtn").hidden = isOwner;
    }

  } catch (error) {
    console.error("Open channel:", error);
    toast("Gagal membuka saluran: " + error.message);
  }
}


/* ==================================================
   FOLLOW CHANNEL
================================================== */

on("followChannelBtn", "click", async () => {
  if (!currentUser || !activeConversation) return;

  const channelId = activeConversation;

  try {
    const channelRef = doc(db, "channels", channelId);
    const followerRef = doc(
      db,
      "channels",
      channelId,
      "followers",
      currentUser.uid
    );

    await runTransaction(db, async transaction => {
      const channelSnap = await transaction.get(channelRef);
      const followerSnap = await transaction.get(followerRef);

      if (!channelSnap.exists()) {
        throw new Error("Saluran tidak ditemukan.");
      }

      if (followerSnap.exists()) return;

      transaction.set(followerRef, {
        uid: currentUser.uid,
        name: currentProfile?.name || "Pengguna",
        followedAt: serverTimestamp()
      });

      transaction.update(channelRef, {
        followerCount: Number(channelSnap.data().followerCount || 0) + 1
      });
    });

    toast("Berhasil mengikuti saluran.");
    await openChannel(channelId);

  } catch (error) {
    console.error("Follow channel:", error);
    toast("Gagal mengikuti saluran: " + error.message);
  }
});


/* ==================================================
   UNFOLLOW CHANNEL
================================================== */

on("unfollowChannelBtn", "click", async () => {
  if (!currentUser || !activeConversation) return;

  const channelId = activeConversation;

  try {
    const channelRef = doc(db, "channels", channelId);
    const followerRef = doc(
      db,
      "channels",
      channelId,
      "followers",
      currentUser.uid
    );

    await runTransaction(db, async transaction => {
      const channelSnap = await transaction.get(channelRef);
      const followerSnap = await transaction.get(followerRef);

      if (!channelSnap.exists()) {
        throw new Error("Saluran tidak ditemukan.");
      }

      if (!followerSnap.exists()) return;

      transaction.delete(followerRef);

      transaction.update(channelRef, {
        followerCount: Math.max(
          0,
          Number(channelSnap.data().followerCount || 0) - 1
        )
      });
    });

    toast("Kamu berhenti mengikuti saluran.");

    activeConversation = null;
    activeConversationType = null;

    hide($("chatPanel"));
    show($("emptyChat"));

  } catch (error) {
    console.error("Unfollow channel:", error);
    toast("Gagal berhenti mengikuti: " + error.message);
  }
});


/* ==================================================
   CREATE CHANNEL
================================================== */

on("createChannelBtn", "click", async () => {
  if (!currentUser) return;

  const name = prompt("Nama saluran:");

  if (!name?.trim()) return;

  const description = prompt("Deskripsi saluran:") || "";

  try {
    const channelRef = await addDoc(collection(db, "channels"), {
      name: name.trim(),
      description: description.trim(),
      ownerId: currentUser.uid,
      followerCount: 0,
      createdAt: serverTimestamp()
    });

    toast("Saluran berhasil dibuat.");

    openChannel(channelRef.id);

  } catch (error) {
    console.error("Create channel:", error);
    toast("Gagal membuat saluran: " + error.message);
  }
});


/* ==================================================
   SEND CHANNEL POST
================================================== */

async function sendChannelPost(text = "", imageURL = "") {
  if (
    !currentUser ||
    !activeConversation ||
    activeConversationType !== "channel"
  ) return;

  const channelId = activeConversation;
  const cleanText = String(text || "").trim();

  if (!cleanText && !imageURL) return;

  try {
    const channelRef = doc(db, "channels", channelId);
    const channelSnap = await getDoc(channelRef);

    if (!channelSnap.exists()) {
      throw new Error("Saluran tidak ditemukan.");
    }

    const channel = channelSnap.data();

    if (channel.ownerId !== currentUser.uid) {
      throw new Error("Hanya admin saluran yang bisa mengirim postingan.");
    }

    await addDoc(collection(db, "channels", channelId, "posts"), {
      senderId: currentUser.uid,
      senderName: currentProfile?.name || "Admin",
      text: cleanText,
      imageURL,
      reactions: {},
      createdAt: serverTimestamp()
    });

    await updateDoc(channelRef, {
      updatedAt: serverTimestamp()
    });

    if ($("channelPostInput")) {
      $("channelPostInput").value = "";
    }

  } catch (error) {
    console.error("Channel post:", error);
    toast("Gagal mengirim postingan: " + error.message);
  }
}

on("sendChannelPostBtn", "click", () => {
  sendChannelPost($("channelPostInput")?.value || "");
});


/* ==================================================
   CHANNEL POST REACTIONS
================================================== */

on("channelReactionBtn", "click", () => {
  if (
    activeConversation &&
    activeConversationType === "channel"
  ) {
    toast("Gunakan tombol + Reaksi pada postingan.");
  }
});


/* ==================================================
   STATUS LIST
================================================== */

function listenStatuses() {
  if (!currentUser) return;

  const statusesQuery = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  const unsubscribe = onSnapshot(statusesQuery, snapshot => {
    const container = $("statusList");
    if (!container) return;

    container.innerHTML = "";

    const now = Date.now();

    const statuses = snapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .filter(status => {
        const expiry = Number(status.expiresAt || 0);
        return !expiry || expiry > now;
      });

    if (!statuses.length) {
      container.innerHTML = `
        <div class="empty-state">Belum ada status.</div>
      `;
      return;
    }

    statuses.forEach(status => {
      const button = document.createElement("button");
      button.className = "status-item";

      button.innerHTML = `
        ${avatarHTML(status.name || "U", status.photoURL)}
        <div class="status-item-details">
          <strong>${escapeHTML(status.name || "Pengguna")}</strong>
          <span>${escapeHTML(status.text || "Status")}</span>
        </div>
      `;

      button.addEventListener("click", () => {
        showStatus(status);
      });

      container.appendChild(button);
    });

  }, error => {
    console.error("Listen statuses:", error);
    toast("Gagal memuat status.");
  });

  addListener(unsubscribe);
}


/* ==================================================
   CREATE STATUS
================================================== */

on("createStatusBtn", "click", () => {
  show($("statusModal"));
});

on("closeStatus", "click", () => {
  hide($("statusModal"));
});

on("publishStatusBtn", "click", async () => {
  if (!currentUser) return;

  const text = $("statusInput")?.value.trim();

  if (!text) {
    toast("Isi status terlebih dahulu.");
    return;
  }

  try {
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      name: currentProfile?.name || "Pengguna",
      photoURL: currentProfile?.photoURL || "",
      text,
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });

    if ($("statusInput")) {
      $("statusInput").value = "";
    }

    hide($("statusModal"));
    toast("Status berhasil dibagikan.");

  } catch (error) {
    console.error("Publish status:", error);
    toast("Gagal membagikan status: " + error.message);
  }
});


/* ==================================================
   VIEW STATUS
================================================== */

function showStatus(status) {
  const modal = $("viewStatusModal");

  if (!modal) {
    toast(status.text || "Status");
    return;
  }

  if ($("viewStatusName")) {
    $("viewStatusName").textContent = status.name || "Pengguna";
  }

  if ($("viewStatusText")) {
    $("viewStatusText").textContent = status.text || "";
  }

  show(modal);
}

on("closeViewStatus", "click", () => {
  hide($("viewStatusModal"));
});


/* ==================================================
   USER SEARCH
================================================== */

async function searchUsers(keyword) {
  if (!currentUser) return;

  const container = $("searchResults");
  if (!container) return;

  const term = String(keyword || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  container.innerHTML = "";

  if (term.length < 2) return;

  try {
    const resultsQuery = query(
      collection(db, "usernames"),
      where("username", ">=", term),
      where("username", "<=", term + "\uf8ff"),
      limit(20)
    );

    const snapshot = await getDocs(resultsQuery);

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state">Pengguna tidak ditemukan.</div>
      `;
      return;
    }

    const profiles = await Promise.all(
      snapshot.docs.map(async item => {
        const uid = item.data().uid;

        if (uid === currentUser.uid) return null;

        const profileSnap = await getDoc(doc(db, "users", uid));

        if (!profileSnap.exists()) return null;

        return {
          uid,
          ...profileSnap.data()
        };
      })
    );

    profiles.filter(Boolean).forEach(profile => {
      const button = document.createElement("button");
      button.className = "chat-item";

      button.innerHTML = `
        ${avatarHTML(profile.name || "U", profile.photoURL)}
        <div class="chat-item-details">
          <strong>${escapeHTML(profile.name || "Pengguna")}</strong>
          <span>@${escapeHTML(profile.username || "")}</span>
        </div>
      `;

      button.addEventListener("click", () => {
        startPrivateChat(profile.uid);
      });

      container.appendChild(button);
    });

  } catch (error) {
    console.error("Search users:", error);
    toast("Pencarian gagal: " + error.message);
  }
}

on("searchUser", "input", event => {
  clearTimeout(searchDelay);

  searchDelay = setTimeout(() => {
    searchUsers(event.target.value);
  }, 350);
});


/* ==================================================
   PRESENCE
================================================== */

function setupPresence() {
  if (!currentUser) return;

  const uid = currentUser.uid;
  const connectedRef = dbRef(rtdb, ".info/connected");

  const unsubscribe = onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true || !currentUser || currentUser.uid !== uid) {
      return;
    }

    const statusRef = dbRef(rtdb, `status/${uid}`);

    try {
      await onDisconnect(statusRef).set({
        state: "offline",
        lastChanged: rtdbTimestamp()
      });

      await set(statusRef, {
        state: "online",
        lastChanged: rtdbTimestamp()
      });

    } catch (error) {
      console.warn("Presence setup:", error);
    }
  });

  addListener(unsubscribe);
}


/* ==================================================
   CHAT PRESENCE
================================================== */

function listenChatPresence(uid) {
  if (!uid) return;

  const statusRef = dbRef(rtdb, `status/${uid}`);

  const unsubscribe = onValue(statusRef, snapshot => {
    const data = snapshot.val();

    if (!data) {
      if ($("chatPresence")) {
        $("chatPresence").textContent = "";
      }
      return;
    }

    if ($("chatPresence")) {
      $("chatPresence").textContent =
        data.state === "online"
          ? "Online"
          : formatLastSeen(data.lastChanged);
    }
  });

  presenceListener = unsubscribe;
  addConversationListener(unsubscribe);
}


/* ==================================================
   ACCOUNT STATUS SCREENS
================================================== */

function showAccountStatus(status) {
  hide($("appScreen"));
  hide($("authScreen"));

  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));

  if (status === "hold") {
    show($("holdScreen"));
  } else if (status === "recovered") {
    show($("recoveredScreen"));
  } else if (status === "permanent") {
    show($("permanentScreen"));
  } else {
    showAuth();
  }
}


/* ==================================================
   ADMIN PANEL
================================================== */

function openAdminPanel() {
  if (currentUser?.uid !== ADMIN_UID) {
    toast("Akses ditolak.");
    return;
  }

  show($("adminModal"));
  loadAppeals();
}

on("openAdmin", "click", openAdminPanel);
on("closeAdmin", "click", () => hide($("adminModal")));


/* ==================================================
   ADMIN FIND USER
================================================== */

on("adminSearchBtn", "click", async () => {
  if (currentUser?.uid !== ADMIN_UID) return;

  const username = $("adminUsername")?.value
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  if (!username) {
    toast("Masukkan username.");
    return;
  }

  try {
    const usernameSnap = await getDoc(
      doc(db, "usernames", username)
    );

    if (!usernameSnap.exists()) {
      toast("Pengguna tidak ditemukan.");
      return;
    }

    const uid = usernameSnap.data().uid;

    const profileSnap = await getDoc(doc(db, "users", uid));

    if (!profileSnap.exists()) {
      toast("Profil tidak ditemukan.");
      return;
    }

    const user = profileSnap.data();

    if ($("adminUserResult")) {
      $("adminUserResult").innerHTML = `
        <div class="admin-user-card">
          <strong>${escapeHTML(user.name || "Pengguna")}</strong>
          <span>@${escapeHTML(user.username || "")}</span>
          <span>${escapeHTML(user.email || "")}</span>
          <span>Status: ${escapeHTML(user.status || "active")}</span>
          <div class="admin-user-actions">
            <button data-action="hold">Tahan akun</button>
            <button data-action="active">Aktifkan</button>
            <button data-action="permanent">Nonaktifkan permanen</button>
          </div>
        </div>
      `;

      $("adminUserResult").dataset.uid = uid;

      $("adminUserResult")
        .querySelectorAll("[data-action]")
        .forEach(button => {
          button.addEventListener("click", () => {
            updateUserStatus(
              uid,
              button.dataset.action
            );
          });
        });
    }

  } catch (error) {
    console.error("Admin search:", error);
    toast("Pencarian admin gagal: " + error.message);
  }
});


/* ==================================================
   ADMIN UPDATE USER STATUS
================================================== */

async function updateUserStatus(uid, status) {
  if (currentUser?.uid !== ADMIN_UID) return;

  const allowed = ["active", "hold", "permanent", "recovered"];

  if (!allowed.includes(status)) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: currentUser.uid
    });

    toast("Status akun diperbarui.");

  } catch (error) {
    console.error("Update user status:", error);
    toast("Gagal memperbarui status: " + error.message);
  }
}


/* ==================================================
   APPEALS
================================================== */

on("submitAppealBtn", "click", async () => {
  if (!currentUser) return;

  const message = $("appealInput")?.value.trim();

  if (!message) {
    toast("Tulis alasan pengajuan terlebih dahulu.");
    return;
  }

  try {
    await addDoc(collection(db, "appeals"), {
      uid: currentUser.uid,
      username: currentProfile?.username || "",
      message,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealInput").value = "";

    toast("Pengajuan berhasil dikirim.");

  } catch (error) {
    console.error("Submit appeal:", error);
    toast("Gagal mengirim pengajuan: " + error.message);
  }
});


/* ==================================================
   LOAD APPEALS FOR ADMIN
================================================== */

async function loadAppeals() {
  if (currentUser?.uid !== ADMIN_UID) return;

  const container = $("appealsList");
  if (!container) return;

  container.innerHTML = "Memuat pengajuan...";

  try {
    const appealsQuery = query(
      collection(db, "appeals"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const snapshot = await getDocs(appealsQuery);

    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state">Tidak ada pengajuan baru.</div>
      `;
      return;
    }

    snapshot.docs.forEach(item => {
      const appeal = item.data();

      const card = document.createElement("div");
      card.className = "appeal-card";

      card.innerHTML = `
        <strong>@${escapeHTML(appeal.username || "pengguna")}</strong>
        <p>${escapeHTML(appeal.message || "")}</p>
        <button type="button">Tandai selesai</button>
      `;

      card.querySelector("button").addEventListener("click", async () => {
        try {
          await updateDoc(item.ref, {
            status: "reviewed",
            reviewedBy: currentUser.uid,
            reviewedAt: serverTimestamp()
          });

          card.remove();
          toast("Pengajuan ditandai selesai.");

        } catch (error) {
          toast("Gagal memperbarui pengajuan: " + error.message);
        }
      });

      container.appendChild(card);
    });

  } catch (error) {
    console.error("Load appeals:", error);
    container.textContent = "Gagal memuat pengajuan.";
  }
}


/* ==================================================
   AUTH STATE LISTENER
================================================== */

onAuthStateChanged(auth, async user => {
  clearListeners();

  currentUser = user;
  currentProfile = null;

  activeConversation = null;
  activeConversationType = null;

  if (!user) {
    showAuth();

    hide($("profileModal"));
    hide($("phoneProfileModal"));
    hide($("holdScreen"));
    hide($("recoveredScreen"));
    hide($("permanentScreen"));

    return;
  }

  try {
    let profileSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnap.exists() && user.phoneNumber) {
      const completed = await ensurePhoneProfile(user);

      if (!completed) return;

      profileSnap = await getDoc(
        doc(db, "users", user.uid)
      );
    }

    if (!profileSnap.exists()) {
      throw new Error(
        "Data profil tidak ditemukan. Silakan hubungi admin."
      );
    }

    currentProfile = {
      uid: user.uid,
      ...profileSnap.data()
    };

    const status = currentProfile.status || "active";

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
    console.error("Auth state:", error);

    showAuth();

    toast(
      "Gagal memuat akun: " + error.message
    );
  }
});


/* ==================================================
   INITIALIZATION
================================================== */

console.log("ZORAAPP initialized successfully.");
