-- Postgres extensions Prisma's schema language cannot express.
--
-- Applied by `yarn db:push` (scripts/db-push.js) after `prisma db push`, and re-applied on
-- every push. Guarded, so re-running is a no-op.
--
--   pg_trgm   — fuzzy skill/keyword matching ("React.js" ≈ "ReactJS" ≈ "React"), which
--               exact matching and embeddings both handle badly at that granularity.
--   pgvector  — semantic matching between a job description and a profile. Kept on the same
--               Postgres deliberately: a second datastore for a few thousand embeddings per
--               user is operational cost with no payoff.
--
-- CREATE EXTENSION requires superuser for anything not marked trusted, and pgvector is not.
-- Failing the whole schema sync over that would be wrong: no table in the foundation schema
-- has a vector column, so a developer without superuser can work on everything except the
-- matching feature. So each is attempted and a missing privilege degrades to a WARNING —
-- loud enough to see, quiet enough not to block. Run scripts/db-bootstrap.sql as a superuser
-- to install them properly.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
    WHEN insufficient_privilege OR undefined_file THEN
        RAISE WARNING 'pg_trgm not installed (%). Fuzzy skill matching will not work until a superuser runs scripts/db-bootstrap.sql.', SQLERRM;
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
    WHEN insufficient_privilege OR undefined_file THEN
        RAISE WARNING 'pgvector not installed (%). Semantic match analysis will not work until a superuser runs scripts/db-bootstrap.sql.', SQLERRM;
END
$$;
