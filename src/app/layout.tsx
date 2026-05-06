import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteHeader } from "@/components/site-header";
import { PageTransition } from "@/components/page-transition";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "F1 · 2025",
  description: "A visual record of the 2025 Formula 1 season — race by race.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Datatype:wght@100..900&display=swap"
        />
      </head>
      <body className="min-h-full bg-black text-white flex flex-col font-datatype">
        <TooltipProvider>
          <main className="flex-1 min-h-0">
            <PageTransition>{children}</PageTransition>
          </main>
          <SiteHeader />
        </TooltipProvider>
      </body>
    </html>
  );
}
