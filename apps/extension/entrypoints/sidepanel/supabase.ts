import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.WXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = import.meta.env.WXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: {
      getItem: async (key: string) => {
        const res = await browser.storage.local.get(key);
        return res[key] as string | null;
      },
      setItem: async (key: string, value: string) => {
        await browser.storage.local.set({ [key]: value });
      },
      removeItem: async (key: string) => {
        await browser.storage.local.remove(key);
      },
    },
  },
});
