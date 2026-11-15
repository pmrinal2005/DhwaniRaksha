import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_Devanagari, Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jet", display: "swap" });
// Latin-only faces render Devanagari as tofu; this keeps every Hindi/Marathi label legible.
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "Dhwani-Raksha Ω — Mission Control", template: "%s · Dhwani-Raksha Ω" },
  description: "Zero-bandwidth acoustic biometric escrow, forensic noise-immune trade broker and cross-dialect voice ledger for Bharat — built on Gnani Prisma v3.0, Timbre v3.0 and vachana-vc-v1.",
  applicationName: "Dhwani-Raksha",
  keywords: ["Gnani", "Prisma v3.0", "Timbre v3.0", "voice cloning", "pgvector", "Bharat", "voice ledger"],
  authors: [{ name: "Dhwani-Raksha" }],
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#07080B" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="raat" suppressHydrationWarning>
      <body className={`${inter.variable} ${space.variable} ${mono.variable} ${devanagari.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
