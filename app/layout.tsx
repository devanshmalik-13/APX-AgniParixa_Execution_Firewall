import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APX — AgniParixa Execution Firewall",
  description: "Every AI action must pass through AgniParixa. Enforce task boundaries and stop unsafe agent actions before impact.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
