import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "../auth-forms";

export default async function LoginPage() {
  if (await getCurrentUserId()) redirect("/");
  return (
    <AuthShell title="Entrar">
      <LoginForm />
    </AuthShell>
  );
}
