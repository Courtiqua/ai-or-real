import "./globals.css";

export const metadata = {
  title: "AI or Real? | Fun Friday",
  description: "Same team. Different brainrot.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
