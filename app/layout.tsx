import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Wrench } from "lucide-react";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FieldFlow — HVAC Service Management",
  description: "Manage work orders and technician dispatch for HVAC field service",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-neutral-50 text-neutral-900`}>
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-orange-600" />
              <span className="text-lg font-semibold">FieldFlow</span>
            </Link>
            <nav className="flex items-center gap-6">
              <NavLink href="/work-orders">Work Orders</NavLink>
              <NavLink href="/technicians">Technicians</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
