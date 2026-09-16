// admin.js — admin dashboard logic

let admin = JSON.parse(localStorage.getItem('sq_admin') || 'null');

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function renderAuthArea() {
  const el = document.getElementById('adminAuthArea');
  el.innerHTML = admin ? `<button class="btn ghost" onclick="adminLogout()">Log out (${admin.Admin_Name})</button>` : '';
}

function showDashboard(show) {
  document.getElementById('adminLoginGate').classList.toggle('hidden', show);
  document.getElementById('adminDashboard').classList.toggle('hidden', !show);
}

async function adminLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const res = await fetch('/api/admin/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  admin = json.data;
  localStorage.setItem('sq_admin', JSON.stringify(admin));
  renderAuthArea();
  showDashboard(true);
  loadAll();
}

function adminLogout() {
  admin = null;
  localStorage.removeItem('sq_admin');
  renderAuthArea();
  showDashboard(false);
}

async function addFlight() {
  const body = {
    flight_no: document.getElementById('fFlightNo').value.trim(),
    source: document.getElementById('fSource').value.trim(),
    destination: document.getElementById('fDest').value.trim(),
    flight_date: document.getElementById('fDate').value,
    flight_time: document.getElementById('fTime').value,
    total_seats: Number(document.getElementById('fSeats').value),
    fare: Number(document.getElementById('fFare').value)
  };
  if (!body.flight_no || !body.source || !body.destination || !body.flight_date) return toast('Fill in all flight fields.', 'error');
  const res = await fetch('/api/admin/flights', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.success) return toast(json.message, 'error');
  toast('Flight added.', 'success');
  loadAll();
}

async function loadAll() {
  const [summary, flights, bookings, standby, audit] = await Promise.all([
    fetch('/api/admin/summary').then(r => r.json()),
    fetch('/api/admin/flights').then(r => r.json()),
    fetch('/api/admin/bookings').then(r => r.json()),
    fetch('/api/admin/standby').then(r => r.json()),
    fetch('/api/admin/audit').then(r => r.json())
  ]);

  document.getElementById('statFlights').textContent = summary.data.flights;
  document.getElementById('statBookings').textContent = summary.data.confirmed;
  document.getElementById('statStandby').textContent = summary.data.waiting;
  document.getElementById('statRevenue').textContent = '₹' + summary.data.revenue.toLocaleString('en-IN');

  document.getElementById('flightsTbody').innerHTML = flights.data.map(f => `
    <tr>
      <td>${f.Flight_No}</td>
      <td class="name">${f.Source} → ${f.Destination}</td>
      <td>${f.Flight_Date} ${f.Flight_Time}</td>
      <td>${f.Available_Seats}/${f.Total_Seats}</td>
      <td>₹${f.Fare.toLocaleString('en-IN')}</td>
      <td>${f.Flight_Status}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="name">No flights yet.</td></tr>`;

  document.getElementById('bookingsTbody').innerHTML = bookings.data.map(b => `
    <tr>
      <td>#${b.Booking_ID}</td>
      <td class="name">${b.Passenger_Name}</td>
      <td>${b.Flight_No} (${b.Source}→${b.Destination})</td>
      <td>${b.Seat_No}</td>
      <td>${b.Status}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="name">No bookings yet.</td></tr>`;

  document.getElementById('standbyTbody').innerHTML = standby.data.map(s => `
    <tr>
      <td>${s.Position}</td>
      <td class="name">${s.Passenger_Name}</td>
      <td>${s.Flight_No} (${s.Source}→${s.Destination})</td>
      <td>${s.Status}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="name">No standby entries yet.</td></tr>`;

  document.getElementById('auditTbody').innerHTML = audit.data.map(a => `
    <tr>
      <td>${a.Created_At}</td>
      <td>${a.Table_Name}</td>
      <td>${a.Action}</td>
      <td class="name">${a.Details || ''}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="name">No log entries yet.</td></tr>`;
}

// ---------- init ----------
renderAuthArea();
if (admin) { showDashboard(true); loadAll(); } else { showDashboard(false); }
