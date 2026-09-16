// db.js — sets up the SQLite database from schema.sql on first run.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'db', 'airline.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'db', 'schema.sql');

const isFreshDB = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

if (isFreshDB) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  console.log('Database initialized with schema + seed data at', DB_PATH);
}

module.exports = db;
