// app.js — passenger-facing SPA logic (vanilla JS, fetch-based)

const API = '';
let currentUser = JSON.parse(localStorage.getItem('sq_user') || 'null');
let pendingBookingFlightId = null; // used when login is triggered mid-booking

// ---------- view switching ----------
function setView(view) {
  document.getElementById('view-search').classList.toggle('hidden', view !== 'search');
  document.getElementById('view-dashboard').classList.toggle('hidden', view !== 'dashboard');
  document.querySelectorAll('.nav-links button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') loadDashboard();
}
document.querySelectorAll('.nav-links button').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.view === 'dashboard' && !currentUser) { openAuth(); return; }
    setView(b.dataset.view);
  });
});

// ---------- toast ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- auth UI ----------
function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentUser) {
    el.innerHTML = `<button class="btn ghost" onclick="logout()">Log out ${currentUser.Name.split(' ')[0]}</button>`;
  } else {
    el.innerHTML = `<button class="pill-btn" onclick="openAuth()">Log in</button>`;
  }
}
function openAuth() { document.getElementById('authOverlay').classList.remove('hidden'); showLogin(); }
function closeAuth() { document.getElementById('authOverlay').classList.add('hidden'); }
function showLogin() { document.getElementById('loginForm').classList.remove('hidden'); document.getElementById('registerForm').classList.add('hidden'); }
function showRegister() { document.getElementById('registerForm').classList.remove('hidden'); document.getElementById('loginForm').classList.add('hidden'); }

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  currentUser = json.data;
  localStorage.setItem('sq_user', JSON.stringify(currentUser));
  renderAuthArea();
  closeAuth();
  toast(`Welcome back, ${currentUser.Name.split(' ')[0]}`, 'success');
  if (pendingBookingFlightId) { const fid = pendingBookingFlightId; pendingBookingFlightId = null; bookFlight(fid); }
}

async function doRegister() {
  const body = {
    name: document.getElementById('regName').value.trim(),
    phone: document.getElementById('regPhone').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    password: document.getElementById('regPassword').value
  };
  const res = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  currentUser = { Passenger_ID: json.data.Passenger_ID, Name: body.name, Email: body.email };
  localStorage.setItem('sq_user', JSON.stringify(currentUser));
  renderAuthArea();
  closeAuth();
  toast('Account created — welcome aboard!', 'success');
  if (pendingBookingFlightId) { const fid = pendingBookingFlightId; pendingBookingFlightId = null; bookFlight(fid); }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('sq_user');
  renderAuthArea();
  setView('search');
}

// ---------- flight search ----------
async function searchFlights() {
  const params = new URLSearchParams();
  const src = document.getElementById('srcInput').value.trim();
  const dst = document.getElementById('dstInput').value.trim();
  const date = document.getElementById('dateInput').value;
  if (src) params.set('source', src);
  if (dst) params.set('destination', dst);
  if (date) params.set('date', date);

  const res = await fetch('/api/flights?' + params.toString());
  const json = await res.json();
  renderFlights(json.data || []);
}

function renderFlights(flights) {
  const list = document.getElementById('flightList');
  document.getElementById('resultCount').textContent = flights.length ? `(${flights.length})` : '';
  if (!flights.length) {
    list.innerHTML = `<div class="empty-state"><div class="glyph">✈</div>No flights match that search. Try clearing a filter.</div>`;
    return;
  }
  list.innerHTML = flights.map(f => {
    const full = f.Available_Seats <= 0;
    return `
    <div class="flight-row">
      <div class="flight-no">${f.Flight_No}</div>
      <div class="route">${f.Source} <span class="arrow">→</span> ${f.Destination}<small>${f.Flight_Status}</small></div>
      <div class="datetime">${f.Flight_Date}</div>
      <div class="datetime">${f.Flight_Time}</div>
      <div class="fare">₹${f.Fare.toLocaleString('en-IN')}</div>
      <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
        <span class="seats-tag ${full ? 'full' : 'open'}">${full ? 'FULL' : f.Available_Seats + ' seats left'}</span>
        ${full
          ? `<button class="btn" onclick="joinStandby(${f.Flight_ID})">Join standby</button>`
          : `<button class="btn primary" onclick="bookFlight(${f.Flight_ID})">Book</button>`}
      </div>
    </div>`;
  }).join('');
}

