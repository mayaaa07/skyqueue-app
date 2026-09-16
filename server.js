// server.js — Express API for the Airplane Standby Passenger Allocation System
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const ok = (res, data) => res.json({ success: true, data });
const fail = (res, code, message) => res.status(code).json({ success: false, message });

function seatLabel(n) {
  const row = Math.ceil(n / 3);
  const col = ['A', 'B', 'C'][(n - 1) % 3];
  return `${row}${col}`;
}

// ===================================================================
// PASSENGER AUTH
// ===================================================================
app.post('/api/register', (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !phone || !email || !password) return fail(res, 400, 'All fields are required.');
  try {
    const stmt = db.prepare('INSERT INTO Passenger (Name, Phone, Email, Password) VALUES (?,?,?,?)');
    const info = stmt.run(name, phone, email, password);
    ok(res, { Passenger_ID: info.lastInsertRowid, name, email });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(res, 409, 'Phone or email already registered.');
    fail(res, 500, 'Registration failed.');
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const p = db.prepare('SELECT Passenger_ID, Name, Email, Phone FROM Passenger WHERE Email = ? AND Password = ?').get(email, password);
  if (!p) return fail(res, 401, 'Invalid email or password.');
  ok(res, p);
});

// ===================================================================
// FLIGHT SEARCH
// ===================================================================
app.get('/api/flights', (req, res) => {
  const { source, destination, date } = req.query;
  let query = "SELECT * FROM Flight WHERE Flight_Status != 'Cancelled'";
  const params = [];
  if (source) { query += ' AND Source LIKE ?'; params.push(`%${source}%`); }
  if (destination) { query += ' AND Destination LIKE ?'; params.push(`%${destination}%`); }
  if (date) { query += ' AND Flight_Date = ?'; params.push(date); }
  query += ' ORDER BY Flight_Date, Flight_Time';
  const flights = db.prepare(query).all(...params);
  ok(res, flights);
});

// ===================================================================
// BOOK TICKET  (fails gracefully to standby if flight is full)
// ===================================================================
app.post('/api/book', (req, res) => {
  const { passenger_id, flight_id } = req.body;
  const flight = db.prepare('SELECT * FROM Flight WHERE Flight_ID = ?').get(flight_id);
  if (!flight) return fail(res, 404, 'Flight not found.');

  const already = db.prepare(
    "SELECT * FROM Booking WHERE Passenger_ID = ? AND Flight_ID = ? AND Status = 'Confirmed'"
  ).get(passenger_id, flight_id);
  if (already) return fail(res, 409, 'You already have a confirmed booking on this flight.');

  if (flight.Available_Seats <= 0) {
    return fail(res, 409, 'FLIGHT_FULL'); // frontend prompts standby join
  }

  const txn = db.transaction(() => {
    const seatsTaken = db.prepare(
      "SELECT COUNT(*) AS c FROM Booking WHERE Flight_ID = ? AND Status = 'Confirmed'"
    ).get(flight_id).c;
    const seatNo = seatLabel(seatsTaken + 1);

    const bookingInfo = db.prepare(
      'INSERT INTO Booking (Passenger_ID, Flight_ID, Seat_No, Status) VALUES (?,?,?,\'Confirmed\')'
    ).run(passenger_id, flight_id, seatNo);

    db.prepare(
      "INSERT INTO Payment (Booking_ID, Amount, Payment_Status) VALUES (?, ?, 'Paid')"
    ).run(bookingInfo.lastInsertRowid, flight.Fare);

    return { Booking_ID: bookingInfo.lastInsertRowid, Seat_No: seatNo };
  });

  try {
    const result = txn();
    ok(res, result);
  } catch (e) {
    fail(res, 500, 'Booking failed: ' + e.message);
  }
});

