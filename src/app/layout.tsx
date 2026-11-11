import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "J-Pay",
  description: "PWA Payroll & Geolocation Logger",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "J-Pay" },
};

export const viewport: Viewport = {
  themeColor: "#0b0e14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-[var(--ink)] text-[var(--paper)] antialiased canvas-dithered">
      {/* Sub-perceptual anti-banding noise — pre-rendered static SVG tile
          (see globals.css .canvas-dithered::before); no per-frame feTurbulence. */}
      <Providers>{children}</Providers>
      </body>
    </html>
  );
}
