-- Brew Log cloud backup schema (mirrors Phase 1 IndexedDB stores, app schema v2).
-- Every table: stable id, timestamps, and a tombstone flag so deletes propagate.

CREATE TABLE IF NOT EXISTS coffee_library (
  id TEXT PRIMARY KEY,
  createdAt TEXT, updatedAt TEXT, deleted INTEGER DEFAULT 0,
  name TEXT, origin TEXT, roastNotes TEXT,
  price REAL, size REAL, notes TEXT,
  photoKey TEXT
);

CREATE TABLE IF NOT EXISTS matcha_library (
  id TEXT PRIMARY KEY,
  createdAt TEXT, updatedAt TEXT, deleted INTEGER DEFAULT 0,
  brand TEXT, grade TEXT, origin TEXT,
  price REAL, size REAL, notes TEXT,
  photoKey TEXT
);

CREATE TABLE IF NOT EXISTS coffee_logs (
  id TEXT PRIMARY KEY,
  createdAt TEXT, updatedAt TEXT, deleted INTEGER DEFAULT 0,
  date TEXT, beanId TEXT, beanName TEXT, beanNotes TEXT,
  method TEXT, grinderId TEXT, grinderName TEXT, grindSetting TEXT,
  dose REAL, water REAL, temp REAL, tempUnit TEXT,
  timeSec INTEGER, rating INTEGER, notes TEXT
);

CREATE TABLE IF NOT EXISTS matcha_logs (
  id TEXT PRIMARY KEY,
  createdAt TEXT, updatedAt TEXT, deleted INTEGER DEFAULT 0,
  date TEXT, matchaId TEXT, matchaName TEXT, beanNotes TEXT,
  prepStyle TEXT, amount REAL, water REAL, temp REAL, tempUnit TEXT,
  milkType TEXT, milkAmount REAL, sweetener TEXT,
  whiskType TEXT, sifted INTEGER, rating INTEGER, notes TEXT
);

CREATE TABLE IF NOT EXISTS grinders (
  id TEXT PRIMARY KEY,
  createdAt TEXT, updatedAt TEXT, deleted INTEGER DEFAULT 0,
  name TEXT
);

CREATE INDEX IF NOT EXISTS idx_coffee_logs_updated ON coffee_logs(updatedAt);
CREATE INDEX IF NOT EXISTS idx_matcha_logs_updated ON matcha_logs(updatedAt);
CREATE INDEX IF NOT EXISTS idx_coffee_library_updated ON coffee_library(updatedAt);
CREATE INDEX IF NOT EXISTS idx_matcha_library_updated ON matcha_library(updatedAt);
CREATE INDEX IF NOT EXISTS idx_grinders_updated ON grinders(updatedAt);
