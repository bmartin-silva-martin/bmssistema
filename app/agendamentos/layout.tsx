import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://bmssistema-sss2.vercel.app"),
  title: "Agendamento | Barbearia Teste",
  description: "Realize seu agendamento agora mesmo, é rápido e fácil.",
  openGraph: {
    description: "Realize seu agendamento agora mesmo, é rápido e fácil.",
    title: "Agendamento",
    type: "website",
    url: "/agendamentos",
  },
  twitter: {
    card: "summary_large_image",
    description: "Realize seu agendamento agora mesmo, é rápido e fácil.",
    title: "Agendamento",
  },
};

export default function AgendamentosLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
