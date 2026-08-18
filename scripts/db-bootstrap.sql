-- One-time database bootstrap. Requires a Postgres superuser.
--
--   sudo -u postgres psql -f scripts/db-bootstrap.sql
--
-- Creates the dedicated application role, the application and shadow databases, and installs
-- the two extensions that CREATE EXTENSION will not let a non-superuser install. Everything
-- here is idempotent, so re-running it on an existing install is safe.
--
-- The credentials below must match DATABASE_USERNAME / DATABASE_PASSWORD / DATABASE_NAME
-- in .env. Change the password here and there together, or not at all.

-- A dedicated role rather than reusing a shared one: this database's role should be able to
-- do nothing outside this database. NOSUPERUSER NOCREATEROLE is the point, not boilerplate.
--
-- CREATE is guarded, but the ALTER below is unconditional and deliberate: guarding the whole
-- block on "role does not exist" makes the script a no-op against a role that already exists
-- under a forgotten password, which surfaces much later as Prisma's P1000 rather than as an
-- error here. Re-running this file must always leave the credentials matching .env.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glowquest') THEN
        CREATE ROLE glowquest WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

ALTER ROLE glowquest WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'glowquest_pg_9f3a2b7c4d1e';

-- CREATE DATABASE cannot run inside a transaction block or a DO block, so it is guarded by
-- \gexec instead: the SELECT emits the statement only when the database is absent.
SELECT 'CREATE DATABASE glowquest_backend OWNER glowquest'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'glowquest_backend')\gexec

-- If the database already existed under another owner (e.g. created before this script was
-- run), hand it over rather than leaving the app role unable to create tables.
ALTER DATABASE glowquest_backend OWNER TO glowquest;

-- `prisma migrate dev` diffs the schema against a throwaway "shadow" database, which it
-- normally creates and drops itself -- impossible for a NOCREATEDB role, and P3014 is the
-- error you get. Creating it here once, owned by the app role, keeps the role unprivileged:
-- Prisma only needs to drop and recreate objects *inside* it, which an owner can do.
-- SHADOW_DATABASE_URL in .env points at this database.
SELECT 'CREATE DATABASE glowquest_backend_shadow OWNER glowquest'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'glowquest_backend_shadow')\gexec

ALTER DATABASE glowquest_backend_shadow OWNER TO glowquest;

\connect glowquest_backend

-- Extensions live in the database, not the cluster, so this has to happen after \connect.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

GRANT ALL ON SCHEMA public TO glowquest;
ALTER SCHEMA public OWNER TO glowquest;

-- The shadow database needs the same superuser-only extensions: migrations replayed into it
-- reference pg_trgm and vector, and the app role cannot install them itself.
\connect glowquest_backend_shadow

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

GRANT ALL ON SCHEMA public TO glowquest;
ALTER SCHEMA public OWNER TO glowquest;
