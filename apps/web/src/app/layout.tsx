import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Vault — Distributed Object Storage System',
  description: 'Self-healing distributed object-storage system with risk-aware placement and failure simulation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-blue-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
