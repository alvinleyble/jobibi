-- S3b: pasted cover letters have no Storage object, so storage_path must be
-- nullable. A NULL storage_path marks a pasted document (see ingest Edge
-- Function's `{ text, kind }` request shape).

alter table public.documents alter column storage_path drop not null;
