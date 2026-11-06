---
name: Expo web root HTML
description: Preserve Expo Router document context when customizing the web HTML shell.
---

Custom Expo Router `+html.tsx` must call `useServerDocumentContext()`, spread its HTML/body attributes, and render its `headNodes` and `bodyNodes`. Omitting the context nodes can leave the browser app blank even when Metro bundles successfully.

**Why:** the custom shell rendered an empty root until the SDK-provided hydration nodes were restored.

**How to apply:** keep this pattern whenever changing the Expo web document, PWA metadata, or shell scripts.