// ===================================================================
// JOIN STANDBY QUEUE
// ===================================================================
app.post('/api/standby', (req, res) => {
  const { passenger_id, flight_id } = req.body;
  const flight = db.prepare('SELECT * FROM Flight WHERE Flight_ID = ?').get(flight_id);
  if (!flight) return fail(res, 404, 'Flight not found.');

  const existing = db.prepare(
    "SELECT * FROM Standby WHERE Passenger_ID = ? AND Flight_ID = ? AND Status = 'Waiting'"
  ).get(passenger_id, flight_id);
  if (existing) return fail(res, 409, 'Already on the standby list for this flight.');

  const lastPos = db.prepare(
    "SELECT MAX(Position) AS pos FROM Standby WHERE Flight_ID = ? AND Status = 'Waiting'"
  ).get(flight_id).pos || 0;

  const info = db.prepare(
    "INSERT INTO Standby (Passenger_ID, Flight_ID, Position, Status) VALUES (?,?,?,'Waiting')"
  ).run(passenger_id, flight_id, lastPos + 1);

  ok(res, { Standby_ID: info.lastInsertRowid, Position: lastPos + 1 });
});

// ===================================================================
// CANCEL TICKET  →  AUTOMATIC STANDBY ALLOCATION (core feature)
// ===================================================================
app.post('/api/cancel', (req, res) => {
  const { booking_id } = req.body;
  const booking = db.prepare('SELECT * FROM Booking WHERE Booking_ID = ?').get(booking_id);
  if (!booking) return fail(res, 404, 'Booking not found.');
  if (booking.Status !== 'Confirmed') return fail(res, 409, 'Booking is already cancelled.');

  const txn = db.transaction(() => {
    // 1. Cancel the booking (trigger logs audit + does NOT change seat count itself)
    db.prepare("UPDATE Booking SET Status = 'Cancelled' WHERE Booking_ID = ?").run(booking_id);

    // 2. Mark payment refunded
    db.prepare("UPDATE Payment SET Payment_Status = 'Refunded' WHERE Booking_ID = ?").run(booking_id);

    // 3. Increase available seats
    db.prepare('UPDATE Flight SET Available_Seats = Available_Seats + 1 WHERE Flight_ID = ?').run(booking.Flight_ID);

    // 4. Find first eligible standby passenger (FCFS by Position)
    const nextInLine = db.prepare(
      "SELECT * FROM Standby WHERE Flight_ID = ? AND Status = 'Waiting' ORDER BY Position ASC LIMIT 1"
    ).get(booking.Flight_ID);

    let allocated = null;
    if (nextInLine) {
      // 5. Allocate the freed seat to them
      // Note: inserting this Confirmed booking fires trg_booking_insert_seats,
      // which already decrements Available_Seats by 1 — since step 3 above just
      // incremented it by 1 for the cancellation, the net effect across both is
      // correctly zero (seat handed straight from one passenger to the next).
      const newBooking = db.prepare(
        "INSERT INTO Booking (Passenger_ID, Flight_ID, Seat_No, Status) VALUES (?,?,?,'Confirmed')"
      ).run(nextInLine.Passenger_ID, booking.Flight_ID, booking.Seat_No);

      const flight = db.prepare('SELECT Fare FROM Flight WHERE Flight_ID = ?').get(booking.Flight_ID);
      db.prepare(
        "INSERT INTO Payment (Booking_ID, Amount, Payment_Status) VALUES (?, ?, 'Paid')"
      ).run(newBooking.lastInsertRowid, flight.Fare);

      db.prepare("UPDATE Standby SET Status = 'Allocated' WHERE Standby_ID = ?").run(nextInLine.Standby_ID);

      // 6. Recalculate remaining queue positions
      const remaining = db.prepare(
        "SELECT Standby_ID FROM Standby WHERE Flight_ID = ? AND Status = 'Waiting' ORDER BY Position ASC"
      ).all(booking.Flight_ID);
      remaining.forEach((row, idx) => {
        db.prepare('UPDATE Standby SET Position = ? WHERE Standby_ID = ?').run(idx + 1, row.Standby_ID);
      });

      allocated = { Passenger_ID: nextInLine.Passenger_ID, Seat_No: booking.Seat_No, New_Booking_ID: newBooking.lastInsertRowid };
    }

    return allocated;
  });

  try {
    const allocated = txn();
    ok(res, { cancelled_booking: booking_id, seat_reallocated_to: allocated });
  } catch (e) {
    fail(res, 500, 'Cancellation failed: ' + e.message);
  }
});

