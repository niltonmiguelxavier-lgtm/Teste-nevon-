import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { currentUser } from "@/lib/auth";
import { CART_COOKIE, readCartFromCookie } from "@/lib/cart";

export const metadata: Metadata = {
  title: {
    default: "Express Delivery — entregas ao domicílio em Maputo",
    template: "%s · Express Delivery",
  },
  description:
    "Entrega de compras, farmácia, comida e documentos em Maputo e Matola. Peça online, pague com Nevon Pay e acompanhe a entrega em tempo real.",
  applicationName: "Express Delivery",
  keywords: ["entregas", "domicílio", "Maputo", "Matola", "Nevon Pay", "delivery"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0c0b",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const cookieStore = await cookies();
  const cart = readCartFromCookie(cookieStore.get(CART_COOKIE)?.value);
  const cartCount = cart.lines.reduce((total, line) => total + line.quantity, 0);

  return (
    <html lang="pt-MZ">
      <body>
        <SiteHeader user={user} cartCount={cartCount} />
        <main id="conteudo">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
