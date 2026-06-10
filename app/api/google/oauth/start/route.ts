import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { googleSheetsService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    const state = crypto.randomUUID();
    (await cookies()).set("google_oauth_state", state, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/api/google/oauth", maxAge: 600,
    });
    return NextResponse.redirect(await googleSheetsService.authorizationUrl(state));
  } catch (error) {
    return apiError(error);
  }
}
