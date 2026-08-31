import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "브랜디 OS",
  description: "회사 지식과 실행을 연결하는 브랜디액션 운영체제",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

const displayPreferenceScript = `
(() => {
  try {
    const savedTheme = window.localStorage.getItem("brandy-os-theme");
    const theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    const guidance = window.localStorage.getItem("brandy-os-guidance") === "off" ? "off" : "on";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.guidance = guidance;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.guidance = "on";
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: displayPreferenceScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
