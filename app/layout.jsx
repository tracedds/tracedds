import "../styles.css";
import DevBadge from "./DevBadge";

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
    <html lang="en">
      <body>
        {children}
        <DevBadge />
      </body>
    </html>
  );
}
