import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import './config.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const DEFAULT_CATEGORIES = ['Ăn uống','Đi lại','Mua sắm','Nhà cửa','Hóa đơn','Giải trí','Sức khỏe','Học tập','Gia đình','Khác'];
const CATEGORY_HINTS = {
  'Ăn uống':['ăn','sáng','trưa','tối','cơm','bún','phở','cafe','cà phê','nước','trà','đồ ăn'],
  'Đi lại':['xăng','xe','grab','taxi','bus','vé xe','gửi xe'],
  'Mua sắm':['mua','shop','quần','áo','giày','đồ'],
  'Nhà cửa':['nhà','nội thất','sửa nhà'],
  'Hóa đơn':['điện','nước','wifi','internet','điện thoại','cước'],
  'Giải trí':['game','phim','netflix','spotify','karaoke'],
  'Sức khỏe':['thuốc','khám','bệnh viện','vitamin'],
  'Học tập':['sách','học','khóa học','vở','bút'],
  'Gia đình':['gia đình','bố','mẹ','con'],
};

const state = {
  supabase: null,
  user: null,
  mode: 'guest',
  expenses: [],
  categories: [],
  currentView: 'dashboard',
  periodMode: 'day',
  periodCursor: new Date(),
  charts: {daily:null, category:null},
  bulkMode: 'day',
  bulkCursor: new Date(),
  summaryMode: 'day',
  summaryCursor: new Date()
};

const cfg = window.POLIME_CONFIG || {};
const cloudConfigured = /^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl || '') && (cfg.supabaseAnonKey || '').length > 20;
if (cloudConfigured) state.supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const STORAGE_EXPENSES = 'polime_guest_expenses_v1';
const STORAGE_CATEGORIES = 'polime_guest_categories_v1';
const STORAGE_THEME = 'polime_theme_v1';

function money(n){ return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(n)||0); }
function localISODate(d = new Date()){ const x = new Date(d.getTime() - d.getTimezoneOffset()*60000); return x.toISOString().slice(0,10); }
function parseDateOnly(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); }
function expenseDate(e){ return new Date(`${e.spent_on}T${e.spent_time || '12:00'}:00`); }
function dateLabel(e){ return `${new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(parseDateOnly(e.spent_on))} ${String(e.spent_time || '').slice(0,5)}`.trim(); }
function sum(list){ return list.reduce((a,e)=>a+Number(e.amount||0),0); }
function escapeHtml(v=''){ return String(v).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d){ const x=startOfDay(d); const day=x.getDay() || 7; x.setDate(x.getDate()-day+1); return x; }
function endOfWeek(d){ const x=startOfWeek(d); x.setDate(x.getDate()+6); return endOfDay(x); }
function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1); }
function endOfMonth(d){ return endOfDay(new Date(d.getFullYear(),d.getMonth()+1,0)); }
function startOfYear(d){ return new Date(d.getFullYear(),0,1); }
function endOfYear(d){ return endOfDay(new Date(d.getFullYear(),11,31)); }
function within(e,a,b){ const d=expenseDate(e); return d>=a && d<=b; }
function toast(msg,type=''){ const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=msg; $('#toastContainer').appendChild(el); setTimeout(()=>el.remove(),3200); }
function openModal(id){
  const m=$(`#${id}`); if(!m) return;
  m.classList.remove('hidden','closing');
  requestAnimationFrame(()=>m.classList.add('is-open'));
}
function closeModal(id){
  const m=$(`#${id}`); if(!m||m.classList.contains('hidden')) return;
  m.classList.remove('is-open'); m.classList.add('closing');
  setTimeout(()=>{m.classList.add('hidden');m.classList.remove('closing');},190);
}

function saveGuest(){ localStorage.setItem(STORAGE_EXPENSES,JSON.stringify(state.expenses)); localStorage.setItem(STORAGE_CATEGORIES,JSON.stringify(state.categories)); }
function loadGuest(){
  try { state.expenses=JSON.parse(localStorage.getItem(STORAGE_EXPENSES)||'[]'); } catch { state.expenses=[]; }
  try { state.categories=JSON.parse(localStorage.getItem(STORAGE_CATEGORIES)||'[]'); } catch { state.categories=[]; }
  if(!state.categories.length) state.categories=DEFAULT_CATEGORIES.map(name=>({id:uid(),name,is_default:true}));
  saveGuest();
}

async function initAuth(){
  if(!state.supabase){ loadGuest(); updateSyncUI(); return; }
  const {data:{session}} = await state.supabase.auth.getSession();
  if(session?.user) await enterCloud(session.user); else { loadGuest(); updateSyncUI(); }
  state.supabase.auth.onAuthStateChange(async (event,session)=>{
    if(event==='SIGNED_IN' && session?.user && state.mode!=='cloud') await enterCloud(session.user,true);
    if(event==='SIGNED_OUT'){ state.user=null; state.mode='guest'; loadGuest(); updateSyncUI(); renderAll(); }
  });
}

