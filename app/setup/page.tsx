import { redirect } from "next/navigation";
import { storage } from "@/lib/storage";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const database = await storage.read();
  if (database.users.length) redirect("/login");
  return <AuthForm mode="setup" />;
}
