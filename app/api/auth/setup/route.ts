import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { storage } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!String(email).includes("@") || String(password).length < 8) throw new Error("Укажите email и пароль от 8 символов");
    const user = await storage.transaction(async (unit) => {
      if (unit.data.users.length) throw new Error("Регистрация уже закрыта");
      const created = {
        id: crypto.randomUUID(),
        email: String(email).trim().toLowerCase(),
        password_hash: await bcrypt.hash(String(password), 12),
        role: "admin" as const,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
      };
      unit.data.users.push(created);
      unit.touch("users");
      return created;
    });
    await createSession(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
