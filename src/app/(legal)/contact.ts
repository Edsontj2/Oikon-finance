/** E-mail de contato do responsável pelo app (variável CONTACT_EMAIL na Vercel). */
export function contactEmail(): string | null {
  const email = process.env.CONTACT_EMAIL?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
