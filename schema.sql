CREATE TABLE IF NOT EXISTS inventory (
  size TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL CHECK(quantity >= 0 AND quantity <= 9999)
);

CREATE TABLE IF NOT EXISTS c1_reservations (
  id TEXT PRIMARY KEY,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK(status IN ('reserved','paid','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_c1_reservations_expiry
  ON c1_reservations(expires_at, status);

CREATE TABLE IF NOT EXISTS c1_orders (
  session_id TEXT PRIMARY KEY,
  reservation_id TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO inventory(size,quantity) VALUES
('S',15),('M',20),('L',15),('XL',5),('XXL',3);
