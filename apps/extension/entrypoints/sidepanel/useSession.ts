import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // The magic link is completed on a separate extension page (callback.html),
    // which writes the session into chrome.storage.local under its own client
    // instance. This side panel's client won't see that via onAuthStateChange,
    // so re-check whenever the shared storage changes.
    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((key) => key.startsWith('sb-'))) {
        supabase.auth.getSession().then(({ data }) => setSession(data.session));
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      subscription.subscription.unsubscribe();
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  return { session, loading };
}
