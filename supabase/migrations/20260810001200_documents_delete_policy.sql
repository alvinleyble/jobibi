-- Allow the ingest Edge Function to clean up its own compensating delete:
-- if embedding/chunk insertion fails partway through, it removes the
-- just-created documents row rather than leaving an orphaned zero-chunk
-- record behind. RLS still confines this to the caller's own rows.

create policy "Users can delete own documents"
  on public.documents
  for delete
  using (auth.uid() = user_id);

grant delete on public.documents to authenticated;
