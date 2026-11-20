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
   ZORAAPP CONFIG
========================================= */

const ADMIN_UID = "PbeBf6CtGLVWvX2RqnuvXBWyePG2";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const PHONE_PATTERN = /^\+628\d{8,11}$/;

const $ = id => document.getElementById(id);

let user = null;
let profile = null;

let activeId = null;
let activeType = null;
let activeInfo = null;

let otpResult = null;
let linkResult = null;

let recaptcha = null;
let linkCaptcha = null;

let rootUnsubs = [];
let chatUnsubs = [];

let busy = false;
let toastTimer = null;
let searchTimer = null;
let typingTimer = null;
let profilePromise = null;

/* =========================================
   BASIC HELPERS
========================================= */

function on(id, event, callback) {
  $(id)?.addEventListener(event, callback);
}

function show(element) {
  if (element) element.hidden = false;
}

function hide(element) {
  if (element) element.hidden = true;
}

function message(id, value = "") {
  if ($(id)) $(id).textContent = value;
}

function toast(value) {
  const element = $("toast");
  if (!element) return;

  element.textContent = value;
  element.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}

function setBusy(button, state, label = "MEMPROSES...") {
  if (!button) return;

  if (state) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function stamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return new Date(value).getTime() || 0;
}

function normalizePhone(value) {
  let phone = String(value || "").trim().replace(/[\s()-]/g, "");

  if (phone.startsWith("08")) {
    phone = "+62" + phone.slice(1);
  } else if (phone.startsWith("8")) {
    phone = "+62" + phone;
  } else if (phone.startsWith("62")) {
    phone = "+" + phone;
  }

  return phone;
}

function authError(error) {
  const errors = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Akun tidak ditemukan.",
    "auth/wrong-password": "Password salah.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/email-already-in-use": "Email sudah digunakan.",
    "auth/weak-password": "Password minimal 6 karakter.",
    "auth/network-request-failed": "Periksa koneksi internet.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/operation-not-allowed": "Metode login belum diaktifkan di Firebase.",
    "auth/invalid-phone-number": "Nomor HP tidak valid.",
    "auth/quota-exceeded": "Kuota SMS Firebase tercapai.",
    "auth/captcha-check-failed": "Verifikasi reCAPTCHA gagal.",
    "auth/invalid-verification-code": "Kode OTP salah.",
    "auth/code-expired": "Kode OTP kedaluwarsa. Minta kode baru.",
    "auth/credential-already-in-use": "Nomor HP sudah digunakan akun lain.",
    "auth/provider-already-linked": "Nomor HP sudah terhubung.",
    "auth/missing-phone-number": "Masukkan nomor HP terlebih dahulu.",
    "auth/invalid-verification-id": "Sesi OTP tidak valid. Kirim ulang kode."
  };

  return errors[error?.code] || error?.message || "Terjadi kesalahan.";
}

function avatar(name = "U", photo = "", extraClass = "") {
  const letter = esc(String(name || "U").charAt(0).toUpperCase());

  return `
    <div class="avatar ${extraClass}"
      ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>
      ${photo ? "" : letter}
    </div>
  `;
}

function clearArrayListeners(list) {
  list.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn(error);
    }
  });

  list.length = 0;
}

function listen(unsubscribe, chat = false) {
  if (typeof unsubscribe !== "function") return;

  (chat ? chatUnsubs : rootUnsubs).push(unsubscribe);
}

/* =========================================
   SCREEN MANAGEMENT
========================================= */

function showAuth() {
  show($("authScreen"));
  hide($("appScreen"));

  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));
  hide($("phoneProfileModal"));
}

function showApp() {
  hide($("authScreen"));
  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));
  show($("appScreen"));
}

function showAccountStatus(status) {
  hide($("authScreen"));
  hide($("appScreen"));

  hide($("holdScreen"));
  hide($("recoveredScreen"));
  hide($("permanentScreen"));

  if (status === "hold") {
    show($("holdScreen"));
  } else if (status === "permanent") {
    show($("permanentScreen"));
  } else {
    show($("recoveredScreen"));
  }
}

