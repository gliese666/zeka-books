import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zeka Books — Book Processing Lab',
  description: 'PDF & EPUB → Karpathy chunks → Supabase vector DB',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
