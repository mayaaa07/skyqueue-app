-- ===================================================================
-- Airplane Standby Passenger Allocation System — Database Schema
-- SQLite (portable, zero-config — same design translates directly
-- to MySQL/PostgreSQL for the written report)
-- ===================================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS Payment;
DROP TABLE IF EXISTS Standby;
DROP TABLE IF EXISTS Booking;
DROP TABLE IF EXISTS Flight;
DROP TABLE IF EXISTS Passenger;
DROP TABLE IF EXISTS Admin;
DROP TABLE IF EXISTS Audit_Log;

CREATE TABLE Passenger (
  Passenger_ID  INTEGER PRIMARY KEY AUTOINCREMENT,
  Name          TEXT NOT NULL,
  Phone         TEXT UNIQUE NOT NULL,
  Email         TEXT UNIQUE NOT NULL,
  Password      TEXT NOT NULL,
  Created_At    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE Flight (
  Flight_ID        INTEGER PRIMARY KEY AUTOINCREMENT,
  Flight_No        TEXT UNIQUE NOT NULL,
  Source           TEXT NOT NULL,
  Destination      TEXT NOT NULL,
  Flight_Date      TEXT NOT NULL,
  Flight_Time      TEXT NOT NULL,
  Total_Seats      INTEGER NOT NULL,
  Available_Seats  INTEGER NOT NULL,
  Fare             REAL NOT NULL DEFAULT 3000,
  Flight_Status    TEXT NOT NULL DEFAULT 'Scheduled'
);

CREATE TABLE Booking (
  Booking_ID    INTEGER PRIMARY KEY AUTOINCREMENT,
  Passenger_ID  INTEGER NOT NULL,
  Flight_ID     INTEGER NOT NULL,
  Seat_No       TEXT NOT NULL,
  Booking_Date  TEXT NOT NULL DEFAULT (datetime('now')),
  Status        TEXT NOT NULL DEFAULT 'Confirmed', -- Confirmed | Cancelled
  FOREIGN KEY (Passenger_ID) REFERENCES Passenger(Passenger_ID),
  FOREIGN KEY (Flight_ID) REFERENCES Flight(Flight_ID)
);

CREATE TABLE Standby (
  Standby_ID    INTEGER PRIMARY KEY AUTOINCREMENT,
  Passenger_ID  INTEGER NOT NULL,
  Flight_ID     INTEGER NOT NULL,
  Position      INTEGER NOT NULL,
  Joining_Date  TEXT NOT NULL DEFAULT (datetime('now')),
  Status        TEXT NOT NULL DEFAULT 'Waiting', -- Waiting | Allocated | Cancelled
  FOREIGN KEY (Passenger_ID) REFERENCES Passenger(Passenger_ID),
  FOREIGN KEY (Flight_ID) REFERENCES Flight(Flight_ID)
);

CREATE TABLE Payment (
  Payment_ID      INTEGER PRIMARY KEY AUTOINCREMENT,
  Booking_ID      INTEGER NOT NULL,
  Amount          REAL NOT NULL,
  Payment_Date    TEXT NOT NULL DEFAULT (datetime('now')),
  Payment_Status  TEXT NOT NULL DEFAULT 'Paid', -- Paid | Refunded | Pending
  FOREIGN KEY (Booking_ID) REFERENCES Booking(Booking_ID)
);

CREATE TABLE Admin (
  Admin_ID    INTEGER PRIMARY KEY AUTOINCREMENT,
  Admin_Name  TEXT NOT NULL,
  Email       TEXT UNIQUE NOT NULL,
  Password    TEXT NOT NULL
);

-- Audit trail: demonstrates trigger-based logging (industry concept)
CREATE TABLE Audit_Log (
  Log_ID      INTEGER PRIMARY KEY AUTOINCREMENT,
  Table_Name  TEXT NOT NULL,
  Record_ID   INTEGER,
  Action      TEXT NOT NULL,
  Details     TEXT,
  Created_At  TEXT DEFAULT (datetime('now'))
);

-- ---- Triggers ----

-- Keep Available_Seats in sync whenever a booking is confirmed
CREATE TRIGGER trg_booking_insert_seats
AFTER INSERT ON Booking
WHEN NEW.Status = 'Confirmed'
BEGIN
  UPDATE Flight SET Available_Seats = Available_Seats - 1 WHERE Flight_ID = NEW.Flight_ID;
  INSERT INTO Audit_Log (Table_Name, Record_ID, Action, Details)
  VALUES ('Booking', NEW.Booking_ID, 'INSERT', 'Confirmed booking created, seat ' || NEW.Seat_No);
END;

-- Log every cancellation
CREATE TRIGGER trg_booking_cancel_log
AFTER UPDATE OF Status ON Booking
WHEN NEW.Status = 'Cancelled' AND OLD.Status = 'Confirmed'
BEGIN
  INSERT INTO Audit_Log (Table_Name, Record_ID, Action, Details)
  VALUES ('Booking', NEW.Booking_ID, 'CANCEL', 'Booking cancelled, seat ' || NEW.Seat_No || ' released');
END;

-- ---- Seed data ----

INSERT INTO Admin (Admin_Name, Email, Password) VALUES ('Super Admin', 'admin@airline.com', 'admin123');

INSERT INTO Flight (Flight_No, Source, Destination, Flight_Date, Flight_Time, Total_Seats, Available_Seats, Fare, Flight_Status) VALUES
('AI-101', 'Mumbai', 'Delhi', date('now', '+3 day'), '08:00', 6, 2, 4500, 'Scheduled'),
('AI-202', 'Delhi', 'Bengaluru', date('now', '+4 day'), '14:30', 6, 0, 5200, 'Scheduled'),
('AI-303', 'Mumbai', 'Goa', date('now', '+2 day'), '19:15', 6, 4, 2800, 'Scheduled'),
('AI-404', 'Chennai', 'Kolkata', date('now', '+5 day'), '11:00', 6, 6, 4100, 'Scheduled');
