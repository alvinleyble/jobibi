import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBetaTester, setIsBetaTester] = useState(false);

  useEffect(() => {
    const fetchBetaStatus = async (userId: string | undefined) => {
      if (!userId) {
        setIsBetaTester(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('is_beta_tester')
          .eq('id', userId)
          .single();
        if (!error && data) {
          setIsBetaTester(Boolean(data.is_beta_tester));
        } else {
          setIsBetaTester(false);
        }
      } catch {
        setIsBetaTester(false);
      }
    };

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await fetchBetaStatus(data.session?.user?.id);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      await fetchBetaStatus(next?.user?.id);
    });

    // The magic link is completed on a separate extension page (callback.html),
    // which writes the session into chrome.storage.local under its own client
    // instance. This side panel's client won't see that via onAuthStateChange,
    // so re-check whenever the shared storage changes.
    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((key) => key.startsWith('sb-'))) {
        supabase.auth.getSession().then(async ({ data }) => {
          setSession(data.session);
          await fetchBetaStatus(data.session?.user?.id);
        });
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      subscription.subscription.unsubscribe();
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  return { session, loading, isBetaTester };
}
