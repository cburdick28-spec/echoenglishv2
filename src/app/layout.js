import "./globals.css";

/**
 * Root layout for Echo English.
 * Wraps every page and defines document-level metadata (title, description, viewport).
 */
export const metadata = {
  title: "Echo English – AI Pronunciation Coach",
  description:
    "Read a sentence aloud and get instant AI feedback on your English pronunciation and fluency.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
