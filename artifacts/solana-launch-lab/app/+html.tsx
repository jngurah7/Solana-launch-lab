import React from 'react';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

export default function RootHtml({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, headNodes, htmlAttributes } =
    useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#080d0a" />
        <meta
          name="description"
          content="A Devnet-first Solana research workspace. Connect Phantom securely and test without real funds."
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body
        {...bodyAttributes}
        style={{ margin: 0, minHeight: '100vh', backgroundColor: '#080d0a' }}
      >
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
