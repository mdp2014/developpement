import "https://deno.land/std@0.224.0/dotenv/load.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(
// @ts-ignore
  Deno.env.get("PUBLIC_SUPABASE_URL")!,
// @ts-ignore
  Deno.env.get("SERVICE_ROLE_KEY")!
);

// Client lié à un token utilisateur (utilisé dans les Edge Functions sécurisées)
export function getSupabaseClientWithToken(token: string) {
  return createClient(
// @ts-ignore
    Deno.env.get("PUBLIC_SUPABASE_URL")!,
// @ts-ignore
    Deno.env.get("SERVICE_ROLE_KEY")!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  );
}
