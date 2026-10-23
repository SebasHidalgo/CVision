-- =====================================================================
-- CVision: bootstrap de la base de datos. Todo lo que Prisma NO hace.
-- =====================================================================
--
-- Qué hace Prisma y qué no. `npm run db:deploy` (prisma migrate deploy)
-- reproduce las migraciones de prisma/migrations: tablas, columnas,
-- enums, primary keys, uniques, foreign keys con su onDelete, y los
-- índices declarados con @@index/@@unique. También reproduce el SQL que
-- se escribió a mano dentro de esas migraciones (los ENABLE ROW LEVEL
-- SECURITY por tabla, los backfills de M6). Lo que Prisma no modela ni
-- vigila: Row Level Security de una tabla futura, policies, grants y
-- revokes, privilegios por defecto, el bucket de Storage y sus límites.
-- Eso vive acá.
--
-- Este archivo COMPLEMENTA las migraciones, no las reemplaza. El orden es:
--   1. npm run db:deploy            (las migraciones)
--   2. este archivo sobre DIRECT_URL (npm run db:bootstrap lo hace solo)
--   3. npm run db:check-rls y npm run storage:setup -- --check
--
-- Es idempotente: correrlo dos veces deja la base igual. Cada sección es
-- un solo statement, para que `prisma db execute --file` lo ejecute entero.
--
-- Inventario del SQL escrito a mano en las migraciones (lo que `prisma
-- migrate diff --from-empty --to-schema-datamodel` NO generaría), al
-- 2026-10-23:
--   0_init                      ALTER TABLE ... ENABLE ROW LEVEL SECURITY (x4)
--   1_rls_prisma_migrations     ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY
--   20261016065447_user_model   RLS de "User"; backfill INSERT INTO "User" desde las filas existentes
--   20261017060957_plans_...    RLS de "UsageEvent" y "RateLimitCounter"
--   20261020235335_m6_leftovers RLS de "GuardStatDaily"; backfills de lastSessionAt,
--                               InterviewFeedback.createdAt y GuardStatDaily (INSERT ... ON CONFLICT)
--   20261021010000_m6_billing   UPDATE "User" SET compPlan desde la columna plan; RLS de
--                               BillingCustomer, Subscription, BillingEvent
-- No hay índices parciales, CHECK constraints, triggers, funciones ni
-- extensiones propias: todo índice y constraint lo genera el schema. Las
-- extensiones presentes (pgcrypto, uuid-ossp, pg_graphql, pg_stat_statements,
-- supabase_vault) son las de Supabase por defecto; la app no usa ninguna.
-- El rate limiter (lib/database/rateLimit.ts) usa SQL en runtime, no DDL.
--
-- Rol que lo corre: `postgres`, el dueño de las tablas (bypassrls, createdb,
-- no superuser). Las policies de storage.objects pertenecen a
-- supabase_storage_admin: acá no se crean ni se borran (ver sección 4).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Row Level Security en TODAS las tablas de public.
-- ---------------------------------------------------------------------
-- Un bucle y no una lista, para que una tabla futura no quede afuera.
-- La app se conecta como el dueño (postgres, bypassrls), así que la RLS
-- no la afecta; existe para que nada más (anon key, Data API si alguien
-- la enciende) llegue a las filas: sin policies, RLS activa = cero filas.
-- Incluye "_prisma_migrations", que Prisma crea en public.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.name);
    RAISE NOTICE 'RLS activada en public.%', t.name;
  END LOOP;
END
$$;


-- ---------------------------------------------------------------------
-- 2. Quitar a anon y authenticated todo privilegio sobre public.
-- ---------------------------------------------------------------------
-- Supabase concede por defecto todo sobre cada tabla nueva de public a
-- anon, authenticated y service_role (visto en el proyecto de desarrollo:
-- los 12 tablas tenían DELETE,INSERT,...,UPDATE para anon). Con la Data
-- API apagada nadie llega con esos roles, y la RLS sin policies los
-- dejaría sin filas igual; esto es la tercera capa: aunque alguien
-- encienda la Data API o agregue una policy por error, anon y
-- authenticated no tienen el privilegio.
--
-- Por qué es seguro: la app se conecta SIEMPRE como `postgres` (dueño de
-- las tablas, DATABASE_URL y DIRECT_URL), nunca como anon/authenticated.
-- service_role no se toca (el servidor usa el service role key solo
-- contra la Storage API, no contra estas tablas; se deja como está).
-- Verificar antes de correrlo en producción que el rol de la conexión sea
-- el dueño: `npm run db:check-rls -- --report` imprime current_user y los
-- dueños.
--
-- ALTER DEFAULT PRIVILEGES solo cubre las tablas que cree el rol
-- `postgres` de ahora en más (las migraciones corren como postgres). Las
-- que creara supabase_admin seguirían con el grant de fábrica; ninguna
-- tabla de la app se crea así.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated';
  RAISE NOTICE 'privilegios de anon y authenticated sobre public revocados (actuales y por defecto)';