async function enterCloud(user, offerMigration=false){
  const guestExpenses = (()=>{try{return JSON.parse(localStorage.getItem(STORAGE_EXPENSES)||'[]')}catch{return[]}})();
  const guestCategories = (()=>{try{return JSON.parse(localStorage.getItem(STORAGE_CATEGORIES)||'[]')}catch{return[]}})();
  state.user=user; state.mode='cloud';
  await loadCloud();
  if(offerMigration && guestExpenses.length && confirm(`Bạn đang có ${guestExpenses.length} khoản chi ở chế độ dùng thử. Đồng bộ chúng lên tài khoản này?`)){
    await migrateGuestToCloud(guestExpenses,guestCategories);
    await loadCloud();
    localStorage.removeItem(STORAGE_EXPENSES); localStorage.removeItem(STORAGE_CATEGORIES);
  }
  updateSyncUI(); renderAll(); closeModal('authModal'); toast('Đã đăng nhập và bật đồng bộ online.','success');
}

async function loadCloud(){
  const [{data:cats,error:ce},{data:exps,error:ee}] = await Promise.all([
    state.supabase.from('categories').select('*').order('created_at',{ascending:true}),
    state.supabase.from('expenses').select('*').order('spent_on',{ascending:false}).order('spent_time',{ascending:false})
  ]);
  if(ce||ee){ toast((ce||ee).message,'error'); return; }
  if(!cats.length){
    const payload=DEFAULT_CATEGORIES.map(name=>({user_id:state.user.id,name,is_default:true}));
    const {error}=await state.supabase.from('categories').insert(payload); if(error) toast(error.message,'error');
    const {data}=await state.supabase.from('categories').select('*').order('created_at'); state.categories=data||[];
  } else state.categories=cats;
  state.expenses=exps||[];
}

async function migrateGuestToCloud(expenses,categories){
  const existingNames=new Set(state.categories.map(c=>c.name.toLowerCase()));
  const missing=(categories||[]).filter(c=>!existingNames.has(c.name.toLowerCase())).map(c=>({user_id:state.user.id,name:c.name,is_default:!!c.is_default}));
  if(missing.length) await state.supabase.from('categories').insert(missing);
  const payload=expenses.map(e=>({user_id:state.user.id,amount:Number(e.amount),category:e.category,note:e.note||'',payment_method:e.payment_method||'Tiền mặt',spent_on:e.spent_on,spent_time:e.spent_time||'12:00'}));
  if(payload.length){ const {error}=await state.supabase.from('expenses').insert(payload); if(error) toast(error.message,'error'); }
}

function updateSyncUI(){
  const cloud=state.mode==='cloud'; $('#syncDot').classList.toggle('online',cloud); $('#syncTitle').textContent=cloud?'Đã đồng bộ online':'Chế độ dùng thử'; $('#syncText').textContent=cloud?(state.user?.email||'Supabase'):'Dữ liệu đang lưu trên thiết bị'; $('#authOpenBtn').classList.toggle('hidden',cloud); $('#logoutBtn').classList.toggle('hidden',!cloud);
  $('#authNote').textContent = cloudConfigured ? 'Tài khoản dùng Supabase Auth. Sau khi đăng nhập, dữ liệu của mỗi tài khoản được tách riêng.' : 'Supabase chưa được cấu hình. Hãy điền URL và anon/publishable key trong config.js để bật đăng ký, đăng nhập và đồng bộ online.';
}

function renderAll(){ renderCategoriesInForms(); renderDashboard(); renderPeriod(); renderHistory(); renderCategoryManager(); renderSummary(); refreshBulkCategoryOptions(); }
function getRange(mode,cursor){ if(mode==='day') return [startOfDay(cursor),endOfDay(cursor)]; if(mode==='week') return [startOfWeek(cursor),endOfWeek(cursor)]; if(mode==='month') return [startOfMonth(cursor),endOfMonth(cursor)]; return [startOfYear(cursor),endOfYear(cursor)]; }
function listFor(mode,cursor){ const [a,b]=getRange(mode,cursor); return state.expenses.filter(e=>within(e,a,b)); }
function pluralCount(n){ return `${n} khoản chi`; }

function renderDashboard(){
  const now=new Date(); const blocks=[['Day','day'],['Week','week'],['Month','month'],['Year','year']];
  for(const [cap,mode] of blocks){ const list=listFor(mode,now); $(`#stat${cap}`).textContent=money(sum(list)); $(`#stat${cap}Count`).textContent=pluralCount(list.length); }
  renderExpenseRows($('#recentBody'), [...state.expenses].sort((a,b)=>expenseDate(b)-expenseDate(a)).slice(0,10));
  renderCharts();
}

