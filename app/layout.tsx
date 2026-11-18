import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitDrive — Your files, on your GitHub",
  description: "A simple personal cloud drive powered by GitHub."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