function clearChatListeners() {
  clearArrayListeners(chatUnsubs);

  if (activeId && activeType) {
    stopTyping(activeId, activeType);
  }
}

function clearListeners() {
  clearChatListeners();
  clearArrayListeners(rootUnsubs);
}

/* =========================================
   LOGIN AND REGISTER
========================================= */

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

  message("authError");
}

on("emailLoginTab", "click", () => switchLoginTab("email"));
on("phoneLoginTab", "click", () => switchLoginTab("phone"));

on("showRegister", "click", () => {
  hide($("loginMode"));
  show($("registerMode"));

  message("authError");
  message("registerError");
});

on("showLogin", "click", () => {
  hide($("registerMode"));
  show($("loginMode"));

  message("authError");
  message("registerError");
});

on("loginBtn", "click", async () => {
  if (busy) return;

  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

  if (!email || !password) {
    return message("authError", "Masukkan email dan password.");
  }

  busy = true;
  setBusy($("loginBtn"), true, "SEDANG MASUK...");
  message("authError");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    message("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("loginBtn"), false);
  }
});

on("registerBtn", "click", async () => {
  if (busy) return;

  const name = $("authName")?.value.trim();
  const username = $("registerUsername")?.value.trim().toLowerCase();
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value;

  if (!name || !username || !email || !password) {
    return message("registerError", "Lengkapi semua kolom.");
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return message("registerError", "Username 3–20 karakter, gunakan huruf, angka, atau underscore.");
  }

        "registerError",
      "Username 3–20 karakter, huruf kecil, angka, atau underscore."
    );
  }

  if (password.length < 8) {
    return message("registerError", "Password minimal 8 karakter.");
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
    console.error("Register:", error);
    message("registerError", authError(error));

    if (createdUser) {
      try {
        await signOut(auth);
      } catch (signOutError) {
        console.warn(signOutError);
      }
    }
  } finally {
    busy = false;
    setBusy($("registerBtn"), false);
  }
});

on("forgotPassword", "click", async () => {
  const email = $("authEmail")?.value.trim();

  if (!email) {
    return message("authError", "Masukkan email terlebih dahulu.");
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast("Link reset password dikirim ke email.");
  } catch (error) {
    message("authError", authError(error));
  }
});

/* =========================================
   PHONE OTP LOGIN
========================================= */

function clearCaptcha(isLink = false) {
  try {
    (isLink ? linkCaptcha : recaptcha)?.clear();
  } catch (error) {
    console.warn(error);
  }

  if (isLink) {
    linkCaptcha = null;
  } else {
    recaptcha = null;
  }
}

function makeCaptcha(containerId) {
  if (!$(containerId)) {
    throw Error("Elemen reCAPTCHA tidak ditemukan.");
  }

  return new RecaptchaVerifier(auth, containerId, {
    size: "normal",
    callback: () => message("authError"),
    "expired-callback": () => {
      toast("reCAPTCHA kedaluwarsa. Silakan ulangi.");
    }
  });
}

