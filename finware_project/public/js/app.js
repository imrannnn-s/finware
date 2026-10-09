
(function(){
"use strict";

/* ============================================================
   DATA – the exact sample set from the lab practical
   ============================================================ */
let DATA = { users: [], banks: [], categories: [], transactions: [], caSessions: [], dimDate: [] };

/* API access – the frontend is served by the same Express server that
   exposes /api/*, so relative paths are all that's needed. */
const API_BASE = '';

/* Signed-in account as reported by the server (/api/auth/login or /me).
   The role here only drives what the UI shows; every API call is
   authorised again on the server from the database record. */
let CURRENT_USER = null;
const isAdmin = ()=> !!CURRENT_USER && CURRENT_USER.role === 'admin';
const isAdminPortal = ()=> /^\/admin\/?$/.test(window.location.pathname);
function authToken(){ try{ return localStorage.getItem('finware_token'); }catch(e){ return null; } }
async function apiFetch(path, options){
  const token = authToken();
  const headers = Object.assign({}, (options && options.headers) || {});
  if(token) headers['Authorization'] = 'Bearer ' + token;
  if(options && options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  if(res.status === 401){
    logout();
    throw new Error('Session expired – please sign in again.');
  }
  return res;
}
async function loadWarehouseData(){
  const res = await apiFetch('/api/warehouse/all');
  if(!res.ok) throw new Error('Could not load warehouse data.');
  DATA = await res.json();
  // Re-derive the date pickers from the freshly loaded fact tables, then push
  // the real coverage window into the topbar badge.
  Object.assign(filterState, defaultFilterState());
  const badge = $('#topbar-range');
  if(badge) badge.textContent = rangeLabel();
}

const PALETTE = ['#3b6fed','#12a893','#e0982f','#8b6ef2','#e5484d'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ============================================================
   HELPERS
   ============================================================ */
const $  = (sel,ctx)=> (ctx||document).querySelector(sel);
const $$ = (sel,ctx)=> Array.from((ctx||document).querySelectorAll(sel));
const byId = (arr,id)=> arr.find(x=>x.id===id);
const userName = id => (byId(DATA.users,id)||{}).name || id;
const bankName = id => (byId(DATA.banks,id)||{}).name || id;
const catName  = id => (byId(DATA.categories,id)||{}).name || id;
const catGroup = id => (byId(DATA.categories,id)||{}).group || '';

const inr = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);
const fmtDate = d => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const weekdayOf = d => WEEKDAYS[new Date(d+'T00:00:00').getDay()];

/* Escape anything that came from the database (or a user) before it goes into
   an innerHTML template. Every render helper below pipes its interpolated
   values through this. */
function escapeHtml(value){
  if(value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function css(varName){ return getComputedStyle(document.documentElement).getPropertyValue(varName).trim(); }

function toast(msg){
  const c = $('#toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  c.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=> el.remove(), 300); }, 2600);
}

function svgIcon(path, extra){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+path+'</svg>';
}
const ICONS = {
  dashboard: svgIcon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  table: svgIcon('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/>'),
  layers: svgIcon('<polygon points="12 2 21 7 12 12 3 7 12 2"/><polyline points="3 12 12 17 21 12"/><polyline points="3 17 12 22 21 17"/>'),
  star: svgIcon('<polygon points="12 2 15 9 22 9.5 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.5 9 9 12 2"/>'),
  snow: svgIcon('<line x1="12" y1="2" x2="12" y2="22"/><line x1="4" y1="7" x2="20" y2="17"/><line x1="20" y1="7" x2="4" y2="17"/>'),
  galaxy: svgIcon('<circle cx="8" cy="8" r="3.2"/><circle cx="16" cy="16" r="3.2"/><line x1="10.5" y1="10" x2="13.5" y2="14"/>'),
  card: svgIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'),
  users: svgIcon('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15 14.6c2.7.4 5.5 2.1 5.5 5.4"/>'),
  bank: svgIcon('<line x1="3" y1="21" x2="21" y2="21"/><path d="M4 21V10M9 21V10M15 21V10M20 21V10"/><polygon points="12 3 21 8 3 8"/>'),
  tag: svgIcon('<path d="M20.6 12.6 12 21.2 2.8 12 2.8 4.4 10.4 4.4z"/><circle cx="7" cy="9" r="1.4"/>'),
  sliders: svgIcon('<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2.2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2.2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2.2"/>'),
  file: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
  profile: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  txn: svgIcon('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  bullet: svgIcon('<polyline points="20 6 9 17 4 12"/>'),
  bell: svgIcon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')
};

/* ============================================================
   NAVIGATION
   ============================================================ */
/* Sidebar configuration.
   FinWare is presented as a banking & fintech analytics product. The Star /
   Snowflake / Galaxy schemas and the source / dimension / fact table browsers
   are deliberately not surfaced in the UI: they remain internal warehouse
   implementation details, fully intact on the server side (schema.sqlite.sql,
   dwm-schema-reference.sql, /api/warehouse/* and /api/analytics/*). */
const ADMIN_NAV = [
  {group:'Overview', items:[
    {id:'dashboard', label:'Dashboard', icon:'dashboard'},
    {id:'about', label:'About & ML Model', icon:'file'}
  ]},
  {group:'Analytics', items:[
    {id:'transactions', label:'Transactions', icon:'card'},
    {id:'ca', label:'CA Sessions', icon:'clock'},
    {id:'user', label:'User Analysis', icon:'users'},
    {id:'bank', label:'Bank Analysis', icon:'bank'},
    {id:'category', label:'Category Analysis', icon:'tag'},
    {id:'time', label:'Time Analysis', icon:'clock'},
    {id:'custom', label:'Custom Analysis', icon:'sliders'}
  ]},
  {group:'Insights', items:[
    {id:'spending', label:'Spending Behaviour', icon:'dashboard'},
    {id:'anomaly', label:'Anomaly Alerts', icon:'bell'},
    {id:'recommendations', label:'Recommendations', icon:'bullet'},
    {id:'about', label:'About & ML Model', icon:'file'}
  ]},
  {group:'Output', items:[
    {id:'reports', label:'Reports', icon:'file'}
  ]},
  {group:'Administration', items:[
    {id:'admin-users', label:'User Management', icon:'users'}
  ]}
];
const USER_NAV = [
  {group:'My account', items:[
    {id:'my-dashboard', label:'My Dashboard', icon:'dashboard'},
    {id:'transactions', label:'My Transactions', icon:'card'},
    {id:'ca', label:'My CA Sessions', icon:'clock'}
  ]},
  {group:'Insights', items:[
    {id:'spending', label:'Spending Behaviour', icon:'dashboard'},
    {id:'anomaly', label:'Unusual Activity', icon:'bell'},
    {id:'recommendations', label:'Recommendations', icon:'bullet'}
  ]},
  {group:'Output', items:[
    {id:'reports', label:'My Reports', icon:'file'}
  ]}
];
/* Pages each role may open. Anything else shows the access-denied page;
   the matching API endpoints are independently protected server-side. */
const USER_PAGES = ['my-dashboard','transactions','ca','spending','anomaly','recommendations','reports','profile','denied'];
const ADMIN_PAGES = ['dashboard','about','transactions','ca','user','bank','category','time','custom',
  'spending','anomaly','recommendations','reports','profile','admin-users','denied'];
const canOpenPage = id => (isAdmin() ? ADMIN_PAGES : USER_PAGES).includes(id);
const homePage = ()=> isAdmin() ? 'dashboard' : 'my-dashboard';

const PAGE_TITLES = {dashboard:'Dashboard', 'my-dashboard':'My Dashboard', 'admin-users':'User Management', denied:'Access denied',
  transactions:'Transactions',
  ca:'CA Sessions', user:'User Analysis', bank:'Bank Analysis', category:'Category Analysis', time:'Time Analysis',
  custom:'Custom Analysis', spending:'Spending Behaviour', anomaly:'Anomaly Alerts',
  recommendations:'Recommendations', reports:'Reports', about:'About & ML Model', profile:'Profile & settings'};

const USER_TITLES = {transactions:'My Transactions', ca:'My CA Sessions', anomaly:'Unusual Activity', reports:'My Reports'};
function pageFromHash(){
  const m = /^#\/([a-z-]+)$/.exec(window.location.hash || '');
  return m ? m[1] : null;
}

function buildNav(){
  const nav = $('#sidebar-nav');
  const groups = isAdmin() ? ADMIN_NAV : USER_NAV;
  nav.innerHTML = groups.map(g=>`
    <div class="nav-group">
      <div class="nav-group-label">${g.group}</div>
      ${g.items.map(it=>`<div class="nav-item" data-nav="${it.id}">${ICONS[it.icon]}<span>${it.label}</span></div>`).join('')}
    </div>`).join('');
  $$('#sidebar-nav .nav-item').forEach(el=> el.addEventListener('click', ()=> showPage(el.dataset.nav)));
}

const CHARTS = {};
function makeChart(canvasId, config){
  const el = document.getElementById(canvasId);
  if(!el) return;
  // Chart.js is loaded from /vendor with a CDN fallback. If both failed we
  // must not throw here — a missing library should degrade one chart, not
  // take down the whole render pass.
  if(typeof Chart === 'undefined'){
    console.error('[FinWare] Chart.js failed to load — cannot render "'+canvasId+'".');
    return;
  }
  // Never leave a previous instance attached: Chart.js throws on a canvas
  // that already has a chart, and stale instances leak on re-render/theme.
  if(CHARTS[canvasId]){ try{ CHARTS[canvasId].destroy(); }catch(e){} delete CHARTS[canvasId]; }
  try{
    CHARTS[canvasId] = new Chart(el.getContext('2d'), config);
  }catch(err){
    console.error('[FinWare] Could not create chart "'+canvasId+'":', err);
  }
}
function baseOptions(extra){
  const textColor = css('--text-muted');
  const gridColor = css('--border');
  const opts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ color:textColor, font:{family:'Inter', size:11}, boxWidth:11, usePointStyle:true } } },
    scales:{
      x:{ ticks:{color:textColor, font:{family:'Inter', size:11}}, grid:{color:'transparent'} },
      y:{ ticks:{color:textColor, font:{family:'Inter', size:11}}, grid:{color:gridColor} }
    }
  };
  return Object.assign(opts, extra||{});
}

function showPage(id){
  if(!CURRENT_USER) return;
  if(!canOpenPage(id) || !$('#page-'+id)) id = 'denied';
  const hash = '#/' + id;
  if(window.location.hash !== hash) history.replaceState(null, '', hash);
  $$('.page').forEach(p=> p.classList.remove('active'));
  const target = $('#page-'+id);
  if(target) target.classList.add('active');
  $$('.nav-item').forEach(n=> n.classList.toggle('active', n.dataset.nav===id));
  $('#topbar-title').textContent = (!isAdmin() && USER_TITLES[id]) || PAGE_TITLES[id] || 'FinWare';
  $('#avatar-menu').classList.remove('show');
  document.body.classList.remove('sidebar-open');
  RENDERERS[id] && RENDERERS[id]();
  window.scrollTo(0,0);
  $('#main-content').scrollTop = 0;
}

/* ============================================================
   FILTER STATE
   ============================================================ */
/* Date bounds come from whatever is actually in fact_transactions /
   fact_ca_sessions, so the pickers stay correct if the dataset is
   reloaded from a different CSV. */
function dataRange(){
  const dates = DATA.transactions.map(t=>t.date)
    .concat(DATA.caSessions.map(s=>s.date))
    .filter(Boolean).sort();
  return { from: dates[0] || '', to: dates[dates.length-1] || '' };
}
function rangeLabel(){
  const r = dataRange();
  if(!r.from) return '–';
  if(r.from===r.to) return fmtDate(r.from);
  return fmtDate(r.from) + ' — ' + fmtDate(r.to);
}
function defaultFilterState(){
  const r = dataRange();
  return {
    dash:{user:'', bank:'', category:'', type:'', from:r.from, to:r.to},
    txn:{user:'', bank:'', category:'', type:'', from:r.from, to:r.to},
    ca:{status:'', ca:'', from:r.from, to:r.to},
    custom:{user:'', from:r.from, to:r.to}
  };
}
const filterState = defaultFilterState();

function optionsHtml(list, valueKey, labelKey, allLabel){
  return `<option value="">${escapeHtml(allLabel)}</option>` + list.map(x=>`<option value="${escapeHtml(x[valueKey])}">${escapeHtml(x[labelKey])}</option>`).join('');
}

function buildFilterBar(container, state, fields, onApply){
  let html = '';
  fields.forEach(f=>{
    if(f.type==='select'){
      html += `<div class="filter-field"><label>${f.label}</label><select data-f="${f.key}">${f.optionsHtml}</select></div>`;
    } else if(f.type==='date'){
      html += `<div class="filter-field"><label>${f.label}</label><input type="date" data-f="${f.key}" value="${state[f.key]}"></div>`;
    }
  });
  html += `<div class="filter-actions"><button class="btn btn-outline btn-sm" data-act="reset">Reset</button><button class="btn btn-primary btn-sm" data-act="apply">Apply</button></div>`;
  container.innerHTML = html;
  fields.forEach(f=>{
    const el = container.querySelector(`[data-f="${f.key}"]`);
    if(el && f.type==='select') el.value = state[f.key];
  });
  container.querySelector('[data-act="apply"]').addEventListener('click', ()=>{
    fields.forEach(f=>{ state[f.key] = container.querySelector(`[data-f="${f.key}"]`).value; });
    onApply();
  });
  container.querySelector('[data-act="reset"]').addEventListener('click', ()=>{
    fields.forEach(f=>{ state[f.key] = f.def!==undefined ? f.def : ''; });
    buildFilterBar(container, state, fields, onApply);
    onApply();
  });
}

function inRange(dateStr, from, to){
  return (!from || dateStr>=from) && (!to || dateStr<=to);
}
function filterTransactions(state){
  return DATA.transactions.filter(t=>
    (!state.user || t.userId===state.user) &&
    (!state.bank || t.bankId===state.bank) &&
    (!state.category || t.categoryId===state.category) &&
    (!state.type || t.type===state.type) &&
    inRange(t.date, state.from, state.to)
  );
}
function filterSessions(state){
  return DATA.caSessions.filter(s=>
    (!state.status || s.status===state.status) &&
    (!state.ca || s.caId===state.ca) &&
    (!state.user || s.userId===state.user) &&
    inRange(s.date, state.from, state.to)
  );
}
const sum = (arr, fn) => arr.reduce((a,x)=> a+fn(x), 0);
const groupSum = (arr, keyFn, valFn) => {
  const m = {};
  arr.forEach(x=>{ const k=keyFn(x); m[k]=(m[k]||0)+valFn(x); });
  return m;
};

/* Income brackets are ordered by the natural low->high order of the values
   actually present in dim_income_bracket, falling back to a numeric-aware sort
   for any label that isn't a plain "<lo>-<hi> LPA" / "<n> LPA+" range. A
   bracket added to the database therefore always appears, instead of silently
   rendering as zero. */
function orderedIncomeBrackets(){
  const present = Array.from(new Set(DATA.users.map(u=>u.income).filter(Boolean)));
  const numeric = label =>{
    const range = String(label).match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if(range) return parseFloat(range[1]);
    const plus = String(label).match(/^(\d+(?:\.\d+)?)\s*LPA\s*\+\s*$/i);
    if(plus) return parseFloat(plus[1]);
    return NaN;
  };
  return present.slice().sort((a,b)=>{
    const na = numeric(a), nb = numeric(b);
    if(!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if(!Number.isNaN(na)) return -1;
    if(!Number.isNaN(nb)) return 1;
    return String(a).localeCompare(String(b));
  });
}

/* ============================================================
   RENDER: DASHBOARD
   ============================================================ */
function renderDashboard(){
  buildFilterBar($('#dash-filters'), filterState.dash, [
    {key:'user', type:'select', label:'User', optionsHtml:optionsHtml(DATA.users,'id','name','All users')},
    {key:'bank', type:'select', label:'Bank', optionsHtml:optionsHtml(DATA.banks,'id','name','All banks')},
    {key:'category', type:'select', label:'Category', optionsHtml:optionsHtml(DATA.categories,'id','name','All categories')},
    {key:'type', type:'select', label:'Type', optionsHtml:'<option value="">All types</option><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option>'},
    {key:'from', type:'date', label:'From', def:dataRange().from},
    {key:'to', type:'date', label:'To', def:dataRange().to}
  ], renderDashboard);

  const txns = filterTransactions(filterState.dash);
  const total = sum(txns, t=>t.amount);
  const debit = sum(txns.filter(t=>t.type==='DEBIT'), t=>t.amount);
  const credit = sum(txns.filter(t=>t.type==='CREDIT'), t=>t.amount);
  // CA activity honours the same date range (and user, where one is selected)
  // as the transaction KPIs, so every card on this page reflects one selection.
  const dash = filterState.dash;
  const caScoped = DATA.caSessions.filter(s=>
    (!dash.user || s.userId===dash.user) && inRange(s.date, dash.from, dash.to)
  );
  const caRevenue = sum(caScoped, s=>s.fee);

  const kpis = [
    {label:'Total transactions', value:txns.length, icon:'txn', bg:'var(--accent-soft)', color:'var(--accent)'},
    {label:'Total transaction value', value:inr(total), icon:'card', bg:'var(--accent-soft)', color:'var(--accent)'},
    {label:'Debit value', value:inr(debit), icon:'txn', bg:'var(--coral-soft)', color:'var(--coral)'},
    {label:'Credit value', value:inr(credit), icon:'txn', bg:'var(--teal-soft)', color:'var(--teal)'},
    {label:'CA session revenue', value:inr(caRevenue), icon:'clock', bg:'var(--violet-soft)', color:'var(--violet)'},
    {label:'Total users', value:DATA.users.length, icon:'users', bg:'var(--amber-soft)', color:'var(--amber)'}
  ];
  $('#dash-kpis').innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-top"><div class="kpi-icon" style="background:${k.bg}; color:${k.color};">${ICONS[k.icon]}</div></div>
      <div class="kpi-value">${escapeHtml(k.value)}</div><div class="kpi-label">${escapeHtml(k.label)}</div>
    </div>`).join('');

  const catTotals = groupSum(txns, t=>t.categoryId, t=>t.amount);
  makeChart('chart-dash-category', {type:'bar', data:{labels:DATA.categories.map(c=>c.name), datasets:[{label:'Value', data:DATA.categories.map(c=>catTotals[c.id]||0), backgroundColor:PALETTE, borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const bankTotals = groupSum(txns, t=>t.bankId, t=>t.amount);
  makeChart('chart-dash-bank', {type:'doughnut', data:{labels:DATA.banks.map(b=>b.name), datasets:[{data:DATA.banks.map(b=>bankTotals[b.id]||0), backgroundColor:PALETTE, borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'62%'})});

  const statusCounts = groupSum(caScoped, s=>s.status, ()=>1);
  makeChart('chart-dash-status', {type:'doughnut', data:{labels:['Completed','Scheduled','Cancelled'], datasets:[{data:[statusCounts.Completed||0, statusCounts.Scheduled||0, statusCounts.Cancelled||0], backgroundColor:[css('--teal'),css('--amber'),css('--coral')], borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'62%'})});

  const incomeOrder = orderedIncomeBrackets();
  const incomeCounts = groupSum(DATA.users, u=>u.income, ()=>1);
  makeChart('chart-dash-income', {type:'bar', data:{labels:incomeOrder, datasets:[{label:'Users', data:incomeOrder.map(i=>incomeCounts[i]||0), backgroundColor:css('--accent'), borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const dates = DATA.transactions.map(t=>t.date).sort();
  const dailyTotals = groupSum(DATA.transactions, t=>t.date, t=>t.amount);
  makeChart('chart-dash-trend', {type:'line', data:{labels:dates.map(d=> new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})), datasets:[{label:'Value', data:dates.map(d=>dailyTotals[d]||0), borderColor:css('--accent'), backgroundColor:'transparent', tension:.35, pointBackgroundColor:css('--accent')}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  $('#dash-recent-body').innerHTML = txns.map(rowTxnHtml).join('') || `<tr><td colspan="7" class="empty-note">No transactions match these filters.</td></tr>`;
  wireTxnRowClicks('#dash-recent-body');

  // Fire-and-forget: the Analysis & Insights section loads independently so a
  // slow or failing analytics endpoint can't block the dashboard above.
  loadAnalytics().catch(err=> console.error('[FinWare] loadAnalytics failed:', err));
}

/* ============================================================
   ANALYSIS & INSIGHTS
   Every chart here is fed by a real /api/analytics/* aggregate. Each panel
   is loaded and rendered independently (Promise.allSettled) so one failing
   endpoint shows its own error state instead of blanking the section.
   ============================================================ */

const ERROR_MSG = 'Unable to load this analysis. Please check the backend/API connection.';
const EMPTY_MSG = 'No data available for this analysis.';

const ANALYSIS_ENDPOINTS = {
  category: '/api/analytics/star/category-summary',
  bank:     '/api/analytics/star/bank-summary',
  trend:    '/api/analytics/star/date-trend',
  users:    '/api/analytics/snowflake/user-profile',
  galaxy:   '/api/analytics/galaxy/cross-process',
  summary:  '/api/analytics/dashboard-summary'
};

/* Loading / error / empty / ready state for a single chart panel. */
function panelState(panel, state, message){
  const card = document.querySelector('.chart-panel[data-panel="'+panel+'"]');
  if(!card) return;
  const box  = card.querySelector('.panel-state');
  const wrap = card.querySelector('.chart-wrap');
  if(!box) return;
  if(state === 'loading' || state === 'error' || state === 'empty'){
    box.hidden = false;
    box.className = 'panel-state ' + state;
    box.innerHTML = state === 'loading'
      ? '<span class="spinner" aria-hidden="true"></span><span>Loading analysis…</span>'
      : '<span>' + (message || ERROR_MSG) + '</span>';
    if(wrap) wrap.classList.add('is-hidden');
    if(state !== 'loading' && CHARTS[ANALYSIS_CANVAS[panel]]){
      try{ CHARTS[ANALYSIS_CANVAS[panel]].destroy(); }catch(e){}
      delete CHARTS[ANALYSIS_CANVAS[panel]];
    }
  } else {
    box.hidden = true;
    box.innerHTML = '';
    if(wrap) wrap.classList.remove('is-hidden');
  }
}

const ANALYSIS_CANVAS = {
  category: 'chart-analytics-category',
  bank:     'chart-analytics-bank',
  trend:    'chart-analytics-trend',
  users:    'chart-analytics-users',
  galaxy:   'chart-analytics-galaxy'
};

/* Fetch one analytics endpoint, normalising HTTP + network + shape errors
   into a single rejected Error so each panel can report consistently.
   `expect` is 'rows' for the list endpoints and 'object' for the summary. */
async function fetchAnalytics(key, expect){
  const path = ANALYSIS_ENDPOINTS[key];
  try{
    const res = await apiFetch(path);
    if(!res.ok){
      const body = await res.json().catch(()=> ({}));
      throw new Error('HTTP ' + res.status + (body && body.error ? ' — ' + body.error : ''));
    }
    const data = await res.json();
    if(expect === 'object'){
      if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('empty');
      return data;
    }
    if(!Array.isArray(data) || !data.length) throw new Error('empty');
    return data;
  }catch(err){
    console.error('[FinWare] analytics request failed for ' + path + ':', err);
    throw err;
  }
}

/* Turn a settled promise into either rows or a panel state, then hand the
   rows to the matching renderer. Never throws. */
function bindPanel(panel, promise, render){
  panelState(panel, 'loading');
  return promise.then(
    rows => { try{ render(rows); }catch(err){ console.error('[FinWare] render failed for "'+panel+'":', err); panelState(panel,'error'); } },
    err  => { panelState(panel, 'error', err && err.message === 'empty' ? EMPTY_MSG : ERROR_MSG); }
  );
}

async function loadAnalytics(){
  const section = $('#analysis-section');
  if(!section) return;

  $('#analysis-range').textContent = rangeLabel();
  panelState('category','loading'); panelState('bank','loading'); panelState('trend','loading');
  panelState('users','loading');    panelState('galaxy','loading');

  const jobs = [
    bindPanel('category', fetchAnalytics('category'), renderCategoryChart),
    bindPanel('bank',     fetchAnalytics('bank'),     renderBankChart),
    bindPanel('trend',    fetchAnalytics('trend'),    renderAmountTrendChart),
    bindPanel('users',    fetchAnalytics('users'),    renderTopUsersChart),
    bindPanel('galaxy',   fetchAnalytics('galaxy'),   renderGalaxyChart)
  ];

  // Summary tiles are decorative — never let them break the charts.
  try{
    const summary = await fetchAnalytics('summary', 'object');
    renderInsightMetrics(summary);
  }catch(err){
    console.error('[FinWare] dashboard-summary failed:', err);
    const box = $('#insight-metrics');
    if(box) box.innerHTML = '<div class="insight-metric error">' + ERROR_MSG + '</div>';
  }

  await Promise.allSettled(jobs);
}

/* ---- dynamic summary metrics, straight from /api/analytics/dashboard-summary ---- */
function renderInsightMetrics(s){
  const box = $('#insight-metrics');
  if(!box) return;
  const span = s.firstDate && s.lastDate
    ? (s.firstDate === s.lastDate ? fmtDate(s.firstDate) : fmtDate(s.firstDate) + ' – ' + fmtDate(s.lastDate))
    : '—';
  const tiles = [
    {label:'Transactions in warehouse', value:(s.txnCount||0).toLocaleString('en-IN'), sub:'rows in Fact_Transactions'},
    {label:'Total transaction value',   value:inr(s.totalValue),                sub:'debit + credit'},
    {label:'CA session revenue',        value:inr(s.caRevenue),                  sub:(s.caSessionCount||0) + ' sessions'},
    {label:'Active users',              value:(s.totalUsers||0).toLocaleString('en-IN'), sub:(s.totalBanks||0) + ' banks · ' + (s.totalCategories||0) + ' categories'},
    {label:'Data coverage',             value:span,                             sub:'dim_date span'}
  ];
  box.innerHTML = tiles.map(t=>`
    <div class="insight-metric">
      <div class="insight-metric-label">${escapeHtml(t.label)}</div>
      <div class="insight-metric-value">${escapeHtml(t.value)}</div>
      <div class="insight-metric-sub">${escapeHtml(t.sub)}</div>
    </div>`).join('');
}

/* ---- 1. Transactions by Category — bar, /star/category-summary ---- */
function renderCategoryChart(rows){
  if(!rows || !rows.length){ panelState('category','empty',EMPTY_MSG); return; }
  panelState('category','ready');
  const sorted = rows.slice().sort((a,b)=> b.totalValue - a.totalValue);
  makeChart('chart-analytics-category', {
    type:'bar',
    data:{
      labels: sorted.map(r=>r.category),
      datasets:[{ label:'Transaction value', data: sorted.map(r=>r.totalValue),
                  backgroundColor: sorted.map((r,i)=> PALETTE[i % PALETTE.length]), borderRadius:6 }]
    },
    options: baseOptions({
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label:(c)=> inr(c.parsed.y) + ' · ' + c.raw2 + ' txns' } } },
      scales:{
        x:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, maxRotation:45, minRotation:0}, grid:{color:'transparent'} },
        y:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, callback:(v)=> inr(v)}, grid:{color:css('--border')} }
      }
    })
  });
}

/* ---- 2. Transactions by Bank — bar, /star/bank-summary ---- */
function renderBankChart(rows){
  if(!rows || !rows.length){ panelState('bank','empty',EMPTY_MSG); return; }
  panelState('bank','ready');
  const sorted = rows.slice().sort((a,b)=> b.totalValue - a.totalValue);
  makeChart('chart-analytics-bank', {
    type:'bar',
    data:{
      labels: sorted.map(r=>r.bank),
      datasets:[{ label:'Transaction value', data: sorted.map(r=>r.totalValue),
                  backgroundColor: sorted.map((r,i)=> PALETTE[(i+1) % PALETTE.length]), borderRadius:6 }]
    },
    options: baseOptions({
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label:(c)=> inr(c.parsed.y) + ' · ' + c.raw2 + ' txns' } } },
      scales:{
        x:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, maxRotation:45, minRotation:0}, grid:{color:'transparent'} },
        y:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, callback:(v)=> inr(v)}, grid:{color:css('--border')} }
      }
    })
  });
}

/* ---- 3. Transaction Amount Trend — line over the real dim_date span ---- */
function renderAmountTrendChart(rows){
  if(!rows || !rows.length){ panelState('trend','empty',EMPTY_MSG); return; }
  panelState('trend','ready');
  const sorted = rows.slice().sort((a,b)=> a.date < b.date ? -1 : 1);
  const labels = sorted.map(r=> new Date(r.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'}));
  const label = $('#analysis-trend-range');
  if(label) label.textContent = fmtDate(sorted[0].date) + ' – ' + fmtDate(sorted[sorted.length-1].date) +
    ' · ' + sorted.length + ' days with activity';

  makeChart('chart-analytics-trend', {
    type:'line',
    data:{ labels, datasets:[
      { label:'Total value', data: sorted.map(r=>r.totalValue), borderColor:css('--accent'),
        backgroundColor:'rgba(59,111,237,0.14)', fill:true, tension:.35, pointRadius:2, pointBackgroundColor:css('--accent'), borderWidth:2 },
      { label:'Debit', data: sorted.map(r=>r.debit), borderColor:css('--coral'),
        backgroundColor:'transparent', tension:.35, pointRadius:0, borderWidth:1.5, borderDash:[5,4] },
      { label:'Credit', data: sorted.map(r=>r.credit), borderColor:css('--teal'),
        backgroundColor:'transparent', tension:.35, pointRadius:0, borderWidth:1.5, borderDash:[2,3] }
    ]},
    options: baseOptions({
      interaction:{ mode:'index', intersect:false },
      scales:{
        x:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:10}, maxTicksLimit:16, autoSkip:true}, grid:{color:'transparent'} },
        y:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, callback:(v)=> inr(v)}, grid:{color:css('--border')} }
      }
    })
  });
}

/* ---- 4. Top Users by Transaction Amount — horizontal bar, /snowflake/user-profile ---- */
function renderTopUsersChart(rows){
  if(!rows || !rows.length){ panelState('users','empty',EMPTY_MSG); return; }
  panelState('users','ready');
  const sorted = rows.slice().sort((a,b)=> a.totalSpend - b.totalSpend); // ascending for indexAxis:'y'
  makeChart('chart-analytics-users', {
    type:'bar',
    data:{
      labels: sorted.map(r=>r.userName),
      datasets:[{ label:'Total spend', data: sorted.map(r=>r.totalSpend),
                  backgroundColor: sorted.map((r,i)=> PALETTE[(i+2) % PALETTE.length]), borderRadius:6 }]
    },
    options: baseOptions({
      indexAxis:'y',
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{
          label:(c)=> inr(c.parsed.x),
          afterLabel:(c)=>{ const r = sorted[c.dataIndex]; return r.city + ' · ' + r.incomeBracket + ' · ' + r.accountType; }
        } } },
      scales:{
        x:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, callback:(v)=> inr(v)}, grid:{color:css('--border')} },
        y:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}}, grid:{color:'transparent'} }
      }
    })
  });
}

/* ---- 5. Galaxy / cross-process — /galaxy/cross-process ----
   The endpoint returns one row per (user, date) that has either fact.
   Chart.js needs a plain series, so we sum both facts by date here; the
   numbers are still exactly what the SQL returned. */
function renderGalaxyChart(rows){
  if(!rows || !rows.length){ panelState('galaxy','empty',EMPTY_MSG); return; }
  panelState('galaxy','ready');
  const byDate = {};
  rows.forEach(r=>{
    const d = r.date;
    if(!byDate[d]) byDate[d] = { date:d, transactionValue:0, caFees:0 };
    byDate[d].transactionValue += Number(r.transactionValue) || 0;
    byDate[d].caFees          += Number(r.caFees) || 0;
  });
  const series = Object.keys(byDate).sort().map(k=> byDate[k]);
  makeChart('chart-analytics-galaxy', {
    type:'bar',
    data:{
      labels: series.map(s=> new Date(s.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})),
      datasets:[
        { label:'Transaction value', data: series.map(s=>s.transactionValue),
          backgroundColor:css('--accent'), borderRadius:4, order:2 },
        { label:'CA session fees', data: series.map(s=>s.caFees),
          type:'line', borderColor:css('--amber'), backgroundColor:css('--amber'),
          pointRadius:2, pointBackgroundColor:css('--amber'), borderWidth:2, tension:.35, order:1 }
      ]
    },
    options: baseOptions({
      interaction:{ mode:'index', intersect:false },
      scales:{
        x:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:10}, maxTicksLimit:16, autoSkip:true}, grid:{color:'transparent'} },
        y:{ ticks:{color:css('--text-muted'), font:{family:'Inter', size:11}, callback:(v)=> inr(v)}, grid:{color:css('--border')} }
      }
    })
  });
}

function rowTxnHtml(t){
  return `<tr data-txn="${escapeHtml(t.id)}"><td>${escapeHtml(t.id)}</td><td>${escapeHtml(fmtDate(t.date))}</td><td>${escapeHtml(userName(t.userId))}</td><td>${escapeHtml(bankName(t.bankId))}</td><td>${escapeHtml(catName(t.categoryId))}</td>
    <td class="${t.type==='DEBIT'?'amt-debit':'amt-credit'}">${escapeHtml(inr(t.amount))}</td><td><span class="badge ${t.type==='DEBIT'?'debit':'credit'}">${escapeHtml(t.type)}</span></td></tr>`;
}
function wireTxnRowClicks(scopeSel){
  $$(scopeSel+' tr[data-txn]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const t = byId(DATA.transactions, tr.dataset.txn);
      if(!t) return;
      // Every transaction opens the backend-calculated risk assessment.
      openTransactionRisk(t.id);
    });
  });
}
function wireCaRowClicks(scopeSel){
  $$(scopeSel+' tr[data-ca]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const s = byId(DATA.caSessions, tr.dataset.ca);
      if(!s) return;
      openModal('CA session '+s.id, [
        ['Date', fmtDate(s.date)], ['User', userName(s.userId)],
        ['CA', s.caName || s.caId], ['Fee', inr(s.fee)], ['Status', s.status]
      ]);
    });
  });
}
function openModal(title, rows){
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = rows.map(r=>`<div class="modal-row"><span>${escapeHtml(r[0])}</span><span>${escapeHtml(r[1])}</span></div>`).join('');
  $('#modal-overlay').classList.add('show');
}

/* ============================================================
   DWM INTERNALS - NOT SURFACED IN THE UI
   The Star / Snowflake / Galaxy schemas and the source / dimension /
   fact table browsers are no longer rendered here: FinWare presents as a
   banking & fintech analytics product. They remain fully implemented on
   the server side - database/schema.sqlite.sql,
   database/dwm-schema-reference.sql, /api/warehouse/* (including the
   whitelisted /source/:table endpoint) and /api/analytics/* - and are
   treated as internal warehouse implementation details.
   ============================================================ */

/* ============================================================
   RENDER: TRANSACTIONS PAGE
   ============================================================ */
function renderTransactionsPage(){
  buildFilterBar($('#txn-filters'), filterState.txn, [
    {key:'user', type:'select', label:'User', optionsHtml:optionsHtml(DATA.users,'id','name','All users')},
    {key:'bank', type:'select', label:'Bank', optionsHtml:optionsHtml(DATA.banks,'id','name','All banks')},
    {key:'category', type:'select', label:'Category', optionsHtml:optionsHtml(DATA.categories,'id','name','All categories')},
    {key:'type', type:'select', label:'Type', optionsHtml:'<option value="">All types</option><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option>'},
    {key:'from', type:'date', label:'From', def:dataRange().from},
    {key:'to', type:'date', label:'To', def:dataRange().to}
  ], renderTransactionsPage);

  const txns = filterTransactions(filterState.txn);
  const total = sum(txns, t=>t.amount);
  const debit = sum(txns.filter(t=>t.type==='DEBIT'), t=>t.amount);
  const credit = sum(txns.filter(t=>t.type==='CREDIT'), t=>t.amount);
  $('#txn-kpis').innerHTML = [
    {label:'Transactions', value:txns.length, color:'var(--accent)', bg:'var(--accent-soft)'},
    {label:'Total value', value:inr(total), color:'var(--accent)', bg:'var(--accent-soft)'},
    {label:'Debit', value:inr(debit), color:'var(--coral)', bg:'var(--coral-soft)'},
    {label:'Credit', value:inr(credit), color:'var(--teal)', bg:'var(--teal-soft)'}
  ].map(k=>`<div class="kpi-card"><div class="kpi-top"><div class="kpi-icon" style="background:${k.bg};color:${k.color};">${ICONS.txn}</div></div><div class="kpi-value">${escapeHtml(k.value)}</div><div class="kpi-label">${escapeHtml(k.label)}</div></div>`).join('');

  const catTotals = groupSum(txns, t=>t.categoryId, t=>t.amount);
  makeChart('chart-txn-category', {type:'bar', data:{labels:DATA.categories.map(c=>c.name), datasets:[{data:DATA.categories.map(c=>catTotals[c.id]||0), backgroundColor:PALETTE, borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});
  const bankTotals = groupSum(txns, t=>t.bankId, t=>t.amount);
  makeChart('chart-txn-bank', {type:'pie', data:{labels:DATA.banks.map(b=>b.name), datasets:[{data:DATA.banks.map(b=>bankTotals[b.id]||0), backgroundColor:PALETTE, borderWidth:0}]}, options: baseOptions({scales:{}})});

  $('#txn-count-label').textContent = txns.length + ' of ' + DATA.transactions.length + ' shown';
  $('#txn-body').innerHTML = txns.map(rowTxnHtml).join('') || `<tr><td colspan="7" class="empty-note">No transactions match these filters.</td></tr>`;
  wireTxnRowClicks('#txn-body');

  $('#txn-export').onclick = ()=>{
    const rows = [['Txn ID','Date','User','Bank','Category','Amount','Type']].concat(
      txns.map(t=>[t.id,t.date,userName(t.userId),bankName(t.bankId),catName(t.categoryId),t.amount,t.type]));
    downloadCsv('transactions.csv', rows);
  };
}

/* ============================================================
   RENDER: CA SESSIONS PAGE
   ============================================================ */
function renderCaPage(){
  const caIds = Array.from(new Set(DATA.caSessions.map(s=>s.caId))).map(id=>({id, label:id}));
  buildFilterBar($('#ca-filters'), filterState.ca, [
    {key:'status', type:'select', label:'Status', optionsHtml:'<option value="">All statuses</option><option>Completed</option><option>Scheduled</option><option>Cancelled</option>'},
    {key:'ca', type:'select', label:'CA', optionsHtml:optionsHtml(caIds,'id','label','All CAs')},
    {key:'from', type:'date', label:'From', def:dataRange().from},
    {key:'to', type:'date', label:'To', def:dataRange().to}
  ], renderCaPage);

  const sessions = filterSessions(filterState.ca);
  const statusCounts = groupSum(sessions, s=>s.status, ()=>1);
  const revenue = sum(sessions, s=>s.fee);
  $('#ca-kpis').innerHTML = [
    {label:'Total sessions', value:sessions.length, color:'var(--accent)', bg:'var(--accent-soft)'},
    {label:'Completed', value:statusCounts.Completed||0, color:'var(--teal)', bg:'var(--teal-soft)'},
    {label:'Scheduled', value:statusCounts.Scheduled||0, color:'var(--amber)', bg:'var(--amber-soft)'},
    {label:'Cancelled', value:statusCounts.Cancelled||0, color:'var(--coral)', bg:'var(--coral-soft)'},
    {label:'Total revenue', value:inr(revenue), color:'var(--violet)', bg:'var(--violet-soft)'}
  ].map(k=>`<div class="kpi-card"><div class="kpi-top"><div class="kpi-icon" style="background:${k.bg};color:${k.color};">${ICONS.clock}</div></div><div class="kpi-value">${escapeHtml(k.value)}</div><div class="kpi-label">${escapeHtml(k.label)}</div></div>`).join('');

  makeChart('chart-ca-status', {type:'doughnut', data:{labels:['Completed','Scheduled','Cancelled'], datasets:[{data:[statusCounts.Completed||0,statusCounts.Scheduled||0,statusCounts.Cancelled||0], backgroundColor:[css('--teal'),css('--amber'),css('--coral')], borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'60%'})});
  const caRevenue = groupSum(sessions, s=>s.caId, s=>s.fee);
  const caList = Object.keys(caRevenue).sort();
  makeChart('chart-ca-revenue', {type:'bar', data:{labels:caList, datasets:[{data:caList.map(c=>caRevenue[c]), backgroundColor:css('--violet'), borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  $('#ca-body').innerHTML = sessions.map(s=>`
    <tr data-ca="${escapeHtml(s.id)}"><td>${escapeHtml(s.id)}</td><td>${escapeHtml(fmtDate(s.date))}</td><td>${escapeHtml(userName(s.userId))}</td><td>${escapeHtml(s.caName || s.caId)}</td><td>${escapeHtml(inr(s.fee))}</td>
    <td><span class="badge ${s.status==='Completed'?'completed':(s.status==='Scheduled'?'scheduled':'cancelled')}">${escapeHtml(s.status)}</span></td></tr>`).join('') || `<tr><td colspan="6" class="empty-note">No sessions match these filters.</td></tr>`;
  wireCaRowClicks('#ca-body');
}

/* ============================================================
   RENDER: USER ANALYSIS
   ============================================================ */
function renderUserAnalysis(){
  const spendByUser = groupSum(DATA.transactions, t=>t.userId, t=>t.amount);
  const feeByUser = groupSum(DATA.caSessions, s=>s.userId, s=>s.fee);
  const userIds = DATA.users.map(u=>u.id);

  makeChart('chart-user-spend', {type:'bar', data:{labels:DATA.users.map(u=>u.name), datasets:[{data:userIds.map(id=>spendByUser[id]||0), backgroundColor:PALETTE, borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const incomeOrder = orderedIncomeBrackets();
  const incomeCounts = groupSum(DATA.users, u=>u.income, ()=>1);
  makeChart('chart-user-income', {type:'doughnut', data:{labels:incomeOrder, datasets:[{data:incomeOrder.map(i=>incomeCounts[i]||0), backgroundColor:PALETTE, borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'60%'})});

  makeChart('chart-user-city', {type:'bar', data:{labels:DATA.users.map(u=>u.city), datasets:[{data:DATA.users.map(u=> spendByUser[u.id]||0), backgroundColor:css('--teal'), borderRadius:6}]}, options: baseOptions({indexAxis:'y', plugins:{legend:{display:false}}})});

  makeChart('chart-user-correlation', {type:'bar', data:{labels:DATA.users.map(u=>u.name),
    datasets:[
      {label:'Transaction value', data:userIds.map(id=>spendByUser[id]||0), backgroundColor:css('--accent'), borderRadius:5},
      {label:'CA session fees', data:userIds.map(id=>feeByUser[id]||0), backgroundColor:css('--teal'), borderRadius:5}
    ]}, options: baseOptions({})});

  $('#user-body').innerHTML = DATA.users.map(u=>`
    <tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.city)}</td><td>${escapeHtml(u.income)}</td><td>${escapeHtml(u.accountType)}</td><td>${escapeHtml(inr(spendByUser[u.id]||0))}</td><td>${escapeHtml(inr(feeByUser[u.id]||0))}</td></tr>`).join('');
}

/* ============================================================
   RENDER: BANK ANALYSIS
   ============================================================ */
function renderBankAnalysis(){
  const valueByBank = groupSum(DATA.transactions, t=>t.bankId, t=>t.amount);
  const countByBank = groupSum(DATA.transactions, t=>t.bankId, ()=>1);
  const total = sum(DATA.transactions, t=>t.amount);

  makeChart('chart-bank-value', {type:'bar', data:{labels:DATA.banks.map(b=>b.name), datasets:[{data:DATA.banks.map(b=>valueByBank[b.id]||0), backgroundColor:PALETTE, borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});
  makeChart('chart-bank-share', {type:'doughnut', data:{labels:DATA.banks.map(b=>b.name), datasets:[{data:DATA.banks.map(b=>valueByBank[b.id]||0), backgroundColor:PALETTE, borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'60%'})});

  const accountCounts = groupSum(DATA.users, u=>u.accountType, ()=>1);
  makeChart('chart-bank-account', {type:'doughnut', data:{labels:Object.keys(accountCounts), datasets:[{data:Object.values(accountCounts), backgroundColor:[css('--accent'),css('--violet')], borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'60%'})});

  $('#bank-body').innerHTML = DATA.banks.map(b=>{
    const v = valueByBank[b.id]||0;
    const share = total ? (v/total*100) : 0;
    return `<tr><td>${escapeHtml(b.name)}</td><td>${escapeHtml(countByBank[b.id]||0)}</td><td>${escapeHtml(inr(v))}</td><td>${escapeHtml(share.toFixed(1)+'%')}</td></tr>`;
  }).join('');
}

/* ============================================================
   RENDER: CATEGORY ANALYSIS
   ============================================================ */
function renderCategoryAnalysis(){
  const spendByCat = groupSum(DATA.transactions, t=>t.categoryId, t=>t.amount);
  const countByCat = groupSum(DATA.transactions, t=>t.categoryId, ()=>1);

  makeChart('chart-cat-spend', {type:'bar', data:{labels:DATA.categories.map(c=>c.name), datasets:[{data:DATA.categories.map(c=>spendByCat[c.id]||0), backgroundColor:PALETTE, borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const groupTotals = groupSum(DATA.transactions, t=>catGroup(t.categoryId), t=>t.amount);
  makeChart('chart-cat-group', {type:'doughnut', data:{labels:Object.keys(groupTotals), datasets:[{data:Object.values(groupTotals), backgroundColor:[css('--accent'),css('--teal'),css('--violet')], borderWidth:0}]}, options: baseOptions({scales:{}, cutout:'60%'})});

  const dates = DATA.transactions.map(t=>t.date).sort();
  const datasets = DATA.categories.map((c,i)=>({
    label:c.name,
    data: dates.map(d=> sum(DATA.transactions.filter(t=>t.date===d && t.categoryId===c.id), t=>t.amount)),
    backgroundColor: PALETTE[i%PALETTE.length], borderRadius:5
  }));
  makeChart('chart-cat-daily', {type:'bar', data:{labels:dates.map(d=>new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})), datasets}, options: baseOptions({scales:{x:{stacked:true, ticks:{color:css('--text-muted')}, grid:{color:'transparent'}}, y:{stacked:true, ticks:{color:css('--text-muted')}, grid:{color:css('--border')}}}})});

  const catRange = $('#cat-daily-range');
  if(catRange) catRange.textContent = rangeLabel() + ' · ' + dates.length + ' days';

  $('#cat-body').innerHTML = DATA.categories.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.group)}</td><td>${escapeHtml(countByCat[c.id]||0)}</td><td>${escapeHtml(inr(spendByCat[c.id]||0))}</td></tr>`).join('');
}

/* ============================================================
   RENDER: TIME ANALYSIS
   ============================================================ */
function renderTimeAnalysis(){
  const dates = DATA.transactions.map(t=>t.date).sort();
  const dailyTotals = groupSum(DATA.transactions, t=>t.date, t=>t.amount);
  makeChart('chart-time-trend', {type:'line', data:{labels:dates.map(d=>fmtDate(d)), datasets:[{data:dates.map(d=>dailyTotals[d]||0), borderColor:css('--accent'), backgroundColor:'transparent', tension:.35, pointBackgroundColor:css('--accent')}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const byWeekday = groupSum(DATA.transactions, t=>weekdayOf(t.date), t=>t.amount);
  const order = dates.map(weekdayOf);
  makeChart('chart-time-weekday', {type:'bar', data:{labels:order, datasets:[{data:order.map(w=>byWeekday[w]||0), backgroundColor:css('--teal'), borderRadius:6}]}, options: baseOptions({plugins:{legend:{display:false}}})});

  const debit = sum(DATA.transactions.filter(t=>t.type==='DEBIT'), t=>t.amount);
  const credit = sum(DATA.transactions.filter(t=>t.type==='CREDIT'), t=>t.amount);
  makeChart('chart-time-split', {type:'bar', data:{labels:['Debit','Credit'], datasets:[{data:[debit,credit], backgroundColor:[css('--coral'),css('--teal')], borderRadius:6}]}, options: baseOptions({indexAxis:'y', plugins:{legend:{display:false}}})});

  const splitRange = $('#time-split-range');
  if(splitRange) splitRange.textContent = rangeLabel();
}

/* ============================================================
   RENDER: CUSTOM ANALYSIS
   ============================================================ */
function renderCustomAnalysis(){
  buildFilterBar($('#custom-filters'), filterState.custom, [
    {key:'user', type:'select', label:'User', optionsHtml:optionsHtml(DATA.users,'id','name','All users')},
    {key:'from', type:'date', label:'From', def:dataRange().from},
    {key:'to', type:'date', label:'To', def:dataRange().to}
  ], renderCustomAnalysis);

  const s = filterState.custom;
  const usersInScope = s.user ? DATA.users.filter(u=>u.id===s.user) : DATA.users;
  const spendByUser = {}, feeByUser = {};
  usersInScope.forEach(u=>{
    spendByUser[u.id] = sum(DATA.transactions.filter(t=>t.userId===u.id && inRange(t.date,s.from,s.to)), t=>t.amount);
    feeByUser[u.id] = sum(DATA.caSessions.filter(x=>x.userId===u.id && inRange(x.date,s.from,s.to)), x=>x.fee);
  });

  makeChart('chart-custom', {type:'bar', data:{labels:usersInScope.map(u=>u.name),
    datasets:[
      {label:'Transaction value', data:usersInScope.map(u=>spendByUser[u.id]||0), backgroundColor:css('--accent'), borderRadius:5},
      {label:'CA session fees', data:usersInScope.map(u=>feeByUser[u.id]||0), backgroundColor:css('--teal'), borderRadius:5}
    ]}, options: baseOptions({})});

  const insights = [];
  const spendEntries = usersInScope.map(u=>({u, v:spendByUser[u.id]||0})).sort((a,b)=>b.v-a.v);
  if(spendEntries.length && spendEntries[0].v>0){
    insights.push(`${spendEntries[0].u.name} has the highest transaction value in this selection, at ${inr(spendEntries[0].v)}.`);
  }
  const withCa = usersInScope.filter(u=>(feeByUser[u.id]||0)>0);
  if(withCa.length){
    insights.push(`${withCa.length} of ${usersInScope.length} selected user(s) booked a CA session in this date range.`);
  } else {
    insights.push(`None of the selected users booked a CA session in this date range.`);
  }
  const savingsCount = usersInScope.filter(u=>u.accountType==='Savings').length;
  insights.push(`${savingsCount} of ${usersInScope.length} selected user(s) hold a Savings account.`);
  const topTwo = spendEntries.slice(0,2).map(e=>e.u.id);
  const topTwoWithCa = topTwo.filter(id=>(feeByUser[id]||0)>0).length;
  if(topTwo.length===2){
    insights.push(topTwoWithCa>0
      ? `Higher-spending users in this selection are also engaging with CA advisory sessions.`
      : `The highest spenders in this selection haven't booked a CA session yet – a possible upsell opportunity.`);
  }
  $('#custom-insights').innerHTML = insights.map(t=>`<li><span class="ibullet">${ICONS.bullet}</span><span>${escapeHtml(t)}</span></li>`).join('');
}

/* ============================================================
   RENDER: REPORTS
   ============================================================ */
const REPORTS = [
  {id:'txn-summary', name:'Transaction Summary Report', desc:'All transactions with category and bank breakdowns.', icon:'card', color:'var(--accent)', bg:'var(--accent-soft)'},
  {id:'user-spending', name:'User Spending Report', desc:'Per-user total spend and CA session fees.', icon:'users', color:'var(--teal)', bg:'var(--teal-soft)'},
  {id:'bank-wise', name:'Bank-wise Transaction Report', desc:'Transaction value and share by bank.', icon:'bank', color:'var(--violet)', bg:'var(--violet-soft)'},
  {id:'ca-session', name:'CA Session Report', desc:'All CA sessions with status and fees.', icon:'clock', color:'var(--amber)', bg:'var(--amber-soft)'},
  {id:'tax-insights', name:'Tax Advisory Insights Report', desc:'Cross-process view of spend vs. CA activity.', icon:'sliders', color:'var(--coral)', bg:'var(--coral-soft)'}
];
const USER_REPORTS = ['txn-summary','ca-session','user-spending'];
function renderReports(){
  const list = isAdmin() ? REPORTS : REPORTS.filter(r=> USER_REPORTS.includes(r.id));
  $('#report-grid').innerHTML = list.map(r=>`
    <div class="report-card">
      <div class="report-icon" style="background:${r.bg}; color:${r.color};">${ICONS[r.icon]}</div>
      <div class="report-info"><h4>${r.name}</h4><p>${r.desc}</p></div>
      <button class="btn btn-outline btn-sm" data-report="${r.id}">Download</button>
    </div>`).join('');
  $$('#report-grid [data-report]').forEach(btn=> btn.addEventListener('click', ()=> generateReport(btn.dataset.report)));
}
function csvEscape(v){ const s=String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function toCsv(rows){ return rows.map(r=> r.map(csvEscape).join(',')).join('\r\n'); }
function downloadCsv(filename, rows){
  const csvText = toCsv(rows);
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
  toast('Report downloaded.');
}

function generateReport(id){
  if(!isAdmin() && !USER_REPORTS.includes(id)) return;
  if(id==='txn-summary'){
    const rows=[['Txn ID','Date','User','Bank','Category','Amount','Type']].concat(
      DATA.transactions.map(t=>[t.id,t.date,userName(t.userId),bankName(t.bankId),catName(t.categoryId),t.amount,t.type]));
    downloadCsv('transaction_summary_report.csv', rows);
  } else if(id==='user-spending'){
    const spend = groupSum(DATA.transactions, t=>t.userId, t=>t.amount);
    const fees = groupSum(DATA.caSessions, s=>s.userId, s=>s.fee);
    const rows=[['User','City','Income Bracket','Total Spend','CA Fees']].concat(
      DATA.users.map(u=>[u.name,u.city,u.income,spend[u.id]||0,fees[u.id]||0]));
    downloadCsv('user_spending_report.csv', rows);
  } else if(id==='bank-wise'){
    const value = groupSum(DATA.transactions, t=>t.bankId, t=>t.amount);
    const count = groupSum(DATA.transactions, t=>t.bankId, ()=>1);
    const total = sum(DATA.transactions, t=>t.amount);
    const rows=[['Bank','Transactions','Total Value','Share %']].concat(
      DATA.banks.map(b=>[b.name, count[b.id]||0, value[b.id]||0, total?((value[b.id]||0)/total*100).toFixed(1):'0']));
    downloadCsv('bank_wise_transaction_report.csv', rows);
  } else if(id==='ca-session'){
    const rows=[['Session ID','Date','User','CA','Fee','Status']].concat(
      DATA.caSessions.map(s=>[s.id,s.date,userName(s.userId),s.caId,s.fee,s.status]));
    downloadCsv('ca_session_report.csv', rows);
  } else if(id==='tax-insights'){
    const spend = groupSum(DATA.transactions, t=>t.userId, t=>t.amount);
    const fees = groupSum(DATA.caSessions, s=>s.userId, s=>s.fee);
    const rows=[['User','Total Spend','CA Fees','Has Completed CA Session']].concat(
      DATA.users.map(u=>[u.name, spend[u.id]||0, fees[u.id]||0, DATA.caSessions.some(s=>s.userId===u.id && s.status==='Completed')?'Yes':'No']));
    downloadCsv('tax_advisory_insights_report.csv', rows);
  }
}

function fillProfile(){
  const u = CURRENT_USER;
  if(!u) return;
  $('#profile-name').value = u.name;
  $('#profile-email').value = u.email;
  $('#profile-role').value = u.title;
  $('#profile-name-display').textContent = u.name;
  $('#profile-role-display').textContent = u.title + ' · ' + u.email;
  $('#profile-avatar').textContent = (u.name || '?').charAt(0).toUpperCase();
}

/* ============================================================
   RENDER: PROFILE
   ============================================================ */
function renderProfile(){
  $$('#page-profile .tab-btn').forEach(btn=>{
    btn.onclick = ()=>{
      $$('#page-profile .tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      $$('#page-profile .tab-panel').forEach(p=>p.classList.remove('active'));
      $('#ptab-'+btn.dataset.ptab).classList.add('active');
    };
  });
  fillProfile();
  $('#profile-save').onclick = async ()=>{
    const payload = { name: $('#profile-name').value.trim() };
    const current = $('#profile-current-password').value, next = $('#profile-new-password').value;
    if(next){ payload.currentPassword = current; payload.newPassword = next; }
    try{
      const res = await apiFetch('/api/auth/me', { method:'PATCH', body: JSON.stringify(payload) });
      const body = await res.json().catch(()=>({}));
      if(!res.ok){ toast(body.error || 'Could not update profile.'); return; }
      setCurrentUser(body.user);
      $('#profile-current-password').value = ''; $('#profile-new-password').value = '';
      toast(next ? 'Profile and password updated.' : 'Profile updated.');
    }catch(err){ toast(err.message || 'Could not update profile.'); }
  };
  $('#dark-toggle').checked = document.documentElement.getAttribute('data-theme')==='dark';
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(mode){
  if(mode==='dark'){ document.documentElement.setAttribute('data-theme','dark'); }
  else if(mode==='light'){ document.documentElement.setAttribute('data-theme','light'); }
  else { document.documentElement.removeAttribute('data-theme'); }
  try{ localStorage.setItem('finware_theme', mode); }catch(e){}
  Object.keys(CHARTS).forEach(k=> CHARTS[k].destroy());
  Object.keys(CHARTS).forEach(k=> delete CHARTS[k]);
  const activePage = $('.page.active');
  if(activePage){ const id = activePage.id.replace('page-',''); RENDERERS[id] && RENDERERS[id](); }
}
function isDark(){
  const attr = document.documentElement.getAttribute('data-theme');
  if(attr==='dark') return true;
  if(attr==='light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/* ============================================================
   RENDERER MAP + INIT
   ============================================================ */
/* ============================================================
   INSIGHTS – BEHAVIOUR, ANOMALIES, RECOMMENDATIONS, RISK
   ------------------------------------------------------------
   All figures rendered on these pages are returned by
   /api/insights/*, which computes them from the warehouse fact
   tables on the server. Nothing is predicted or scored here, and
   no value is hardcoded in this file.
   ============================================================ */
const insightState = { spendingUser:null, recUser:null, anomalyUser:'', anomalyStatus:'' };

const UNLINKED_MSG = 'Your account is not linked to a customer record yet. Please ask an administrator to link it.';
const INSUFFICIENT_MSG = 'Insufficient transaction history for a reliable behavioural prediction.';

function metricTile(label, value, sub){
  return `<div class="insight-metric"><div class="insight-metric-label">${escapeHtml(label)}</div>`
       + `<div class="insight-metric-value">${escapeHtml(value)}</div>`
       + (sub ? `<div class="insight-metric-sub">${escapeHtml(sub)}</div>` : '')
       + '</div>';
}
function metricError(message){
  return `<div class="insight-metric error">${escapeHtml(message)}</div>`;
}
const riskBadge = level => `<span class="badge ${escapeHtml(String(level).toLowerCase())}">${escapeHtml(level)}</span>`;
const statusBadge = status => `<span class="badge ${status==='ANOMALOUS'?'anomalous':'normal'}">${escapeHtml(status)}</span>`;

/* Populate a customer <select> from the users already loaded by
   /api/warehouse/all, preserving whatever is currently chosen. */
function fillCustomerSelect(sel, stateKey, allowBlank){
  if(!sel) return '';
  if(sel.dataset.filled !== '1'){
    const blank = allowBlank ? '<option value="">All customers</option>' : '';
    sel.innerHTML = blank + DATA.users.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)} (${escapeHtml(u.id)})</option>`).join('');
    sel.dataset.filled = '1';
    sel.addEventListener('change', ()=>{ insightState[stateKey] = sel.value; });
  }
  const wanted = insightState[stateKey];
  const exists = DATA.users.some(u=>u.id===wanted);
  sel.value = exists ? wanted : (allowBlank ? '' : (DATA.users[0]||{}).id || '');
  insightState[stateKey] = sel.value;
  return sel.value;
}

/* Fetch an insights endpoint, surfacing the server's message on failure. */
async function fetchInsight(path){
  const res = await apiFetch(path);
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
  return body;
}

/* TRANSACTION RISK – opened from any transaction row (Transactions,
   Dashboard, Category/Time analysis and the anomaly table). */
async function openTransactionRisk(txnId){
  openModal('Transaction ' + txnId, [['Assessment','Loading…']]);
  try{
    const d = await fetchInsight('/api/insights/transaction/' + encodeURIComponent(txnId) + '/risk');
    const t = d.transaction, r = d.risk;
    const baselineLabel = r.baseline === undefined ? null : (r.baselineSource === 'category'
      ? inr(r.baseline) + ' (' + r.baselineSample + '-transaction category average)'
      : inr(r.baseline) + ' (overall average)');
    const rows = [
      ['Amount', inr(t.amount)],
      ['Date', fmtDate(t.date)],
      ['Customer', t.userName || t.userId],
      ['Bank', t.bank],
      ['Category', t.categoryName],
      ['Type', t.type],
      ['Status', r.status],
      ['Risk', r.level],
      ['Risk score', r.score + ' / 100'],
      ['Usual amount', baselineLabel],
      ['Share of customer spend', r.shareOfLifetimeSpend + '%']
    ].filter(row=> row[1] !== null && row[1] !== undefined && row[1] !== 'undefined%');
    $('#modal-title').textContent = 'Transaction ' + t.txnId + ' – Risk';
    $('#modal-body').innerHTML =
      rows.map(row=>`<div class="modal-row"><span>${escapeHtml(row[0])}</span><span>${escapeHtml(row[1])}</span></div>`).join('')
      + `<div class="rec-tag">Reason</div><div class="rec-why">${escapeHtml(r.reason)}</div>`;
  }catch(err){
    $('#modal-body').innerHTML = metricError('Could not load the risk assessment: ' + (err && err.message ? err.message : 'unknown error'));
  }
}

/* Attach risk lookups to every rendered transaction row. */
function wireRiskRowClicks(scope){
  const root = typeof scope === 'string' ? $(scope) : scope;
  if(!root) return;
  $$('tr[data-txn]', root).forEach(tr=>{
    if(tr.dataset.riskWired === '1') return;
    tr.dataset.riskWired = '1';
    tr.addEventListener('click', ()=> openTransactionRisk(tr.dataset.txn));
  });
}

/* ---------------- SPENDING BEHAVIOUR ---------------- */
async function renderSpendingBehaviour(){
  const userId = fillCustomerSelect($('#spending-user'),'spendingUser',false);
  const box = $('#spending-metrics'), insight = $('#spending-insight'),
        period = $('#spending-period'), catBody = $('#spending-cat-body');
  if(!box) return;

  if(!userId){
    box.innerHTML = metricError(isAdmin() ? 'No customers were returned by the warehouse.' : UNLINKED_MSG);
    return;
  }

  box.innerHTML = '<div class="insight-metric"><div class="insight-metric-sub">Calculating from recorded transactions…</div></div>';

  try{
    const d = await fetchInsight('/api/insights/customer/' + encodeURIComponent(userId) + '/spending');

    if(!d.sufficientHistory){
      const message = d.message || INSUFFICIENT_MSG;
      box.innerHTML = metricError(message);
      if(insight) insight.textContent = message;
      if(period) period.textContent = '';
      if(catBody) catBody.innerHTML = '';
      return;
    }

    box.innerHTML = [
      metricTile('Predicted behaviour', d.behaviour, 'Spending trend: ' + d.spendingTrend),
      metricTile('Primary category', d.primaryCategory ? d.primaryCategory.name : '—',
                 d.primaryCategory ? d.primaryCategory.shareOfSpend + '% of spend' : ''),
      metricTile('Transaction frequency', d.transactionFrequency,
                 (d.frequencyDetail.changePct >= 0 ? '+' : '') + d.frequencyDetail.changePct + '% vs earlier period'),
      metricTile('Average transaction', inr(d.averageTransaction), d.totalTransactions + ' transactions'),
      metricTile('Total spending', inr(d.totalSpending), 'Highest ' + inr(d.highestTransaction)),
      metricTile('Debit transactions', String(d.debitCount), 'Outgoing'),
      metricTile('Credit transactions', String(d.creditCount), 'Incoming'),
      metricTile('Highest transaction', inr(d.highestTransaction), 'Largest single payment')
    ].join('');

    if(insight) insight.textContent = d.insight;
    if(period) period.textContent = d.period ? fmtDate(d.period.firstDate) + ' – ' + fmtDate(d.period.lastDate) : '';

    if(catBody){
      catBody.innerHTML = d.categories.map(c=>`<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.group)}</td>
        <td>${escapeHtml(c.transactionCount)}</td>
        <td class="${'amt-debit'}">${escapeHtml(inr(c.totalSpend))}</td>
        <td>${escapeHtml(inr(c.averageAmount))}</td>
        <td>${escapeHtml(c.shareOfSpend + '%')}</td>
      </tr>`).join('');
    }
  }catch(err){
    box.innerHTML = metricError('Could not load spending behaviour: ' + (err && err.message ? err.message : 'unknown error'));
    if(catBody) catBody.innerHTML = '';
  }
}

/* ---------------- ANOMALY ALERTS ---------------- */
async function renderAnomalyAlerts(){
  const userId = fillCustomerSelect($('#anomaly-user'),'anomalyUser',isAdmin());
  if(!isAdmin() && !userId){
    $('#anomaly-kpis').innerHTML = metricError(UNLINKED_MSG);
    $('#anomaly-body').innerHTML = '';
    return;
  }
  const statusSel = $('#anomaly-status');
  if(statusSel && statusSel.dataset.filled !== '1'){
    statusSel.dataset.filled = '1';
    statusSel.addEventListener('change', ()=>{ insightState.anomalyStatus = statusSel.value; renderAnomalyAlerts(); });
  }
  const status = insightState.anomalyStatus;
  const kpis = $('#anomaly-kpis'), body = $('#anomaly-body'), empty = $('#anomaly-empty');
  if(!kpis) return;

  kpis.innerHTML = '<div class="insight-metric"><div class="insight-metric-sub">Reviewing recorded transactions…</div></div>';

  const params = [];
  if(userId) params.push('user=' + encodeURIComponent(userId));
  if(status) params.push('status=' + encodeURIComponent(status));

  try{
    const d = await fetchInsight('/api/insights/anomalies' + (params.length ? '?' + params.join('&') : ''));
    const c = d.counts;

    kpis.innerHTML = [
      metricTile('Transactions reviewed', c.totalTransactions.toLocaleString('en-IN'), 'All recorded transactions'),
      metricTile('Normal', c.normalCount.toLocaleString('en-IN'), 'Within expected pattern'),
      metricTile('Anomalous', c.anomalousCount.toLocaleString('en-IN'), 'Flagged for review'),
      metricTile('Anomaly rate', c.anomalyRate + '%', 'Share flagged'),
      metricTile('High risk', String(c.riskHigh), d.bands ? 'Score ' + d.bands.high : 'Needs attention')
    ].join('');

    if(body){
      body.innerHTML = (d.transactions || []).map(t=>`<tr data-txn="${escapeHtml(t.txnId)}">
        <td>${escapeHtml(t.txnId)}</td>
        <td>${escapeHtml(t.userName)}</td>
        <td>${escapeHtml(fmtDate(t.date))}</td>
        <td>${escapeHtml(t.categoryName)}</td>
        <td class="${t.type==='DEBIT'?'amt-debit':'amt-credit'}">${escapeHtml(inr(t.amount))}</td>
        <td>${escapeHtml(t.riskScore)}</td>
        <td>${riskBadge(t.riskLevel)}</td>
        <td>${statusBadge(t.status)}</td>
      </tr>`).join('');
      wireRiskRowClicks(body);
    }
    if(empty) empty.hidden = (d.transactions || []).length > 0;
  }catch(err){
    kpis.innerHTML = metricError('Could not load anomaly review: ' + (err && err.message ? err.message : 'unknown error'));
    if(body) body.innerHTML = '';
    if(empty) empty.hidden = true;
  }
}

/* ---------------- RECOMMENDATIONS ---------------- */
async function renderRecommendations(){
  const userId = fillCustomerSelect($('#rec-user'),'recUser',false);
  const metrics = $('#rec-metrics'), cats = $('#rec-categories'), list = $('#rec-list'),
        disclaimer = $('#rec-disclaimer');
  if(!metrics) return;

  if(!userId){
    metrics.innerHTML = metricError(isAdmin() ? 'No customers were returned by the warehouse.' : UNLINKED_MSG);
    return;
  }

  metrics.innerHTML = '<div class="insight-metric"><div class="insight-metric-sub">Generating from recorded activity…</div></div>';

  try{
    const d = await fetchInsight('/api/insights/customer/' + encodeURIComponent(userId) + '/recommendations');

    if(!d.sufficientHistory){
      metrics.innerHTML = metricError(d.message || INSUFFICIENT_MSG);
      if(cats) cats.innerHTML = '';
      if(list) list.innerHTML = '';
      if(disclaimer) disclaimer.textContent = '';
      return;
    }

    const top = d.topCategories[0];
    metrics.innerHTML = [
      metricTile('Behaviour', d.behaviour, 'Spending trend: ' + d.spendingTrend),
      metricTile('Transaction frequency', d.transactionFrequency, 'Across the recorded period'),
      metricTile('Leading category', top ? top.name : '—', top ? top.shareOfSpend + '% of spend' : ''),
      metricTile('Recommendations', String(d.recommendations.length), 'Generated from this customer\'s data')
    ].join('');

    if(cats){
      cats.innerHTML = (d.topCategories || []).map((c,i)=>`
        <div class="report-card">
          <div class="report-icon" style="background:var(--accent-soft); color:var(--accent);">${ICONS.tag || ICONS.txn}</div>
          <div class="report-info">
            <h4>${escapeHtml(c.name)}</h4>
            <p>${escapeHtml(c.group)} &middot; ${escapeHtml(c.transactionCount)} transactions &middot; ${escapeHtml(inr(c.totalSpend))}</p>
          </div>
          <div class="insight-metric-value">${escapeHtml(c.shareOfSpend + '%')}</div>
        </div>`).join('');
    }

    if(list){
      list.innerHTML = (d.recommendations || []).map(r=>`
        <div class="rec-block">
          <h4>${escapeHtml(r.title)}</h4>
          <div class="rec-body">${escapeHtml(r.recommendation)}</div>
          ${r.offer ? `<div class="rec-tag">Recommended offer</div><div class="rec-offer">${escapeHtml(r.offer)}</div>` : ''}
          <div class="rec-tag">Why</div>
          <div class="rec-why">${escapeHtml(r.reason)}</div>
        </div>`).join('')
        || metricError('Not enough activity recorded yet to generate a recommendation for this customer.');
    }
    if(disclaimer) disclaimer.textContent = d.disclaimer || '';
  }catch(err){
    metrics.innerHTML = metricError('Could not load recommendations: ' + (err && err.message ? err.message : 'unknown error'));
    if(cats) cats.innerHTML = '';
    if(list) list.innerHTML = '';
  }
}

/* ---------------- MY DASHBOARD (user role) ---------------- */
function renderUserDashboard(){
  const me = DATA.users[0];
  $('#my-unlinked').hidden = !!me;
  $('#my-dash-content').hidden = !me;
  $('#my-dash-title').textContent = 'Welcome, ' + ((CURRENT_USER && CURRENT_USER.name) || 'there');
  if(!me) return;
  const debits = DATA.transactions.filter(t=>t.type==='DEBIT');
  const credits = DATA.transactions.filter(t=>t.type==='CREDIT');
  $('#my-kpis').innerHTML = [
    ['Transactions', DATA.transactions.length.toLocaleString('en-IN')],
    ['Total spent', inr(sum(debits, t=>t.amount))],
    ['Total received', inr(sum(credits, t=>t.amount))],
    ['CA sessions', String(DATA.caSessions.length)],
    ['CA fees', inr(sum(DATA.caSessions, s=>s.fee))]
  ].map(k=>`<div class="kpi-card"><div class="kpi-value">${escapeHtml(k[1])}</div><div class="kpi-label">${escapeHtml(k[0])}</div></div>`).join('');

  const byCat = groupSum(debits, t=>catName(t.categoryId), t=>t.amount);
  const byBank = groupSum(debits, t=>bankName(t.bankId), t=>t.amount);
  makeChart('chart-my-category', { type:'doughnut',
    data:{ labels:Object.keys(byCat), datasets:[{ data:Object.values(byCat), backgroundColor:PALETTE, borderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:css('--text-muted'), font:{family:'Inter', size:11}, boxWidth:11 } } } } });
  makeChart('chart-my-bank', { type:'bar',
    data:{ labels:Object.keys(byBank), datasets:[{ label:'Spend', data:Object.values(byBank), backgroundColor:PALETTE[0], borderRadius:6 }] },
    options: baseOptions({ plugins:{ legend:{ display:false } } }) });

  const recent = DATA.transactions.slice().sort((a,b)=> b.date.localeCompare(a.date)).slice(0,10);
  $('#my-recent-body').innerHTML = recent.map(t=>`<tr data-txn="${escapeHtml(t.id)}">
    <td>${escapeHtml(t.id)}</td><td>${escapeHtml(fmtDate(t.date))}</td><td>${escapeHtml(bankName(t.bankId))}</td>
    <td>${escapeHtml(catName(t.categoryId))}</td>
    <td class="${t.type==='DEBIT'?'amt-debit':'amt-credit'}">${escapeHtml(inr(t.amount))}</td><td>${escapeHtml(t.type)}</td></tr>`).join('');
  wireRiskRowClicks('#my-recent-body');
}

/* ---------------- ABOUT (admin only, fetched from the server) ---------------- */
async function renderAbout(){
  const box = $('#about-content');
  if(!box || box.dataset.loaded === '1') return;
  try{
    const res = await apiFetch('/api/admin/model-info');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    // Trusted, static admin content served by our own backend.
    box.innerHTML = await res.text();
    box.dataset.loaded = '1';
  }catch(err){
    box.innerHTML = metricError('Could not load this page.');
  }
}

/* ---------------- USER MANAGEMENT (admin only) ---------------- */
async function renderAdminUsers(){
  const body = $('#admin-users-body');
  body.innerHTML = '<tr><td colspan="6" class="muted">Loading accounts…</td></tr>';
  let accounts;
  try{
    const res = await apiFetch('/api/admin/users');
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    accounts = data.users;
  }catch(err){
    body.innerHTML = `<tr><td colspan="6">${metricError('Could not load accounts: ' + escapeHtml(err.message))}</td></tr>`;
    return;
  }
  $('#admin-users-count').textContent = accounts.length + ' account' + (accounts.length===1?'':'s');
  const customerOptions = selected => '<option value="">— Not linked —</option>' + DATA.users.map(c=>
    `<option value="${escapeHtml(c.id)}"${c.id===selected?' selected':''}>${escapeHtml(c.name)} (${escapeHtml(c.id)})</option>`).join('');
  body.innerHTML = accounts.map(a=>{
    const self = CURRENT_USER && a.id === CURRENT_USER.id;
    return `<tr data-account="${escapeHtml(a.id)}">
      <td>${escapeHtml(a.name)}${self?' <span class="muted">(you)</span>':''}</td>
      <td>${escapeHtml(a.email)}</td>
      <td><select class="admin-users-select" data-field="role">
        <option value="user"${a.role==='user'?' selected':''}>User</option>
        <option value="admin"${a.role==='admin'?' selected':''}>Admin</option></select></td>
      <td>${a.role==='admin' ? '<span class="muted">All records</span>' :
        `<select class="admin-users-select" data-field="customerId">${customerOptions(a.customerId)}</select>`}</td>
      <td>${escapeHtml(a.createdAt ? fmtDate(String(a.createdAt).slice(0,10)) : '—')}</td>
      <td>${self ? '' : '<button class="btn btn-outline btn-sm" data-action="delete">Delete</button>'}</td>
    </tr>`;
  }).join('');

  $$('tr[data-account]', body).forEach(tr=>{
    const id = tr.dataset.account;
    $$('select[data-field]', tr).forEach(sel=> sel.addEventListener('change', async ()=>{
      const payload = {}; payload[sel.dataset.field] = sel.value || null;
      const res = await apiFetch('/api/admin/users/' + encodeURIComponent(id), { method:'PATCH', body: JSON.stringify(payload) });
      const data = await res.json().catch(()=>({}));
      toast(res.ok ? 'Account updated.' : (data.error || 'Could not update account.'));
      renderAdminUsers();
    }));
    const del = $('[data-action="delete"]', tr);
    if(del) del.addEventListener('click', async ()=>{
      if(!window.confirm('Delete this account? This cannot be undone.')) return;
      const res = await apiFetch('/api/admin/users/' + encodeURIComponent(id), { method:'DELETE' });
      const data = await res.json().catch(()=>({}));
      toast(res.ok ? 'Account deleted.' : (data.error || 'Could not delete account.'));
      renderAdminUsers();
    });
  });
}

const RENDERERS = {
  'my-dashboard': renderUserDashboard,
  'admin-users': renderAdminUsers,
  about: renderAbout,
  dashboard: renderDashboard,
  transactions: renderTransactionsPage,
  ca: renderCaPage,
  user: renderUserAnalysis,
  bank: renderBankAnalysis,
  category: renderCategoryAnalysis,
  time: renderTimeAnalysis,
  custom: renderCustomAnalysis,
  spending: renderSpendingBehaviour,
  anomaly: renderAnomalyAlerts,
  recommendations: renderRecommendations,
  reports: renderReports,
  profile: renderProfile
};

function wireChrome(){
  $('#hamburger-btn').addEventListener('click', ()=> document.body.classList.toggle('sidebar-open'));
  $('#avatar-btn').addEventListener('click', (e)=>{ e.stopPropagation(); $('#avatar-menu').classList.toggle('show'); });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('.avatar-wrap')) $('#avatar-menu').classList.remove('show'); });
  $$('#avatar-menu [data-nav]').forEach(b=> b.addEventListener('click', ()=> showPage(b.dataset.nav)));
  $('#logout-btn').addEventListener('click', logout);
  $('#modal-close').addEventListener('click', ()=> $('#modal-overlay').classList.remove('show'));
  $('#modal-overlay').addEventListener('click', (e)=>{ if(e.target.id==='modal-overlay') $('#modal-overlay').classList.remove('show'); });
  $('#theme-toggle').addEventListener('click', ()=> applyTheme(isDark() ? 'light' : 'dark'));
  $('#dark-toggle').addEventListener('change', (e)=> applyTheme(e.target.checked ? 'dark' : 'light'));
  $$('.forgot-link').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); toast("Password reset isn't available yet \u2014 please contact an administrator."); }));
  $('#denied-home').addEventListener('click', ()=> showPage(homePage()));
  window.addEventListener('hashchange', ()=>{ const id = pageFromHash(); if(CURRENT_USER && id) showPage(id); });
  const refresh = $('#analysis-refresh');
  if(refresh) refresh.addEventListener('click', ()=>{ loadAnalytics().catch(err=> console.error('[FinWare] analytics refresh failed:', err)); });
}

/* ============================================================
   LOGIN
   ============================================================ */
function logout(){
  const wasAdmin = isAdmin() || isAdminPortal();
  try{ localStorage.removeItem('finware_token'); }catch(e){}
  CURRENT_USER = null;
  // A full reload drops every cached record, chart and form state so nothing
  // from this session is visible to whoever signs in next.
  window.location.replace(wasAdmin ? '/admin' : '/');
}
function setCurrentUser(user){
  CURRENT_USER = user;
  $('#avatar-initial').textContent = (user.name || '?').charAt(0).toUpperCase();
  $('#avatar-name').textContent = user.name;
}
async function loginSuccess(user){
  setCurrentUser(user);
  buildNav();
  await loadWarehouseData();
  $('#login-page').style.display = 'none';
  $('#app').classList.add('active');
  const requested = pageFromHash();
  showPage(requested && requested !== 'denied' ? requested : homePage());
}
function showAuthPanel(name){
  ['user-login','register','admin-login'].forEach(p=>{ $('#auth-'+p).hidden = (p !== name); });
  $$('.login-error').forEach(el=> el.classList.remove('show'));
}
function setAuthError(id, msg){
  const el = $('#'+id);
  el.textContent = msg;
  el.classList.add('show');
}
async function postAuth(path, payload, errorId){
  $('#'+errorId).classList.remove('show');
  try{
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(()=> ({}));
    if(!res.ok){
      setAuthError(errorId, body.error || 'Something went wrong. Please try again.');
      return;
    }
    try{ localStorage.setItem('finware_token', body.token); }catch(err){}
    await loginSuccess(body.user);
  }catch(err){
    setAuthError(errorId, 'Could not reach the FinWare server. Is it running?');
  }
}
function wireLogin(){
  $$('[data-auth-switch]').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); showAuthPanel(a.dataset.authSwitch); }));
  $('#user-login-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    postAuth('/api/auth/login', {
      email: $('#user-login-email').value.trim().toLowerCase(),
      password: $('#user-login-password').value,
      portal: 'user'
    }, 'user-login-error');
  });
  $('#admin-login-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    postAuth('/api/auth/login', {
      email: $('#admin-login-email').value.trim().toLowerCase(),
      password: $('#admin-login-password').value,
      portal: 'admin'
    }, 'admin-login-error');
  });
  $('#register-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const password = $('#register-password').value;
    if(password !== $('#register-confirm').value){
      setAuthError('register-error', 'Passwords do not match.');
      return;
    }
    // Only identity fields are sent; the server always assigns the "user" role.
    postAuth('/api/auth/register', {
      name: $('#register-name').value.trim(),
      email: $('#register-email').value.trim().toLowerCase(),
      password
    }, 'register-error');
  });
}

/* ============================================================
   INIT
   ============================================================ */
async function init(){
  let savedTheme = null;
  try{ savedTheme = localStorage.getItem('finware_theme'); }catch(e){}
  if(savedTheme==='dark') document.documentElement.setAttribute('data-theme','dark');
  if(savedTheme==='light') document.documentElement.setAttribute('data-theme','light');

  wireChrome();
  wireLogin();
  showAuthPanel(isAdminPortal() ? 'admin-login' : 'user-login');
  if(isAdminPortal()) $('#login-tag').textContent = 'Administrator access';

  const token = authToken();
  if(token){
    try{
      const res = await apiFetch('/api/auth/me');
      if(res.ok){
        const body = await res.json();
        await loginSuccess(body.user);
        return;
      }
    }catch(err){
      // Invalid/expired token (apiFetch already cleared it) or the server isn't
      // reachable yet – either way fall through to the sign-in screen.
    }
  }
  $('#login-page').style.display='flex';
}
document.addEventListener('DOMContentLoaded', init);

})();
