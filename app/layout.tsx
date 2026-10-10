import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APX — Safe execution for AI support agents",
  description: "Preview AI support actions, enforce ticket-specific permissions, execute approved transactions, and recover supported changes.",
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
