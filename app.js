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
  setAdminUI();
}

async function loadData(){
  if(!db){
    $('connection').textContent = 'Supabase 설정 필요';
    render();
    return;
  }
  try{
    const results = await Promise.all([
      db.from('assets').select('*').order('name'),
      db.from('loans').select('*').order('borrowed_at', {ascending: false}),
      db.rpc('get_asset_availability')
    ]);
    if(results[0].error) throw results[0].error;
    if(results[1].error) throw results[1].error;
    if(results[2].error) throw results[2].error;
    
    assets = results[0].data || [];
    loans = results[1].data || [];
    const avList = results[2].data || [];
    
    borrowedAssetIds = new Set();
    for(let i=0; i<avList.length; i++){
      if(avList[i].is_borrowed) borrowedAssetIds.add(avList[i].asset_id);
    }
    $('connection').textContent = '공용 DB 연결됨';
    render();
  }catch(e){
    $('connection').textContent = 'DB 오류';
    console.error(e);
    toast('데이터를 불러오지 못했습니다. Supabase 설정과 SQL 정책을 확인하세요.');
  }
}

function render(){
  renderMetrics();
  renderDashboard();
  renderInventory();
  renderLoans();
  renderHistory();
  setAdminUI();
}

function renderMetrics(){
  const active = loans.filter(function(l){ return !l.returned_at; });
  const overdue = active.filter(function(l){
    if(!l.due_date) return false;
    return l.due_date < today();
  });
  const items = [
    ['전체 비품', assets.length, '등록된 품목'],
    ['대여 중', active.length, '현재 사용 중'],
    ['사용 가능', assets.filter(function(a){ return statusFor(a) === 'available'; }).length, '바로 대여 가능'],
    ['반납 기한 초과', overdue.length, '확인이 필요한 품목']
  ];
  let html = '';
  for(let i=0; i<items.length; i++){
    html += '<div class="metric"><div class="label">' + items[i][0] + '</div><div class="value">' + items[i][1] + '</div><div class="foot">' + items[i][2] + '</div></div>';
  }
  $('metrics').innerHTML = html;
}

function renderDashboard(){
  const active = loans.filter(function(l){ return !l.returned_at; }).sort(function(a,b){
    const da = a.due_date ? a.due_date : '';
    const dbDate = b.due_date ? b.due_date : '';
    return da.localeCompare(dbDate);
  });
  
  if(active.length > 0){
    let rowsHtml = '';
    const limit = Math.min(active.length, 7);
    for(let i=0; i<limit; i++){
      const l = active[i];
      const isOverdue = l.due_date && l.due_date < today();
      rowsHtml += '<tr><td><b>' + safe(fmtName(l.asset_id)) + '</b><div class="asset-id">' + safe(l.asset_id) + '</div></td><td>' + safe(l.borrower_name) + '</td><td>' + dateText(l.due_date) + '</td><td><span class="status ' + (isOverdue ? 'borrowed' : 'available') + '">' + (isOverdue ? '기한 초과' : '대여 중') + '</span></td></tr>';
    }
    $('dashboardLoans').innerHTML = '<table><thead><tr><th>비품</th><th>대여자</th><th>반납 예정</th><th>상태</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  } else {
    $('dashboardLoans').innerHTML = '<div class="empty">현재 대여 중인 비품이 없습니다.</div>';
  }

  const getTime = function(item){
    if(item.updated_at) return item.updated_at;
    if(item.borrowed_at) return item.borrowed_at;
    return '';
  };
  const recent = [].concat(loans).sort(function(a,b){
    return getTime(b).localeCompare(getTime(a));
  }).slice(0,5);
  
  let recentHtml = '';
  for(let i=0; i<recent.length; i++){
    const l = recent[i];
    const targetDate = l.returned_at ? l.returned_at : l.borrowed_at;
    const labelText = l.returned_at ? '반납 완료' : '대여 등록';
    recentHtml += '<div class="activity-item"><b>' + safe(l.borrower_name) + '</b> · ' + safe(fmtName(l.asset_id)) + '<small>' + dateText(targetDate) + ' · ' + labelText + '</small></div>';
  }
  $('recentActivity').innerHTML = recentHtml || '<div class="empty">아직 활동이 없습니다.</div>';
}

