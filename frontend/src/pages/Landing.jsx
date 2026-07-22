/**
 * Landing.jsx — Code Ground public landing page
 *
 * Sections (in order):
 *   1. <Nav>          — logo + single CTA link, no distractions
 *   2. <Hero>         — animated terminal demo that IS the product pitch
 *   3. <Features>     — three-column feature strip
 *   4. <CTABanner>    — final conversion push before footer
 *   5. <Footer>       — minimal: logo + tagline + links
 *
 * Design decisions:
 *   - JetBrains Mono for all display text (coding font = on-theme)
 *   - Electric blue (#3B82F6) + phosphor cyan (#22D3EE) palette
 *   - Hero IS a live animated simulation of the product — not a screenshot
 *   - No external icon libraries, no heavy deps — pure CSS + JS animations
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './Landing.module.css';

/* ─────────────────────────────────────────
   Logo mark — a stylised "<CG>" in mono
───────────────────────────────────────── */
function Logo({ size = 'md' }) {
  return (
    <div className={`${styles.logo} ${styles[`logo_${size}`]}`} aria-label="Code Ground">
      {/* The angle-bracket wrap signals "code"; CG is the initialism */}
      <span className={styles.logo_bracket}>&lt;</span>
      <span className={styles.logo_letters}>CG</span>
      <span className={styles.logo_bracket}>/&gt;</span>
    </div>
  );
}

/* ─────────────────────────────────────────
   Nav — sticky top bar, minimal
───────────────────────────────────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.nav_scrolled : ''}`} role="navigation" aria-label="Main navigation">
      <Logo size="md" />
      <div className={styles.nav_actions}>
        <Link to="/login" className={styles.nav_link}>Sign in</Link>
        <Link to="/register" className={styles.cta_btn}>Get started</Link>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────
   TerminalDemo — the animated hero widget
   Shows: two user cursors editing + AI
   streaming a response in real time.
   Pure CSS + setInterval animation.
───────────────────────────────────────── */

/* The fake code lines shown in the editor pane */
const CODE_LINES = [
  { text: 'async function validateToken(token) {', indent: 0 },
  { text: '  const decoded = jwt.verify(token,', indent: 0 },
  { text: '    process.env.JWT_SECRET', indent: 0 },
  { text: '  );', indent: 0 },
  { text: '  return decoded;', indent: 0 },
  { text: '}', indent: 0 },
  { text: '', indent: 0 },
  { text: '// Bob: using old signature below', indent: 0 },
  { text: 'const user = validateToken(req.headers.token);', indent: 0 },
];

/* The AI response that streams in */
const AI_RESPONSE =
  "⚠ Alice changed validateToken — it now requires a string, not a header object. Line 9 will throw a TypeError at runtime. Update to: validateToken(req.headers.authorization?.split(' ')[1])";

