// shared/validateRequest.ts
import { isAllowedOrigin } from "./validateOrigin.ts";
import { rejectResponse } from "./http.ts";
import { getCsrfFromCookie, getCookieValue } from "./cookie.ts";
import { getSupabaseClientWithToken } from "./supabaseClient.ts";
import { log, warn } from "./logger.ts"; 

const CSRF_HEADER = "x-csrf-token";

export async function validateRequest(
  req: Request,
  requiredModule?: string,
  allowedMethods: string[] = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
): Promise<{ userId: string; token: string } | Response> {
  const origin = new URL(req.url).origin;
  const method = req.method.toUpperCase();

  // CORS Preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": allowedMethods.join(", "),
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-csrf-token",
      },
    });
  }

  // ❗ Rejet si méthode non autorisée
  if (!allowedMethods.includes(method)) {
    warn(`🚫 Méthode non autorisée : ${method}`);
    return rejectResponse("Méthode non autorisée", 405);
  }

  // Vérification de l'origine
  if (!isAllowedOrigin(origin)) {
    warn("⛔ [PROXY] Origine interdite:", origin);
    return rejectResponse("Origine non autorisée");
  }

  // Authentification par cookie
  const cookieHeader = req.headers.get("cookie") || "";
  const token = getCookieValue(cookieHeader, "sb-access-token");
  log("🔍 [PROXY] Token présent:", token ? "✅" : "❌");

  if (!token) {
    warn("🚫 [PROXY] Token manquant");
    return rejectResponse("Utilisateur non authentifié");
  }

  const supabase = getSupabaseClientWithToken(token);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    warn("❌ Auth échouée :", authError?.message);
    return rejectResponse("Utilisateur non authentifié");
  }

  const userId = user.id;

  // Vérifie les droits sur le module si demandé
  if (requiredModule) {
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
    if (!modules.includes(requiredModule)) {
      warn(`⛔ Accès interdit au module '${requiredModule}' pour user ${userId}`);
      return rejectResponse("Accès interdit au module");
    }
  }

  // CSRF
  if (["POST", "PATCH", "DELETE"].includes(method)) {
    const csrfTokenHeader = req.headers.get(CSRF_HEADER);
    const csrfTokenCookie = getCsrfFromCookie(cookieHeader);
    log("🔐 [PROXY] CSRF Header:", csrfTokenHeader);
    log("🔐 [PROXY] CSRF Cookie:", csrfTokenCookie);

    if (csrfTokenHeader !== csrfTokenCookie) {
      warn("🚨 [PROXY] CSRF mismatch ou token manquant");
      return rejectResponse("CSRF token invalide ou manquant");
    }
  }

  return { userId, token };
}
