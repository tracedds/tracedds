import { Geist } from "next/font/google";
import "../styles.css";
import DevBadge from "./DevBadge";

const sans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "TraceDDS",
  description: "Supply traceability and audit-readiness for dental practices — scan your shelves, stay compliant, spend less.",
  appleWebApp: {
    capable: true,
    title: "TraceDDS",
    statusBarStyle: "default",
  },
  // Legacy alias so older iOS (pre-Safari 16.4) also launches standalone.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        {children}
        <DevBadge />
      </body>
    </html>
  );
}
