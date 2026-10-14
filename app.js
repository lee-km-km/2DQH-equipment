/* LabStock v1. Configure SUPABASE_URL and SUPABASE_ANON_KEY below. */
const SUPABASE_URL = 'https://wrnzxduqvhxxadiojuei.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_q8u_SQKOMIypR-5jOvO4NQ_lNjfcRHk';
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
let assets=[], loans=[], session=null, admin=false, borrowedAssetIds=new Set(), modalMode='', modalId=null;
const today=()=>{const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
const dateText=d=>d?String(d).replaceAll('-','.'): '—';
const safe=v=>(v !== null && v !== undefined ? String(v) : '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assetFor=id=>assets.find(a=>a.id===id);
const activeLoanFor=id=>loans.find(l=>l.asset_id===id&&!l.returned_at);
const isAdmin=()=>admin;
const statusFor=a=>{
  if(borrowedAssetIds.has(a.id)) return 'borrowed';
  if(activeLoanFor(a.id)) return 'borrowed';
  if(a.status === 'maintenance') return 'maintenance';
  return 'available';
};
const statusLabel=s=>{
  const map={available:'사용 가능', borrowed:'대여 중', maintenance:'수리 중'};
  if(map[s]) return map[s];
  return s;
};
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
function fmtName(id){const a=assetFor(id);if(a && a.name) return a.name;return id;}
function setAdminUI(){ $('loginBtn').classList.toggle('hidden',isAdmin());$('logoutBtn').classList.toggle('hidden',!isAdmin());document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin()));$('connection').textContent=db?'공용 DB 연결':'설정 필요'; }
async function refreshAdminState(){admin=false;if(db&&session?.user&&!session.user.is_anonymous){const {data,error}=await db.rpc('is_admin');if(error)console.error('관리자 권한 확인 실패:',error);admin=!error&&data===true;}setAdminUI();}
async function loadData(){if(!db){$('connection').textContent='Supabase 설정 필요';render();return}try{const [{data:a,error:ae},{data:l,error:le},{data:av,error:ave}]=await Promise.all([db.from('assets').select('*').order('name'),db.from('loans').select('*').order('borrowed_at',{ascending:false}),db.rpc('get_asset_availability')]);if(ae)throw ae;if(le)throw le;if(ave)throw ave;assets=a?a:[];loans=l?l:[];const avList=av?av:[];borrowedAssetIds=new Set(avList.filter(x=>x.is_borrowed).map(x=>x.asset_id));$('connection').textContent='공용 DB 연결됨';render()}catch(e){$('connection').textContent='DB 오류';console.error(e);toast('데이터를 불러오지 못했습니다. Supabase 설정과 SQL 정책을 확인하세요.')}}
function render(){renderMetrics();renderDashboard();renderInventory();renderLoans();renderHistory();setAdminUI()}
function renderMetrics(){
  const active=loans.filter(l=>!l.returned_at);
  const overdue=active.filter(l=>{if(!l.due_date) return false;return l.due_date < today();});
  const items=[
    ['전체 비품', assets.length, '등록된 품목'],
    ['대여 중', active.length, '현재 사용 중'],
    ['사용 가능', assets.filter(a=>statusFor(a)==='available').length, '바로 대여 가능'],
    ['반납 기한 초과', overdue.length, '확인이 필요한 품목']
  ];
  $('metrics').innerHTML=items.map(x=>'<div class="metric"><div class="label">'+x[0]+'</div><div class="value">'+x[1]+'</div><div class="foot">'+x[2]+'</div></div>').join('');
}
function renderDashboard(){
  const active=loans.filter(l=>!l.returned_at).sort((a,b)=>{
    const da=a.due_date?a.due_date:'';
    const dbDate=b.due_date?b.due_date:'';
    return da.localeCompare(dbDate);
  });
  
  if(active.length > 0) {
    let rowsHtml = '';
    for(let i=0; i<Math.min(active.length, 7); i++) {
      const l = active[i];
      const isOverdue = l.due_date && l.due_date < today();
      rowsHtml += '<tr><td><b>' + safe(fmtName(l.asset_id)) + '</b><div class="asset-id">' + safe(l.asset_id) + '</div></td><td>' + safe(l.borrower_name) + '</td><td>' + dateText(l.due_date) + '</td><td><span class="status ' + (isOverdue ? 'borrowed' : 'available') + '">' + (isOverdue ? '기한 초과' : '대여 중') + '</span></td></tr>';
    }
    $('dashboardLoans').innerHTML = '<table><thead><tr><th>비품</th><th>대여자</th><th>반납 예정</th><th>상태</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  } else {
    $('dashboardLoans').innerHTML = '<div class="empty">현재 대여 중인 비품이 없습니다.</div>';
  }

  const getTime=item=>{if(item.updated_at) return item.updated_at;if(item.borrowed_at) return item.borrowed_at;return '';};
  const recent=[...loans].sort((a,b)=>getTime(b).localeCompare(getTime(a))).slice(0,5);
  
  let recentHtml = '';
  for(let i=0; i<recent.length; i++) {
    const l = recent[i];
    recentHtml += '<div class="activity-item"><b>' + safe(l.borrower_name) + '</b> · ' + safe(fmtName(l.asset_id)) + '<small>' + dateText(l.returned_at ? l.returned_at : l.borrowed_at) + ' · ' + (l.returned_at ? '반납 완료' : '대여 등록') + '</small></div>';
  }
  $('recentActivity').innerHTML = recentHtml || '<div class="empty">아직 활동이 없습니다.</div>';
}
function renderInventory(){
  const q=$('assetSearch').value.trim().toLowerCase();
  const f=$('assetFilter').value;
  const list=assets.filter(a=>{
    const matchFilter=(f==='all'?true:statusFor(a)===f);
    const textTarget=[a.id,a.name,a.category,a.location,a.note].join(' ').toLowerCase();
    const matchSearch=textTarget.includes(q);
    return matchFilter&&matchSearch;
  });
  
  if(list.length > 0) {
    let listHtml = '';
    for(let i=0; i<list.length; i++) {
      const a = list[i];
      const l = activeLoanFor(a.id);
      const st = statusFor(a);
      const bName = l && l.borrower_name ? l.borrower_name : '—';
      const loc = a.location ? a.location : '—';
      let actionBtn = '';
      if(st === 'available') {
        actionBtn += '<button class="text-btn" data-borrow="' + safe(a.id) + '">대여</button>';
      }
      if(isAdmin()) {
        actionBtn += '<button class="text-btn" data-edit="' + safe(a.id) + '">수정