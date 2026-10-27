import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { AuthShell } from "../auth-shell";
import { SignupForm } from "../auth-forms";

export default async function CadastroPage() {
  if (await getCurrentUserId()) redirect("/");
  return (
    <AuthShell title="Criar conta">
      <SignupForm />
    </AuthShell>
  );
}
