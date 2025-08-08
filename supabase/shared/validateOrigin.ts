// validateOrigin.ts
export function getOrigin(req: Request): string {
  return (
    req.headers.get("origin") ||
    req.headers.get("x-forwarded-origin") ||
    ""
  );
}

export function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins = [
    "https://mdp2014.github.io",
    "http://sqnjzcqcmtjhbptjlixe.supabase.co"
    // ajoute d'autres domaines ici si besoin
  ];
  return allowedOrigins.includes(origin);
}
