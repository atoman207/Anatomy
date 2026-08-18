import type { Metadata } from "next";
import { Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { WorkspaceProvider } from "@/components/workspace";

const notoSans = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
});

const notoSerif = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "研究データ管理",
  description:
    "Rawファイル整理、サンプルシート、統計解析（t検定、ANOVA、PCA、クラスタリング）、図作成、実験ノート自動化。",
  icons: {
    icon: "/LOGO.png",
    shortcut: "/LOGO.png",
    apple: "/LOGO.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${notoSans.variable} ${notoSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <WorkspaceProvider>
          <Nav />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </WorkspaceProvider>
        <footer className="border-t border-line px-4 py-4 text-center text-[11px] text-ink-3 sm:px-6">
          統計解析はブラウザ内で実行されます。保存しない限りデータはアップロードされません。
        </footer>
      </body>
    </html>
  );
}