async function bookFlight(flightId) {
  if (!currentUser) { pendingBookingFlightId = flightId; openAuth(); return; }
  const res = await fetch('/api/book', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ passenger_id: currentUser.Passenger_ID, flight_id: flightId }) });
  const json = await res.json();
  if (!json.success) {
    if (json.message === 'FLIGHT_FULL') {
      toast('That flight just filled up — joining the standby queue instead.', '');
      return joinStandby(flightId);
    }
    return toast(json.message, 'error');
  }
  toast(`Booked! Seat ${json.data.Seat_No} confirmed.`, 'success');
  searchFlights();
}

async function joinStandby(flightId) {
  if (!currentUser) { pendingBookingFlightId = flightId; openAuth(); return; }
  const res = await fetch('/api/standby', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ passenger_id: currentUser.Passenger_ID, flight_id: flightId }) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  toast(`Added to standby — position #${json.data.Position}.`, 'success');
}

// ---------- dashboard ----------
async function loadDashboard() {
  const [bookingsRes, standbyRes] = await Promise.all([
    fetch(`/api/bookings/${currentUser.Passenger_ID}`),
    fetch(`/api/standby/${currentUser.Passenger_ID}`)
  ]);
  const bookings = (await bookingsRes.json()).data || [];
  const standby = (await standbyRes.json()).data || [];
  renderBookings(bookings);
  renderStandby(standby);
}

function renderBookings(rows) {
  const el = document.getElementById('bookingList');
  if (!rows.length) { el.innerHTML = `<div class="empty-state"><div class="glyph">🎫</div>No bookings yet — search a flight to get started.</div>`; return; }
  el.innerHTML = rows.map(b => `
    <div class="ticket">
      <div class="ticket-main">
        <div class="ticket-top-row">
          <div class="ticket-route">${b.Source} → ${b.Destination} <span style="color:var(--text-faint); font-size:13px; font-weight:400;">(${b.Flight_No})</span></div>
          <span class="status-tag ${b.Status}">${b.Status}</span>
        </div>
        <div class="ticket-meta">
          <span>${b.Flight_Date} · ${b.Flight_Time}</span>
          <span>₹${b.Amount ? b.Amount.toLocaleString('en-IN') : '—'} · ${b.Payment_Status || '—'}</span>
        </div>
        ${b.Status === 'Confirmed' ? `<div style="margin-top:12px;"><button class="btn danger" onclick="cancelBooking(${b.Booking_ID})">Cancel ticket</button></div>` : ''}
      </div>
      <div class="ticket-stub">
        <div class="seat-label">Seat</div>
        <div class="seat-value">${b.Seat_No}</div>
      </div>
    </div>
  `).join('');
}

function renderStandby(rows) {
  const el = document.getElementById('standbyList');
  if (!rows.length) { el.innerHTML = `<div class="empty-state"><div class="glyph">⏳</div>You're not on any standby queues right now.</div>`; return; }
  el.innerHTML = rows.map(s => `
    <div class="ticket">
      <div class="ticket-main">
        <div class="ticket-top-row">
          <div class="ticket-route">${s.Source} → ${s.Destination} <span style="color:var(--text-faint); font-size:13px; font-weight:400;">(${s.Flight_No})</span></div>
          <span class="status-tag ${s.Status}">${s.Status}</span>
        </div>
        <div class="ticket-meta">
          <span>${s.Flight_Date} · ${s.Flight_Time}</span>
          <span>Joined ${s.Joining_Date}</span>
        </div>
      </div>
      <div class="ticket-stub">
        <div class="seat-label">Queue #</div>
        <div class="seat-value">${s.Position}</div>
      </div>
    </div>
  `).join('');
}

async function cancelBooking(bookingId) {
  if (!confirm('Cancel this ticket? If someone is on the standby queue, your seat will be reassigned to them automatically.')) return;
  const res = await fetch('/api/cancel', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ booking_id: bookingId }) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  toast(json.data.seat_reallocated_to ? 'Ticket cancelled — seat reassigned to the next standby passenger.' : 'Ticket cancelled.', 'success');
  loadDashboard();
}

// ---------- init ----------
renderAuthArea();
searchFlights();
