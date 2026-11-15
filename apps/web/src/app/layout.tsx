import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jet", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MUDRA-VANI OMEGA — Mission Control", template: "%s · MUDRA-VANI OMEGA" },
  description: "Live observability for multilingual voice infrastructure, biometric verification and signed Boli-Patra workflows.",
  applicationName: "MUDRA-VANI OMEGA",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#07080B" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="raat" suppressHydrationWarning>
      <body className={`${inter.variable} ${space.variable} ${mono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