function TerminalDemo() {
  /* Which characters of the AI response have been revealed */
  const [aiChars, setAiChars] = useState(0);
  /* Blink state for the two user cursors */
  const [blink, setBlink] = useState(true);
  /* Whether the AI panel is visible yet */
  const [aiVisible, setAiVisible] = useState(false);
  /* Alice's cursor line (animates downward as she "types") */
  const [aliceLine, setAliceLine] = useState(1);

  const streamRef = useRef(null);

  useEffect(() => {
    /* Cursor blink — 530ms feels natural */
    const blinkTimer = setInterval(() => setBlink(b => !b), 530);

    /* Alice's cursor moves down through the code after 1s */
    const aliceTimer = setTimeout(() => {
      let line = 1;
      const mover = setInterval(() => {
        line += 1;
        setAliceLine(line);
        if (line >= 5) clearInterval(mover);
      }, 600);
    }, 1000);

    /* AI panel appears after 4s */
    const aiShowTimer = setTimeout(() => {
      setAiVisible(true);
      /* Then stream in the AI text character by character */
      let i = 0;
      streamRef.current = setInterval(() => {
        i += 1;
        setAiChars(i);
        if (i >= AI_RESPONSE.length) {
          clearInterval(streamRef.current);
        }
      }, 22); /* ~22ms per char feels like fast but readable streaming */
    }, 4000);

    return () => {
      clearInterval(blinkTimer);
      clearTimeout(aliceTimer);
      clearTimeout(aiShowTimer);
      if (streamRef.current) clearInterval(streamRef.current);
    };
  }, []);

  return (
    <div className={styles.terminal} role="img" aria-label="Animated demo of two developers editing code together with AI assistance">
      {/* ── Terminal chrome — fake macOS-style window bar ── */}
      <div className={styles.terminal_bar}>
        <span className={styles.dot} style={{ background: '#FF5F57' }} />
        <span className={styles.dot} style={{ background: '#FEBC2E' }} />
        <span className={styles.dot} style={{ background: '#28C840' }} />
        <span className={styles.terminal_title}>auth.js — Code Ground</span>

        {/* Live presence chips — two fake users */}
        <div className={styles.presence}>
          <div className={styles.user_chip} style={{ '--uc': '#3B82F6' }}>
            <span className={styles.user_dot} />
            Alice
          </div>
          <div className={styles.user_chip} style={{ '--uc': '#22D3EE' }}>
            <span className={styles.user_dot} />
            Bob
          </div>
        </div>
      </div>

      {/* ── Editor body ── */}
      <div className={styles.editor_body}>
        {/* Line numbers column */}
        <div className={styles.line_nums} aria-hidden="true">
          {CODE_LINES.map((_, i) => (
            <div key={i} className={styles.line_num}>{i + 1}</div>
          ))}
        </div>

        {/* Code column */}
        <div className={styles.code_col}>
          {CODE_LINES.map((line, i) => (
            <div key={i} className={styles.code_line}>
              {/* Alice's blue cursor sits on her current line */}
              {i === aliceLine && (
                <span
                  className={`${styles.cursor} ${blink ? styles.cursor_vis : ''}`}
                  style={{ '--cc': '#3B82F6' }}
                  aria-hidden="true"
                />
              )}
              {/* Bob's cyan cursor sits on line 8 (where the bug is) */}
              {i === 8 && (
                <span
                  className={`${styles.cursor} ${blink ? styles.cursor_vis : ''}`}
                  style={{ '--cc': '#22D3EE' }}
                  aria-hidden="true"
                />
              )}
              {/* Highlight the buggy line Bob is on */}
              <span
                className={`${styles.code_text} ${i === 8 ? styles.line_warn : ''}`}
                dangerouslySetInnerHTML={{ __html: colourCode(line.text) }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── AI suggestion panel — slides up after delay ── */}
      <div className={`${styles.ai_panel} ${aiVisible ? styles.ai_panel_vis : ''}`} aria-live="polite">
        <div className={styles.ai_panel_header}>
          {/* The <CG/> logo mark doubles as the AI avatar */}
          <span className={styles.ai_avatar} aria-hidden="true">&lt;CG/&gt;</span>
          <span className={styles.ai_label}>Code Ground AI</span>
          {/* Pulsing dot = "thinking / streaming" */}
          {aiChars < AI_RESPONSE.length && (
            <span className={styles.ai_thinking} aria-hidden="true" />
          )}
        </div>
        {/* Streamed text — only the revealed portion */}
        <p className={styles.ai_text}>
          {AI_RESPONSE.slice(0, aiChars)}
          {/* Blinking cursor while streaming */}
          {aiChars < AI_RESPONSE.length && (
            <span className={`${styles.stream_cursor} ${blink ? styles.cursor_vis : ''}`} aria-hidden="true">▋</span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * colourCode — naive syntax highlighter for the demo lines.
 * Only handles keywords, strings, and comments — enough to
 * look convincing without pulling in a real library.
 */
function colourCode(text) {
  if (!text) return '&nbsp;'; /* keep empty lines from collapsing */

  const KEYWORDS = ['async', 'function', 'const', 'return', 'await'];
  const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'g');

  return text
    /* HTML-escape angle brackets first to avoid XSS */
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    /* Comments → muted */
    .replace(/(\/\/.*)$/, '<span style="color:#4B5563">$1</span>')
    /* Strings → green */
    .replace(/('.*?'|".*?")/g, '<span style="color:#86EFAC">$1</span>')
    /* Keywords → blue */
    .replace(KEYWORD_RE, '<span style="color:#93C5FD">$1</span>')
    /* Numbers → cyan */
    .replace(/\b(\d+)\b/g, '<span style="color:#67E8F9">$1</span>');
}

/* ─────────────────────────────────────────
   Hero — headline + sub + terminal demo
───────────────────────────────────────── */
function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-headline">
      <div className={styles.hero_inner}>
        {/* Tag above the headline — signals AI feature */}
        <div className={styles.eyebrow} aria-hidden="true">
          <span className={styles.eyebrow_dot} />
          AI-powered pair programming
        </div>

        {/* Main headline — JetBrains Mono, very large */}
        <h1 id="hero-headline" className={styles.headline}>
          {/* Line break is intentional — "Code together." stands alone */}
          Code together.<br />
          <span className={styles.headline_accent}>Ship faster.</span>
        </h1>

        <p className={styles.hero_sub}>
          Code Ground gives your team a shared editor where an AI pair programmer
          watches every change, spots cross-user conflicts in real time, and
          suggests fixes before your build breaks.
        </p>

        <div className={styles.hero_cta}>
          <Link to="/register" className={styles.cta_btn_lg}>
            Start coding free
          </Link>
          <a
            href="https://github.com/pui1ya/code-ground"
            className={styles.ghost_btn}
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* Star icon — inline SVG, no library needed */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Star on GitHub
          </a>
        </div>

        {/* Social proof — tiny numbers below CTA */}
        <p className={styles.social_proof}>
          Free to start · No credit card · Works in your browser
        </p>

        {/* The animated terminal demo IS the hero visual */}
        <TerminalDemo />
      </div>

      {/* Ambient glow orbs — purely decorative, no meaning */}
      <div className={styles.orb_blue} aria-hidden="true" />
      <div className={styles.orb_cyan} aria-hidden="true" />
    </section>
  );
}

/* ─────────────────────────────────────────
   Features — three cards explaining the
   three core things Code Ground does
───────────────────────────────────────── */
const FEATURES = [
  {
    /* SVG icon: two overlapping cursors */
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M9 3L3 9l6 12 1.5-4.5L15 18l6-6-4.5-1.5L21 9l-6 6-4.5-1.5L9 3z" />
      </svg>
    ),
    title: 'Zero-conflict editing',
    body: 'Yjs CRDT ensures every keystroke from every user merges perfectly — the same algorithm that powers Google Docs.',
  },
  {
    /* SVG icon: robot / AI chip */
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 4 0v2" />
        <path d="M16 7V5a2 2 0 0 0-4 0v2" />
        <circle cx="9" cy="13" r="1.5" />
        <circle cx="15" cy="13" r="1.5" />
        <path d="M9 17h6" />
      </svg>
    ),
    title: 'AI that sees everyone',
    body: "The AI doesn't just see your file. It sees the last 50 edits, who made them, and spots conflicts before you run the code.",
  },
  {
    /* SVG icon: play triangle in a box = run / execute */
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <polygon points="9,8 17,12 9,16" fill="currentColor" stroke="none" />
      </svg>
    ),
    title: 'Sandboxed execution',
    body: 'Run JS, Python, Go, Java, or C++ in an isolated Docker container. Output streams to every user in the session.',
  },
];

function Features() {
  return (
    <section className={styles.features} aria-labelledby="features-heading">
      {/* Visually hidden heading for screen readers */}
      <h2 id="features-heading" className={styles.sr_only}>Features</h2>

      <div className={styles.features_grid}>
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.feature_card}>
            <div className={styles.feature_icon}>{f.icon}</div>
            <h3 className={styles.feature_title}>{f.title}</h3>
            <p className={styles.feature_body}>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────
   CTABanner — final push before footer
───────────────────────────────────────── */
function CTABanner() {
  return (
    <section className={styles.cta_banner} aria-labelledby="cta-heading">
      <h2 id="cta-heading" className={styles.cta_banner_heading}>
        Your team's next session starts here.
      </h2>
      <p className={styles.cta_banner_sub}>
        Free forever for small teams. No setup, no plugins — just open a URL and code.
      </p>
      <Link to="/register" className={styles.cta_btn_lg}>
        Create a free workspace
      </Link>
    </section>
  );
}

/* ─────────────────────────────────────────
   Footer — minimal
───────────────────────────────────────── */
function Footer() {
  return (
    <footer className={styles.footer} role="contentinfo">
      <Logo size="sm" />
      <p className={styles.footer_tagline}>
        {/* The mono comment style echoes the product's world */}
        <span className={styles.footer_comment}>// built for developers who think in pairs</span>
      </p>
      <nav className={styles.footer_links} aria-label="Footer navigation">
        <Link to="/login" className={styles.footer_link}>Sign in</Link>
        <Link to="/register" className={styles.footer_link}>Get started</Link>
        <a href="https://github.com" className={styles.footer_link} target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>
    </footer>
  );
}

/* ─────────────────────────────────────────
   Landing — page root, composes all sections
───────────────────────────────────────── */
export default function Landing() {
  return (
    <div className={styles.root}>
      <Nav />
      <main>
        <Hero />
        <Features />
        <CTABanner />
      </main>
      <Footer />
    </div>
  );
}
