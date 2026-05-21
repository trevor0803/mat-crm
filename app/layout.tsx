import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAT Digital CRM",
  description: "Internal CRM for MAT Digital.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-brand-navy text-gray-100 antialiased">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          {children}
        </main>
        <Footer />
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          toastOptions={{
            classNames: {
              success:
                "!bg-brand-card !border !border-brand-gold/40 !text-gray-100 [&_[data-icon]]:!text-brand-gold",
            },
          }}
        />
      </body>
    </html>
  );
}
