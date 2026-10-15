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
let selectedInventoryCategory = 'all';
let selectedBorrowCategory = 'all';
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
  // 관리자 전용 화면에서 로그아웃하면 일반 사용자가 볼 수 있는 전체 비품 화면으로 이동
  const activeView = document.querySelector('.view.active');
  if(!isAdmin() && activeView && activeView.classList.contains('admin-only')) showView('inventory');
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
    // Consumables are an optional module until the migration SQL is applied.
    const cRes = await db.from('consumables').select('*').order('name');
    const rRes = await db.from('reorder_requests').select('*, consumables(name, unit, location)').order('created_at', {ascending:false});
    const mRes = await db.from('consumable_movements').select('*, consumables(name, unit)').order('created_at', {ascending:false}).limit(30);
    consumablesAvailable = !cRes.error && !rRes.error && !mRes.error;
    consumables = cRes.error ? [] : (cRes.data || []);
    reorderRequests = rRes.error ? [] : (rRes.data || []);
    stockMovements = mRes.error ? [] : (mRes.data || []);
    if(cRes.error || rRes.error || mRes.error) console.warn('소모품 테이블을 사용할 수 없습니다. consumables_migration.sql을 적용했는지 확인하세요.', cRes.error || rRes.error || mRes.error);
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
  renderHome();
  renderMetrics();
  renderDashboard();
  renderInventory();
  renderLoans();
  renderHistory();
  renderConsumables();
  setAdminUI();
}

function renderHome(){
  const loanEl=$('homeLoanCount'), lowEl=$('homeLowCount');
  if(!loanEl||!lowEl) return;
  const active=loans.filter(function(l){ return !l.returned_at; }).length;
  loanEl.textContent=active+'건 대여 중';
  const low=consumables.filter(function(c){ return Number(c.quantity)<=Number(c.min_quantity); }).length;
  lowEl.textContent=isAdmin() && low?('최소 보유량 이하 '+low+'개'):'';
  lowEl.classList.toggle('warn',isAdmin() && low>0);
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
    ['반납 기한 초과', overdue.length, '확인이 필요한 품목'],
    ['소모품 부족', consumables.filter(function(c){ return Number(c.quantity) <= Number(c.min_quantity); }).length, '재주문 확인 필요']
  ];
  let html = '';
  for(let i=0; i<items.length; i++){
    html += '<div class="metric"><div class="label">' + items[i][0] + '</div><div class="value">' + items[i][1] + '</div><div class="foot">' + items[i][2] + '</div></div>';
  }
  $('metrics').innerHTML = html;
}