// ===================================================================
// PASSENGER STATUS VIEWS
// ===================================================================
app.get('/api/bookings/:passenger_id', (req, res) => {
  const rows = db.prepare(`
    SELECT B.Booking_ID, B.Seat_No, B.Booking_Date, B.Status,
           F.Flight_No, F.Source, F.Destination, F.Flight_Date, F.Flight_Time, F.Fare,
           P.Payment_Status, P.Amount
    FROM Booking B
    JOIN Flight F ON B.Flight_ID = F.Flight_ID
    LEFT JOIN Payment P ON P.Booking_ID = B.Booking_ID
    WHERE B.Passenger_ID = ?
    ORDER BY B.Booking_Date DESC
  `).all(req.params.passenger_id);
  ok(res, rows);
});

app.get('/api/standby/:passenger_id', (req, res) => {
  const rows = db.prepare(`
    SELECT S.Standby_ID, S.Position, S.Status, S.Joining_Date,
           F.Flight_No, F.Source, F.Destination, F.Flight_Date, F.Flight_Time
    FROM Standby S
    JOIN Flight F ON S.Flight_ID = F.Flight_ID
    WHERE S.Passenger_ID = ?
    ORDER BY S.Joining_Date DESC
  `).all(req.params.passenger_id);
  ok(res, rows);
});

// ===================================================================
// ADMIN
// ===================================================================
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT Admin_ID, Admin_Name, Email FROM Admin WHERE Email = ? AND Password = ?').get(email, password);
  if (!admin) return fail(res, 401, 'Invalid admin credentials.');
  ok(res, admin);
});

app.get('/api/admin/flights', (req, res) => {
  ok(res, db.prepare('SELECT * FROM Flight ORDER BY Flight_Date, Flight_Time').all());
});

app.post('/api/admin/flights', (req, res) => {
  const { flight_no, source, destination, flight_date, flight_time, total_seats, fare } = req.body;
  try {
    const info = db.prepare(
      `INSERT INTO Flight (Flight_No, Source, Destination, Flight_Date, Flight_Time, Total_Seats, Available_Seats, Fare)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(flight_no, source, destination, flight_date, flight_time, total_seats, total_seats, fare || 3000);
    ok(res, { Flight_ID: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(res, 409, 'Flight number already exists.');
    fail(res, 500, 'Could not add flight.');
  }
});

app.put('/api/admin/flights/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE Flight SET Flight_Status = ? WHERE Flight_ID = ?').run(status, req.params.id);
  ok(res, { updated: true });
});

app.get('/api/admin/bookings', (req, res) => {
  ok(res, db.prepare(`
    SELECT B.Booking_ID, B.Seat_No, B.Status, B.Booking_Date,
           Pa.Name AS Passenger_Name, F.Flight_No, F.Source, F.Destination, F.Flight_Date
    FROM Booking B
    JOIN Passenger Pa ON B.Passenger_ID = Pa.Passenger_ID
    JOIN Flight F ON B.Flight_ID = F.Flight_ID
    ORDER BY B.Booking_Date DESC
  `).all());
});

app.get('/api/admin/standby', (req, res) => {
  ok(res, db.prepare(`
    SELECT S.Standby_ID, S.Position, S.Status, S.Joining_Date,
           Pa.Name AS Passenger_Name, F.Flight_No, F.Source, F.Destination, F.Flight_Date
    FROM Standby S
    JOIN Passenger Pa ON S.Passenger_ID = Pa.Passenger_ID
    JOIN Flight F ON S.Flight_ID = F.Flight_ID
    ORDER BY F.Flight_ID, S.Position
  `).all());
});

app.get('/api/admin/summary', (req, res) => {
  const flights = db.prepare('SELECT COUNT(*) c FROM Flight').get().c;
  const confirmed = db.prepare("SELECT COUNT(*) c FROM Booking WHERE Status='Confirmed'").get().c;
  const waiting = db.prepare("SELECT COUNT(*) c FROM Standby WHERE Status='Waiting'").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(Amount),0) r FROM Payment WHERE Payment_Status='Paid'").get().r;
  ok(res, { flights, confirmed, waiting, revenue });
});

app.get('/api/admin/audit', (req, res) => {
  ok(res, db.prepare('SELECT * FROM Audit_Log ORDER BY Log_ID DESC LIMIT 50').all());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Airline app running at http://localhost:${PORT}`));
