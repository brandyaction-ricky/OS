-- Server-side work (indexing large documents, nightly sync, batch jobs) runs as service_role through
-- PostgREST. With no setting of its own it inherited the authenticator's 8s limit, so saving a few
-- hundred search chunks for a large document was cut off. Staff requests (authenticated 8s, anon 3s)
-- are unchanged. Roll back with: alter role service_role reset statement_timeout;
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
