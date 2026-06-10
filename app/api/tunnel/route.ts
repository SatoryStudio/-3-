import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { tunnelService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await tunnelService.read());
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    return NextResponse.json({ ok: true, ...(await tunnelService.update(await request.json())) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    await requireSession();
    return NextResponse.json(await tunnelService.test());
  } catch (error) {
    return apiError(error);
  }
}
