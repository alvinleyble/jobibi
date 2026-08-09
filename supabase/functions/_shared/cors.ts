// The Sidekick calls Edge Functions from a chrome-extension:// origin, which
// has no fixed value we can allowlist ahead of publishing, so this stays
// wildcard-open. No cookies or ambient credentials are involved — every
// call carries its own bearer token, which is what RLS actually keys on.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
