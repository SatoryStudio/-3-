import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { storage } from "@/lib/storage";
import { setSetting } from "@/lib/services/settings-service";

export async function PUT(request: Request) {
  try {
    await requireSession();
    const values = await request.json() as Record<string, number>;
    await storage.transaction((unit) => {
      Object.entries(values).forEach(([key, value]) => {
        setSetting(unit.data, key, Math.round(Number(value)), "number");
      });
      unit.touch("settings");
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