on("sendPhoneOtp", "click", async () => {
  if (busy) return;

  const phone = normalizePhone($("phoneNumber")?.value);

  if (!PHONE_PATTERN.test(phone)) {
    return message(
      "authError",
      "Nomor tidak valid. Contoh: +6281234567890"
    );
  }

  busy = true;
  setBusy($("sendPhoneOtp"), true, "MENGIRIM SMS...");
  message("authError");

  try {
    clearCaptcha();

    recaptcha = makeCaptcha("recaptcha-container");

    otpResult = await signInWithPhoneNumber(
      auth,
      phone,
      recaptcha
    );

    $("phoneNumber").value = phone;
    $("phoneNumber").readOnly = true;

    show($("otpPanel"));
    toast("Kode OTP dikirim melalui SMS.");
  } catch (error) {
    console.error("Phone OTP:", error);

    otpResult = null;
    clearCaptcha();

    message("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("sendPhoneOtp"), false);
  }
});

on("verifyPhoneOtp", "click", async () => {
  if (busy || !otpResult) {
    return message("authError", "Minta kode OTP terlebih dahulu.");
  }

  const code = $("phoneOtp")?.value.trim();

  if (!/^\d{6}$/.test(code)) {
    return message("authError", "Kode OTP harus 6 digit.");
  }

  busy = true;
  setBusy($("verifyPhoneOtp"), true, "MEMVERIFIKASI...");

  try {
    await otpResult.confirm(code);

    otpResult = null;
    clearCaptcha();

    toast("Nomor berhasil diverifikasi.");
  } catch (error) {
    console.error("Verify OTP:", error);
    message("authError", authError(error));
  } finally {
    busy = false;
    setBusy($("verifyPhoneOtp"), false);
  }
});

on("resendPhoneOtp", "click", async () => {
  $("phoneNumber").readOnly = false;
  $("phoneOtp").value = "";

  hide($("otpPanel"));

  otpResult = null;
  clearCaptcha();

  $("sendPhoneOtp")?.click();
});

/* =========================================
   COMPLETE PHONE PROFILE
========================================= */

async function ensurePhoneProfile(currentUser) {
  if (profilePromise) return profilePromise;

  profilePromise = (async () => {
    const modal = $("phoneProfileModal");
    const button = $("completePhoneProfile");

    if (!modal || !button) {
      throw Error("Form profil nomor HP tidak ditemukan.");
    }

    show(modal);
    message("phoneProfileError");

    return new Promise(resolve => {
      const saveProfile = async () => {
        if (busy) return;

        const name = $("phoneProfileName")?.value.trim();
        const username = $("phoneProfileUsername")
          ?.value.trim()
          .toLowerCase();

        if (!name || !/^[a-z0-9_]{3,20}$/.test(username)) {
          return message(
            "phoneProfileError",
            "Isi nama dan username valid (3–20 karakter)."
          );
        }

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

          hide(modal);
          button.removeEventListener("click", saveProfile);
          resolve();
        } catch (error) {
          message("phoneProfileError", authError(error));
        } finally {
          busy = false;
          setBusy(button, false);
        }
      };

      button.addEventListener("click", saveProfile);
    });
  })();

  try {
    await profilePromise;
  } finally {
    profilePromise = null;
  }
}

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
            throw Error("Profil belum berhasil disimpan.");
          }

          profile = {
            uid: currentUser.uid,
            ...snap.data()
          };

          hide(modal);
          resolve(true);
        } catch (error) {
          console.error("Phone profile:", error);
          message("phoneProfileError", error.message || authError(error));
        } finally {
          busy = false;
          setBusy(button, false);
        }
      };

      button.onclick = saveProfile;
    });
  })();

  try {
    return await profilePromise;
  } finally {
    profilePromise = null;
  }
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

function renderProfile() {
  if (!profile || !user) return;

  const name = profile.name || "Pengguna";
  const photo = profile.photoURL || "";

  if ($("myName")) $("myName").textContent = name;
  if ($("myEmail")) $("myEmail").textContent = profile.email || "";
  if ($("myPhone")) $("myPhone").textContent = profile.phoneNumber || "";

  if ($("myAvatar")) {
    $("myAvatar").textContent = photo ? "" : name.charAt(0).toUpperCase();
    $("myAvatar").style.backgroundImage = photo
      ? `url("${photo}")`
      : "none";
  }

  if ($("openAdmin")) {
    $("openAdmin").hidden = user.uid !== ADMIN_UID;
  }

  if ($("profileName")) $("profileName").value = name;
  if ($("profileUsername")) {
    $("profileUsername").value = profile.username || "";
  }
  if ($("profileBio")) $("profileBio").value = profile.bio || "";

  if ($("profilePhotoPreview")) {
    $("profilePhotoPreview").textContent = photo
      ? ""
      : name.charAt(0).toUpperCase();

    $("profilePhotoPreview").style.backgroundImage = photo
      ? `url("${photo}")`
      : "none";
  }
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

  if (file.size > MAX_IMAGE_SIZE) {
    throw Error("Ukuran gambar maksimal 5 MB.");
  }

  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const path = `${folder}/${user.uid}/${Date.now()}_${safeName}`;

  const reference = storageRef(storage, path);

  await uploadBytes(reference, file);

  return getDownloadURL(reference);
}

