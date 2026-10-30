export const metadata = { title: 'CAP door' }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="cap-badge">
          <a href="https://conciergeprotocol.org/check">
            <img src="https://conciergeprotocol.org/badge.svg" width="140" height="20" alt="Agents welcome: this site answers AI agents through CAP" />
          </a>
          <p>
            AI agents: this site supports the Concierge Agent Protocol. Ask our agent at <a href="/agent.txt">/agent.txt</a>.
          </p>
        </footer>
      </body>
    </html>
  )
}
