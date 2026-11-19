
import { auth, db, storage } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  doc,getDoc,setDoc,updateDoc,collection,addDoc,
  query,where,orderBy,onSnapshot,serverTimestamp,
  getDocs,limit
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import {
  ref,uploadBytes,getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

// GANTI DENGAN UID AKUN ADMIN LU
const ADMIN_UID = "GANTI_DENGAN_UID_ADMIN";

const $ = id => document.getElementById(id);
let currentUser=null;
let currentProfile=null;
let activeChat=null;
let activeUnsubscribe=null;
let chatUnsubscribe=null;

function show(id){
  ["authScreen","holdScreen","permanentScreen","appScreen"]
    .forEach(x=>$(x).hidden=x!==id);
}

function isAdmin(){
  return currentUser?.uid===ADMIN_UID;
}

function error(message){
  $("authError").textContent=message;
}

$("loginBtn").onclick=async()=>{
  try{
    error("");
    await signInWithEmailAndPassword(
      auth,$("authEmail").value.trim(),$("authPassword").value
    );
  }catch(e){error(e.message)}
};

$("registerBtn").onclick=async()=>{
  try{
    error("");
    const name=$("authName").value.trim();
    const email=$("authEmail").value.trim();
    const password=$("authPassword").value;
    if(!name)throw Error("Nama harus diisi.");
    if(password.length<8)throw Error("Password minimal 8 karakter.");

    const credential=await createUserWithEmailAndPassword(auth,email,password);
    await setDoc(doc(db,"users",credential.user.uid),{
      uid:credential.user.uid,
      name,
      email,
      bio:"",
      verified:false,
      status:"active",
      createdAt:serverTimestamp()
    });
  }catch(e){error(e.message)}
};

onAuthStateChanged(auth,async user=>{
  if(activeUnsubscribe)activeUnsubscribe();
  if(chatUnsubscribe)chatUnsubscribe();
  currentUser=user;
  activeChat=null;

  if(!user){show("authScreen");return}

  try{
    const snap=await getDoc(doc(db,"users",user.uid));
    if(!snap.exists()){
      show("authScreen");
      return;
    }

    currentProfile=snap.data();

    if(currentProfile.status==="permanent"){
      show("permanentScreen");
      return;
    }
    if(currentProfile.status==="held"){
      show("holdScreen");
      return;
    }
    if(currentProfile.status!=="active"){
      show("holdScreen");
      return;
    }

    show("appScreen");
    $("myName").textContent=currentProfile.name;
    $("myEmail").textContent=user.email;
    $("myAvatar").textContent=(currentProfile.name||"Z")[0].toUpperCase();
    $("adminLink").hidden=!isAdmin();

    listenChats();
    listenStatuses();
  }catch(e){
    console.error(e);
    show("authScreen");
  }
});

$("logoutBtn").onclick=()=>signOut(auth);
$("logoutHold").onclick=()=>signOut(auth);
$("newAccountBtn").onclick=()=>signOut(auth);

$("themeBtn").onclick=()=>{
  document.body.classList.toggle("dark");
  localStorage.setItem("zora-theme",
    document.body.classList.contains("dark")?"dark":"light");
};
if(localStorage.getItem("zora-theme")==="dark")
  document.body.classList.add("dark");

// PENCARIAN PENGGUNA
let searchTimer;
$("searchUser").oninput=()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(searchUsers,350);
};

async function searchUsers(){
  const value=$("searchUser").value.trim().toLowerCase();
  $("searchResults").innerHTML="";
  if(value.length<2)return;

  const snap=await getDocs(collection(db,"users"));
  snap.forEach(d=>{
    const u=d.data();
    if(u.uid!==currentUser.uid &&
       u.name?.toLowerCase().includes(value) &&
       u.status==="active"){
      const item=document.createElement("div");
      item.className="user-item";
      const name=document.createElement("strong");
      name.textContent=u.name+(u.verified?" ✓":"");
      item.append(name);
      item.onclick=()=>openChat(u);
      $("searchResults").append(item);
    }
  });
}

// CHAT PRIBADI
function chatId(a,b){return [a,b].sort().join("_")}