on("profilePhotoInput", "change", event => {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_SIZE) {
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

  const name = $("profileName")?.value.trim();
  const bio = $("profileBio")?.value.trim();

  if (!name) return toast("Nama tidak boleh kosong.");

  busy = true;
  setBusy($("saveProfile"), true, "MENYIMPAN...");

  try {
    let photoURL = profile.photoURL || "";
    const file = $("profilePhotoInput")?.files?.[0];

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

    if ($("profilePhotoInput")) {
      $("profilePhotoInput").value = "";
    }

    hide($("profileModal"));
    toast("Profil berhasil diperbarui.");
  } catch (error) {
    console.error(error);
    toast("Gagal menyimpan profil: " + error.message);
  } finally {
    busy = false;
    setBusy($("saveProfile"), false);
  }
});

/* =========================================
   LINK PHONE TO EXISTING ACCOUNT
========================================= */

on("linkPhoneBtn", "click", () => {
  show($("linkPhoneModal"));
});

on("closeLinkPhone", "click", () => {
  hide($("linkPhoneModal"));
});

on("sendLinkPhoneOtp", "click", async () => {
  if (!user) return message("linkPhoneError", "Kamu belum login.");
  if (busy) return;

  const phone = normalizePhone($("linkPhoneNumber")?.value);

  if (!PHONE_PATTERN.test(phone)) {
    return message("linkPhoneError", "Nomor HP tidak valid.");
  }

  busy = true;
  setBusy($("sendLinkPhoneOtp"), true, "MENGIRIM SMS...");

  try {
    clearCaptcha(true);

    linkCaptcha = makeCaptcha("link-recaptcha-container");

    linkResult = await linkWithPhoneNumber(
      user,
      phone,
      linkCaptcha
    );

    show($("linkPhoneOtpPanel"));
    message("linkPhoneError");

    toast("Kode OTP dikirim melalui SMS.");
  } catch (error) {
    console.error(error);
    message("linkPhoneError", authError(error));
    clearCaptcha(true);
  } finally {
    busy = false;
    setBusy($("sendLinkPhoneOtp"), false);
  }
});

on("verifyLinkPhoneOtp", "click", async () => {
  if (!linkResult || !user || busy) return;

  const code = $("linkPhoneOtp")?.value.trim();

  if (!/^\d{6}$/.test(code)) {
    return message("linkPhoneError", "Kode OTP harus 6 digit.");
  }

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
      if (!element) return;

      element.innerHTML = "";

      if (snapshot.empty) {
        element.innerHTML =
          '<div class="empty-state">Belum ada grup.</div>';
        return;
      }

      snapshot.forEach(groupDoc => {
        const data = groupDoc.data();
        const button = document.createElement("button");

        button.type = "button";
        button.className = "chat-item";

        button.innerHTML = `
          ${avatar(data.name || "G")}
          <div class="chat-item-details">
            <strong>${esc(data.name || "Grup")}</strong>
            <span>${esc(data.lastMessage || "Grup baru")}</span>
          </div>
        `;

        button.onclick = () => openConversation(
          groupDoc.id,
          "group",
          {
            name: data.name,
            ownerId: data.ownerId
          }
        );

        element.append(button);
      });
    }, error => {
      console.error(error);
      toast("Gagal memuat grup: " + error.message);
    })
  );
}

