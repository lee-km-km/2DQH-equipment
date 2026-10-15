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
      db.from('loans').select('*').order('borrowed_at', {ascending: false})
    ]);
    if(results[0].error) throw results[0].error;
    if(results[1].error) throw results[1].error;

    assets = results[0].data || [];
    loans = results[1].data || [];
    // Compute availability from loan rows; a missing optional RPC must not block loading.
    borrowedAssetIds = new Set();
    for(let i=0; i<loans.length; i++){
      if(!loans[i].returned_at) borrowedAssetIds.add(loans[i].asset_id);
    }
    
    $('connection').textContent = '공용 DB 연결됨';
    render();
  }catch(e){
    $('connection').textContent = 'DB 오류';
    console.error('Supabase 데이터 로드 실패:', e);
    toast('데이터를 불러오지 못했습니다: ' + (e && e.message ? e.message : 'Supabase 설정/RLS 확인'));
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
  if(mode === 'asset'){
    titleText = a ? '비품 정보 수정' : '비품 등록';
  } else if(mode === 'borrow'){
    titleText = '대여 기록';
  } else if(mode === 'return'){
    titleText = '반납 처리';
  } else if(mode === 'editLoan'){
    titleText = '대여 기록 수정';
  }
  $('modalTitle').textContent = titleText;

  let target = null;
  for(let i = 0; i < loans.length; i++){
    if(String(loans[i].id) === String(id)){
      target = loans[i];
      break;
    }
  }

  const lName = target ? (target.borrower_name || '') : '';
  const lDue = target ? (target.due_date || today()) : today();
  const lMemo = target ? (target.memo || '') : '';
  const lStart = target ? (target.borrowed_at || today()) : today();
  const assetObjName = target ? fmtName(target.asset_id) : '';

  let parts = [];

  if(mode === 'asset'){
    const aId = a && a.id ? a.id : nextAssetId();
    const aCat = a && a.category ? a.category : '';
    const aName = a && a.name ? a.name : '';
    const aLoc = a && a.location ? a.location : '';
    const aNote = a && a.note ? a.note : '';
    const isReadonly = a ? 'readonly' : '';
    const selAvail = (!a || a.status === 'available') ? 'selected' : '';
    const selMaint = (a && a.status === 'maintenance') ? 'selected' : '';
    
    parts.push('<div class="form-grid">');
    parts.push('<label class="field">식별번호 *<input name="id" required value="' + safe(aId) + '" ' + isReadonly + ' placeholder="EQ-001"></label>');
    parts.push('<label class="field">분류 *<input name="category" required value="' + safe(aCat) + '" placeholder="측정공구"></label>');
    parts.push('<label class="field full">비품명 *<input name="name" required value="' + safe(aName) + '"></label>');
    parts.push('<label class="field full">보관 위치<input name="location" value="' + safe(aLoc) + '" placeholder="분석실 캐비닛 A"></label>');
    parts.push('<label class="field">상태<select name="status"><option value="available" ' + selAvail + '>사용 가능</option><option value="maintenance" ' + selMaint + '>수리 중</option></select></label>');
    parts.push('<label class="field">비고<input name="note" value="' + safe(aNote) + '"></label>');
    parts.push('</div>');
  } else if(mode === 'borrow'){
    const avail = assets.filter(function(x){ return statusFor(x) === 'available'; });
    let optHtml = '';
    for(let i=0; i<avail.length; i++){
      const x = avail[i];
      const isSel = (x.id === id) ? 'selected' : '';
      optHtml += '<option value="' + safe(x.id) + '" ' + isSel + '>' + safe(x.id) + ' · ' + safe(x.name) + '</option>';
    }
    parts.push('<div class="form-grid">');
    parts.push('<label class="field full">비품 *<select name="asset_id" required>' + optHtml + '</select></label>');
    parts.push('<label class="field full">대여자 이름 *<input name="borrower_name" required maxlength="100" placeholder="이름 직접 입력"></label>');
    parts.push('<label class="field">대여 시작일 *<input name="borrowed_at" type="date" required value="' + today() + '"></label>');
    parts.push('<label class="field">반납 예정일 *<input name="due_date" type="date" required min="' + today() + '" value="' + today() + '"></label>');
    parts.push('<label class="field full">사용 목적 / 메모<textarea name="memo" rows="2" maxlength="500" placeholder="선택 입력"></textarea><small>대여 기록은 공용 목록에 저장됩니다. 이름 입력은 본인 확인 수단이 아닙니다.</small></label>');
    parts.push('</div>');
    if(avail.length === 0){
      parts.push('<p>현재 대여 가능한 비품이 없습니다.</p>');
    }
  } else if(mode === 'editLoan'){
    parts.push('<p><b>' + safe(assetObjName) + '</b> · ' + safe(lName) + '</p>');
    parts.push('<div class="form-grid">');
    parts.push('<label class="field full">대여자 이름 *<input name="borrower_name" required maxlength="100" value="' + safe(lName) + '"></label>');
    parts.push('<label class="field full">반납 예정일 *<input name="due_date" type="date" required min="' + lStart + '" value="' + safe(lDue) + '"></label>');
    parts.push('<label class="field full">메모<textarea name="memo" rows="2" maxlength="500">' + safe(lMemo) + '</textarea></label>');
    parts.push('</div>');
  } else if(mode === 'return'){
    parts.push('<p><b>' + safe(assetObjName) + '</b> · ' + safe(lName) + '</p>');
    parts.push('<div class="form-grid">');
    parts.push('<label class="field full">실제 반납일 *<input name="returned_at" type="date" required value="' + today() + '" min="' + lStart + '"></label>');
    parts.push('<label class="field full">반납 메모<textarea name="return_memo" rows="2" maxlength="500" placeholder="파손·분실 여부 등"></textarea></label>');
    parts.push('</div>');
  } else {
    parts.push('<label class="field">관리자 이메일<input name="email" type="email" required autocomplete="username"></label>');
    parts.push('<label class="field" style="margin-top:12px">비밀번호<input name="password" type="password" required autocomplete="current-password"></label>');
    parts.push('<p class="sub" style="margin-top:12px">Supabase에서 미리 생성한 관리자 계정만 로그인할 수 있도록 회원가입은 꺼두세요.</p>');
  }
  
  $('modalBody').innerHTML = parts.join('');
  
  let btnText = '저장';
  if(mode === 'borrow') btnText = '대여 등록';
  else if(mode === 'return') btnText = '반납 완료';
  else if(mode === 'login') btnText = '로그인';
  else if(mode === 'editLoan') btnText = '수정 저장';
  
  $('saveModal').textContent = btnText;
  const hasAvail = assets.some(function(x){ return statusFor(x) === 'available'; });
  $('saveModal').disabled = (mode === 'borrow' && !hasAvail);
}

