import { useEffect } from 'react'

const OWNER = 'GG HighTech Pro'
const CONTACT = 'grant88271@gmail.com'
const UPDATED = 'October 28, 2026'

// The privacy policy the app stores link to. It covers the website and every GGTV app.
function PrivacyPage() {
  useEffect(() => {
    document.title = 'GGTV | Privacy Policy'
    return () => { document.title = 'GGTV | Live Broadcast' }
  }, [])

  return (
    <main className="page-wrap legal-page">
      <div className="eyebrow">GGTV BROADCAST NETWORK <span> / </span> PRIVACY</div>
      <div className="page-heading">
        <div>
          <h1>Privacy Policy</h1>
          <p>Last updated {UPDATED}</p>
        </div>
      </div>

      <article className="legal-body">
        <p>
          GGTV is a live television channel run by {OWNER} ("we", "us"). This policy explains what information
          is handled when you watch GGTV on this website or in the GGTV apps for iPhone, Android, Apple TV,
          Android TV, Fire TV, Roku, Samsung and LG TVs.
        </p>

        <h2>The short version</h2>
        <p>
          You can watch GGTV without an account. We don't ask for your name, email address, phone number or
          payment details, we don't use advertising or tracking tools, and we don't sell or share information
          about you.
        </p>

        <h2>Information we handle</h2>
        <ul>
          <li>
            <strong>Connection information.</strong> To play the channel and show the schedule, your device
            connects to our servers. Like any website, the servers receive your IP address, the type of
            device or browser and the time of the request. Our hosting provider keeps these in short-term
            technical logs, used only to keep the service running and secure.
          </li>
          <li>
            <strong>Nothing stored on your device for viewers.</strong> The website and apps don't set
            tracking cookies or keep personal information on your device. The website may save a copy of
            its own pages so it can show a message when you're offline.
          </li>
          <li>
            <strong>Studio staff.</strong> Only GGTV staff sign in, to the studio area of the website, and
            that sign-in uses a cookie to keep their session open. Viewers never need to sign in.
          </li>
        </ul>

        <h2>How we use it</h2>
        <p>
          Only to deliver the channel and its schedule, to fix problems and to protect the service from
          abuse. We don't build profiles of viewers or use the information for advertising.
        </p>

        <h2>Sharing</h2>
        <p>
          We don't sell, rent or trade information. Our servers are run by hosting providers that process
          connection data on our behalf. We may disclose information if the law requires it.
        </p>

        <h2>App stores and devices</h2>
        <p>
          Apple, Google, Amazon, Roku, Samsung and LG run the stores and devices the apps are installed from,
          and they handle information under their own privacy policies.
        </p>

        <h2>Children</h2>
        <p>
          GGTV doesn't knowingly collect personal information from anyone, including children under 13.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes, we'll update it on this page and change the date at the top.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or your information: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </article>
    </main>
  )
}

export default PrivacyPage