/* Dialog internal agar tidak memakai prompt browser. */
function askValue(title, placeholder, callback, multiline = false) {
  let overlay = $("zoraInputDialog");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "zoraInputDialog";
    overlay.className = "modal";
    overlay.hidden = true;

    overlay.innerHTML = `
      <div class="modal-content">
        <h3 id="zoraDialogTitle"></h3>
        <div id="zoraDialogField"></div>
        <div class="modal-actions">
          <button type="button" id="zoraDialogCancel" class="secondary-btn">Batal</button>
          <button type="button" id="zoraDialogConfirm" class="primary-btn">Lanjutkan</button>
        </div>
      </div>
    `;

    document.body.append(overlay);
  }

  $("zoraDialogTitle").textContent = title;

  const field = $("zoraDialogField");
  field.innerHTML = "";

  const input = document.createElement(multiline ? "textarea" : "input");
  input.placeholder = placeholder;
  input.className = "form-input";
  input.maxLength = 300;

  field.append(input);

  show(overlay);
  input.focus();

  const close = () => {
    hide(overlay);
    $("zoraDialogCancel").onclick = null;
    $("zoraDialogConfirm").onclick = null;
  };

  $("zoraDialogCancel").onclick = close;

  $("zoraDialogConfirm").onclick = async () => {
    const value = input.value.trim();

    if (!value) {
      input.focus();
      return;
    }

    close();
    await callback(value);
  };
}

