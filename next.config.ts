import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  experimental: {
    // Nenhum formulário do app passa de poucos KB; o padrão do Next é 1 MB.
    serverActions: { bodySizeLimit: "64kb" },
    // Voltar para uma página aberta há pouco é instantâneo. Salvar qualquer coisa limpa
    // esse cache (revalidatePath no layout), então os números nunca ficam velhos.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
