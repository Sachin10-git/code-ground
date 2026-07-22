/**
 * Pricing.jsx — Code Ground pricing page
 *
 * ── Sections ────────────────────────────────────────────────────────
 *
 *   <PricingNav>      sticky top bar — logo, sign in, get started
 *   <PricingHero>     headline + one-liner
 *   <PlanCards>       Free card + Pro card side by side
 *   <FeatureMatrix>   full comparison table — every feature, both plans
 *   <FAQ>             three objections answered
 *   <CTABanner>       final conversion push
 *   <PricingFooter>   minimal links
 *
 * ── Stripe Checkout flow ────────────────────────────────────────────
 *
 *   User clicks "Get Pro"
 *     → handleCheckout() fires
 *     → POST /api/billing/checkout   { plan: 'pro' }
 *     → Backend creates Stripe Checkout Session
 *     → Returns { url: 'https://checkout.stripe.com/...' }
 *     → window.location.href = url   (hard redirect to Stripe)
 *     → Stripe handles payment
 *     → On success → Stripe redirects to /dashboard?upgraded=true
 *     → On cancel  → Stripe redirects to /pricing
 *
 *   While the POST is in flight: button shows a spinner + "Redirecting…"
 *   If the POST fails: inline error message below the button
 *
 * ── Auth state ──────────────────────────────────────────────────────
 *
 *   The component reads `user` from AuthContext.
 *   - Signed-in users who are already Pro see "You're on Pro ✓"
 *     instead of the checkout button — no upsell to existing customers.
 *   - Signed-in free users see "Upgrade to Pro".
 *   - Signed-out users see "Get started free" → /register.
 *
 * ── No <form> tags ───────────────────────────────────────────────────
 *   All interactions are button onClick handlers per project convention.
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth }           from '../hooks/useAuth.jsx';
import api                   from '../utils/api.js';
import styles                from './Pricing.module.css';

/* ─────────────────────────────────────────────────────────────────────
   FEATURE DATA
   Single source of truth for the comparison matrix and plan cards.
   Adding a feature here updates both the card bullet list and the
   full matrix row automatically.

   Structure:
     category  — groups rows in the matrix under a section header
     label     — the feature name shown to the user
     free      — true / false / string (e.g. "50 / month")
     pro       — true / false / string (e.g. "Unlimited")
     highlight — true → row gets an accent background (key differentiators)
───────────────────────────────────────────────────────────────────── */
const FEATURES = [
  /* ── Core editing ── */
  { category: 'Editor',   label: 'Monaco code editor',         free: true,           pro: true,          highlight: false },
  { category: 'Editor',   label: 'Real-time collaboration',    free: true,           pro: true,          highlight: false },
  { category: 'Editor',   label: 'Live cursors and presence',  free: true,           pro: true,          highlight: false },
  { category: 'Editor',   label: 'Documents',                  free: '3 documents',  pro: 'Unlimited',   highlight: false },
  { category: 'Editor',   label: 'Collaborators per document', free: '2 users',      pro: 'Unlimited',   highlight: false },

  /* ── Languages ── */
  { category: 'Languages', label: 'JavaScript / TypeScript',   free: true,           pro: true,          highlight: false },
  { category: 'Languages', label: 'Python',                    free: true,           pro: true,          highlight: false },
  { category: 'Languages', label: 'Go, Java, C++',             free: false,          pro: true,          highlight: true  },

  /* ── AI pair programmer ── */
  { category: 'AI',        label: 'AI pair programmer',        free: '50 / month',   pro: 'Unlimited',   highlight: true  },
  { category: 'AI',        label: 'Session-aware context',     free: true,           pro: true,          highlight: false },
  { category: 'AI',        label: 'Conflict detection',        free: true,           pro: true,          highlight: false },
  { category: 'AI',        label: 'Inline @AI suggestions',    free: false,          pro: true,          highlight: true  },
  { category: 'AI',        label: 'AI session summaries',      free: false,          pro: true,          highlight: true  },

  /* ── Code execution ── */
  { category: 'Execution', label: 'Sandboxed code execution',  free: '20 runs / day', pro: 'Unlimited',  highlight: false },
  { category: 'Execution', label: 'Execution timeout',         free: '10 seconds',    pro: '30 seconds', highlight: false },

  /* ── History ── */
  { category: 'History',   label: 'Named snapshots',           free: '3 per doc',    pro: 'Unlimited',   highlight: false },
  { category: 'History',   label: 'Session history retention', free: '7 days',       pro: '90 days',     highlight: false },

  /* ── Support ── */
  { category: 'Support',   label: 'Community support',         free: true,           pro: true,          highlight: false },
  { category: 'Support',   label: 'Priority support',          free: false,          pro: true,          highlight: false },
];

