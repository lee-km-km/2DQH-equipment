/* LabStock v1. Configure SUPABASE_URL and SUPABASE_ANON_KEY below. */
const SUPABASE_URL = 'https://wrnzxduqvhxxadiojuei.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_q8u_SQKOMIypR-5jOvO4NQ_lNjfcRHk';
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = function(id){ return document.getElementById(id); };

let assets = [];
let loans = [];
let session = null;
let admin = false;
let borrowedAssetIds = new Set();
let modalMode = '';
let modalId = null;

function today(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y + '-' + m + '-' + day;
}

function dateText(d){
  if(!d) return '—';
  return String(d).replace(/-/g, '.');
}

function safe(v){
  if(v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function assetFor(id){
  for(let i=0; i<assets.length; i++){
    if(assets[i].id === id) return assets[i];
  }
  return null;
}

function activeLoanFor(id){
  for(let i=0; i<loans.length; i++){
    if(loans[i].asset_id === id && !loans[i].returned_at) return loans[i];
  }
  return null;
}

function isAdmin(){
  return admin;
}

function statusFor(a){
  if(borrowedAssetIds.has(a.id)) return 'borrowed';
  if(activeLoanFor(a.id)) return 'borrowed';
  if(a.status === 'maintenance') return 'maintenance';
  return 'available';
}

function statusLabel(s){
  if(s === 'available') return '사용 가능';
  if(s === 'borrowed') return '대여 중';
  if(s === 'maintenance') return '수리 중';
  return s;
}

function toast(msg){
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(function(){
    $('toast').classList.remove('show');
  }, 2600);
}

function fmtName(id){
  const a = assetFor(id);
  if(a && a.name) return a.name;
  return id;
}

function setAdminUI(){
  $('loginBtn').classList.toggle('hidden', isAdmin());$('logoutBtn').classList.toggle('hidden', !isAdmin());
  const adminEls = document.querySelectorAll('.admin-only');
  for(let i=0; i<adminEls.length; i++){
    adminEls[i].classList.toggle('hidden', !isAdmin());
  }
  $('connection').textContent = db ? '공용 DB 연결' : '설정 필요';
}

async function refreshAdminState(){
  admin = false;
  if(db && session && session.user && !session.user.is_anonymous){
    const res = await db.rpc('is_admin');
    if(res.error) console.error('관리자 권한 확인 실패:', res.error);
    admin = !res.error && res.data === true;
  }