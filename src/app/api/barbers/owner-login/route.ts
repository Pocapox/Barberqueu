import { z } from "zod";
import { issueOwnerToken, ownerPinMatches } from "@/lib/barber-auth";
import { managerCookie } from "@/lib/manager-session";
import { ApiError, body, handleError, json, limit } from "../../_shared";

export const runtime = "nodejs";
const schema = z.object({ pin: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    limit("owner-login", 8, 60000);
    const input = schema.parse(await body(request));
    if (!ownerPinMatches(input.pin)) throw new ApiError(401, "PIN incorrecto.");
    const response = json({ role: "owner", shopId: process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001", name: "Administrador" });
    response.headers.set("Set-Cookie", managerCookie(issueOwnerToken()));
    return response;
  } catch (error) { return handleError(error); }
}