async function openChat(other){
  if(other.status!=="active")return;

  activeChat=other;
  const id=chatId(currentUser.uid,other.uid);

  await setDoc(doc(db,"chats",id),{
    members:[currentUser.uid,other.uid],
    updatedAt:serverTimestamp()
  },{merge:true});

  $("emptyChat").hidden=true;
  $("chatPanel").hidden=false;
  $("chatName").textContent=other.name;
  $("chatAvatar").textContent=(other.name||"U")[0].toUpperCase();
  $("chatVerified").textContent=other.verified?"✓ Akun terverifikasi":"";
  $("chatVerified").className=other.verified?"verified":"";

  if(activeUnsubscribe)activeUnsubscribe();

  const messagesRef=collection(db,"chats",id,"messages");
  const q=query(messagesRef,orderBy("createdAt","asc"),limit(200));

  activeUnsubscribe=onSnapshot(q,snap=>{
    $("messages").innerHTML="";
    snap.forEach(d=>{
      const m=d.data();
      const bubble=document.createElement("div");
      bubble.className="bubble"+(m.sender===currentUser.uid?" mine":"");

      if(m.type==="image"){
        const img=document.createElement("img");
        img.src=m.image;
        img.alt="Gambar pesan";
        bubble.append(img);
      }else{
        const content=document.createElement("div");
        content.textContent=m.text||"";
        bubble.append(content);
      }

      const time=document.createElement("small");
      time.textContent=m.sender===currentUser.uid?"Anda":"";
      bubble.append(time);
      $("messages").append(bubble);
    });
    $("messages").scrollTop=$("messages").scrollHeight;
  });
}

async function sendMessage(text,imageUrl=null){
  if(!activeChat)return;
  const id=chatId(currentUser.uid,activeChat.uid);

  await addDoc(collection(db,"chats",id,"messages"),{
    sender:currentUser.uid,
    text:text||"",
    type:imageUrl?"image":"text",
    image:imageUrl||null,
    createdAt:serverTimestamp()
  });

  await updateDoc(doc(db,"chats",id),{
    lastMessage:imageUrl?"Foto":text,
    updatedAt:serverTimestamp()
  });
}

$("sendBtn").onclick=async()=>{
  const text=$("messageInput").value.trim();
  if(!text)return;
  $("messageInput").value="";
  try{await sendMessage(text)}catch(e){alert(e.message)}
};

$("messageInput").onkeydown=e=>{
  if(e.key==="Enter")$("sendBtn").click();
};

$("imageInput").onchange=async e=>{
  const file=e.target.files[0];
  if(!file||!activeChat)return;
  if(file.size>5*1024*1024){
    alert("Ukuran gambar maksimal 5 MB");
    return;
  }
  try{
    const path=`chat-media/${currentUser.uid}/${Date.now()}-${file.name}`;
    const storageRef=ref(storage,path);
    await uploadBytes(storageRef,file);
    const url=await getDownloadURL(storageRef);
    await sendMessage("",url);
  }catch(err){alert(err.message)}
};

// DAFTAR CHAT
function listenChats(){
  const q=query(
    collection(db,"chats"),
    where("members","array-contains",currentUser.uid)
  );
  chatUnsubscribe=onSnapshot(q,async snap=>{
    $("chatList").innerHTML="";
    for(const d of snap.docs){
      const data=d.data();
      const otherId=data.members.find(x=>x!==currentUser.uid);
      if(!otherId)continue;
      const userSnap=await getDoc(doc(db,"users",otherId));
      if(!userSnap.exists())continue;
      const u=userSnap.data();
      if(u.status!=="active")continue;

      const item=document.createElement("div");
      item.className="chat-item";
      const name=document.createElement("strong");
      name.textContent=u.name+(u.verified?" ✓":"");
      item.append(name);
      item.onclick=()=>openChat(u);
      $("chatList").append(item);
    }
  });
}

// PROFIL
$("profileBtn").onclick=()=>{
  $("profileName").value=currentProfile.name||"";
  $("profileBio").value=currentProfile.bio||"";
  $("profileModal").hidden=false;
};
$("closeProfile").onclick=()=>$("profileModal").hidden=true;
$("saveProfile").onclick=async()=>{
  const name=$("profileName").value.trim();
  if(!name)return alert("Nama harus diisi.");
  await updateDoc(doc(db,"users",currentUser.uid),{
    name,bio:$("profileBio").value.trim()
  });
  currentProfile.name=name;
  currentProfile.bio=$("profileBio").value.trim();
  $("myName").textContent=name;
  $("myAvatar").textContent=name[0].toUpperCase();
  $("profileModal").hidden=true;
};

// STATUS TEKS
$("statusList").innerHTML=
  '<button id="addStatus">+ Buat status</button>';
