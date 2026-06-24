"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/planner", label: "Planner" },
  { href: "/chatter", label: "Chatter" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/clients");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="border-b border-brand-card bg-brand-navy">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
        <Link
          href="/"
          className="text-xl font-semibold tracking-tight text-brand-gold hover:brightness-110"
        >
          MAT Digital CRM
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-2 py-1 text-sm transition-colors ${
                  active ? "text-brand-gold" : "text-gray-300 hover:text-gray-100"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-brand-gold" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
