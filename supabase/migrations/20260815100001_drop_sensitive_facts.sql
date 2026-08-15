-- Drop sensitive_facts table and all dependent objects (indexes, RLS policies, grants)
-- S12 design retired: salary/notice now handled as dynamic refusal requiring direct input,
-- no stored fact is auto-suggested.

drop table if exists public.sensitive_facts cascade;
