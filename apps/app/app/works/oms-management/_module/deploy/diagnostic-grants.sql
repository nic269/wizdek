-- Reviewed operator template, NOT an automatic app migration.
-- Run as an authorized DB owner after backup. Supply :database through psql -v.
-- Set the LOGIN password through your secret-management procedure.
CREATE ROLE oms_management_read LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"database" TO oms_management_read;
GRANT USAGE ON SCHEMA public TO oms_management_read;
GRANT SELECT ON workflow_run, workflow_run_log, scheduled_job_config, scheduled_job_run, site_setting, audit_log TO oms_management_read;
-- Optional direct maintenance writes, only after write/recovery verification:
-- GRANT INSERT, UPDATE, DELETE ON site_setting TO oms_management_read;
-- GRANT INSERT ON audit_log TO oms_management_read;
-- Never grant membership in broad roles or SELECT on user/session/account/token tables.
-- If public schema CREATE is inherited from PUBLIC on an older DB, review the impact
-- before revoking that shared grant; the app will reject activation until corrected.