EXCEPTION
  WHEN undefined_object THEN
    -- Una base sin los roles de Supabase (la temporal de prueba, un
    -- Postgres pelado): no hay nada que revocar.
    RAISE NOTICE 'roles anon/authenticated inexistentes: nada que revocar';
END
$$;


-- ---------------------------------------------------------------------
-- 3. Índices y constraints escritos a mano.
-- ---------------------------------------------------------------------
-- Ninguno al 2026-10-23 (ver el inventario de arriba): todo índice y
-- constraint sale del schema de Prisma y lo reproduce db:deploy. Si
-- alguna migración futura agrega uno a mano (un índice parcial, un
-- CHECK), repetirlo acá con IF NOT EXISTS para que la base reconstruida
-- lo tenga aunque la migración se reescriba.
SELECT 'sección 3: sin índices ni constraints a mano' AS nota;


-- ---------------------------------------------------------------------
-- 4. El bucket de Storage: privado, 10 MiB, solo PDF.
-- ---------------------------------------------------------------------
-- Los mismos valores que usa la app: RESUME_BUCKET = 'files-bucket' y
-- BUCKET_SETTINGS en lib/supabase/server.ts, MAX_RESUME_BYTES = 10 MiB =
-- 10485760 bytes en lib/uploadLimits.ts (un test compara estos números con
-- el código). Insertar o actualizar, nunca borrar.
--
-- Policies: el bucket NO lleva ninguna para anon/public. El service role
-- se salta la RLS y es el único que lo toca (lib/supabase/server.ts). Las
-- policies de storage.objects son de supabase_storage_admin y este rol
-- no puede crearlas ni borrarlas: si la sección 5 muestra alguna, borrarla
-- a mano en el dashboard: Storage > Policies > files-bucket.
--
-- En una base sin el schema storage (la temporal de prueba) se salta con
-- un NOTICE en vez de fallar.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'sin schema storage: el bucket no se puede crear acá (no es un proyecto de Supabase)';
    RETURN;
  END IF;
  EXECUTE $sql$
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('files-bucket', 'files-bucket', false, 10485760, ARRAY['application/pdf'])
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types
  $sql$;
  RAISE NOTICE 'bucket files-bucket: privado, 10485760 bytes, application/pdf';
END
$$;


-- ---------------------------------------------------------------------
-- 5. Reporte (solo lectura). Pegar esta sección en el SQL editor de
--    Supabase para verificar; todo debería salir vacío o como se espera.
-- ---------------------------------------------------------------------
-- @@report
-- `npm run db:bootstrap` ejecuta el archivo hasta la línea de arriba y
-- después imprime este mismo reporte él solo (5e no se puede consultar
-- en una base sin schema storage; el script lo salta con un aviso).

-- 5a. Tablas de public con RLS apagada: debe salir VACÍO.
SELECT c.relname AS tabla_sin_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 1;

-- 5b. Policies en public: debe salir VACÍO (la app no usa policies).
SELECT tablename, policyname, roles::text AS roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY 1, 2;

-- 5c. Policies sobre storage.objects que mencionen el bucket o que apliquen
--     a anon/public: debe salir VACÍO.
SELECT policyname, roles::text AS roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual, '') ILIKE '%files-bucket%' OR coalesce(with_check, '') ILIKE '%files-bucket%'
       OR roles::text ILIKE '%anon%' OR roles::text ILIKE '%public%')
ORDER BY 1;

-- 5d. Privilegios de anon y authenticated sobre tablas de public: debe salir VACÍO.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
ORDER BY 2, 1, 3;

-- 5e. El bucket: una fila, public = false, file_size_limit = 10485760,
--     allowed_mime_types = {application/pdf}.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'files-bucket';