function renderCharts(){ if(!window.Chart) return setTimeout(renderCharts,250);
  const text=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(); const line=getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
  const days=[]; const vals=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(new Intl.DateTimeFormat('vi-VN',{weekday:'short',day:'2-digit'}).format(d)); vals.push(sum(listFor('day',d))); }
  state.charts.daily?.destroy(); state.charts.daily=new Chart($('#dailyChart'),{type:'bar',data:{labels:days,datasets:[{data:vals,borderRadius:8,backgroundColor:'#6a74f5'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw)}}},scales:{x:{grid:{display:false},ticks:{color:text}},y:{beginAtZero:true,grid:{color:line},ticks:{color:text,callback:v=>v>=1000000?`${v/1000000}tr`:v>=1000?`${v/1000}k`:v}}}}});
  const month=listFor('month',new Date()); const map={}; month.forEach(e=>map[e.category]=(map[e.category]||0)+Number(e.amount)); const entries=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  state.charts.category?.destroy(); state.charts.category=new Chart($('#categoryChart'),{type:'doughnut',data:{labels:entries.length?entries.map(x=>x[0]):['Chưa có dữ liệu'],datasets:[{data:entries.length?entries.map(x=>x[1]):[1],backgroundColor:entries.length?['#5b67f1','#9b6ce8','#16a675','#ef9252','#e65c72','#4aa4e8','#d0a03c','#6db06b','#9b768e','#8792a9']:['#d9deea'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'67%',plugins:{legend:{position:'bottom',labels:{color:text,boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:c=>entries.length?`${c.label}: ${money(c.raw)}`:'Chưa có dữ liệu'}}}}});
}

function renderPeriod(){
  const mode=state.periodMode,c=state.periodCursor,list=listFor(mode,c); const total=sum(list); $('#periodTotal').textContent=money(total); $('#periodCount').textContent=list.length; $('#periodAverage').textContent=money(list.length?total/list.length:0); $('#periodLabel').textContent=periodLabel(mode,c); $('#periodEyebrow').textContent=({day:'Ngày đang xem',week:'Tuần đang xem',month:'Tháng đang xem',year:'Năm đang xem'})[mode];
  renderExpenseRows($('#periodBody'), [...list].sort((a,b)=>expenseDate(b)-expenseDate(a))); $('#periodExpenseSubtitle').textContent=pluralCount(list.length);
  const breakdown=$('#periodBreakdown'); breakdown.innerHTML=''; const items=buildBreakdown(mode,c,list); $('#breakdownTitle').textContent=mode==='year'?'12 tháng trong năm':mode==='month'?'Các ngày trong tháng':mode==='week'?'7 ngày trong tuần':'Theo danh mục';
  for(const item of items){ const btn=document.createElement('button'); btn.className='breakdown-item'; btn.innerHTML=`<span>${escapeHtml(item.label)}</span><strong>${money(item.total)}</strong><small>${pluralCount(item.items.length)}</small>`; btn.addEventListener('click',()=>showDetail(item.label,item.items)); breakdown.appendChild(btn); }
}
function periodLabel(mode,d){ const f=new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}); if(mode==='day') return f.format(d); if(mode==='week'){const [a,b]=getRange(mode,d); return `${f.format(a)} – ${f.format(b)}`;} if(mode==='month') return `Tháng ${d.getMonth()+1}/${d.getFullYear()}`; return `Năm ${d.getFullYear()}`; }
function buildBreakdown(mode,c,list){
  if(mode==='year') return Array.from({length:12},(_,m)=>{ const a=new Date(c.getFullYear(),m,1),b=endOfMonth(a),items=list.filter(e=>within(e,a,b)); return {label:`Tháng ${m+1}`,total:sum(items),items}; });
  if(mode==='month'){ const days=new Date(c.getFullYear(),c.getMonth()+1,0).getDate(); return Array.from({length:days},(_,i)=>{ const d=new Date(c.getFullYear(),c.getMonth(),i+1),items=list.filter(e=>within(e,startOfDay(d),endOfDay(d))); return {label:`Ngày ${String(i+1).padStart(2,'0')}/${String(c.getMonth()+1).padStart(2,'0')}`,total:sum(items),items}; }); }
  if(mode==='week'){ const start=startOfWeek(c); return Array.from({length:7},(_,i)=>{ const d=new Date(start); d.setDate(d.getDate()+i); const items=list.filter(e=>within(e,startOfDay(d),endOfDay(d))); return {label:new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit'}).format(d),total:sum(items),items}; }); }
  const map={}; list.forEach(e=>{(map[e.category] ||= []).push(e)}); return Object.entries(map).map(([label,items])=>({label,total:sum(items),items})).sort((a,b)=>b.total-a.total);
}

function renderExpenseRows(tbody,list){
  if(!list.length){ tbody.innerHTML='<tr><td class="empty-cell" colspan="6">Chưa có khoản chi nào.</td></tr>'; return; }
  tbody.innerHTML=list.map(e=>`<tr><td>${escapeHtml(dateLabel(e))}</td><td><span class="category-pill">${escapeHtml(e.category)}</span></td><td>${escapeHtml(e.note)}</td><td>${escapeHtml(e.payment_method||'')}</td><td class="amount-cell">${money(e.amount)}</td><td><div class="row-actions"><button class="row-btn" data-edit="${e.id}" title="Sửa">✎</button><button class="row-btn" data-delete="${e.id}" title="Xóa">×</button></div></td></tr>`).join('');
}

function renderHistory(){
  const q=$('#historySearch').value.trim().toLowerCase(),cat=$('#historyCategory').value,from=$('#historyFrom').value,to=$('#historyTo').value;
  const list=[...state.expenses].filter(e=>(!q||`${e.note} ${e.category} ${e.payment_method}`.toLowerCase().includes(q))&&(!cat||e.category===cat)&&(!from||e.spent_on>=from)&&(!to||e.spent_on<=to)).sort((a,b)=>expenseDate(b)-expenseDate(a));
  renderExpenseRows($('#historyBody'),list); $('#historyTotal').textContent=money(sum(list));
}
function renderCategoriesInForms(){
  const current=$('#expenseCategory').value; $('#expenseCategory').innerHTML=state.categories.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join(''); if(state.categories.some(c=>c.name===current)) $('#expenseCategory').value=current;
  const hc=$('#historyCategory'),hcv=hc.value; hc.innerHTML='<option value="">Tất cả danh mục</option>'+state.categories.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join(''); hc.value=hcv;
}
function renderCategoryManager(){ const counts={}; state.expenses.forEach(e=>counts[e.category]=(counts[e.category]||0)+1); $('#categoryList').innerHTML=state.categories.map(c=>`<div class="category-item"><div><b>${escapeHtml(c.name)}</b><small>${pluralCount(counts[c.name]||0)}</small></div><button class="row-btn" data-delete-category="${c.id}" title="Xóa danh mục">×</button></div>`).join(''); }
function showDetail(title,items){ $('#detailTitle').textContent=title; $('#detailSubtitle').textContent=pluralCount(items.length); $('#detailTotal').textContent=money(sum(items)); const body=$('#detailBody'); if(!items.length) body.innerHTML='<tr><td class="empty-cell" colspan="4">Không có khoản chi.</td></tr>'; else body.innerHTML=[...items].sort((a,b)=>expenseDate(b)-expenseDate(a)).map(e=>`<tr><td>${escapeHtml(dateLabel(e))}</td><td><span class="category-pill">${escapeHtml(e.category)}</span></td><td>${escapeHtml(e.note)}</td><td class="amount-cell">${money(e.amount)}</td></tr>`).join(''); openModal('detailModal'); }

async function saveExpense(data,id=''){
  if(state.mode==='cloud'){
    if(id){ const {error}=await state.supabase.from('expenses').update(data).eq('id',id); if(error) throw error; }
    else { const {error}=await state.supabase.from('expenses').insert({...data,user_id:state.user.id}); if(error) throw error; }
    await loadCloud();
  } else {
    if(id){ const i=state.expenses.findIndex(e=>e.id===id); if(i>=0) state.expenses[i]={...state.expenses[i],...data}; }
    else state.expenses.push({id:uid(),...data,created_at:new Date().toISOString()});
    saveGuest();
  }
}
async function deleteExpense(id){
  if(!confirm('Xóa khoản chi này?')) return;
  if(state.mode==='cloud'){ const {error}=await state.supabase.from('expenses').delete().eq('id',id); if(error) return toast(error.message,'error'); await loadCloud(); }
  else { state.expenses=state.expenses.filter(e=>e.id!==id); saveGuest(); }
  renderAll(); toast('Đã xóa khoản chi.','success');
}
async function addCategory(name){
  name=name.trim(); if(!name) return; if(state.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())) return toast('Danh mục đã tồn tại.','error');
  if(state.mode==='cloud'){ const {error}=await state.supabase.from('categories').insert({user_id:state.user.id,name,is_default:false}); if(error) return toast(error.message,'error'); await loadCloud(); }
  else { state.categories.push({id:uid(),name,is_default:false}); saveGuest(); }
  renderAll(); toast('Đã thêm danh mục.','success');
}
async function deleteCategory(id){
  const c=state.categories.find(x=>String(x.id)===String(id)); if(!c) return; if(state.categories.length<=1) return toast('Cần giữ lại ít nhất 1 danh mục.','error'); if(!confirm(`Xóa danh mục “${c.name}”? Các khoản chi cũ vẫn giữ tên danh mục này.`)) return;
  if(state.mode==='cloud'){ const {error}=await state.supabase.from('categories').delete().eq('id',id); if(error) return toast(error.message,'error'); await loadCloud(); }
  else { state.categories=state.categories.filter(x=>String(x.id)!==String(id)); saveGuest(); }
  renderAll(); toast('Đã xóa danh mục.','success');
}

function openExpense(e=null){
  $('#expenseForm').reset(); $('#expenseId').value=e?.id||''; $('#expenseModalTitle').textContent=e?'Sửa chi tiêu':'Thêm chi tiêu'; const now=new Date(); $('#expenseDate').value=e?.spent_on||localISODate(now); $('#expenseTime').value=(e?.spent_time||`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`).slice(0,5); if(e){ $('#expenseAmount').value=new Intl.NumberFormat('vi-VN').format(e.amount); if(!state.categories.some(c=>c.name===e.category)){ const opt=document.createElement('option'); opt.value=e.category; opt.textContent=`${e.category} (đã xóa)`; $('#expenseCategory').appendChild(opt); } $('#expenseCategory').value=e.category; $('#expenseNote').value=e.note; $('#expensePayment').value=e.payment_method||'Tiền mặt'; } openModal('expenseModal'); setTimeout(()=>$('#quickInput').focus(),50);
}
function parseAmount(v){ return Number(String(v).replace(/\./g,'').replace(/,/g,'').replace(/[^\d]/g,''))||0; }
function parseQuick(v){
  const s=v.trim().toLowerCase(); const m=s.match(/(\d+(?:[.,]\d+)?)\s*(k|tr|m|nghìn|ngan|triệu)?/i); if(!m) return null; let n=Number(m[1].replace(',','.')); const unit=(m[2]||'').toLowerCase(); if(['k','nghìn','ngan'].includes(unit)) n*=1000; if(['tr','m','triệu'].includes(unit)) n*=1000000; const note=v.replace(m[0],'').trim()||'Chi tiêu'; let cat='Khác'; for(const [name,keys] of Object.entries(CATEGORY_HINTS)){ if(keys.some(k=>note.toLowerCase().includes(k))){cat=name;break;} } if(!state.categories.some(c=>c.name===cat)) cat=state.categories[0]?.name||'Khác'; return {amount:Math.round(n),note,category:cat};
}


function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function clampDateToRange(d,a,b){ return d<a?new Date(a):d>b?new Date(b):new Date(d); }
function modeRangeLabel(mode,cursor){ return periodLabel(mode,cursor); }
function bulkDefaultDate(){
  const [a,b]=getRange(state.bulkMode,state.bulkCursor); return localISODate(clampDateToRange(new Date(),a,b));
}
function categoryOptions(selected=''){
  return state.categories.map(c=>`<option value="${escapeHtml(c.name)}" ${c.name===selected?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
}
function paymentOptions(selected='Tiền mặt'){
  return ['Tiền mặt','Chuyển khoản','Thẻ','Ví điện tử','Khác'].map(x=>`<option ${x===selected?'selected':''}>${x}</option>`).join('');
}
function bulkRowHTML(date=bulkDefaultDate(), index=1){
  const now=new Date(),tm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return `<tr class="bulk-row"><td class="row-number">${index}</td><td><input class="sheet-input bulk-date" type="date" value="${date}"></td><td><input class="sheet-input bulk-time" type="time" value="${tm}"></td><td><select class="sheet-input bulk-category">${categoryOptions(state.categories[0]?.name||'')}</select></td><td><input class="sheet-input bulk-note" maxlength="120" placeholder="Nội dung chi tiêu"></td><td><select class="sheet-input bulk-payment">${paymentOptions()}</select></td><td><input class="sheet-input bulk-amount money-input" inputmode="numeric" placeholder="0"></td><td><button class="row-btn bulk-remove" title="Xóa dòng">×</button></td></tr>`;
}
function renumberBulkRows(){ $$('#bulkBody .bulk-row').forEach((tr,i)=>{ const n=$('.row-number',tr); if(n)n.textContent=i+1; }); }
function addBulkRow(date=bulkDefaultDate()){ $('#bulkBody').insertAdjacentHTML('beforeend',bulkRowHTML(date,$$('#bulkBody .bulk-row').length+1)); updateBulkDraftTotal(); }
function clearBulkRows(){ $('#bulkBody').innerHTML=''; }
function generateBulkTemplate(){
  clearBulkRows(); const c=state.bulkCursor,mode=state.bulkMode;
  if(mode==='day'){ for(let i=0;i<5;i++) addBulkRow(localISODate(c)); }
  else if(mode==='week'){ const s=startOfWeek(c); for(let i=0;i<7;i++) addBulkRow(localISODate(addDays(s,i))); }
  else if(mode==='month'){ const days=new Date(c.getFullYear(),c.getMonth()+1,0).getDate(); for(let i=1;i<=days;i++) addBulkRow(localISODate(new Date(c.getFullYear(),c.getMonth(),i))); }
  else { for(let m=0;m<12;m++) addBulkRow(localISODate(new Date(c.getFullYear(),m,1))); }
  updateBulkDraftTotal();
}
function updateBulkPeriodUI(){
  $('#bulkPeriodLabel').textContent=modeRangeLabel(state.bulkMode,state.bulkCursor);
}
function updateBulkDraftTotal(){
  const total=$$('#bulkBody .bulk-amount').reduce((a,x)=>a+parseAmount(x.value),0); $('#bulkDraftTotal').textContent=money(total);
}
function refreshBulkCategoryOptions(){
  $$('#bulkBody .bulk-category').forEach(sel=>{ const v=sel.value; sel.innerHTML=categoryOptions(v); if(state.categories.some(c=>c.name===v)) sel.value=v; });
}
function readBulkRows(){
  const [a,b]=getRange(state.bulkMode,state.bulkCursor); const out=[]; let invalidDate=false;
  $$('#bulkBody .bulk-row').forEach(tr=>{
    const amount=parseAmount($('.bulk-amount',tr).value); if(!amount) return;
    const spent_on=$('.bulk-date',tr).value, d=parseDateOnly(spent_on); if(d<a||d>b) invalidDate=true;
    out.push({amount,category:$('.bulk-category',tr).value,note:$('.bulk-note',tr).value.trim()||'Chi tiêu',payment_method:$('.bulk-payment',tr).value,spent_on,spent_time:$('.bulk-time',tr).value||'12:00'});
  });
  if(invalidDate) throw new Error('Có ngày nằm ngoài kỳ đang chọn. Hãy sửa ngày hoặc đổi kỳ nhập.');
  return out;
}
async function saveBulkRows(){
  let rows; try{ rows=readBulkRows(); }catch(e){ return toast(e.message,'error'); }
  if(!rows.length) return toast('Chưa có dòng nào có số tiền để lưu.','error');
  const btn=$('#bulkSaveBtn'); btn.disabled=true; btn.textContent='Đang lưu...';
  try{
    if(state.mode==='cloud'){
      const payload=rows.map(x=>({...x,user_id:state.user.id})); const {error}=await state.supabase.from('expenses').insert(payload); if(error) throw error; await loadCloud();
    }else{
      const now=new Date().toISOString(); state.expenses.push(...rows.map(x=>({id:uid(),...x,created_at:now}))); saveGuest();
    }
    renderAll(); generateBulkTemplate(); toast(`Đã lưu ${rows.length} khoản chi. Tổng ${money(sum(rows))}.`,'success');
  }catch(e){ toast(e.message||'Không thể lưu bảng.','error'); }
  finally{ btn.disabled=false; btn.textContent='Lưu tất cả'; }
}

function summaryBuckets(mode,c){
  if(mode==='day'){
    const s=startOfWeek(c); return Array.from({length:7},(_,i)=>{const d=addDays(s,i);return {label:new Intl.DateTimeFormat('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit'}).format(d),a:startOfDay(d),b:endOfDay(d)}});
  }
  if(mode==='week'){
    const ms=startOfMonth(c),me=endOfMonth(c); let s=startOfWeek(ms),arr=[],i=1; while(s<=me){const e=endOfWeek(s);arr.push({label:`Tuần ${i++}\n${String(Math.max(s,ms).getDate()).padStart(2,'0')}/${String(c.getMonth()+1).padStart(2,'0')}`,a:new Date(Math.max(s,ms)),b:new Date(Math.min(e,me))});s=addDays(s,7);} return arr;
  }
  if(mode==='month') return Array.from({length:12},(_,m)=>{const d=new Date(c.getFullYear(),m,1);return {label:`Tháng ${m+1}`,a:startOfMonth(d),b:endOfMonth(d)}});
  const startY=c.getFullYear()-2; return Array.from({length:5},(_,i)=>{const d=new Date(startY+i,0,1);return {label:`Năm ${d.getFullYear()}`,a:startOfYear(d),b:endOfYear(d)}});
}
function summaryContextLabel(mode,c){
  if(mode==='day'){const [a,b]=[startOfWeek(c),endOfWeek(c)];return `Tuần ${new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(a)} – ${new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(b)}`;}
  if(mode==='week') return `Tháng ${c.getMonth()+1}/${c.getFullYear()}`;
  if(mode==='month') return `Năm ${c.getFullYear()}`;
  return `${c.getFullYear()-2} – ${c.getFullYear()+2}`;
}
function renderSummary(){
  const table=$('#summaryTable'); if(!table) return; const mode=state.summaryMode,c=state.summaryCursor,buckets=summaryBuckets(mode,c);
  $('#summaryEyebrow').textContent=`Bảng theo ${{day:'ngày',week:'tuần',month:'tháng',year:'năm'}[mode]}`; $('#summaryPeriodLabel').textContent=summaryContextLabel(mode,c);
  $$('.summary-tab').forEach(b=>b.classList.toggle('active',b.dataset.summaryMode===mode));
  const categoryNames=[...new Set([...state.categories.map(x=>x.name),...state.expenses.map(x=>x.category)])];
  const rows=categoryNames.map(cat=>{
    const vals=buckets.map(b=>sum(state.expenses.filter(e=>e.category===cat&&within(e,b.a,b.b)))); return {cat,vals,total:vals.reduce((a,v)=>a+v,0)};
  }).filter(r=>r.total>0 || state.categories.some(c=>c.name===r.cat));
  const colTotals=buckets.map((_,i)=>rows.reduce((a,r)=>a+r.vals[i],0)),grand=colTotals.reduce((a,v)=>a+v,0);
  const th=buckets.map(b=>`<th class="summary-period-th">${escapeHtml(b.label).replace(/\n/g,'<br>')}</th>`).join('');
  const body=rows.map(r=>`<tr><th class="summary-row-head">${escapeHtml(r.cat)}</th>${r.vals.map(v=>`<td class="summary-value ${v?'has-value':''}">${v?money(v):'—'}</td>`).join('')}<td class="summary-row-total">${money(r.total)}</td></tr>`).join('');
  table.innerHTML=`<thead><tr><th class="summary-row-head sticky-col">Danh mục</th>${th}<th class="summary-total-head">Tổng danh mục</th></tr></thead><tbody>${body||`<tr><td colspan="${buckets.length+2}" class="empty-cell">Chưa có dữ liệu.</td></tr>`}</tbody><tfoot><tr><th class="summary-row-head sticky-col">TỔNG CHI</th>${colTotals.map(v=>`<th class="summary-col-total">${money(v)}</th>`).join('')}<th class="summary-grand-total">${money(grand)}</th></tr></tfoot>`;
}
function moveSummary(dir){ const d=new Date(state.summaryCursor),m=state.summaryMode; if(m==='day')d.setDate(d.getDate()+7*dir); else if(m==='week')d.setMonth(d.getMonth()+dir); else if(m==='month')d.setFullYear(d.getFullYear()+dir); else d.setFullYear(d.getFullYear()+5*dir); state.summaryCursor=d; renderSummary(); }

function setView(view){
  state.currentView=view; $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); $$('.view').forEach(v=>v.classList.remove('active')); const titles={dashboard:'Tổng quan',day:'Hôm nay',week:'Theo tuần',month:'Theo tháng',year:'Theo năm',bulk:'Nhập dạng bảng',summary:'Bảng tổng hợp',history:'Lịch sử',categories:'Danh mục'}; $('#viewTitle').textContent=titles[view]||'Quản Lý Polime'; if(['day','week','month','year'].includes(view)){state.periodMode=view; $('#periodView').classList.add('active'); renderPeriod();} else { const target=$(`#${view}View`); if(target) target.classList.add('active'); } if(view==='bulk'){ updateBulkPeriodUI(); if(!$('#bulkBody').children.length) generateBulkTemplate(); } if(view==='summary') renderSummary(); $('#sidebar').classList.remove('open');
}
function movePeriod(dir){ const d=new Date(state.periodCursor); if(state.periodMode==='day') d.setDate(d.getDate()+dir); else if(state.periodMode==='week') d.setDate(d.getDate()+7*dir); else if(state.periodMode==='month') d.setMonth(d.getMonth()+dir); else d.setFullYear(d.getFullYear()+dir); state.periodCursor=d; renderPeriod(); }

function bind(){
  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view))); $$('[data-jump-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.jumpView))); $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open'); $('#addExpenseBtn').onclick=()=>openExpense(); $('#openBulkBtn').onclick=()=>setView('bulk'); $$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close)); $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m) closeModal(m.id)}));
  $('#themeBtn').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark'; document.documentElement.dataset.theme=next; localStorage.setItem(STORAGE_THEME,next); $('#themeBtn').textContent=next==='dark'?'☀':'☾'; setTimeout(()=>{renderCharts()},30);};
  $('#prevPeriodBtn').onclick=()=>movePeriod(-1); $('#nextPeriodBtn').onclick=()=>movePeriod(1); $('#currentPeriodBtn').onclick=()=>{state.periodCursor=new Date();renderPeriod()};
  $('#bulkMode').onchange=e=>{state.bulkMode=e.target.value;state.bulkCursor=parseDateOnly($('#bulkAnchor').value||localISODate());updateBulkPeriodUI();generateBulkTemplate();};
  $('#bulkAnchor').onchange=e=>{state.bulkCursor=parseDateOnly(e.target.value||localISODate());updateBulkPeriodUI();generateBulkTemplate();};
  $('#bulkAddRowBtn').onclick=()=>addBulkRow(); $('#bulkGenerateBtn').onclick=generateBulkTemplate; $('#bulkSaveBtn').onclick=saveBulkRows;
  $('#bulkBody').addEventListener('input',e=>{ if(e.target.classList.contains('bulk-amount')){const n=parseAmount(e.target.value);e.target.value=n?new Intl.NumberFormat('vi-VN').format(n):'';updateBulkDraftTotal();} });
  $('#bulkBody').addEventListener('click',e=>{const b=e.target.closest('.bulk-remove');if(b){b.closest('tr').remove();renumberBulkRows();updateBulkDraftTotal();}});
  $$('.summary-tab').forEach(b=>b.onclick=()=>{state.summaryMode=b.dataset.summaryMode;renderSummary();}); $('#summaryPrevBtn').onclick=()=>moveSummary(-1); $('#summaryNextBtn').onclick=()=>moveSummary(1); $('#summaryCurrentBtn').onclick=()=>{state.summaryCursor=new Date();renderSummary();};
  $('#expenseAmount').addEventListener('input',e=>{const n=parseAmount(e.target.value); e.target.value=n?new Intl.NumberFormat('vi-VN').format(n):'';}); $('#quickInput').addEventListener('input',e=>{const p=parseQuick(e.target.value); if(p){$('#expenseAmount').value=new Intl.NumberFormat('vi-VN').format(p.amount);$('#expenseNote').value=p.note;$('#expenseCategory').value=p.category;}});
  $('#expenseForm').addEventListener('submit',async e=>{e.preventDefault(); const data={amount:parseAmount($('#expenseAmount').value),category:$('#expenseCategory').value,note:$('#expenseNote').value.trim(),payment_method:$('#expensePayment').value,spent_on:$('#expenseDate').value,spent_time:$('#expenseTime').value}; if(data.amount<=0) return toast('Số tiền phải lớn hơn 0.','error'); try{await saveExpense(data,$('#expenseId').value);closeModal('expenseModal');renderAll();toast('Đã lưu khoản chi.','success');}catch(err){toast(err.message||'Không thể lưu dữ liệu.','error')}});
  document.body.addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]'),dc=e.target.closest('[data-delete-category]'); if(edit) openExpense(state.expenses.find(x=>String(x.id)===String(edit.dataset.edit))); if(del) deleteExpense(del.dataset.delete); if(dc) deleteCategory(dc.dataset.deleteCategory);});
  ['historySearch','historyCategory','historyFrom','historyTo'].forEach(id=>$('#'+id).addEventListener(id==='historySearch'?'input':'change',renderHistory)); $('#categoryForm').addEventListener('submit',async e=>{e.preventDefault();await addCategory($('#newCategoryName').value);$('#newCategoryName').value='';});
  $('#authOpenBtn').onclick=()=>openModal('authModal'); $('#logoutBtn').onclick=async()=>{ if(state.supabase) await state.supabase.auth.signOut(); };
  $$('.auth-tab').forEach(b=>b.onclick=()=>{ $$('.auth-tab').forEach(x=>x.classList.toggle('active',x===b)); $('#loginForm').classList.toggle('hidden',b.dataset.authTab!=='login'); $('#registerForm').classList.toggle('hidden',b.dataset.authTab!=='register'); });
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.supabase)return toast('Chưa cấu hình Supabase trong config.js.','error'); const {error}=await state.supabase.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value}); if(error) toast(error.message,'error');});
  $('#registerForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.supabase)return toast('Chưa cấu hình Supabase trong config.js.','error'); const p=$('#registerPassword').value;if(p!==$('#registerPassword2').value)return toast('Hai mật khẩu không khớp.','error'); const {data,error}=await state.supabase.auth.signUp({email:$('#registerEmail').value.trim(),password:p}); if(error)return toast(error.message,'error'); if(data.session) toast('Đăng ký thành công.','success'); else toast('Đã tạo tài khoản. Kiểm tra email để xác nhận nếu Supabase đang bật xác thực email.','success');});
}

async function init(){
  const theme=localStorage.getItem(STORAGE_THEME)|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); document.documentElement.dataset.theme=theme; $('#themeBtn').textContent=theme==='dark'?'☀':'☾'; $('#bulkAnchor').value=localISODate(); state.bulkCursor=new Date(); $('#todayLabel').textContent=new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date()); bind(); await initAuth(); renderAll();
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init();