function renderDashboard(){
  const lowStockItems = consumables.filter(function(c){ return Number(c.quantity) <= Number(c.min_quantity); });
  const notice = $('lowStockNotice');
  if(notice){
    if(lowStockItems.length){
      const preview = lowStockItems.slice(0,4).map(function(c){
        const out = Number(c.quantity) <= 0;
        const label = out ? '재고 0 · 구매요청' : '구매요청';
        return '<button class="low-stock-chip" type="button" data-reorder="'+safe(c.id)+'"><b>'+safe(c.name)+'</b><small>'+safe(c.quantity)+' '+safe(c.unit||'개')+' 남음 · '+safe(c.location||'위치 미등록')+' · '+label+'</small></button>';
      }).join('');
      notice.innerHTML = '<section class="stock-alert"><div class="stock-alert-icon">!</div><div class="stock-alert-content"><b>소모품 재고 확인이 필요합니다</b><p>'+lowStockItems.length+'개 품목이 최소 보유량 이하입니다.</p><div class="low-stock-list">'+preview+'</div></div><button class="btn" data-goto="consumables">소모품 확인</button></section>';
    } else if(consumablesAvailable && consumables.length){ notice.innerHTML='<section class="stock-ok"><span>✓</span><div><b>소모품 재고 양호</b><p>현재 최소 보유량 이하인 품목이 없습니다.</p></div><button class="text-btn" data-goto="consumables">재고 보기</button></section>'; }
    else notice.innerHTML='';
  }
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

const TOP_LEVEL_CATEGORIES = ['공구','측정공구','실험장비','전기·전자','안전용품','기타'];
function topLevelCategory(asset){
  const raw = String((asset && asset.category) || '').trim();
  const text = (raw + ' ' + String((asset && asset.name) || '')).toLowerCase();
  if(/측정|캘리퍼|마이크로미터|게이지|버니어|멀티미터|테스터/.test(text)) return '측정공구';
  if(/안전|보안경|장갑|마스크|소화기|구급|보호구/.test(text)) return '안전용품';
  if(/전기|전자|전원|회로|납땜|인두|아두이노|센서|케이블/.test(text)) return '전기·전자';
  if(/실험|피펫|비커|플라스크|시험관|원심|현미경|배양|시약/.test(text)) return '실험장비';
  if(/공구|드라이버|렌치|펜치|플라이어|망치|톱|드릴|니퍼|스패너/.test(text)) return '공구';
  if(TOP_LEVEL_CATEGORIES.includes(raw)) return raw;
  return '기타';
}
function categoryTabsHtml(selected, actionAttr){
  const cats = ['all'].concat(TOP_LEVEL_CATEGORIES);
  return '<div class="category-tabs" aria-label="대분류">' + cats.map(function(cat){
    const label = cat === 'all' ? '전체' : cat;
    return '<button type="button" class="category-tab'+(selected===cat?' active':'')+'" '+actionAttr+'="'+safe(cat)+'" aria-pressed="'+(selected===cat?'true':'false')+'">'+label+'</button>';
  }).join('') + '</div>';
}

function renderInventory(){
  const q = $('assetSearch').value.trim().toLowerCase();
  const f = $('assetFilter').value;
  const list = assets.filter(function(a){
    const matchCategory = selectedInventoryCategory === 'all' || topLevelCategory(a) === selectedInventoryCategory;
    const matchFilter = (f === 'all' ? true : statusFor(a) === f);
    const textTarget = [a.id, a.name, a.category, a.location, a.note].join(' ').toLowerCase();
    const matchSearch = textTarget.includes(q);
    return matchCategory && matchFilter && matchSearch;
  });
  const categoryHost = $('inventoryCategories');
  if(categoryHost) categoryHost.innerHTML = categoryTabsHtml(selectedInventoryCategory, 'data-inventory-category');
  
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

function updateBorrowCategory(category){
  selectedBorrowCategory = category;
  const body = $('modalBody');
  const select = body.querySelector('[name="asset_id"]');
  const categorySelect = body.querySelector('[name="borrow_category"]');
  if(categorySelect && categorySelect.value !== category) categorySelect.value = category;
  if(!select) return;
  const previous = select.value;
  const available = assets.filter(function(a){ return statusFor(a) === 'available' && (category === 'all' || topLevelCategory(a) === category); });
  select.innerHTML = '<option value="">비품을 선택하세요</option>' + available.map(function(a){ return '<option value="'+safe(a.id)+'">'+safe(a.id)+' · '+safe(a.name)+'</option>'; }).join('');
  if(available.some(function(a){ return a.id === previous; })) select.value = previous;
  else if(available.length === 1) select.value = available[0].id;
  select.disabled = available.length === 0;
  $('saveModal').disabled = available.length === 0;
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

function renderConsumables(){
  const searchEl = $('consumableSearch');
  if(!searchEl) return;
  const q = searchEl.value.trim().toLowerCase();
  const filterEl = $('consumableFilter');
  if(!isAdmin() && (filterEl.value === 'low' || filterEl.value === 'ok')) filterEl.value = 'all';
  const f = filterEl.value;
  const low = consumables.filter(function(c){ return Number(c.quantity) <= Number(c.min_quantity); });
  const outOfStock = consumables.filter(function(c){ return Number(c.quantity) <= 0; });
  const rows = consumables.filter(function(c){
    const quantity = Number(c.quantity);
    const isLow = quantity <= Number(c.min_quantity);
    const isOut = quantity <= 0;
    const target = [c.name,c.category,c.location,c.note].join(' ').toLowerCase();
    const filterMatch = f === 'all' || (f === 'available' && !isOut) || (f === 'out' && isOut) || (isAdmin() && f === 'low' && isLow) || (isAdmin() && f === 'ok' && !isLow);
    return target.includes(q) && filterMatch;
  });
  // Keep threshold-based inventory metrics and alerts private to administrators.
  // 재고 요약 카드 영역은 관리자에게만 표시하며, '등록 품목' 카드는 제거합니다.
  $('consumableSummary').innerHTML = isAdmin() ? [
    ['재고 없음', outOfStock.length, '현재 수량이 0인 품목'],
    ['최소 보유량 이하', low.length, '관리자 확인 및 재주문 필요'],
    ['재주문 요청', reorderRequests.filter(function(r){ return r.status !== 'received'; }).length, '처리 중인 요청']
  ].map(function(x){return '<div class="metric"><div class="label">'+x[0]+'</div><div class="value">'+x[1]+'</div><div class="foot">'+x[2]+'</div></div>';}).join('') : '';
  if(!consumablesAvailable){
    $('consumableRows').innerHTML = '<div class="empty">소모품 기능을 시작하려면 프로젝트 ZIP에 포함된 <b>consumables_migration.sql</b>을 Supabase SQL Editor에서 실행하세요.</div>';
  } else if(rows.length){
    let html='';
    rows.forEach(function(c){
      const quantity = Number(c.quantity);
      const isLow = quantity <= Number(c.min_quantity);
      const isOut = quantity <= 0;
      const status = isOut ? '<span class="status low">재고 없음</span>' : (isAdmin() && isLow ? '<span class="status low">최소 보유량 이하</span>' : '<span class="status available">재고 있음</span>');
      let actions='<button class="text-btn" data-movement="'+safe(c.id)+'" data-movement-type="use">사용 기록</button><button class="text-btn" data-movement="'+safe(c.id)+'" data-movement-type="in">입고 기록</button><button class="text-btn" data-reorder="'+safe(c.id)+'">'+(isOut?'구매 요청':'재주문 요청')+'</button>';
      if(isAdmin()) actions+='<button class="text-btn" data-edit-consumable="'+safe(c.id)+'">정보 수정</button>';
      const rowClass = isOut ? 'out-of-stock' : (isAdmin() && isLow ? 'low-row' : '');
      html+='<tr class="'+rowClass+'"><td><b>'+safe(c.name)+'</b><div class="asset-id">'+safe(c.category||'기타')+'</div></td><td><b>'+safe(c.quantity)+' '+safe(c.unit||'개')+'</b></td>'+(isAdmin()?'<td class="admin-only"><b>'+safe(c.min_quantity)+' '+safe(c.unit||'개')+'</b></td>':'')+'<td><span class="location-text">'+safe(c.location||'위치 미등록')+'</span></td><td>'+status+'</td><td>'+actions+'</td></tr>';
    });
    $('consumableRows').innerHTML='<table><thead><tr><th>소모품 / 분류</th><th>현재 수량</th>'+(isAdmin()?'<th class="admin-only">최소 보유량</th>':'')+'<th>보관 위치</th><th>상태</th><th>작업</th></tr></thead><tbody>'+html+'</tbody></table>';
  } else $('consumableRows').innerHTML='<div class="empty">등록된 소모품이 없습니다.'+(isAdmin()?' 오른쪽 위에서 첫 소모품을 등록하세요.':'')+'</div>';

  // Reorder queue and stock movement log are management details; keep them in admin mode.
  document.querySelectorAll('.admin-consumables-only').forEach(function(el){ el.classList.toggle('hidden', !isAdmin()); });
  if(!isAdmin()){
    $('reorderRows').innerHTML = '<div class="empty">재주문 요청 현황은 관리자 화면에서 확인할 수 있습니다.</div>';
    $('movementRows').innerHTML = '<div class="empty">재고 변동 기록은 관리자 화면에서 확인할 수 있습니다.</div>';
    return;
  }
  if(!consumablesAvailable){ $('reorderRows').innerHTML='<div class="empty">소모품 데이터베이스 설정이 필요합니다.</div>'; return; }
  if(!reorderRequests.length){ $('reorderRows').innerHTML='<div class="empty">아직 재주문 요청이 없습니다.</div>'; } else {
    let requestHtml='';
    reorderRequests.forEach(function(r){
      const name=(r.consumables&&r.consumables.name)||consumableFor(r.consumable_id)?.name||'삭제된 품목';
      const label=r.status==='received'?'입고 완료':r.status==='ordered'?'주문 진행 중':'요청됨';
      let action='';
      if(r.status!=='received') action='<button class="text-btn" data-request-status="'+safe(r.id)+'" data-status="'+(r.status==='pending'?'ordered':'received')+'">'+(r.status==='pending'?'주문 진행':'입고 완료')+'</button>';
      requestHtml+='<tr><td><b>'+safe(name)+'</b><div class="asset-id">'+safe(r.requester||'요청자 미입력')+' · '+dateText(String(r.created_at||'').slice(0,10))+'</div></td><td>'+safe(r.requested_quantity)+' '+safe((r.consumables&&r.consumables.unit)||'개')+'</td><td><span class="status '+(r.status==='received'?'available':r.status==='ordered'?'ordered':'pending')+'">'+label+'</span></td><td>'+safe(r.note||'—')+'</td><td>'+action+'</td></tr>';
    });
    $('reorderRows').innerHTML='<table><thead><tr><th>품목 / 요청자</th><th>요청 수량</th><th>진행 상태</th><th>메모</th><th>관리</th></tr></thead><tbody>'+requestHtml+'</tbody></table>';
  }
  if(!stockMovements.length){ $('movementRows').innerHTML='<div class="empty">아직 재고 변동 기록이 없습니다.</div>'; }
  else { let movementHtml=''; stockMovements.forEach(function(m){ const isIn=m.movement_type==='in'; movementHtml+='<tr><td><b>'+safe((m.consumables&&m.consumables.name)||consumableFor(m.consumable_id)?.name||'소모품')+'</b><div class="asset-id">'+safe(m.actor||'사용자 미입력')+' · '+dateText(String(m.created_at||'').slice(0,10))+'</div></td><td><span class="status '+(isIn?'available':'borrowed')+'">'+(isIn?'입고':'사용')+'</span></td><td><b>'+(isIn?'+':'−')+safe(m.quantity)+' '+safe((m.consumables&&m.consumables.unit)||'개')+'</b></td><td>'+safe(m.note||'—')+'</td></tr>'; }); $('movementRows').innerHTML='<table><thead><tr><th>품목 / 기록자</th><th>유형</th><th>변동 수량</th><th>메모</th></tr></thead><tbody>'+movementHtml+'</tbody></table>'; }
}
function consumableFor(id){ return consumables.find(function(c){return String(c.id)===String(id);})||null; }

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
    const avail = assets.filter(function(x){ return statusFor(x) === 'available'; });
    selectedBorrowCategory = id ? topLevelCategory(assetFor(id)) : 'all';
    if(!avail.some(function(x){ return topLevelCategory(x) === selectedBorrowCategory; })) selectedBorrowCategory = 'all';
    const categories = ['all'].concat(TOP_LEVEL_CATEGORIES);
    const categoryOptions = categories.map(function(cat){
      const count = cat === 'all' ? avail.length : avail.filter(function(x){return topLevelCategory(x) === cat;}).length;
      if(cat !== 'all' && count === 0) return '';
      return '<option value="'+safe(cat)+'" '+(selectedBorrowCategory===cat?'selected':'')+'>'+safe(cat==='all'?'전체 대분류':cat)+' ('+count+')</option>';
    }).join('');
    const filteredAvail = avail.filter(function(x){ return selectedBorrowCategory === 'all' || topLevelCategory(x) === selectedBorrowCategory; });
    const assetOptions = '<option value="">비품을 선택하세요</option>' + filteredAvail.map(function(x){
      return '<option value="'+safe(x.id)+'" '+(x.id===id?'selected':'')+'>'+safe(x.id)+' · '+safe(x.name)+'</option>';
    }).join('');
    parts.push('<div class="form-grid">');
    parts.push('<label class="field full">대분류 선택 *<select name="borrow_category" required>'+categoryOptions+'</select></label>');
    parts.push('<label class="field full">비품 선택 *<select name="asset_id" required '+(filteredAvail.length?'':'disabled')+'>'+assetOptions+'</select></label>');
    parts.push('<label class="field full">대여자 이름 *<input name="borrower_name" required maxlength="100" placeholder="이름 직접 입력"></label>');
    parts.push('<label class="field">대여 시작일 *<input name="borrowed_at" type="date" required value="' + today() + '"></label>');
    parts.push('<label class="field">반납 예정일 *<input name="due_date" type="date" required min="' + today() + '" value="' + today() + '"></label>');
    parts.push('<label class="field full">사용 목적 / 메모<textarea name="memo" rows="2" maxlength="500" placeholder="선택 입력"></textarea><small>대여 기록은 공용 목록에 저장됩니다. 이름 입력은 본인 확인 수단이 아닙니다.</small></label>');
    parts.push('</div>');
    if(avail.length === 0){
      parts.push('<p>현재 대여 가능한 비품이 없습니다.</p>');
    }
  } else if(mode === 'consumable'){
    titleText = id ? '소모품 정보 수정' : '소모품 등록';
  } else if(mode === 'reorder'){
    titleText = '재주문 요청';
  } else if(mode === 'movement'){
    titleText = id ? '재고 변동 기록' : '재고 변동 기록';
  } else if(mode === 'quickReturn'){
    titleText = '빠른 반납';
  } else if(mode === 'quickReorder'){
    titleText = '빠른 구매요청';
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
    selectedBorrowCategory = id ? topLevelCategory(assetFor(id)) : 'all';
    if(!avail.some(function(x){ return topLevelCategory(x) === selectedBorrowCategory; })) selectedBorrowCategory = 'all';
    const filteredAvail = avail;
    let optHtml = '';
    for(let i=0; i<filteredAvail.length; i++){
      const x = filteredAvail[i];
      const isSel = (x.id === id) ? 'selected' : '';
      optHtml += '<option value="' + safe(x.id) + '" ' + isSel + '>' + safe(x.id) + ' · ' + safe(x.name) + '</option>';
    }
    // 대분류는 별도 버튼 대신 비품 선택 목록 안의 그룹으로 표시합니다.
    const groupedOptions = TOP_LEVEL_CATEGORIES.map(function(cat){
      const items = filteredAvail.filter(function(x){ return topLevelCategory(x) === cat; });
      if(!items.length) return '';
      return '<optgroup label="'+safe(cat)+'">'+items.map(function(x){
        return '<option value="'+safe(x.id)+'" '+(x.id === id ? 'selected' : '')+'>'+safe(x.id)+' · '+safe(x.name)+'</option>';
      }).join('')+'</optgroup>';
    }).join('');
    const otherItems = filteredAvail.filter(function(x){ return !TOP_LEVEL_CATEGORIES.includes(topLevelCategory(x)); });
    if(otherItems.length) optHtml = '<optgroup label="기타">'+otherItems.map(function(x){return '<option value="'+safe(x.id)+'" '+(x.id === id ? 'selected' : '')+'>'+safe(x.id)+' · '+safe(x.name)+'</option>';}).join('')+'</optgroup>';
    else optHtml = '';
    parts.push('<div class="form-grid">');
    parts.push('<label class="field full">비품 *<select name="asset_id" required>' + groupedOptions + optHtml + '</select></label>');
    parts.push('<label class="field full">대여자 이름 *<input name="borrower_name" required maxlength="100" placeholder="이름 직접 입력"></label>');
    parts.push('<label class="field">대여 시작일 *<input name="borrowed_at" type="date" required value="' + today() + '"></label>');
    parts.push('<label class="field">반납 예정일 *<input name="due_date" type="date" required min="' + today() + '" value="' + today() + '"></label>');
    parts.push('<label class="field full">사용 목적 / 메모<textarea name="memo" rows="2" maxlength="500" placeholder="선택 입력"></textarea><small>대여 기록은 공용 목록에 저장됩니다. 이름 입력은 본인 확인 수단이 아닙니다.</small></label>');
    parts.push('</div>');
    if(avail.length === 0){
      parts.push('<p>현재 대여 가능한 비품이 없습니다.</p>');
    }
  } else if(mode === 'consumable'){
    if(!isAdmin()) { parts.push('<p>소모품 등록 및 수정은 관리자 로그인이 필요합니다.</p>'); }
    else {
      const c=consumableFor(id);
      parts.push('<div class="form-grid">');
      parts.push('<label class="field full">소모품명 *<input name="name" required maxlength="160" value="'+safe(c?c.name:'')+'" placeholder="예: 200 µL 피펫 팁"></label>');
      parts.push('<label class="field">분류<input name="category" value="'+safe(c?c.category:'')+'" placeholder="팁·장갑·시약"></label>');
      parts.push('<label class="field">단위 *<input name="unit" required value="'+safe(c?c.unit:'개')+'" placeholder="박스, 병, 팩"></label>');
      parts.push('<label class="field">현재 수량 *<input name="quantity" type="number" min="0" step="any" required value="'+safe(c?c.quantity:0)+'"></label>');
      parts.push('<label class="field">최소 보유량 *<input name="min_quantity" type="number" min="0" step="any" required value="'+safe(c?c.min_quantity:1)+'"></label>');
      parts.push('<label class="field full">보관 위치 *<input name="location" required maxlength="200" value="'+safe(c?c.location:'')+'" placeholder="예: 실험실 A · 2번 캐비닛 · 3번째 서랍"></label>');
      parts.push('<label class="field full">비고<textarea name="note" rows="2" maxlength="500">'+safe(c?c.note:'')+'</textarea></label>');
      parts.push('</div>');
    }
  } else if(mode === 'movement'){
    const c=consumableFor(id);
    const moveType=window.__labstockMovementType==='in'?'in':'use';
    if(!c) parts.push('<p>소모품을 찾을 수 없습니다.</p>');
    else { parts.push('<p><b>'+safe(c.name)+'</b> · 현재 재고 <b>'+safe(c.quantity)+' '+safe(c.unit||'개')+'</b><br><span class="sub">'+safe(c.location||'위치 미등록')+'</span></p>'); parts.push('<div class="form-grid" style="margin-top:16px"><label class="field">기록 유형<select name="movement_type"><option value="use" '+(moveType==='use'?'selected':'')+'>사용 / 재고 차감</option><option value="in" '+(moveType==='in'?'selected':'')+'>입고 / 재고 증가</option></select></label><label class="field">수량 *<input name="quantity" type="number" min="0.01" step="any" required></label><label class="field full">기록자 *<input name="actor" required maxlength="100" placeholder="이름"></label><label class="field full">메모<textarea name="note" rows="2" maxlength="500" placeholder="사용 목적 또는 입고 정보"></textarea></label></div><p class="form-hint">저장 즉시 공용 재고 수량이 반영됩니다. 사용 기록으로 재고가 0 미만이 되지는 않습니다.</p>'); }
  } else if(mode === 'reorder'){
    const c=consumableFor(id);
    if(!c) parts.push('<p>소모품을 찾을 수 없습니다.</p>');
    else {
      parts.push('<p><b>'+safe(c.name)+'</b> · 현재 '+safe(c.quantity)+' '+safe(c.unit||'개')+' · '+safe(c.location||'위치 미등록')+'</p>');
      parts.push('<div class="form-grid" style="margin-top:16px">');
      parts.push('<label class="field">요청 수량 *<input name="requested_quantity" type="number" min="0.01" step="any" required value="'+Math.max(1,Number(c.min_quantity)-Number(c.quantity))+'"></label>');
      parts.push('<label class="field">요청자 *<input name="requester" required maxlength="100" placeholder="이름"></label>');
      parts.push('<label class="field full">메모<textarea name="note" rows="2" maxlength="500" placeholder="구매처, 제품번호 등 (선택)"></textarea></label></div>');
    }

  } else if(mode === 'quickReorder'){
    const list = consumables.slice().sort(function(a,b){
      const ao = Number(a.quantity) <= 0 ? 0 : (Number(a.quantity) <= Number(a.min_quantity) ? 1 : 2);
      const bo = Number(b.quantity) <= 0 ? 0 : (Number(b.quantity) <= Number(b.min_quantity) ? 1 : 2);
      if(ao !== bo) return ao - bo;
      return String(a.name||'').localeCompare(String(b.name||''));
    });
    if(!list.length) parts.push('<p>등록된 소모품이 없습니다.</p>');
    else {
      const opt = list.map(function(c){
        const tag = Number(c.quantity) <= 0 ? ' (재고 0)' : (Number(c.quantity) <= Number(c.min_quantity) ? ' (부족)' : '');
        return '<option value="'+safe(c.id)+'">'+safe(c.name)+tag+'</option>';
      }).join('');
      const first = list[0];
      const recQty = Math.max(1, Number(first.min_quantity) - Number(first.quantity));
      parts.push('<div class="form-grid">');
      parts.push('<label class="field full">소모품 *<select name="consumable_id" required>'+opt+'</select></label>');
      parts.push('<label class="field">요청 수량 *<input name="requested_quantity" type="number" min="0.01" step="any" required value="'+recQty+'"></label>');
      parts.push('<label class="field">요청자 *<input name="requester" required maxlength="100" placeholder="이름"></label>');
      parts.push('<label class="field full">메모<textarea name="note" rows="2" maxlength="500" placeholder="구매처, 제품번호 등 (선택)"></textarea></label>');
      parts.push('</div>');
      parts.push('<p class="form-hint">재고가 0인 품목은 즉시 구매요청으로 연결됩니다. (대시보드 재고 알림도 그대로 유지됩니다.)</p>');
    }
  } else if(mode === 'quickReturn'){
    const active = loans.filter(function(l){ return !l.returned_at; });
    if(!active.length) parts.push('<p>현재 대여 중인 비품이 없습니다.</p>');
    else{
      const opt = active.map(function(l){
        return '<option value="'+safe(l.id)+'">'+safe(l.asset_id)+' · '+safe(fmtName(l.asset_id))+' · '+safe(l.borrower_name||'')+'</option>';
      }).join('');
      parts.push('<div class="form-grid">');
      parts.push('<label class="field full">반납할 비품 *<select name="loan_id" required>'+opt+'</select></label>');
      parts.push('<label class="field">실제 반납일 *<input name="returned_at" type="date" required value="'+today()+'"></label>');
      parts.push('<label class="field full">반납 메모<textarea name="return_memo" rows="2" maxlength="500" placeholder="파손·분실 여부 등"></textarea></label>');
      parts.push('</div>');
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
  if(mode === 'borrow') btnText = '대여';
  else if(mode === 'return') btnText = '반납 완료';
  else if(mode === 'login') btnText = '로그인';
  else if(mode === 'editLoan') btnText = '수정 저장';
  else if(mode === 'consumable') btnText = '소모품 저장';
  else if(mode === 'reorder') btnText = '재주문 요청';
  else if(mode === 'movement') btnText = '재고 반영';
  else if(mode === 'quickReturn') btnText = '반납 완료';
  else if(mode === 'quickReorder') btnText = '구매요청';
  
  $('saveModal').textContent = btnText;
  const hasAvail = assets.some(function(x){ return statusFor(x) === 'available'; });
  $('saveModal').disabled = (mode === 'borrow' && (!hasAvail || !assets.some(function(x){ return statusFor(x)==='available' && (selectedBorrowCategory==='all' || topLevelCategory(x)===selectedBorrowCategory); }))); 
  // Mobile friendliness: focus the most important field first.
  setTimeout(function(){
    if(mode === 'borrow'){
      const el = $('modalBody').querySelector('[name="borrower_name"]'); if(el) el.focus();
    } else if(mode === 'reorder'){
      const el = $('modalBody').querySelector('[name="requester"]'); if(el) el.focus();
    } else if(mode === 'quickReorder'){
      const el = $('modalBody').querySelector('[name="requester"]'); if(el) el.focus();
    } else if(mode === 'quickReturn'){
      const el = $('modalBody').querySelector('[name="loan_id"]'); if(el) el.focus();
    }
  }, 0);
}


// ---- App bootstrap and event handlers (missing from the uploaded source) ----
function nextAssetId(){
  let max = 0;
  assets.forEach(function(a){ const m = String(a.id || '').match(/^EQ-(\d+)$/i); if(m) max = Math.max(max, Number(m[1])); });
  return 'EQ-' + String(max + 1).padStart(3, '0');
}
function showView(name){
  if((name === 'dashboard' || name === 'history') && !isAdmin()) name = 'inventory';
  document.body.classList.toggle('home-active', name==='home');
  document.querySelectorAll('.view').forEach(function(el){ el.classList.toggle('active', el.id === 'view-' + name); });
  document.querySelectorAll('.nav[data-view]').forEach(function(el){ el.classList.toggle('active', el.dataset.view === name); });
}

function scrollToReorderPanel(){
  showView('consumables');
  const el = document.getElementById('reorderPanel');
  if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
}
function firstOutOfStockConsumable(){
  const out = consumables.filter(function(c){ return Number(c.quantity) <= 0; });
  if(out.length) return out[0];
  const low = consumables.filter(function(c){ return Number(c.quantity) <= Number(c.min_quantity); });
  return low.length ? low[0] : null;
}
function openBestReorder(){
  showView('consumables');
  const c = firstOutOfStockConsumable();
  if(c) openModal('reorder', c.id);
  else openModal('quickReorder');
}

function closeModal(){
  $('modalBackdrop').classList.remove('open'); $('modalForm').reset();
  if(window.__labstockFromHome){ window.__labstockFromHome=false; showView('home'); }
}
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
    } else if(modalMode === 'consumable'){
      if(!isAdmin()) throw new Error('소모품 등록·수정은 관리자 로그인이 필요합니다.');
      const payload={name:v.name.trim(),category:(v.category||'기타').trim(),unit:v.unit.trim(),quantity:Number(v.quantity),min_quantity:Number(v.min_quantity),location:v.location.trim(),note:(v.note||'').trim(),updated_at:new Date().toISOString()};
      const result=modalId?await db.from('consumables').update(payload).eq('id',modalId):await db.from('consumables').insert(payload);
      if(result.error) throw result.error;
    } else if(modalMode === 'movement'){
      const c=consumableFor(modalId); if(!c) throw new Error('소모품을 찾을 수 없습니다.');
      const nextQty = (v.movement_type === 'in') ? (Number(c.quantity) + Number(v.quantity)) : (Number(c.quantity) - Number(v.quantity));
      const {data,error}=await db.rpc('record_consumable_movement',{p_consumable_id:c.id,p_movement_type:v.movement_type,p_quantity:Number(v.quantity),p_actor:v.actor.trim(),p_note:(v.note||'').trim()});
      if(error) throw error;
      if(v.movement_type === 'use' && nextQty === 0){ window.__labstockAutoReorderId = c.id; }
    } else if(modalMode === 'reorder'){
      const c=consumableFor(modalId); if(!c) throw new Error('소모품을 찾을 수 없습니다.');
      const {error}=await db.from('reorder_requests').insert({consumable_id:c.id,requested_quantity:Number(v.requested_quantity),requester:v.requester.trim(),note:(v.note||'').trim(),status:'pending'});
      if(error) throw error;
    } else if(modalMode === 'quickReorder'){
      const c=consumableFor(v.consumable_id); if(!c) throw new Error('소모품을 찾을 수 없습니다.');
      const {error}=await db.from('reorder_requests').insert({consumable_id:c.id,requested_quantity:Number(v.requested_quantity),requester:v.requester.trim(),note:(v.note||'').trim(),status:'pending'});
      if(error) throw error;
    } else if(modalMode === 'quickReturn'){
      const target=loans.find(function(l){return String(l.id)===String(v.loan_id);});
      if(!target) throw new Error('대여 기록을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');
      const memo=[target.memo||'',v.return_memo?'반납 메모: '+v.return_memo.trim():''].filter(Boolean).join('\n');
      const {error}=await db.from('loans').update({returned_at:v.returned_at,memo:memo,updated_at:new Date().toISOString()}).eq('id',target.id);
      if(error) throw error;
    } else if(modalMode === 'borrow'){
      // The loans INSERT RLS policy requires an authenticated user_id.
      // Reuse the current session, or create an anonymous auth session if needed.
      const {data: sessionData, error: sessionError} = await db.auth.getSession();
      if(sessionError) throw sessionError;
      let currentSession = sessionData.session;

      if(!currentSession || !currentSession.user || !currentSession.user.id){
        const {data, error} = await db.auth.signInAnonymously();
        if(error) throw error;
        currentSession = data.session;
      }
      if(!currentSession || !currentSession.user || !currentSession.user.id){
        throw new Error('로그인 세션을 생성하지 못했습니다. Supabase에서 익명 로그인을 활성화한 뒤 다시 시도하세요.');
      }
      session = currentSession;

      const {error} = await db.from('loans').insert({
        asset_id: v.asset_id,
        borrower_name: v.borrower_name.trim(),
        borrowed_at: v.borrowed_at,
        due_date: v.due_date,
        memo: (v.memo||'').trim(),
        user_id: currentSession.user.id
      });
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
    if(window.__labstockAutoReorderId){
      const id = window.__labstockAutoReorderId; window.__labstockAutoReorderId = null;
      toast('재고가 0이 되어 구매요청 화면으로 이동합니다.');
      showView('consumables');
      openModal('reorder', id);
    }
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
    if(target.dataset.inventoryCategory){selectedInventoryCategory=target.dataset.inventoryCategory;renderInventory();return;}
    if(target.dataset.borrowCategory){updateBorrowCategory(target.dataset.borrowCategory);return;}
    if(target.dataset.borrow){openModal('borrow',target.dataset.borrow);return;}
    if(target.dataset.edit){openModal('asset',target.dataset.edit);return;}
    if(target.dataset.return){openModal('return',target.dataset.return);return;}
    if(target.dataset.editLoan){openModal('editLoan',target.dataset.editLoan);return;}
    if(target.dataset.editConsumable){openModal('consumable',target.dataset.editConsumable);return;}
    if(target.dataset.reorder){openModal('reorder',target.dataset.reorder);return;}
    if(target.dataset.movement){window.__labstockMovementType=target.dataset.movementType||'use';openModal('movement',target.dataset.movement);return;}
    if(target.dataset.requestStatus){updateRequestStatus(target.dataset.requestStatus,target.dataset.status);return;}
    switch(target.id){
      case 'loginBtn':openModal('login');break;
      case 'logoutBtn':db.auth.signOut().then(function(){session=null;admin=false;setAdminUI();toast('로그아웃했습니다.');loadData();}).catch(function(err){console.error(err);toast('로그아웃 실패: '+err.message);});break;
      case 'addAsset':if(isAdmin())openModal('asset');else toast('관리자 로그인이 필요합니다.');break;
      case 'addConsumable':if(isAdmin())openModal('consumable');else toast('소모품 등록은 관리자 로그인이 필요합니다.');break;
      case 'loanAdd':case 'quickBorrow':openModal('borrow');break;
      case 'homeBorrow':window.__labstockFromHome=true;openModal('borrow');break;
      case 'homeReturn':window.__labstockFromHome=true;openModal('quickReturn');break;
      case 'homeReorder':window.__labstockFromHome=true;openModal('quickReorder');break;
      case 'mobileBorrow':openModal('borrow');break;
      case 'mobileReturn':showView('loans');openModal('quickReturn');break;
      case 'mobileReorder':openBestReorder();break;
      case 'closeModal':case 'cancelModal':closeModal();break;
      case 'exportCsv':exportHistoryCsv();break;
    }
  });
  $('modalForm').addEventListener('submit',saveForm);
  $('modalBackdrop').addEventListener('click',function(e){if(e.target===$('modalBackdrop'))closeModal();});
  $('assetSearch').addEventListener('input',renderInventory);$('assetFilter').addEventListener('change',renderInventory);
  $('modalBody').addEventListener('change',function(e){if(e.target && e.target.name==='borrow_category') updateBorrowCategory(e.target.value);});
  $('consumableSearch').addEventListener('input',renderConsumables);$('consumableFilter').addEventListener('change',renderConsumables);
  $('loanSearch').addEventListener('input',renderLoans);$('loanFilter').addEventListener('change',renderLoans);$('historySearch').addEventListener('input',renderHistory);
}
async function updateRequestStatus(id,status){
  if(!isAdmin()){toast('관리자 로그인이 필요합니다.');return;}
  const {error}=await db.from('reorder_requests').update({status:status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){console.error(error);toast('요청 상태 변경 실패: '+error.message);return;}
  toast(status==='received'?'입고 완료로 변경했습니다.':'주문 진행 중으로 변경했습니다.');await loadData();
}
async function initApp(){
  bindEvents();
  if(window.matchMedia('(max-width:700px)').matches) showView('home');
  if(!db){$('connection').textContent='Supabase 설정 필요';render();return;}
  try{const {data,error}=await db.auth.getSession();if(error)throw error;session=data.session;await refreshAdminState();}
  catch(err){console.warn('세션 확인 실패. 공개 데이터 조회는 계속 시도합니다.',err);}
  await loadData();
}
document.addEventListener('DOMContentLoaded',initApp);

