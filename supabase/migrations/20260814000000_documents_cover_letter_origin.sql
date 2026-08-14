-- S8: Draft Cover Letter — track origin on accepted drafts (D13)
-- Accepted drafts stored as documents rows (kind='cover_letter') must record
-- whether they were accepted verbatim or edited, so S9's style-profile
-- distillation can filter correctly (voice corpus = user_written + user_edited,
-- never accepted_verbatim). No new table — just a nullable column on the
-- existing documents row, with the same CHECK values as qa_pairs.origin.
-- Pasted cover letters predating S8 have NULL origin (treated as user_written
-- by S9, matching the S3b manual-paste path which is user-authored text).

alter table public.documents
  add column if not exists origin text
    check (origin in ('user_written', 'user_edited', 'accepted_verbatim'));

comment on column public.documents.origin is
  'S8 D13: cover-letter draft origin (accepted_verbatim must never feed voice profile). NULL for pre-S8 rows and non-cover-letter kinds.';
