CREATE TABLE IF NOT EXISTS stock (
  version TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity >= 0 AND quantity <= 9999),
  PRIMARY KEY (version, size)
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON reservations(expires_at, status);

CREATE TABLE IF NOT EXISTS orders (
  session_id TEXT PRIMARY KEY,
  reservation_id TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO stock(version,size,quantity) VALUES
('30','S',15),('30','M',20),('30','L',15),('30','XL',5),('30','XXL',3),
('50','S',15),('50','M',20),('50','L',15),('50','XL',5),('50','XXL',3);
