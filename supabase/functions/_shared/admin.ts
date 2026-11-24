// Autorización de admin para las Edge Functions que se llaman desde el panel.
// Solo existe UN admin (profiles.role = 'admin', limitado por constraint a soyprocesoc@gmail.com);
// los leads también son usuarios de Supabase Auth pero con rol 'lead' y no pasan esta verificación.
// Único destinatario de las alertas internas (licitaciones SECOP): nadie más debe recibirlas.
export const ADMIN_EMAIL = "soyprocesoc@gmail.com";

// deno-lint-ignore no-explicit-any
export async function esAdmin(sb: any, authorization: string | null): Promise<boolean> {
  const jwt = (authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await sb.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: perfil } = await sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return perfil?.role === "admin";
}
