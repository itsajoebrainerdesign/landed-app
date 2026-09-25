import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "./NavBar";
import { ServiceWorker } from "./components/ServiceWorker";
import { ACCENT_BOOT_SCRIPT } from "./lib/accent";

export const metadata: Metadata = {
  title: "Landed",
  description: "Know what's here, right now.",
  applicationName: "Landed",
  // iPhone "Add to Home Screen": open full-screen, with this name and icon.
  appleWebApp: { capable: true, title: "Landed", statusBarStyle: "default" },
  icons: {
    icon: "/icons/favicon-32.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  // Lets the page draw under the notch / home indicator when installed —
  // the Search/Explore toggle and nav bar already pad themselves with
  // env(safe-area-inset-*), which only has a value with viewport-fit=cover.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The accent colour chosen in Account, applied before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_BOOT_SCRIPT }} />
      </head>
      <body className="font-nuckle">
        {children}
        <NavBar />
        <ServiceWorker />
      </body>
    </html>
  );
}