// ---- App bootstrap and event handlers (missing from the uploaded source) ----
function nextAssetId(){
  let max = 0;
  assets.forEach(function(a){ const m = String(a.id || '').match(/^EQ-(\d+)$/i); if(m) max = Math.max(max, Number(m[1])); });
  return 'EQ-' + String(max + 1).padStart(3, '0');
}
function showView(name){
  document.querySelectorAll('.view').forEach(function(el){ el.classList.toggle('active', el.id === 'view-' + name); });
  document.querySelectorAll('.nav[data-view]').forEach(function(el){ el.classList.toggle('active', el.dataset.view === name); });
}
function closeModal(){ $('modalBackdrop').classList.remove('open'); $('modalForm').reset(); }
function formValues(form){ return Object.fromEntries(new FormData(form).entries()); }
async function saveForm(e){
  e.preventDefault();
  if(!db){ toast('Supabase URL과 공개 키를 확인하세요.'); return; }
  const form = $('modalForm'); if(!form.reportValidity()) return;
  const v = formValues(form), btn = $('saveModal'); btn.disabled = true;
  try{
    if(modalMode === 'login'){
      const {data,error} = await db.auth.signInWithPassword({email:v.email,password:v.password});
      if(error) throw error;
      session = data.session; await refreshAdminState();
      if(!admin){ await db.auth.signOut(); session=null; await refreshAdminState(); throw new Error('이 계정에 관리자 권한이 없습니다. Supabase user_roles에 admin 역할을 등록하세요.'); }
      closeModal(); toast('관리자 로그인 완료'); await loadData(); return;
    }
    if(modalMode === 'asset'){
      if(!isAdmin()) throw new Error('비품 등록·수정은 관리자 로그인이 필요합니다.');
      const payload={id:v.id.trim(),name:v.name.trim(),category:v.category.trim(),location:(v.location||'').trim(),status:v.status||'available',note:(v.note||'').trim()};
      const result = modalId ? await db.from('assets').update(payload).eq('id',modalId) : await db.from('assets').insert(payload);
      if(result.error) throw result.error;
    } else if(modalMode === 'borrow'){
      const {error}=await db.from('loans').insert({asset_id:v.asset_id,borrower_name:v.borrower_name.trim(),borrowed_at:v.borrowed_at,due_date:v.due_date,memo:(v.memo||'').trim()});
      if(error) throw error;
    } else if(modalMode === 'return'){
      const target=loans.find(function(l){return String(l.id)===String(modalId);});
      if(!target) throw new Error('대여 기록을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');
      const memo=[target.memo||'',v.return_memo?'반납 메모: '+v.return_memo.trim():''].filter(Boolean).join('\n');
      const {error}=await db.from('loans').update({returned_at:v.returned_at,memo:memo,updated_at:new Date().toISOString()}).eq('id',target.id);
      if(error) throw error;
    } else if(modalMode === 'editLoan'){
      const {error}=await db.from('loans').update({borrower_name:v.borrower_name.trim(),due_date:v.due_date,memo:(v.memo||'').trim(),updated_at:new Date().toISOString()}).eq('id',modalId);
      if(error) throw error;
    } else throw new Error('알 수 없는 작업입니다.');
    closeModal(); toast('저장했습니다.'); await loadData();
  }catch(err){ console.error('저장/인증 실패:',err); toast(err&&err.message?err.message:'요청 처리에 실패했습니다.'); }
  finally{ btn.disabled=false; }
}
function exportHistoryCsv(){
  const headers=['비품 식별번호','비품명','대여자','대여 시작일','반납 예정일','실제 반납일','메모'];
  const rows=loans.map(function(l){return [l.asset_id,fmtName(l.asset_id),l.borrower_name,l.borrowed_at,l.due_date,l.returned_at||'',l.memo||''];});
  const cell=function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';};
  const csv='\ufeff'+[headers].concat(rows).map(function(r){return r.map(cell).join(',');}).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download='labstock-history-'+today()+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function bindEvents(){
  document.querySelectorAll('.nav[data-view]').forEach(function(el){el.addEventListener('click',function(){showView(el.dataset.view);});});
  document.addEventListener('click',function(e){
    const target=e.target.closest('button');if(!target)return;
    if(target.dataset.goto){showView(target.dataset.goto);return;}
    if(target.dataset.borrow){openModal('borrow',target.dataset.borrow);return;}
    if(target.dataset.edit){openModal('asset',target.dataset.edit);return;}
    if(target.dataset.return){openModal('return',target.dataset.return);return;}
    if(target.dataset.editLoan){openModal('editLoan',target.dataset.editLoan);return;}
    switch(target.id){
      case 'loginBtn':openModal('login');break;
      case 'logoutBtn':db.auth.signOut().then(function(){session=null;admin=false;setAdminUI();toast('로그아웃했습니다.');loadData();}).catch(function(err){console.error(err);toast('로그아웃 실패: '+err.message);});break;
      case 'addAsset':if(isAdmin())openModal('asset');else toast('관리자 로그인이 필요합니다.');break;
      case 'loanAdd':case 'quickBorrow':openModal('borrow');break;
      case 'closeModal':case 'cancelModal':closeModal();break;
      case 'exportCsv':exportHistoryCsv();break;
    }
  });
  $('modalForm').addEventListener('submit',saveForm);
  $('modalBackdrop').addEventListener('click',function(e){if(e.target===$('modalBackdrop'))closeModal();});
  $('assetSearch').addEventListener('input',renderInventory);$('assetFilter').addEventListener('change',renderInventory);
  $('loanSearch').addEventListener('input',renderLoans);$('loanFilter').addEventListener('change',renderLoans);$('historySearch').addEventListener('input',renderHistory);
}
async function initApp(){
  bindEvents();
  if(!db){$('connection').textContent='Supabase 설정 필요';render();return;}
  try{const {data,error}=await db.auth.getSession();if(error)throw error;session=data.session;await refreshAdminState();}
  catch(err){console.warn('세션 확인 실패. 공개 데이터 조회는 계속 시도합니다.',err);}
  await loadData();
}
document.addEventListener('DOMContentLoaded',initApp);

