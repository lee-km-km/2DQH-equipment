/* LabStock v1. Configure SUPABASE_URL and SUPABASE_ANON_KEY below. */
const SUPABASE_URL = 'https://wrnzxduqvhxxadiojuei.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_q8u_SQKOMIypR-5jOvO4NQ_lNjfcRHk';
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = function(id){ return document.getElementById(id); };

let assets = [];
let loans = [];
let consumables = [];
let reorderRequests = [];
let stockMovements = [];
let consumablesAvailable = true;
let session = null;
let admin = false;
let borrowedAssetIds = new Set();
let modalMode = '';
let modalId = null;
let inventoryCategory = '전체';
let borrowCategory = '전체';
let borrowSelectedAsset = '';
const ASSET_CATEGORIES = ['공구','측정공구','실험장비','전기·전자','안전용품','기타'];

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

function updateBorrowAssetOptions(){
  const list = $('modalBody').querySelector('#borrowAssetOptions');
  if(!list) return;
  const avail = assets.filter(function(x){return statusFor(x)==='available' && (borrowCategory==='전체' || categoryForAsset(x)===borrowCategory);});
  if(!avail.some(function(x){return String(x.id)===String(borrowSelectedAsset);})) borrowSelectedAsset = avail.length ? avail[0].id : '';
  list.innerHTML = avail.map(function(x){
    const checked = String(x.id)===String(borrowSelectedAsset) ? 'checked' : '';
    return '<label class="borrow-asset-option '+(checked?'selected':'')+'"><input type="radio" name="asset_id" value="'+safe(x.id)+'" '+checked+' required><span class="borrow-asset-name">'+safe(x.name)+'</span><span class="borrow-asset-meta">'+safe(x.id)+' · '+safe(x.location||'위치 미등록')+'</span></label>';
  }).join('');
  const empty = $('modalBody').querySelector('[data-borrow-empty]');
  if(empty) empty.textContent = avail.length ? '' : '이 대분류에는 지금 대여 가능한 비품이 없습니다.';
  if($('saveModal') && modalMode==='borrow') $('saveModal').disabled = avail.length===0;
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

function categoryForAsset(a){
  const raw = String((a && a.category) || '').trim().toLowerCase();
  const name = String((a && a.name) || '').trim().toLowerCase();
  const value = raw + ' ' + name;
  if (/측정|캘리퍼|마이크로미터|멀티미터|테스터|온도계|압력계|게이지/.test(value)) return '측정공구';
  if (/공구|드라이버|렌치|플라이어|펜치|망치|드릴|톱|커터/.test(value)) return '공구';
  if (/전기|전자|전원|케이블|센서|회로|납땜|전압|전류/.test(value)) return '전기·전자';
  if (/안전|보호구|보안경|장갑|마스크|안전화|하네스/.test(value)) return '안전용품';
  if (/실험|장비|현미경|원심분리|교반|항온|건조기|분석기|인큐베이터/.test(value)) return '실험장비';
  if (ASSET_CATEGORIES.includes(raw)) return raw;
  return '기타';
}
function renderCategoryButtons(containerId, selected, dataAttr){
  const el = $(containerId); if(!el) return;
  const counts = {};
  ASSET_CATEGORIES.forEach(function(c){counts[c]=0;});
  assets.forEach(function(a){counts[categoryForAsset(a)]++;});
  const allCount = assets.length;
  let html = '<button type="button" class="category-chip '+(selected==='전체'?'active':'')+'" '+dataAttr+'="전체">전체 <span>'+allCount+'</span></button>';
  ASSET_CATEGORIES.forEach(function(c){
    html += '<button type="button" class="category-chip '+(selected===c?'active':'')+'" '+dataAttr+'="'+safe(c)+'">'+safe(c)+' <span>'+counts[c]+'</span></button>';
  });
  el.innerHTML = html;
}