function renderInventory(){
  const q = $('assetSearch').value.trim().toLowerCase();
  const f = $('assetFilter').value;
  const list = assets.filter(function(a){
    const matchFilter = (f === 'all' ? true : statusFor(a) === f);
    const textTarget = [a.id, a.name, a.category, a.location, a.note].join(' ').toLowerCase();
    const matchSearch = textTarget.includes(q);
    return matchFilter && matchSearch;
  });
  
  if(list.length > 0){
    let listHtml = '';
    for(let i=0; i<list.length; i++){
      const a = list[i];
      const l = activeLoanFor(a.id);
      const st = statusFor(a);
      const bName = l && l.borrower_name ? l.borrower_name : '—';
      const loc = a.location ? a.location : '—';
      let actionBtn = '';
      if(st === 'available'){
        actionBtn += '<button class="text-btn" data-borrow="' + safe(a.id) + '">대여</button>';
      }
      if(isAdmin()){
        actionBtn += '<button class="text-btn" data-edit="' + safe(a.id) + '">수정</button>';
      }
      listHtml += '<tr><td><b>' + safe(a.name) + '</b><div class="asset-id">' + safe(a.id) + '</div></td><td>' + safe(a.category) + '</td><td>' + safe(loc) + '</td><td><span class="status ' + st + '">' + statusLabel(st) + '</span></td><td>' + safe(bName) + '</td><td>' + actionBtn + '</td></tr>';
    }
    $('inventoryRows').innerHTML = '<table><thead><tr><th>비품명 / 식별번호</th><th>분류</th><th>보관 위치</th><th>상태</th><th>현재 대여자</th><th>작업</th></tr></thead><tbody>' + listHtml + '</tbody></table>';
  } else {
    $('inventoryRows').innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
  }
}

function canManageLoan(l){ return true; }

function renderLoans(){
  const q = $('loanSearch').value.trim().toLowerCase();
  const f = $('loanFilter').value;
  const list = loans.filter(function(l){
    let matchFilter = false;
    if(f === 'all') matchFilter = true;
    else if(f === 'active') matchFilter = !l.returned_at;
    else if(f === 'returned') matchFilter = !!l.returned_at;
    const textTarget = [l.asset_id, l.borrower_name, fmtName(l.asset_id)].join(' ').toLowerCase();
    return matchFilter && textTarget.includes(q);
  });
  
  if(list.length > 0){
    let loanHtml = '';
    for(let i=0; i<list.length; i++){
      const l = list[i];
      let action = '';
      if(canManageLoan(l)){
        action += '<button class="text-btn" data-edit-loan="' + l.id + '">수정</button>';
        if(!l.returned_at){
          action += '<button class="text-btn" data-return="' + l.id + '">반납 처리</button>';
        } else {
          action += '<span class="status available">완료</span>';
        }
      } else {
        action = '—';
      }
      loanHtml += '<tr><td><b>' + safe(fmtName(l.asset_id)) + '</b><div class="asset-id">' + safe(l.asset_id) + '</div></td><td>' + safe(l.borrower_name) + '</td><td>' + dateText(l.borrowed_at) + '</td><td>' + dateText(l.due_date) + '</td><td>' + dateText(l.returned_at) + '</td><td>' + action + '</td></tr>';
    }
    $('loanRows').innerHTML = '<table><thead><tr><th>비품</th><th>대여자</th><th>대여 시작일</th><th>반납 예정일</th><th>실제 반납일</th><th>처리</th></tr></thead><tbody>' + loanHtml + '</tbody></table>';
  } else {
    $('loanRows').innerHTML = '<div class="empty">표시할 기록이 없습니다.</div>';
  }
}

function renderHistory(){
  const q = $('historySearch').value.trim().toLowerCase();
  const list = loans.filter(function(l){
    return [l.asset_id, l.borrower_name, fmtName(l.asset_id)].join(' ').toLowerCase().includes(q);
  });
  
  if(list.length > 0){
    let histHtml = '';
    for(let i=0; i<list.length; i++){
      const l = list[i];
      const statClass = l.returned_at ? 'available' : 'borrowed';
      const statText = l.returned_at ? '반납 완료' : '대여 중';
      histHtml += '<tr><td><b>' + safe(fmtName(l.asset_id)) + '</b><div class="asset-id">' + safe(l.asset_id) + '</div></td><td>' + safe(l.borrower_name) + '</td><td>' + dateText(l.borrowed_at) + '</td><td>' + dateText(l.due_date) + '</td><td>' + dateText(l.returned_at) + '</td><td><span class="status ' + statClass + '">' + statText + '</span></td></tr>';
    }
    $('historyRows').innerHTML = '<div class="table-wrap"><table><thead><tr><th>비품 / 식별번호</th><th>대여자</th><th>시작일</th><th>예정 반납일</th><th>실제 반납일</th><th>상태</th></tr></thead><tbody>' + histHtml + '</tbody></table></div>';
  } else {
    $('historyRows').innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
  }
}

function openModal(mode, id){
  if(id === undefined) id = null;
  modalMode = mode;
  modalId = id;
  $('modalBackdrop').classList.add('open');
  const a = id ? assetFor(id) : null;
  
  let titleText = '관리자 로그인';
  if(mode === 'asset') titleText = a ? '비품 정보 수정' : '비품 등록';
  else if(mode === 'borrow') titleText = '대여 기록';
  else if(mode === 'return') titleText = '반납 처리';
  else if(mode === 'editLoan