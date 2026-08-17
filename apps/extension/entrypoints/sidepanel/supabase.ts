import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const supabaseUrl = import.meta.env.WXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const supabaseKey = import.meta.env.WXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key';

    client = createClient(supabaseUrl, supabaseKey, {
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
  }
  return client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    if (prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    const instance = getSupabase();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(target, prop, value, receiver) {
    return Reflect.set(target, prop, value, receiver);
  },
  defineProperty(target, prop, descriptor) {
    return Reflect.defineProperty(target, prop, descriptor);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
    const instance = getSupabase();
    return Reflect.getOwnPropertyDescriptor(instance, prop);
  },
  has(target, prop) {
    if (prop in target) {
      return true;
    }
    const instance = getSupabase();
    return Reflect.has(instance, prop);
  },
  getPrototypeOf(_target) {
    const instance = getSupabase();
    return Reflect.getPrototypeOf(instance);
  },
  ownKeys(target) {
    const instance = getSupabase();
    const instanceKeys = Reflect.ownKeys(instance);
    const targetKeys = Reflect.ownKeys(target);
    return Array.from(new Set([...targetKeys, ...instanceKeys]));
  },
});

