const state = { token: localStorage.getItem('campus_pulse_token'), user: JSON.parse(localStorage.getItem('campus_pulse_user') || 'null'), issues: [], category: 'all', map: null, markers: new Map() };
const campus = [-33.9309, 18.4258];
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const categoryName = (value) => value === 'teaching' ? 'Teaching' : value[0].toUpperCase() + value.slice(1);
const statusName = (value) => value === 'in_progress' ? 'In progress' : value[0].toUpperCase() + value.slice(1);
const relativeTime = (value) => { const hours = Math.max(0, Math.floor((Date.now() - new Date(`${value}Z`).getTime()) / 3600000)); return hours < 1 ? 'just now' : `${hours}h ago`; };

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The signal dropped. Try again.');
  return body;
}
function showError(message) { const target = $('#form-error'); if (target) target.textContent = message; }
function showToast(message) { const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3400); }
function setSession(data) { state.token = data.token; state.user = data.user; localStorage.setItem('campus_pulse_token', data.token); localStorage.setItem('campus_pulse_user', JSON.stringify(data.user)); }
function logout() { localStorage.removeItem('campus_pulse_token'); localStorage.removeItem('campus_pulse_user'); state.token = null; state.user = null; location.href = '/index.html'; }

function initAuth() {
  const form = $('#auth-form'); if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault(); showError(''); const page = document.body.dataset.page; const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button'); button.disabled = true; button.innerHTML = 'THINKING… 🤖';
    try { const result = await api(`/api/auth/${page === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) }); setSession(result); location.href = '/profile.html'; }
    catch (error) { showError(error.message); button.disabled = false; button.innerHTML = page === 'register' ? 'CREATE ACCOUNT <b>→</b>' : 'LOG IN <b>→</b>'; }
  });
}
function updateAuthLinks() {
  document.querySelectorAll('[data-auth-link]').forEach(link => { if (state.user) { link.textContent = state.user.name.split(' ')[0].toUpperCase(); link.href = '/profile.html'; } });
}
function markerIcon(issue) { return L.divIcon({ className: '', html: `<div class="custom-pin ${issue.status === 'stale' ? 'stale' : ''} ${issue.status === 'resolved' ? 'resolved' : ''}"></div>`, iconSize: [18,18], iconAnchor: [9,9] }); }
function popupHtml(issue) {
  const actions = state.user && issue.status !== 'resolved' ? `<div class="popup-actions"><button class="confirm-button" data-action="confirm" data-id="${issue.id}">Still there</button><button class="clear-button" data-action="resolve" data-id="${issue.id}">It's fixed</button></div>` : '';
  return `<div class="popup"><span class="category-label">${categoryName(issue.category)} · ${statusName(issue.status)}</span><h4>${escapeHtml(issue.description)}</h4><p>Confirmed ${issue.confirmation_count}× · Last seen ${relativeTime(issue.last_confirmed_at)}</p>${actions}</div>`;
}
async function issueAction(button) {
  if (!state.user) { location.href = '/login.html'; return; }
  try { await api(`/api/issues/${button.dataset.id}/${button.dataset.action}`, { method: 'POST' }); showToast(button.dataset.action === 'confirm' ? 'Confirmed. Pulse bumped. ✦' : 'Cleared. Nice human work.'); await loadIssues(); }
  catch (error) { showToast(error.message); }
}
function wireActions() { document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); issueAction(button); })); }
function renderList() {
  const list = $('#issue-list'); if (!list) return;
  const query = ($('#search')?.value || '').toLowerCase();
  const visible = state.issues.filter(issue => (state.category === 'all' || issue.category === state.category) && `${issue.description} ${issue.category}`.toLowerCase().includes(query));
  $('#issue-count').textContent = `${state.issues.filter(issue => issue.status !== 'resolved').length} LIVE SIGNALS`;
  if (!visible.length) { list.innerHTML = '<div class="empty-state"><strong>Nothing here yet.</strong><br>Even AI needs data to work with. ✦<br><br><a class="button button-cyan" href="/report.html">BE THE FIRST <b>+</b></a></div>'; return; }
  list.innerHTML = visible.map(issue => `<article class="issue-card" data-id="${issue.id}"><div class="issue-card-top"><span class="category-label">${categoryName(issue.category)}</span><span class="status-badge ${issue.status === 'stale' ? 'stale' : ''}">${statusName(issue.status)}</span></div><h4>${escapeHtml(issue.description)}</h4><p>Reported by ${escapeHtml(issue.reporter_name || 'a student')}</p><div class="issue-card-foot"><span class="confirm-count">Confirmed ${issue.confirmation_count}×</span><span>${relativeTime(issue.last_confirmed_at)}</span></div></article>`).join('');
  document.querySelectorAll('.issue-card').forEach(card => card.addEventListener('click', () => { const marker = state.markers.get(Number(card.dataset.id)); if (marker) { state.map.setView(marker.getLatLng(), 18, { animate: true }); marker.openPopup(); } }));
}
function renderMap() {
  state.markers.forEach(marker => marker.remove()); state.markers.clear();
  state.issues.filter(issue => state.category === 'all' || issue.category === state.category).forEach(issue => { const marker = L.marker([issue.latitude, issue.longitude], { icon: markerIcon(issue) }).addTo(state.map).bindPopup(popupHtml(issue)); marker.on('popupopen', wireActions); marker.on('click', () => marker.getElement()?.classList.add('pin-selected')); marker.on('popupclose', () => marker.getElement()?.classList.remove('pin-selected')); state.markers.set(issue.id, marker); });
}
async function loadIssues() {
  const list = $('#issue-list'); if (list) list.innerHTML = '<div class="thinking">Thinking…<br><small>(the robot is on it 🤖)</small></div>';
  try { const result = await api('/api/issues'); state.issues = result.issues; renderMap(); renderList(); }
  catch (error) { if (list) list.innerHTML = `<div class="error-state">${escapeHtml(error.message)}<br><br><button class="button button-cyan" id="retry">RETRY SIGNAL</button></div>`; $('#retry')?.addEventListener('click', loadIssues); }
}
function initMap() {
  const mapElement = $('#map-canvas'); if (!mapElement) return;
  state.map = L.map(mapElement, { scrollWheelZoom: false }).setView(campus, 17); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(state.map);
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { $('.filter.active')?.classList.remove('active'); button.classList.add('active'); state.category = button.dataset.category; renderMap(); renderList(); }));
  $('#search')?.addEventListener('input', renderList); $('#refresh')?.addEventListener('click', loadIssues); loadIssues();
}
function initReport() {
  const mapElement = $('#report-map'); if (!mapElement) return;
  if (!state.user) { location.href = '/login.html'; return; }
  const map = L.map(mapElement).setView(campus, 17); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  let marker = L.marker(campus, { draggable: true }).addTo(map);
  const setPin = (latLng) => { marker.setLatLng(latLng); $('[name=latitude]').value = latLng.lat; $('[name=longitude]').value = latLng.lng; };
  map.on('click', event => setPin(event.latlng)); marker.on('dragend', () => setPin(marker.getLatLng()));
  $('#report-form').addEventListener('submit', async event => { event.preventDefault(); showError(''); const data = Object.fromEntries(new FormData(event.target)); const button = event.target.querySelector('button'); button.disabled = true; button.innerHTML = 'PUBLISHING… 🤖'; try { await api('/api/issues', { method: 'POST', body: JSON.stringify({ ...data, latitude: Number(data.latitude), longitude: Number(data.longitude) }) }); location.href = '/map.html'; } catch (error) { showError(error.message); button.disabled = false; button.innerHTML = 'PUBLISH SIGNAL <b>↗</b>'; } });
}
async function initProfile() {
  const target = $('#profile-content'); if (!target) return;
  if (!state.user) { location.href = '/login.html'; return; }
  $('#profile-subtitle').textContent = `${state.user.name} // ${state.user.role.toUpperCase()} ACCESS`;
  try {
    const result = await api('/api/issues'); const issues = state.user.role === 'staff' ? result.issues : result.issues.filter(issue => issue.reporter_id === state.user.id);
    target.innerHTML = `<section class="glass-panel"><p class="kicker cyan">${state.user.role === 'staff' ? 'RESOLVER QUEUE' : 'MY REPORTS'}</p><h2>${state.user.role === 'staff' ? 'Keep the signal moving.' : 'Your signals.'}</h2>${issues.length ? issues.map(issue => `<article class="issue-card"><div class="issue-card-top"><span class="category-label">${categoryName(issue.category)}</span><span class="status-badge">${statusName(issue.status)}</span></div><h4>${escapeHtml(issue.description)}</h4><div class="issue-card-foot"><span class="confirm-count">Confirmed ${issue.confirmation_count}×</span><span>${relativeTime(issue.last_confirmed_at)}</span></div>${state.user.role === 'staff' && issue.status !== 'resolved' ? `<div class="popup-actions"><button class="confirm-button" data-staff-status="in_progress" data-id="${issue.id}">IN PROGRESS</button><button class="clear-button" data-staff-status="resolved" data-id="${issue.id}">RESOLVE</button></div>` : ''}</article>`).join('') : '<div class="empty-state"><strong>No signals here yet.</strong><br>Even AI needs data to work with. ✦</div>'}<button class="button button-cyan" id="logout">LOG OUT <b>↗</b></button></section>`;
    $('#logout').addEventListener('click', logout); document.querySelectorAll('[data-staff-status]').forEach(button => button.addEventListener('click', async () => { try { await api(`/api/issues/${button.dataset.id}/status`, { method:'PATCH', body: JSON.stringify({ status: button.dataset.staffStatus }) }); initProfile(); } catch (error) { showToast(error.message); } }));
  } catch (error) { target.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`; }
}
function initHomeMotion() {
  if (document.body.dataset.page !== 'home') return;
  const layers = document.querySelectorAll('[data-parallax]');
  window.addEventListener('scroll', () => { const offset = Math.min(window.scrollY, window.innerHeight); layers.forEach(layer => { layer.style.transform = `translate3d(0, ${offset * Number(layer.dataset.parallax) * -1}px, 0)`; }); }, { passive: true });
  const lifecycle = document.querySelectorAll('.lifecycle-card');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting || entry.target.dataset.played) return;
    entry.target.dataset.played = 'true';
    const card = entry.target;
    if (card.dataset.lifecycle === 'confirm') { const counter = card.querySelector('[data-counter]'); let value = 0; const timer = setInterval(() => { counter.textContent = ++value; if (value === 2) clearInterval(timer); }, 280); }
    card.classList.add('lifecycle-playing');
  }), { threshold: .55 });
  lifecycle.forEach(card => observer.observe(card));
}
function init() { updateAuthLinks(); initAuth(); initMap(); initReport(); initProfile(); initHomeMotion(); document.querySelectorAll('.reveal').forEach(element => element.style.animationDelay = `${Math.random() * .18}s`); }
document.addEventListener('DOMContentLoaded', init);
