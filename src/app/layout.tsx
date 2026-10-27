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
        {/* Sub-perceptual anti-banding SVG dither filter (zero-dimension, purely visual) */}
        <svg
          style={{ position: "fixed", width: 0, height: 0, pointerEvents: "none" }}
          aria-hidden="true"
        >
          <filter id="dither-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={3} result="noise" />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.015 0"
            />
            <feBlend mode="overlay" in="SourceGraphic" />
          </filter>
        </svg>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
