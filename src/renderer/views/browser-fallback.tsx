export function BrowserFallback() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">SafeScreen</div>
        <h1>This page is only the dev server.</h1>
        <p>
          SafeScreen is a desktop Electron app. If you open the Vite URL directly
          in Chrome, the runtime bridge is missing, so protection will not start
          here.
        </p>
        <div className="note">
          Start the real app with <code>npm run dev</code> and use the Electron
          window that opens, not the localhost tab in your browser.
        </div>
      </section>
    </main>
  );
}