$("addStatus").onclick=async()=>{
  const text=prompt("Tulis status:");
  if(!text?.trim())return;
  await addDoc(collection(db,"statuses"),{
    uid:currentUser.uid,
    name:currentProfile.name,
    text:text.trim(),
    createdAt:serverTimestamp()
  });
  alert("Status berhasil dibuat.");
};
function listenStatuses(){
  const q=query(collection(db,"statuses"),orderBy("createdAt","desc"),limit(50));
  onSnapshot(q,snap=>{
    $("statusList").innerHTML="";
    snap.forEach(d=>{
      const s=d.data();
      const item=document.createElement("div");
      item.className="user-item";
      const name=document.createElement("strong");
      name.textContent=s.name;
      const content=document.createElement("small");
      content.textContent=s.text;
      item.append(name,content);
      item.onclick=()=>alert(s.name+": "+s.text);
      $("statusList").append(item);
    });
  });
}

// BANDING
$("appealBtn").onclick=async()=>{
  const text=$("appealText").value.trim();
  if(text.length<10){
    $("appealMessage").textContent="Jelaskan banding minimal 10 karakter.";
    return;
  }
  try{
    await addDoc(collection(db,"appeals"),{
      uid:currentUser.uid,
      email:currentUser.email,
      text,
      status:"pending",
      createdAt:serverTimestamp()
    });
    $("appealMessage").textContent="Banding berhasil dikirim.";
    $("appealBtn").disabled=true;
  }catch(e){
    $("appealMessage").textContent=e.message;
  }
};

// PANEL ADMIN
$("openAdmin").onclick=()=>{
  $("adminScreen").hidden=false;
  loadAppeals();
};
$("closeAdmin").onclick=()=>$("adminScreen").hidden=true;

$("findAdminUser").onclick=async()=>{
  if(!isAdmin())return;
  const uid=$("adminSearch").value.trim();
  if(!uid)return;

  const snap=await getDoc(doc(db,"users",uid));
  $("adminUserResult").innerHTML="";
  if(!snap.exists()){
    $("adminUserResult").textContent="Pengguna tidak ditemukan.";
    return;
  }

  const u=snap.data();
  const card=document.createElement("div");
  card.className="admin-user";
  const title=document.createElement("strong");
  title.textContent=u.name+" — "+u.email;
  const status=document.createElement("p");
  status.textContent="Status: "+u.status;
  card.append(title,status);

  function action(label,callback){
    const b=document.createElement("button");
    b.textContent=label;
    b.onclick=callback;
    card.append(b);
  }

  action("Centang biru",()=>moderate(uid,{verified:true}));
  action("Cabut centang",()=>moderate(uid,{verified:false}));
  action("Tahan sementara",()=>{
    const reason=prompt("Alasan penahanan:");
    if(reason)moderate(uid,{status:"held",reason});
  });
  action("Permanenkan",()=>{
    if(confirm("Permanenkan akun ini?"))
      moderate(uid,{status:"permanent",reason:"Penonaktifan permanen"});
  });
  action("Unblock / Pulihkan",()=>{
    moderate(uid,{status:"active",reason:""});
  });

  $("adminUserResult").append(card);
};

async function moderate(uid,changes){
  if(!isAdmin())return alert("Akses ditolak.");
  try{
    await updateDoc(doc(db,"users",uid),{
      ...changes,
      moderatedAt:serverTimestamp(),
      moderatedBy:currentUser.uid
    });
    alert("Perubahan berhasil disimpan.");
    $("findAdminUser").click();
  }catch(e){alert(e.message)}
}

async function loadAppeals(){
  if(!isAdmin())return;
  const q=query(collection(db,"appeals"),where("status","==","pending"));
  const snap=await getDocs(q);
  $("appealList").innerHTML="";

  snap.forEach(d=>{
    const a=d.data();
    const card=document.createElement("div");
    card.className="admin-user";
    const details=document.createElement("p");
    details.textContent=a.email+" — "+a.text;
    card.append(details);

    const approve=document.createElement("button");
    approve.textContent="Terima banding";
    approve.onclick=async()=>{
      await moderate(a.uid,{status:"active",reason:""});
      await updateDoc(doc(db,"appeals",d.id),{status:"approved"});
      loadAppeals();
    };

    const reject=document.createElement("button");
    reject.textContent="Tolak banding";
    reject.onclick=async()=>{
      await updateDoc(doc(db,"appeals",d.id),{status:"rejected"});
      loadAppeals();
    };
    card.append(approve,reject);
    $("appealList").append(card);
  });
    }
