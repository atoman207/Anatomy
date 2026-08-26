import type { Metadata } from "next";
import { Noto_Sans_JP, Noto_Serif_JP, Roboto } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { ToastProvider } from "@/components/shell/Toast";
import { WorkspaceProvider } from "@/components/workspace";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

const notoSans = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  preload: false,
  display: "swap",
  adjustFontFallback: false,
  fallback: [
    "Hiragino Sans",
    "Hiragino Kaku Gothic ProN",
    "Yu Gothic",
    "Meiryo",
    "sans-serif",
  ],
});

const notoSerif = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  preload: false,
  display: "swap",
  adjustFontFallback: false,
  fallback: [
    "Hiragino Mincho ProN",
    "Yu Mincho",
    "MS PMincho",
    "serif",
  ],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — 実験ノート・統計解析・AI査読`,
    // Every page sets its own <title>; this only fills the %s slot.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // No manual `icons` field: src/app/icon.png, apple-icon.png and
  // favicon.ico (the Next.js file-based convention) are auto-detected and
  // generate the right <link rel="icon"> tags on their own - declaring both
  // would risk two conflicting favicon links.
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — 実験ノート・統計解析・AI査読`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — 実験ノート・統計解析・AI査読`,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${notoSans.variable} ${notoSerif.variable} ${roboto.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("chondro.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh font-sans">
        <ToastProvider>
          <WorkspaceProvider>
            <AppShell>{children}</AppShell>
          </WorkspaceProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