on("createGroupBtn", "click", () => {
  askValue("Buat grup baru", "Nama grup", async name => {
    try {
      const result = await addDoc(collection(db, "groups"), {
        name,
        ownerId: user.uid,
        members: [user.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: ""
      });

      toast("Grup berhasil dibuat.");

      openConversation(result.id, "group", {
        name,
        ownerId: user.uid
      });
    } catch (error) {
      toast("Gagal membuat grup: " + error.message);
    }
  });
});

on("inviteGroupMember", "click", () => {
  if (activeType !== "group" || !activeId) return;

  askValue("Tambah anggota grup", "Masukkan username", async value => {
    const username = value.toLowerCase().replace(/^@/, "");

    try {
      const groupRef = doc(db, "groups", activeId);
      const groupSnap = await getDoc(groupRef);

      if (!groupSnap.exists() || groupSnap.data().ownerId !== user.uid) {
        throw Error("Hanya pemilik grup yang bisa mengundang.");
      }

      const usernameSnap = await getDoc(doc(db, "usernames", username));

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
      if (!element) return;

      element.innerHTML = "";

      if (snapshot.empty) {
        element.innerHTML =
          '<div class="empty-state">Belum ada saluran.</div>';
        return;
      }

      snapshot.forEach(channelDoc => {
        const data = channelDoc.data();
        const button = document.createElement("button");

        button.type = "button";
        button.className = "chat-item";

        button.innerHTML = `
          ${avatar(data.name || "S")}
          <div class="channel-item-details">
            <strong>${esc(data.name || "Saluran")}</strong>
            <span>${Number(data.followerCount || 0)} PENGIKUT</span>
          </div>
        `;

        button.onclick = () => openChannel(channelDoc.id);
        element.append(button);
      });
    }, error => {
      console.error(error);
      toast("Gagal memuat saluran: " + error.message);
    })
  );
}

async function openChannel(id) {
  try {
    const channelSnap = await getDoc(doc(db, "channels", id));

    if (!channelSnap.exists()) {
      throw Error("Saluran tidak ditemukan.");
    }

    const data = channelSnap.data();

    const followerSnap = await getDoc(
      doc(db, "channels", id, "followers", user.uid)
    );

    openConversation(id, "channel", {
      name: data.name,
      ownerId: data.ownerId,
      isOwner: data.ownerId === user.uid,
      isFollowing: followerSnap.exists(),
      followerCount: data.followerCount || 0
    });
  } catch (error) {
    toast(error.message);
  }
}

async function changeChannelFollow(id, follow) {
  const channelRef = doc(db, "channels", id);
  const followerRef = doc(db, "channels", id, "followers", user.uid);

  try {
    await runTransaction(db, async transaction => {
      const channelSnap = await transaction.get(channelRef);
      const followerSnap = await transaction.get(followerRef);

      if (!channelSnap.exists()) {
        throw Error("Saluran tidak ditemukan.");
      }

      const count = Number(channelSnap.data().followerCount || 0);

      if (follow && !followerSnap.exists()) {
        transaction.set(followerRef, {
          uid: user.uid,
          createdAt: serverTimestamp()
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

    await openChannel(id);
  } catch (error) {
    toast("Gagal memperbarui pengikut: " + error.message);
  }
}

async function changeChannelFollow(id, follow) {
  const channelRef = doc(db, "channels", id);
  const followerRef = doc(db, "channels", id, "followers", user.uid);

  try {
    await runTransaction(db, async transaction => {
      const channelSnap = await transaction.get(channelRef);
      const followerSnap = await transaction.get(followerRef);

      if (!channelSnap.exists()) {
        throw Error("Saluran tidak ditemukan.");
      }

      const count = Number(channelSnap.data().followerCount || 0);

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

    toast(follow ? "Berhasil mengikuti saluran." : "Berhenti mengikuti saluran.");
    await openChannel(id);
  } catch (error) {
    toast("Gagal memperbarui pengikut: " + error.message);
  }
}

on("createChannelBtn", "click", () => {
  askValue("Buat saluran", "Nama saluran", async name => {
    try {
      const result = await addDoc(collection(db, "channels"), {
        name,
        description: "",
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
});

async function sendChannelPost(textValue = "", imageURL = "") {
  if (activeType !== "channel" || !activeId) return;

  const clean = textValue.trim();

  if (!clean && !imageURL) return;

  try {
    const channelRef = doc(db, "channels", activeId);
    const channelSnap = await getDoc(channelRef);

    if (!channelSnap.exists() || channelSnap.data().ownerId !== user.uid) {
      throw Error("Hanya pemilik saluran yang bisa posting.");
    }

    await addDoc(collection(db, "channels", activeId, "posts"), {
      senderId: user.uid,
      senderName: profile.name,
      text: clean,
      imageURL,
      reactions: {},
      createdAt: serverTimestamp()
    });

    await updateDoc(channelRef, {
      updatedAt: serverTimestamp()
    });

    if ($("channelPostInput")) $("channelPostInput").value = "";
  } catch (error) {
    toast("Gagal posting: " + error.message);
  }
}

on("sendChannelPost", "click", () => {
  sendChannelPost($("channelPostInput")?.value || "");
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
      if (!element) return;

      const items = snapshot.docs
        .map(document => ({
          id: document.id,
          ...document.data()
        }))
        .filter(item => !item.expiresAt || item.expiresAt > Date.now());

      element.innerHTML = "";

      if (!items.length) {
        element.innerHTML =
          '<div class="empty-state">Belum ada status.</div>';
      } else {
        items.forEach(item => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "status-item";

          button.innerHTML = `
            ${avatar(item.name || "U", item.photoURL)}
            <div class="status-item-details">
              <strong>${esc(item.name || "Pengguna")}</strong>
              <span>${esc(item.text || "Status")}</span>
            </div>
          `;

          button.onclick = () => showStatus(item);
          element.append(button);
        });
      }

      const mine = items.filter(item => item.uid === user.uid);

      $("myStatuses").innerHTML = mine.map(item => `
        <div class="status-item">
          <strong>${esc(item.text || "")}</strong>
        </div>
      `).join("") || '<p class="input-hint">Belum ada status yang kamu bagikan.</p>';
    }, error => {
      console.error(error);
      toast("Gagal memuat status: " + error.message);
    })
  );
}

on("createStatusBtn", "click", () => show($("statusModal")));
on("closeStatus", "click", () => hide($("statusModal")));

on("publishStatus", "click", async () => {
  const textValue = $("statusInput")?.value.trim();

  if (!textValue) return toast("Isi status terlebih dahulu.");

  try {
    await addDoc(collection(db, "statuses"), {
      uid: user.uid,
      name: profile.name,
      photoURL: profile.photoURL || "",
      text: textValue,
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

on("closeViewStatus", "click", () => hide($("viewStatusModal")));

/* =========================================
   CONVERSATION
========================================= */

function openConversation(id, type, info = {}) {
  clearChatListeners();

  activeId = id;
  activeType = type;
  activeInfo = info;

  show($("chatPanel"));
  hide($("emptyChat"));

  $("chatName").textContent = info.name || "Percakapan";

  $("chatAvatar").textContent = info.photoURL
    ? ""
    : (info.name || "U").charAt(0).toUpperCase();

  $("chatAvatar").style.backgroundImage = info.photoURL
    ? `url("${info.photoURL}")`
    : "none";

  message("chatPresence");
  message("typingIndicator");

  hide($("channelControls"));
  hide($("channelComposer"));
  hide($("inviteGroupMember"));

  show($("composer"));

  $("composer").hidden = type === "channel";
  $("messageInput").disabled = type === "channel";
  $("sendBtn").disabled = type === "channel";
  $("imageInput").disabled = type === "channel";

  if (type === "group") {
    $("inviteGroupMember").hidden = info.ownerId !== user.uid;
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

    $("followChannelBtn")?.addEventListener("click", () => {
      changeChannelFollow(id, true);
    });

    $("unfollowChannelBtn")?.addEventListener("click", () => {
      changeChannelFollow(id, false);
    });
  } else {
    listenMessages(id, type);
    listenTyping(id, type);

    if (type === "private" && info.uid) {
      listenPresence(info.uid);
    }
  }

  if (window.innerWidth <= 700) {
    $("appScreen").classList.add("mobile-chat-open");
  }
}

function typingRef(id, type, uid) {
  return dbRef(rtdb, `typing/${type}/${id}/${uid}`);
}

function typeOn() {
  if (!activeId || !activeType || activeType === "channel" || !user) {
    return;
  }

  set(typingRef(activeId, activeType, user.uid), {
    name: profile.name,
    typing: true,
    updatedAt: rtdbTimestamp()
  }).catch(error => console.warn(error));

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    stopTyping(activeId, activeType);
  }, 2200);
}

function stopTyping(id, type) {
  if (!user || !id || !type) return;

  remove(typingRef(id, type, user.uid)).catch(() => {});
}

on("messageInput", "input", typeOn);

function listenTyping(id, type) {
  const reference = dbRef(rtdb, `typing/${type}/${id}`);

  const unsubscribe = onValue(reference, snapshot => {
    const names = Object.entries(snapshot.val() || {})
      .filter(([uid, value]) => uid !== user.uid && value.typing)
      .map(([, value]) => value.name || "Pengguna");

    message(
      "typingIndicator",
      names.length ? names.join(", ") + " sedang mengetik..." : ""
    );
  });

  listen(unsubscribe, true);
}

/* =========================================
   ONLINE STATUS / LAST SEEN
========================================= */

function listenPresence(uid) {
  const unsubscribe = onValue(
    dbRef(rtdb, `status/${uid}`),
    snapshot => {
      const value = snapshot.val();

      message(
        "chatPresence",
        !value
          ? ""
          : value.state === "online"
            ? "Online"
            : "Terakhir dilihat " +
              new Date(value.lastChanged || Date.now()).toLocaleString(
                "id-ID",
                {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit"
                }
              )
      );
    }
  );

  listen(unsubscribe, true);
}

function setupPresence() {
  const connectedRef = dbRef(rtdb, ".info/connected");

  const unsubscribe = onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true || !user) return;

    const reference = dbRef(rtdb, `status/${user.uid}`);

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
      console.warn("Presence:", error);
    }
  });

  listen(unsubscribe);
}

/* =========================================
   SEARCH USERS
========================================= */

on("searchUser", "input", event => {
  clearTimeout(searchTimer);

  const value = event.target.value;

  searchTimer = setTimeout(() => {
    searchUsers(value);
  }, 300);
});

async function searchUsers(term) {
  const element = $("searchResults");
  if (!element) return;

  const key = term.trim().toLowerCase().replace(/^@/, "");

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

    for (const usernameDoc of results.docs) {
      const uid = usernameDoc.data().uid;

      if (!uid || uid === user.uid) continue;

      const profileSnap = await getDoc(doc(db, "users", uid));
      if (!profileSnap.exists()) continue;

      const data = profileSnap.data();
      const button = document.createElement("button");

      button.type = "button";
      button.className = "chat-item";

      button.innerHTML = `
        ${avatar(data.name || "U", data.photoURL)}
        <div class="chat-item-details">
          <strong>${esc(data.name || "Pengguna")}</strong>
          <span>@${esc(data.username || "")}</span>
        </div>
      `;

      button.onclick = () => startPrivate(uid);
      element.append(button);
    }
  } catch (error) {
    console.error("Search:", error);
    toast("Pencarian gagal: " + error.message);
  }
}

on("newChatBtn", "click", () => {
  $("searchUser")?.focus();
  toast("Cari username untuk memulai chat.");
});

/* =========================================
   ACCOUNT APPEALS
========================================= */

on("appealBtn", "click", async () => {
  if (!user || !profile) return;

  const textValue = $("appealText")?.value.trim();

  if (!textValue) {
    return message("appealMessage", "Tulis alasan banding terlebih dahulu.");
  }

  try {
    await addDoc(collection(db, "appeals"), {
      uid: user.uid,
      username: profile.username || "",
      message: textValue,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("appealText").value = "";

    message("appealMessage", "Banding berhasil dikirim.");
  } catch (error) {
    console.error(error);
    message("appealMessage", "Gagal mengirim: " + error.message);
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
on("closeAdmin", "click", () => hide($("adminScreen")));

on("findAdminUser", "click", async () => {
  if (user?.uid !== ADMIN_UID) return;

  const username = $("adminSearch")
    ?.value.trim()
    .toLowerCase()
    .replace(/^@/, "");

  if (!username) return toast("Masukkan username.");

  const element = $("adminUserResult");
  element.textContent = "Mencari pengguna...";

  try {
    const usernameSnap = await getDoc(doc(db, "usernames", username));

    if (!usernameSnap.exists()) {
      element.textContent = "Pengguna tidak ditemukan.";
      return;
    }

    const uid = usernameSnap.data().uid;
    const profileSnap = await getDoc(doc(db, "users", uid));

    if (!profileSnap.exists()) {
      element.textContent = "Profil pengguna tidak ditemukan.";
      return;
    }

    const data = profileSnap.data();

    element.innerHTML = `
      <div class="admin-user-card">
        <strong>${esc(data.name || "Pengguna")}</strong>
        <span>@${esc(data.username || "")}</span>
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
        updateUserStatus(uid, button.dataset.status);
      };
    });
  } catch (error) {
    console.error(error);
    element.textContent = "Pencarian gagal: " + error.message;
  }
});

async function updateUserStatus(uid, status) {
  if (user?.uid !== ADMIN_UID) return;

  const allowed = ["active", "hold", "permanent", "recovered"];

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
  if (!element) return;

  element.textContent = "Memuat...";

  try {
    const results = await getDocs(
      query(
        collection(db, "appeals"),
        where("status", "==", "pending"),
        limit(100)
      )
    );

    const appeals = results.docs
      .map(document => ({
        ref: document.ref,
        ...document.data()
      }))
      .sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));

    element.innerHTML = "";

    if (!appeals.length) {
      element.textContent = "Tidak ada pengajuan baru.";
      return;
    }

    appeals.forEach(data => {
      const card = document.createElement("div");
      card.className = "appeal-card";

      const title = document.createElement("strong");
      title.textContent = "@" + (data.username || "pengguna");

      const paragraph = document.createElement("p");
      paragraph.textContent = data.message || "";

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Tandai selesai";

      button.onclick = async () => {
        button.disabled = true;

        try {
          await updateDoc(data.ref, {
            status: "reviewed",
            reviewedBy: user.uid,
            reviewedAt: serverTimestamp()
          });

          card.remove();
          toast("Pengajuan ditandai selesai.");
        } catch (error) {
          button.disabled = false;
          toast("Gagal: " + error.message);
        }
      };

      card.append(title, paragraph, button);
      element.append(card);
    });
  } catch (error) {
    console.error("Appeals:", error);
    element.textContent = "Gagal memuat pengajuan: " + error.message;
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
  activeInfo = null;

  if (!currentUser) {
    showAuth();
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
        "Data profil tidak ditemukan. Silakan hubungi administrator."
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
    console.error("Auth state:", error);

    showAuth();
    toast("Gagal memuat akun: " + error.message);
  }
});

console.log("ZORAAPP initialized");
