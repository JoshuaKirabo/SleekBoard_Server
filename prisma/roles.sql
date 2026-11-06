-- SleekBoard's two database users, so the running server never connects as an admin.
--
--   sleekboard_owner  owns the tables and runs migrations (prisma migrate, from your Mac). The server never uses it.
--   sleekboard_app    what the server connects as. It can read and write rows, and nothing else: no creating,
--                     changing or dropping tables, no other databases, no admin powers.
--
-- Run it as an admin, against SleekBoard's database, after the first migration and again any time:
--
--   psql -d sleekboard -f prisma/roles.sql                       on this Mac (Postgres.app skips passwords locally)
--   psql -d sleekboard -v owner_password=... -v app_password=... -f prisma/roles.sql      on Cloud SQL
--
-- On Cloud SQL, make both users with this file, not with gcloud or the console: those add every user to
-- cloudsqlsuperuser, which is the admin power this is meant to keep away from the server.

\set ON_ERROR_STOP on

-- The two users, made once. Neither can make users or databases of its own, or skip permissions.
SELECT 'CREATE ROLE sleekboard_owner LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sleekboard_owner') \gexec
SELECT 'CREATE ROLE sleekboard_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sleekboard_app') \gexec
ALTER ROLE sleekboard_owner NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE sleekboard_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;

-- prisma migrate dev builds a throwaway copy of the database to check migrations against, so the owner may make
-- databases. Only the owner, which only runs from your Mac.
ALTER ROLE sleekboard_owner CREATEDB;

\if :{?owner_password}
  ALTER ROLE sleekboard_owner PASSWORD :'owner_password';
\endif
\if :{?app_password}
  ALTER ROLE sleekboard_app PASSWORD :'app_password';
\endif

-- An admin can only hand things to a user it belongs to. Cloud SQL's admin isn't a real superuser, so it joins the
-- owner first. Locally the superuser doesn't need to.
SELECT format('GRANT sleekboard_owner TO %I', current_user)
  WHERE NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) \gexec

-- The owner owns the database, its schema and everything in it.
SELECT format('ALTER DATABASE %I OWNER TO sleekboard_owner', current_database()) \gexec
ALTER SCHEMA public OWNER TO sleekboard_owner;

DO $$
  DECLARE
    item record;
  BEGIN
    FOR item IN
      SELECT c.relname AS name, c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v', 'm')
        -- A table's own id counter moves with its table and can't be handed over by itself.
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a' AND c.relkind = 'S')
    LOOP
      EXECUTE format('ALTER %s public.%I OWNER TO sleekboard_owner',
        CASE item.kind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        item.name);
    END LOOP;

    FOR item IN
      SELECT t.typname AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    LOOP
      EXECUTE format('ALTER TYPE public.%I OWNER TO sleekboard_owner', item.name);
    END LOOP;
  END
$$;

-- Nobody gets in by default. Only the app user may connect, and only the owner may create things.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sleekboard_app', current_database()) \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sleekboard_app;

-- Rows only: read, add, change, delete. Tables a later migration adds get the same, since the owner makes them.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sleekboard_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sleekboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sleekboard_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sleekboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sleekboard_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sleekboard_app;

-- Prisma's record of which migrations ran is the owner's business, not the server's.
REVOKE ALL ON TABLE public._prisma_migrations FROM sleekboard_app;