/* Features shown as bullet points inside the Pro card.
   Keep this list short — 5–6 items max. */
const PRO_BULLETS = FEATURES.filter(f =>
  ['Unlimited AI pair programmer', 'AI session summaries', 'Inline @AI suggestions',
   'Go, Java, C++', 'Unlimited documents', 'Unlimited code execution'].includes(f.label) ||
  (f.pro === 'Unlimited' && f.highlight)
).slice(0, 6);

/* Features shown as bullet points inside the Free card. */
const FREE_BULLETS = FEATURES.filter(f =>
  ['Monaco code editor', 'Real-time collaboration', 'Live cursors and presence',
   'AI pair programmer', 'Sandboxed code execution', 'Named snapshots'].includes(f.label)
).slice(0, 5);

/* ─────────────────────────────────────────────────────────────────────
   ICONS  (inline SVG, stroke-based, inherit currentColor)
───────────────────────────────────────────────────────────────────── */

/** Green check — feature is included */
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="#34D399" strokeWidth="2.5" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** Dim dash — feature is not included on this plan */
const DashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="#334155" strokeWidth="2" strokeLinecap="round"
    aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/** Arrow right — used inside CTA button */
const ArrowRightIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

/** External link — Stripe redirect indicator */
const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/** Spinner — arc that rotates */
const Spinner = () => (
  <svg className={styles.spinner} width="15" height="15"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   FeatureValue — renders the value cell in the matrix.
   true  → green check icon
   false → dim dash icon
   string → the string with an accent colour if it's "Unlimited"
───────────────────────────────────────────────────────────────────── */
function FeatureValue({ value }) {
  if (value === true)  return <CheckIcon />;
  if (value === false) return <DashIcon />;

  /* String value — "Unlimited" gets the accent colour */
  const isUnlimited = value === 'Unlimited';
  return (
    <span className={isUnlimited ? styles.val_unlimited : styles.val_text}>
      {value}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PricingNav — sticky top bar
───────────────────────────────────────────────────────────────────── */
function PricingNav({ user }) {
  return (
    <nav className={styles.nav} role="navigation" aria-label="Main navigation">
      <Link to="/" className={styles.logo} aria-label="Code Ground home">
        <span className={styles.logo_bracket}>&lt;</span>
        <span className={styles.logo_letters}>CG</span>
        <span className={styles.logo_bracket}>/&gt;</span>
      </Link>

      <div className={styles.nav_actions}>
        {user ? (
          <Link to="/dashboard" className={styles.nav_link}>Dashboard</Link>
        ) : (
          <Link to="/login" className={styles.nav_link}>Sign in</Link>
        )}
        {!user && (
          <Link to="/register" className={styles.cta_btn_sm}>Get started free</Link>
        )}
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PricingHero — headline section above the plan cards
───────────────────────────────────────────────────────────────────── */
function PricingHero() {
  return (
    <section className={styles.hero} aria-labelledby="pricing-headline">
      {/* Eyebrow */}
      <div className={styles.eyebrow} aria-hidden="true">
        <span className={styles.eyebrow_dot} />
        Simple, transparent pricing
      </div>

      <h1 id="pricing-headline" className={styles.headline}>
        One plan for solo devs.<br />
        <span className={styles.headline_accent}>One for teams who ship.</span>
      </h1>

      <p className={styles.hero_sub}>
        Start free. No credit card. Upgrade when the AI starts saving you real time.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PlanCards — Free + Pro side by side
   The Pro card is visually elevated: blue border glow, "Most popular"
   badge, and a slightly larger padding to feel more substantial.
───────────────────────────────────────────────────────────────────── */
function PlanCards({ user, onCheckout, checkoutLoading, checkoutError }) {
  const isPro = user?.is_paid;

  return (
    <section
      className={styles.cards_section}
      aria-label="Pricing plans"
    >
      <div className={styles.cards_grid}>

        {/* ── Free card ── */}
        <div className={styles.card} aria-label="Free plan">
          <div className={styles.card_header}>
            <h2 className={styles.plan_name}>Free</h2>
            <div className={styles.price_row}>
              <span className={styles.price}>₹0</span>
              <span className={styles.price_period}>/ forever</span>
            </div>
            <p className={styles.plan_tagline}>
              Everything you need to start coding together.
            </p>
          </div>

          {/* Feature bullets */}
          <ul className={styles.bullets} aria-label="Free plan features">
            {FREE_BULLETS.map(f => (
              <li key={f.label} className={styles.bullet}>
                <CheckIcon />
                <span>
                  {/* Show the value if it's a string, otherwise just the label */}
                  {typeof f.free === 'string'
                    ? <><strong className={styles.bullet_val}>{f.free}</strong> {f.label.toLowerCase()}</>
                    : f.label
                  }
                </span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div className={styles.card_footer}>
            {user ? (
              !isPro ? (
                /* Signed-in free user — already on this plan */
                <div className={styles.current_plan_badge} aria-label="Current plan">
                  <CheckIcon /> Current plan
                </div>
              ) : null
            ) : (
              /* Signed-out user */
              <Link to="/register" className={styles.free_btn}>
                Get started free
                <ArrowRightIcon />
              </Link>
            )}
          </div>
        </div>

        {/* ── Pro card ── */}
        <div className={`${styles.card} ${styles.card_pro}`} aria-label="Pro plan">

          {/* "Most popular" badge */}
          <div className={styles.popular_badge} aria-label="Most popular">
            Most popular
          </div>

          <div className={styles.card_header}>
            <h2 className={styles.plan_name}>Pro</h2>
            <div className={styles.price_row}>
              <span className={styles.price}>₹299</span>
              <span className={styles.price_period}>/ month</span>
            </div>
            <p className={styles.plan_tagline}>
              Unlimited AI. Unlimited docs. Full team features.
            </p>
          </div>

          {/* Feature bullets */}
          <ul className={styles.bullets} aria-label="Pro plan features">
            {FEATURES.filter(f => f.pro === true || f.pro === 'Unlimited').slice(0, 6).map(f => (
              <li key={f.label} className={styles.bullet}>
                <CheckIcon />
                <span>
                  {f.pro === 'Unlimited'
                    ? <><strong className={styles.bullet_val_pro}>Unlimited</strong> {f.label.toLowerCase()}</>
                    : f.label
                  }
                </span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div className={styles.card_footer}>
            {isPro ? (
              /* Already on Pro */
              <div className={styles.current_plan_badge} aria-label="Current plan">
                <CheckIcon /> You're on Pro
              </div>
            ) : user ? (
              /* Signed-in free user — upgrade */
              <div className={styles.checkout_wrap}>
                <button
                  className={styles.pro_btn}
                  onClick={onCheckout}
                  disabled={checkoutLoading}
                  aria-busy={checkoutLoading}
                >
                  {checkoutLoading ? (
                    <><Spinner /> Redirecting…</>
                  ) : (
                    <>Upgrade to Pro <ExternalIcon /></>
                  )}
                </button>
                {checkoutError && (
                  <p className={styles.checkout_err} role="alert">
                    {checkoutError}
                  </p>
                )}
                <p className={styles.stripe_note}>
                  {/* Inline lock icon */}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Secured by Stripe · Cancel anytime
                </p>
              </div>
            ) : (
              /* Signed-out user */
              <div className={styles.checkout_wrap}>
                <Link to="/register" className={styles.pro_btn}>
                  Get started free <ArrowRightIcon />
                </Link>
                <p className={styles.stripe_note}>
                  Start free, upgrade later
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Billing note below cards */}
      <p className={styles.billing_note}>
        All prices in INR. Billed monthly. Cancel anytime — no questions asked.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FeatureMatrix — full comparison table
   Groups features by category with section headers.
   This is the honest, detailed breakdown that converts
   users who need to see every line item before upgrading.
───────────────────────────────────────────────────────────────────── */
function FeatureMatrix() {
  /* Group features by category */
  const categories = [...new Set(FEATURES.map(f => f.category))];

  return (
    <section className={styles.matrix_section} aria-labelledby="matrix-heading">
      <h2 id="matrix-heading" className={styles.matrix_heading}>
        Everything, compared
      </h2>
      <p className={styles.matrix_sub}>
        Every feature, every limit — nothing hidden.
      </p>

      <div className={styles.matrix_wrap}>
        <table className={styles.matrix} role="table">

          {/* Column headers */}
          <thead>
            <tr>
              {/* Feature label column — no header text needed */}
              <th className={styles.th_feature} scope="col">
                <span className={styles.sr_only}>Feature</span>
              </th>
              <th className={styles.th_plan} scope="col">
                <span className={styles.th_free_label}>Free</span>
              </th>
              <th className={`${styles.th_plan} ${styles.th_pro}`} scope="col">
                <span className={styles.th_pro_label}>Pro</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {categories.map(cat => (
              <React.Fragment key={cat}>
                {/* Category section header row */}
                <tr className={styles.cat_row}>
                  <td colSpan={3} className={styles.cat_cell}>
                    {cat}
                  </td>
                </tr>

                {/* Feature rows for this category */}
                {FEATURES.filter(f => f.category === cat).map(f => (
                  <tr
                    key={f.label}
                    className={`${styles.feat_row} ${f.highlight ? styles.feat_row_highlight : ''}`}
                  >
                    <td className={styles.feat_label}>{f.label}</td>
                    <td className={styles.feat_val}>
                      <FeatureValue value={f.free} />
                    </td>
                    <td className={`${styles.feat_val} ${styles.feat_val_pro}`}>
                      <FeatureValue value={f.pro} />
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FAQ — three common objections answered
   Written in mono comment style to match Code Ground's brand voice.
───────────────────────────────────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: 'Can I really use it for free forever?',
    a: 'Yes. The free plan has no time limit. You get a real collaborative editor with AI, code execution, and snapshots. The limits (3 documents, 50 AI calls/month) are generous for solo learners or small experiments.',
  },
  {
    q: 'What happens if I hit the AI call limit?',
    a: "You'll see a prompt to upgrade. Your editor keeps working normally — only new AI requests are paused. Your existing session and all your documents stay intact.",
  },
  {
    q: 'Can I cancel my Pro subscription?',
    a: 'Any time, one click, from your dashboard. You keep Pro access until the end of the billing period. No penalties, no awkward cancellation flows.',
  },
];

function FAQ() {
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <section className={styles.faq_section} aria-labelledby="faq-heading">
      <h2 id="faq-heading" className={styles.faq_heading}>
        Common questions
      </h2>

      <div className={styles.faq_list} role="list">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = openIdx === i;
          return (
            <div key={i} className={styles.faq_item} role="listitem">
              <button
                className={styles.faq_question}
                onClick={() => setOpenIdx(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
              >
                {/* Mono comment marker signals the brand world */}
                <span className={styles.faq_marker} aria-hidden="true">
                  {isOpen ? '// ' : '/* '}
                </span>
                {item.q}
                <span
                  className={`${styles.faq_chevron} ${isOpen ? styles.faq_chevron_open : ''}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </button>

              {isOpen && (
                <div
                  id={`faq-answer-${i}`}
                  className={styles.faq_answer}
                  role="region"
                >
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CTABanner — final conversion push at the bottom of the page
───────────────────────────────────────────────────────────────────── */
function CTABanner({ user, onCheckout, checkoutLoading }) {
  const isPro = user?.is_paid;

  return (
    <section className={styles.cta_section} aria-labelledby="cta-heading">
      <h2 id="cta-heading" className={styles.cta_heading}>
        Ready to code smarter?
      </h2>
      <p className={styles.cta_sub}>
        The AI pair programmer is watching. Let it help.
      </p>

      <div className={styles.cta_actions}>
        {isPro ? (
          <Link to="/dashboard" className={styles.cta_btn_primary}>
            Go to dashboard <ArrowRightIcon />
          </Link>
        ) : user ? (
          <button
            className={styles.cta_btn_primary}
            onClick={onCheckout}
            disabled={checkoutLoading}
          >
            {checkoutLoading ? <><Spinner /> Redirecting…</> : <>Upgrade to Pro <ExternalIcon /></>}
          </button>
        ) : (
          <>
            <Link to="/register" className={styles.cta_btn_primary}>
              Start for free <ArrowRightIcon />
            </Link>
            <Link to="/login" className={styles.cta_btn_ghost}>
              Sign in
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PricingFooter — minimal footer matching Landing page
───────────────────────────────────────────────────────────────────── */
function PricingFooter() {
  return (
    <footer className={styles.footer} role="contentinfo">
      <span className={styles.footer_logo}>
        <span className={styles.logo_bracket}>&lt;</span>
        <span className={styles.logo_letters}>CG</span>
        <span className={styles.logo_bracket}>/&gt;</span>
      </span>
      <nav className={styles.footer_links} aria-label="Footer navigation">
        <Link to="/"          className={styles.footer_link}>Home</Link>
        <Link to="/dashboard" className={styles.footer_link}>Dashboard</Link>
        <a href="/terms"      className={styles.footer_link}>Terms</a>
        <a href="/privacy"    className={styles.footer_link}>Privacy</a>
      </nav>
      <p className={styles.footer_comment}>
        {/* Mono comment matches brand voice established on Landing */}
        // prices in INR · payments via Stripe
      </p>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Pricing — page root
   Owns the Stripe Checkout state and passes handlers down.
───────────────────────────────────────────────────────────────────── */
export default function Pricing() {
  const { user }  = useAuth();
  const navigate  = useNavigate();

  /* Checkout state */
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError,   setCheckoutError]   = useState('');

  /**
   * handleCheckout — initiates the Stripe Checkout session.
   *
   * Flow:
   *   1. POST /api/billing/checkout  → { url }
   *   2. Redirect to Stripe-hosted page
   *   3. After payment, Stripe redirects back to /dashboard?upgraded=true
   *
   * If the user is not signed in, redirect to /register first.
   * The register page will redirect to /pricing after account creation.
   */
  async function handleCheckout() {
    /* Not signed in — send to register */
    if (!user) {
      navigate('/register', { state: { from: '/pricing' } });
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError('');

    try {
      const { data } = await api.post('/billing/checkout', {
        plan:        'pro',
        /* Stripe will redirect here after successful payment */
        success_url: `${window.location.origin}/dashboard?upgraded=true`,
        /* Stripe will redirect here if user cancels */
        cancel_url:  `${window.location.origin}/pricing`,
      });

      /* Hard redirect to Stripe-hosted checkout page */
      window.location.href = data.url;

    } catch (err) {
      /*
       * Show a human-readable error.
       * Common causes: network failure, invalid API key in dev,
       * or Stripe account not fully configured yet.
       */
      const msg =
        err.response?.data?.error ||
        'Could not start checkout. Please try again.';
      setCheckoutError(msg);
      setCheckoutLoading(false);
    }

    /* Note: we don't call setCheckoutLoading(false) on success
       because the page will redirect away. Leaving the spinner
       running feels correct — the user is being taken somewhere. */
  }

  return (
    <div className={styles.root}>
      <PricingNav user={user} />

      <main>
        <PricingHero />

        <PlanCards
          user={user}
          onCheckout={handleCheckout}
          checkoutLoading={checkoutLoading}
          checkoutError={checkoutError}
        />

        <FeatureMatrix />

        <FAQ />

        <CTABanner
          user={user}
          onCheckout={handleCheckout}
          checkoutLoading={checkoutLoading}
        />
      </main>

      <PricingFooter />
    </div>
  );
}
