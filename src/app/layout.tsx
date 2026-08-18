import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { WorkspaceProvider } from "@/components/workspace";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "chondro — 研究データ管理 / Research data workbench",
  description:
    "Raw file organization, sample sheets, statistics (t-test, ANOVA, PCA, clustering), figures, and experiment notebook automation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <WorkspaceProvider>
          <Nav />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </WorkspaceProvider>
        <footer className="border-t border-line px-4 py-4 text-center text-[11px] text-ink-3 sm:px-6">
          chondro — statistics run locally in your browser; nothing is uploaded unless you save it.
        </footer>
      </body>
    </html>
  );
}
