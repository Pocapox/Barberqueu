export const managerSessionCookie = "barberqueue_session";
const maxAge = 12 * 60 * 60;

export function readManagerToken(request: Request): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === managerSessionCookie) return parts.join("=");
  }
  return "";
}

export function managerCookie(token: string): string {
  return `${managerSessionCookie}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearManagerCookie(): string {
  return `${managerSessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
