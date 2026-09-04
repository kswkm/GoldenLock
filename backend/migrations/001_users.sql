-- Apply with a restricted deployment role. Never store plaintext passwords.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hospital', 'ambulance', 'operator')),
  organization_id TEXT NOT NULL,
  wallet_address TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generate bcrypt hashes outside this file and insert users through a restricted secret-managed job.
