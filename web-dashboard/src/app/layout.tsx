import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoldenLock Control",
  description: "Emergency resource coordination dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}