// set-auth-cookie.ts
// @ts-ignore
import { serve } from "std/http/server.ts"; // @ts-ignore
import { getOrigin, isAllowedOrigin  } from "shared/validateOrigin.ts";// @ts-ignore
import { rejectResponse } from "shared/http.ts";// @ts-ignore
import { getSupabaseClientWithToken } from "shared/supabaseClient.ts";// @ts-ignore
import { log, warn, errorlog } from "shared/logger.ts"; // @ts-ignore

const CSRF_COOKIE_NAME = "csrf-token";
const AUTH_COOKIE_NAME = "sb-access-token";
const REQUIRED_MODULE = "application";

serve(async (req) => {
  const method = req.method;
  const origin = getOrigin(req);

  log(`📥 ${method} /set-auth-cookie from ${origin}`);

  // 🔁 OPTIONS pour CORS
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // 🔐 Vérifie l'origine
  if (!isAllowedOrigin(origin)) {
    warn("⛔ Origine non autorisée :", origin);
    return rejectResponse("Origine non autorisée");
  }

  // 📦 Récupère le token d'authentification
  let access_token: string | undefined;
  try {
    const body = await req.json();
    access_token = body?.access_token;
  } catch {
    errorlog("❌ Erreur de parsing JSON.");
    return rejectResponse("Requête invalide");
  }

  if (!access_token) {
    warn("⚠️ Token manquant.");
    return rejectResponse("Access token manquant");
  }

  const csrfToken = crypto.randomUUID();
  log("🔐 Tokens générés :", {
    csrf: csrfToken.slice(0, 5) + "...",
    access: access_token.slice(0, 8) + "...",
  });


  
  // ✅ Vérification de l'utilisateur via Supabase
  const supabase = getSupabaseClientWithToken(access_token);
  const { data: { user }, error: authError } = await supabase.auth.getUser(access_token);

  if (authError || !user) {
    warn("❌ Auth échouée :", authError?.message);
    return rejectResponse("Utilisateur non authentifié");
  }

  const userId = user.id;

  // 🔒 Vérifie les droits d'accès "application"
  const { data: userData, error: userError } = await supabase
    .from("user")
    .select("module")
    .eq("id", userId)
    .maybeSingle();

  if (userError || !userData) {
    warn("❌ Erreur récupération module pour user:", userError?.message);
    return rejectResponse("Erreur serveur ou utilisateur non trouvé");
  }

  const modules = (userData.module || "").split("-");
  if (!modules.includes(REQUIRED_MODULE)) {
    warn(`⛔ Accès interdit à l'application '${REQUIRED_MODULE}' pour user ${userId}`);
    return rejectResponse("⛔ Accès interdit à l'application");
  }


  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  });

  const baseCookieAttrs = "Path=/; Secure; SameSite=None";

  // Cookie CSRF : accessible côté client
  headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${csrfToken}; ${baseCookieAttrs}; Max-Age=14400`
  );

  // Cookie d'authentification : HttpOnly
  headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=${access_token}; ${baseCookieAttrs}; HttpOnly; Max-Age=3600`
  );

  return new Response(JSON.stringify({ csrfToken }), {
    status: 200,
    headers,
  });
});
