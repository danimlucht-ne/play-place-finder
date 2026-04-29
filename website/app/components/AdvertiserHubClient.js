'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  clearSharedAuthSession,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  getDefaultApiBase,
  hubFetch,
  loadHubSettings,
  readJwtClaims,
  saveSharedAuthSession,
  hubAdvertiserPillClass,
} from './hubClientUtils';
import HubAuthPanel from './HubAuthPanel';

const emptyOnboarding = {
  businessName: '',
  contactEmail: '',
  category: 'family_dining',
  city: '',
  state: '',
  websiteUrl: '',
  description: '',
  businessAddress: '',
};

const emptyDraft = {
  packageType: 'inline_listing',
  durationMonths: '1',
  targetingRadiusMiles: '20',
  startDate: '',
  headline: '',
  body: '',
  ctaText: 'Learn More',
  ctaUrl: '',
  creativeBusinessName: '',
  creativeBusinessCategory: '',
  showDistance: true,
  termsVersion: '1.0',
};

const categoryOptions = [
  'indoor_play',
  'outdoor_recreation',
  'family_dining',
  'education',
  'entertainment',
  'retail',
  'health_wellness',
  'services',
  'other',
];

const categoryLabels = {
  indoor_play: 'Indoor play',
  outdoor_recreation: 'Outdoor recreation',
  family_dining: 'Family dining',
  education: 'Education',
  entertainment: 'Entertainment',
  retail: 'Retail',
  health_wellness: 'Health and wellness',
  services: 'Services',
  other: 'Other',
};

const packageLabels = {
  featured_home: 'Featured home placement',
  inline_listing: 'Inline listing',
  event_spotlight_7d: '7-day event spotlight',
  event_spotlight_14d: '14-day event spotlight',
};

function trackingPlacementLabel(raw) {
  if (!raw || raw === 'unknown') return 'Unknown';
  if (raw === 'featured_home') return 'Home featured';
  if (raw === 'inline_listing') return 'Search listing';
  if (raw === 'map_sponsored_pin') return 'Map pin';
  return String(raw).replace(/_/g, ' ');
}

/** Human-readable draft title; full Mongo id shown as secondary line for support. */
function draftCardTitle(submission, advertiser) {
  const id = String(submission._id || '');
  const short = id.length > 10 ? `…${id.slice(-6)}` : id;
  const ev = typeof submission.eventName === 'string' ? submission.eventName.trim() : '';
  if (ev) return `${ev} · ${short}`;
  const biz = (advertiser?.businessName || '').trim();
  if (biz) return `${biz} · ${short}`;
  return `Ad draft ${short}`;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildAnalyticsCsv(daily) {
  const lines = [['date', 'impressions', 'clicks', 'ctr'].join(',')];
  for (const row of daily || []) {
    const d = row.date || row.ymd || '';
    const imp = row.impressions ?? 0;
    const clk = row.clicks ?? 0;
    const ctr = row.ctr != null ? row.ctr : (imp > 0 ? clk / imp : 0);
    lines.push([d, imp, clk, ctr].join(','));
  }
  return lines.join('\n');
}

/** Match app: hide date/time/location duplicates in body when When/Where rows exist. */
function eventBodyTextForDisplay(body, isEvent, opts = {}) {
  if (!isEvent) return (body || '').trim();
  let t = (body || '').trim();
  if (!t) return t;
  t = t
    .split('\n')
    .map((l) => l.trim())
    .filter((line) => !/^(date|time|location):/i.test(line))
    .join('\n')
    .trim();
  t = t.replace(/\bDate:\s*[^.!\n]+[.!?]?\s*/gi, ' ');
  t = t.replace(/\bTime:\s*[^.!\n]+[.!?]?\s*/gi, ' ');
  t = t.replace(/\bLocation:\s*[^.!\n]+[.!?]?\s*/gi, ' ');
  const en = (opts.eventName || '').trim();
  if (en.length >= 2) {
    const re = new RegExp(
      `Join us for\\s*${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[.!?]?\\s*`,
      'i',
    );
    t = t.replace(re, ' ');
  }
  const ymd = (opts.eventDate || '').trim().slice(0, 10);
  if (ymd.length >= 8) {
    t = t.replace(new RegExp(`\\b${ymd.replace(/-/g, '\\-')}\\b`, 'g'), ' ');
  }
  const time = (opts.eventTime || '').trim();
  if (time.length >= 3) t = t.split(time).join(' ');
  const loc = (opts.eventLocation || '').trim();
  if (loc.length >= 3) t = t.split(loc).join(' ');
  return t
    .replace(/\s+/g, ' ')
    .replace(/\s+\./, '.')
    .trim()
    .replace(/\.+$/g, '')
    .trim();
}

function formatEventDateReadableLineYmd(ymd, isRecurring) {
  if (!ymd || String(ymd).trim().length < 10) return null;
  const d = new Date(`${String(ymd).trim().slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (isRecurring) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Every ${days[d.getDay()]}`;
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function DailyImpressionsChart({ daily }) {
  const days = useMemo(() => {
    const list = [...(daily || [])].filter((d) => d && (d.date || d.ymd));
    list.sort((a, b) => String(a.date || a.ymd).localeCompare(String(b.date || b.ymd)));
    return list.slice(-21);
  }, [daily]);
  const maxImp = useMemo(
    () => Math.max(1, ...days.map((d) => d.impressions || 0)),
    [days],
  );
  if (days.length === 0) return null;
  return (
    <div className="hub-analytics-section">
      <h4>Impressions trend</h4>
      <p className="hub-analytics-sub">Bar height follows views per day (up to the last 21 days in the table below).</p>
      <div className="hub-bar-chart" role="img" aria-label="Impressions by day">
        {days.map((d) => {
          const ymd = d.date || d.ymd;
          const im = d.impressions || 0;
          const h = Math.max(4, (im / maxImp) * 100);
          return (
            <div
              key={ymd}
              className="hub-bar-chart__col"
              title={`${ymd}: ${im} views, ${d.clicks || 0} taps`}
            >
              <div className="hub-bar-chart__bar" style={{ height: `${h}%` }} />
              <span className="hub-bar-chart__tick">{ymd.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdPreviewCard({
  placement,
  isEvent,
  businessName,
  headline,
  body,
  ctaText,
  imageUrl,
  eventName,
  eventDate,
  eventTime,
  eventLocation,
  isRecurring,
  title = 'In-app preview',
  description,
  tone = 'draft',
}) {
  const isPrime = placement === 'featured_home';
  const displayTitlePrime = (() => {
    if (isPrime && isEvent && eventName && String(eventName).trim()) return String(eventName).trim();
    if (isPrime && businessName && String(businessName).trim()) return String(businessName).trim();
    if (isPrime) return (headline || '').trim() || (businessName || '').trim() || 'Your business';
    return '';
  })();
  const displayHeadline = (headline || '').trim() || 'Your headline will appear here';
  const displayTitleInline = (() => {
    if (isEvent && eventName && String(eventName).trim()) return String(eventName).trim();
    return displayHeadline;
  })();
  const whenLine = isEvent
    ? [formatEventDateReadableLineYmd(eventDate, !!isRecurring), (eventTime || '').trim()]
        .filter((x) => x)
        .join(' at ') || null
    : null;
  const whereLine = isEvent && (eventLocation || '').trim() ? (eventLocation || '').trim() : null;
  const eventNameForDedup = isEvent
    ? (eventName && String(eventName).trim() ? String(eventName).trim() : displayTitleInline)
    : null;
  const bodyRaw = (body || '').trim();
  const displayBodyProcessed = isEvent
    ? eventBodyTextForDisplay(bodyRaw, true, {
        eventName: eventNameForDedup,
        eventDate,
        eventTime,
        eventLocation: whereLine || eventLocation,
      })
    : bodyRaw;
  const bodyParagraph = (isEvent ? displayBodyProcessed : bodyRaw) || null;
  const bodyPlaceholder = 'Your description will appear here once you add it.';
  const displayCta = ctaText?.trim() || 'Learn more';
  const previewLabel =
    description ||
    (isPrime
      ? 'Prime: split layout (image and copy side by side), matching the app home card.'
      : 'Inline: split layout with image on the left, matching search and list ads.');

  return (
    <div className="hub-draft-preview">
      <div className="hub-draft-preview__head">
        <div>
          <h3>{title}</h3>
          <p>{previewLabel}</p>
        </div>
        <span className={`hub-pill hub-pill--${tone === 'pending' ? 'warn' : isPrime ? 'good' : 'neutral'}`}>
          {isPrime ? 'Prime layout' : isEvent ? 'Event / inline layout' : 'Inline layout'}
        </span>
      </div>

      {isPrime ? (
        <article className="hub-ad-preview hub-ad-preview--prime" aria-label="Prime placement preview">
          <div className="hub-ad-preview__image hub-ad-preview__image--prime">
            {imageUrl ? <img src={imageUrl} alt="" /> : <span>Ad image</span>}
          </div>
          <div className="hub-ad-preview__content hub-ad-preview__content--prime">
            <div className="hub-ad-preview__copy">
              <h4>{displayTitlePrime || displayHeadline || 'Your business'}</h4>
              {whenLine ? (
                <p className="hub-ad-preview__meta">
                  <strong>When:</strong> {whenLine}
                </p>
              ) : null}
              {whereLine ? (
                <p className="hub-ad-preview__meta">
                  <strong>Where:</strong> {whereLine}
                </p>
              ) : null}
              {bodyParagraph ? <p>{bodyParagraph}</p> : <p className="hub-ad-preview__meta">{bodyPlaceholder}</p>}
            </div>
            <div className="hub-ad-preview__footer">
              <span className={`hub-ad-preview__badge${isEvent ? ' hub-ad-preview__badge--event' : ''}`}>
                {isEvent ? 'Event' : 'Ad'}
              </span>
              <button type="button" className="hub-ad-preview__cta" disabled>
                {displayCta}
              </button>
            </div>
          </div>
        </article>
      ) : (
        <article className="hub-ad-preview hub-ad-preview--inline" aria-label="Inline listing preview">
          <div className="hub-ad-preview__image hub-ad-preview__image--inline">
            {imageUrl ? <img src={imageUrl} alt="" /> : <span>Ad image</span>}
          </div>
          <div className="hub-ad-preview__content hub-ad-preview__content--inline">
            <h4>{displayTitleInline}</h4>
            {whenLine ? (
              <p className="hub-ad-preview__meta">
                <strong>When:</strong> {whenLine}
              </p>
            ) : null}
            {whereLine ? (
              <p className="hub-ad-preview__meta">
                <strong>Where:</strong> {whereLine}
              </p>
            ) : null}
            {bodyParagraph ? <p>{bodyParagraph}</p> : <p className="hub-ad-preview__meta">{bodyPlaceholder}</p>}
            <div className="hub-ad-preview__footer hub-ad-preview__footer--inline">
              <span className={`hub-ad-preview__badge${isEvent ? ' hub-ad-preview__badge--event' : ''}`}>
                {isEvent ? 'Event' : 'Ad'}
              </span>
              <button type="button" className="hub-ad-preview__cta" disabled>
                {displayCta}
              </button>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}

function DraftPreviewCard({ draftForm, advertiser, imagePreviewUrl }) {
  return (
    <AdPreviewCard
      placement={draftForm.packageType}
      isEvent={draftForm.packageType.startsWith('event_')}
      businessName={draftForm.creativeBusinessName.trim() || advertiser?.businessName}
      headline={draftForm.headline}
      body={draftForm.body}
      ctaText={draftForm.ctaText}
      imageUrl={imagePreviewUrl}
    />
  );
}

export default function AdvertiserHubClient({ embedded = false }) {
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [advertiser, setAdvertiser] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignDetail, setCampaignDetail] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState(emptyOnboarding);
  const [draftForm, setDraftForm] = useState(emptyDraft);
  const [imageFile, setImageFile] = useState(null);
  const [activeSubmission, setActiveSubmission] = useState(null);
  const [paymentDiscountCode, setPaymentDiscountCode] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const paymentMountRef = useRef(null);
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const claims = readJwtClaims(token);
  const publishableKey = useMemo(
    () => (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim(),
    [],
  );
  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return '';
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    const settings = loadHubSettings('advertiser');
    setApiBase(settings.apiBase);
    setToken(settings.token);
  }, []);

  function destroyPaymentUi() {
    try {
      if (paymentMountRef.current) {
        paymentMountRef.current.innerHTML = '';
      }
    } catch (_) {
      /* no-op */
    }
    elementsRef.current = null;
  }

  useEffect(() => {
    destroyPaymentUi();
    if (!token || !selectedSubmission) {
      setActiveSubmission(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await hubFetch(apiBase, token, `/api/ads/submissions/${encodeURIComponent(selectedSubmission)}`);
        if (!cancelled) {
          setActiveSubmission(response.data || null);
        }
      } catch (err) {
        if (!cancelled) {
          setActiveSubmission(null);
          setError(err.message || 'Could not load submission status.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSubmission, token, apiBase]);

  useEffect(() => () => {
    destroyPaymentUi();
  }, []);

  async function runTask(task, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await task();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function handleAuthenticated(nextToken) {
    setToken(nextToken);
    saveSharedAuthSession(apiBase, nextToken);
    setMessage('Signed in successfully.');
    setError('');
    setTimeout(() => {
      refreshDashboard(nextToken);
    }, 0);
  }

  function handleSignedOut() {
    setToken('');
    clearSharedAuthSession();
    destroyPaymentUi();
    setAdvertiser(null);
    setSubmissions([]);
    setCampaigns([]);
    setSelectedSubmission(null);
    setSelectedCampaign(null);
    setCampaignDetail(null);
    setActiveSubmission(null);
    setPaymentDiscountCode('');
    setMessage('Signed out.');
    setError('');
  }

  async function refreshDashboard(tokenOverride) {
    const effectiveToken = typeof tokenOverride === 'string' ? tokenOverride : token;
    await runTask(async () => {
      const [profileRes, submissionsRes, campaignsRes] = await Promise.all([
        hubFetch(apiBase, effectiveToken, '/api/advertisers/me').catch((err) => {
          if (String(err.message).toLowerCase().includes('not found')) return { data: null };
          throw err;
        }),
        hubFetch(apiBase, effectiveToken, '/api/ads/submissions/mine'),
        hubFetch(apiBase, effectiveToken, '/api/ads/analytics/campaigns'),
      ]);
      setAdvertiser(profileRes.data || null);
      setSubmissions(submissionsRes.data || []);
      setCampaigns(campaignsRes.data || []);
      return true;
    }, 'Your advertising dashboard is up to date.');
  }

  async function createDraftSubmission(event) {
    event.preventDefault();
    const created = await runTask(async () => {
      const response = await hubFetch(apiBase, token, '/api/ads/submissions', {
        method: 'POST',
        body: JSON.stringify(onboardingForm),
      });
      return response.data;
    }, 'Business details saved. Your draft is ready for ad details.');
    if (created && created.submissionId) {
      const submissionId = String(created.submissionId);
      setSelectedSubmission(submissionId);
      await refreshDashboard();
    }
  }

  async function saveDraftSteps(event) {
    event.preventDefault();
    if (!selectedSubmission) {
      setError('Start a draft first, or choose one you already saved.');
      return;
    }

    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 2,
          packageType: draftForm.packageType,
          durationMonths: draftForm.packageType.startsWith('event_') ? undefined : Number(draftForm.durationMonths),
          targetingRadiusMiles: Number(draftForm.targetingRadiusMiles),
          startDate: draftForm.packageType.startsWith('event_') ? undefined : draftForm.startDate,
        }),
      });

      let imageUrl = null;
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        const upload = await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}/assets`, {
          method: 'POST',
          body: formData,
          isFormData: true,
          headers: {},
        });
        imageUrl = upload.data?.imageUrl || null;
      }

      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 3,
          headline: draftForm.headline,
          body: draftForm.body,
          ctaText: draftForm.ctaText,
          ctaUrl: draftForm.ctaUrl,
          imageUrl,
          creativeBusinessName: draftForm.creativeBusinessName || undefined,
          creativeBusinessCategory: draftForm.creativeBusinessCategory || undefined,
          showDistance: draftForm.showDistance,
        }),
      });

      await hubFetch(apiBase, token, `/api/ads/submissions/${selectedSubmission}`, {
        method: 'PUT',
        body: JSON.stringify({
          step: 5,
          termsVersion: draftForm.termsVersion,
        }),
      });
      setImageFile(null);
      await refreshDashboard();
      return true;
    }, 'Ad details saved.');
  }

  async function loadCampaignDetail(campaignId) {
    await runTask(async () => {
      const response = await hubFetch(apiBase, token, `/api/ads/analytics/campaigns/${campaignId}`);
      setSelectedCampaign(campaignId);
      setCampaignDetail(response.data || null);
      return true;
    });
  }

  async function cancelSubmission(submissionId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${submissionId}/prelaunch-cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshDashboard();
      return true;
    }, 'Draft cancelled before launch.');
  }

  async function deleteDraft(submissionId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/submissions/${submissionId}`, {
        method: 'DELETE',
      });
      if (selectedSubmission === submissionId) setSelectedSubmission(null);
      await refreshDashboard();
      return true;
    }, 'Draft deleted.');
  }

  async function cancelCampaign(campaignId) {
    await runTask(async () => {
      await hubFetch(apiBase, token, `/api/ads/campaigns/${campaignId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshDashboard();
      if (selectedCampaign === campaignId) {
        await loadCampaignDetail(campaignId);
      }
      return true;
    }, 'Campaign cancelled.');
  }

  async function reconcileSubmissionAfterPayment(submissionId) {
    await hubFetch(apiBase, token, `/api/ads/payments/reconcile/${encodeURIComponent(submissionId)}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async function startAdPayment() {
    if (!selectedSubmission) {
      setError('Choose a saved draft first.');
      return;
    }
    if (!publishableKey) {
      setError('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY for this site build.');
      return;
    }
    setPaymentBusy(true);
    setError('');
    setMessage('');
    destroyPaymentUi();
    try {
      const intentResponse = await hubFetch(apiBase, token, '/api/ads/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({
          submissionId: selectedSubmission,
          discountCode: paymentDiscountCode.trim() || undefined,
        }),
      });
      const payload = intentResponse.data || {};

      if (payload.freeCheckout) {
        await hubFetch(apiBase, token, '/api/ads/payments/free-submission', {
          method: 'POST',
          body: JSON.stringify({
            submissionId: selectedSubmission,
            discountCode: paymentDiscountCode.trim(),
          }),
        });
        await reconcileSubmissionAfterPayment(selectedSubmission);
        setMessage('Free checkout completed.');
        await refreshDashboard();
        const detail = await hubFetch(apiBase, token, `/api/ads/submissions/${encodeURIComponent(selectedSubmission)}`);
        setActiveSubmission(detail.data || null);
        return;
      }

      const clientSecret = payload.clientSecret;
      if (!clientSecret) {
        throw new Error('Payment could not be started (no client secret returned).');
      }

      if (!stripeRef.current) {
        stripeRef.current = await loadStripe(publishableKey);
      }
      const stripe = stripeRef.current;
      if (!stripe) {
        throw new Error('Stripe.js failed to initialize.');
      }

      const detail = await hubFetch(apiBase, token, `/api/ads/submissions/${encodeURIComponent(selectedSubmission)}`);
      const submission = detail.data || null;
      setActiveSubmission(submission);
      const mode = submission?.paymentMode === 'setup_intent' ? 'setup' : 'payment';
      const elements = stripe.elements({ clientSecret });
      elementsRef.current = elements;
      const paymentElement = elements.create('payment');
      if (!paymentMountRef.current) {
        throw new Error('Payment container is not available.');
      }
      paymentElement.mount(paymentMountRef.current);

      const returnUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      const confirmResult = mode === 'setup'
        ? await stripe.confirmSetup({ elements, confirmParams: { returnUrl } })
        : await stripe.confirmPayment({ elements, confirmParams: { returnUrl } });

      if (confirmResult.error) {
        throw new Error(confirmResult.error.message || 'Stripe confirmation failed.');
      }

      await reconcileSubmissionAfterPayment(selectedSubmission);
      destroyPaymentUi();
      setMessage('Payment submitted. Your order will finish processing in a few moments.');
      await refreshDashboard();
      const updated = await hubFetch(apiBase, token, `/api/ads/submissions/${encodeURIComponent(selectedSubmission)}`);
      setActiveSubmission(updated.data || null);
    } catch (err) {
      setError(err.message || 'Payment failed.');
    } finally {
      setPaymentBusy(false);
    }
  }

  return (
    <div className={`container hub-page${embedded ? ' hub-page--embedded' : ''}`}>
      {embedded ? (
        <section className="hub-inline-intro">
          <div>
            <p className="hub-eyebrow">Continue here</p>
            <h2>Build and manage your advertising</h2>
            <p className="hub-lead">
              Sign in, save your business details, create an ad, and keep up with campaign updates without leaving this page.
            </p>
          </div>
        </section>
      ) : (
        <section className={`hub-hero${token ? ' hub-hero--signed-in' : ''}`}>
          <div>
            <p className="hub-eyebrow">Advertiser tools</p>
            <h1>{token ? 'Your advertiser dashboard' : 'Advertiser Hub'}</h1>
            <p className="hub-lead">
              {token
                ? 'Manage your business details, draft new ads, request updates, and track campaign performance in one place.'
                : 'Set up your business profile, build an ad, and keep track of campaigns in one place.'}
            </p>
          </div>
          {!token ? (
            <div className="hub-tip-card">
              <h2>What you can do here</h2>
              <ul>
                <li>Tell us about your business</li>
                <li>Choose the kind of ad you want to run</li>
                <li>See how your campaigns are performing</li>
                <li>Send updates for review before they replace a live ad</li>
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {!token ? (
        <HubAuthPanel
          apiBase={apiBase}
          token={token}
          onAuthenticated={handleAuthenticated}
          onSignedOut={handleSignedOut}
          audience="advertiser"
        />
      ) : null}

      {token ? (
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Your dashboard</h2>
              <p>Refresh to load your saved drafts, campaign updates, and any changes waiting on approval.</p>
              <p className="hub-dashboard-account">
                Signed in as <strong>{claims?.email || claims?.user_id || 'your account'}</strong>
              </p>
            </div>
            <div className="hub-actions-inline">
              <button type="button" className="btn btn-teal" disabled={busy} onClick={refreshDashboard}>Refresh</button>
            </div>
          </div>
          {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
          {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
        </section>
      ) : null}

      {!token ? (
        <section className="hub-card">
          <h2>Sign in to get started</h2>
          <p className="hub-muted-copy">
            Once you sign in, you will be able to save your business details, build an ad, and track your campaigns here.
          </p>
        </section>
      ) : (
        <>
      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Business details</h2>
              <p>Start a new draft by telling us about your business.</p>
            </div>
          </div>
          <form className="hub-form-grid" onSubmit={createDraftSubmission}>
            {Object.entries(onboardingForm).map(([key, value]) => (
              key === 'description' || key === 'businessAddress' ? (
                <label className="hub-field hub-field--full" key={key}>
                  <span>{key === 'businessAddress' ? 'Business address' : 'Business description'}</span>
                  <textarea value={value} rows={key === 'description' ? 3 : 2} onChange={(event) => setOnboardingForm((current) => ({ ...current, [key]: event.target.value }))} />
                </label>
              ) : key === 'category' ? (
                <label className="hub-field" key={key}>
                  <span>Category</span>
                  <select value={value} onChange={(event) => setOnboardingForm((current) => ({ ...current, category: event.target.value }))}>
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>{categoryLabels[option] || option}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="hub-field" key={key}>
                  <span>
                    {key === 'contactEmail'
                      ? 'Contact email'
                      : key === 'businessName'
                        ? 'Business name'
                        : key === 'websiteUrl'
                          ? 'Website'
                          : key.charAt(0).toUpperCase() + key.replace(/([A-Z])/g, ' $1').slice(1)}
                  </span>
                  <input value={value} onChange={(event) => setOnboardingForm((current) => ({ ...current, [key]: event.target.value }))} />
                </label>
              )
            ))}
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>Save business details</button>
            </div>
          </form>
          {advertiser ? (
            <div className="hub-summary">
              <div><strong>Current business:</strong> {advertiser.businessName}</div>
              <div><strong>Service area:</strong> {advertiser.regionKey || 'Not set yet'}</div>
              <div><strong>Status:</strong> <span className={`hub-pill hub-pill--${hubAdvertiserPillClass(advertiser.status)}`}>{advertiser.status || 'unknown'}</span></div>
            </div>
          ) : null}
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Ad details</h2>
              <p>Choose a saved draft, then add the ad type, timing, image, and message you want people to see. New and updated creative goes through review before it can appear.</p>
            </div>
          </div>
          <form className="hub-form-grid" onSubmit={saveDraftSteps}>
            <label className="hub-field">
              <span>Saved draft</span>
              <select value={selectedSubmission || ''} onChange={(event) => setSelectedSubmission(event.target.value || null)}>
                <option value="">Choose a draft</option>
                {submissions.map((submission) => (
                  <option key={submission._id} value={submission._id}>
                    {`${formatDateOnly(submission.updatedAt)} - ${submission.status || 'draft'}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>Ad type</span>
              <select value={draftForm.packageType} onChange={(event) => setDraftForm((current) => ({ ...current, packageType: event.target.value }))}>
                {Object.entries(packageLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>How long to run it</span>
              <select value={draftForm.durationMonths} onChange={(event) => setDraftForm((current) => ({ ...current, durationMonths: event.target.value }))}>
                <option value="1">1 month</option>
                <option value="2">2 months</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
              </select>
            </label>
            <label className="hub-field">
              <span>How far away people can see it</span>
              <select value={draftForm.targetingRadiusMiles} onChange={(event) => setDraftForm((current) => ({ ...current, targetingRadiusMiles: event.target.value }))}>
                <option value="20">20 miles</option>
                <option value="30">30 miles</option>
                <option value="40">40 miles</option>
                <option value="50">50 miles</option>
              </select>
            </label>
            <label className="hub-field">
              <span>Start date</span>
              <input type="date" value={draftForm.startDate} onChange={(event) => setDraftForm((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="hub-field hub-field--full">
              <span>Ad title</span>
              <input value={draftForm.headline} onChange={(event) => setDraftForm((current) => ({ ...current, headline: event.target.value }))} />
            </label>
            <label className="hub-field hub-field--full">
              <span>Ad description</span>
              <textarea rows={4} value={draftForm.body} onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Button label</span>
              <input value={draftForm.ctaText} onChange={(event) => setDraftForm((current) => ({ ...current, ctaText: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Button link</span>
              <input value={draftForm.ctaUrl} onChange={(event) => setDraftForm((current) => ({ ...current, ctaUrl: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Business name shown on the ad</span>
              <input value={draftForm.creativeBusinessName} onChange={(event) => setDraftForm((current) => ({ ...current, creativeBusinessName: event.target.value }))} />
            </label>
            <label className="hub-field">
              <span>Business category shown on the ad</span>
              <select value={draftForm.creativeBusinessCategory} onChange={(event) => setDraftForm((current) => ({ ...current, creativeBusinessCategory: event.target.value }))}>
                <option value="">Use the main business category</option>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{categoryLabels[option] || option}</option>
                ))}
              </select>
            </label>
            <label className="hub-field">
              <span>Ad image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
              <small className="hub-field-hint">Portrait images are recommended (4:5 works best).</small>
            </label>
            <label className="hub-checkbox hub-field--full">
              <input type="checkbox" checked={draftForm.showDistance} onChange={(event) => setDraftForm((current) => ({ ...current, showDistance: event.target.checked }))} />
              <span>Show how far away the business is</span>
            </label>
            <div className="hub-field hub-field--full">
              <DraftPreviewCard
                draftForm={draftForm}
                advertiser={advertiser}
                imagePreviewUrl={imagePreviewUrl}
              />
            </div>
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>Save ad details</button>
            </div>
          </form>
          {selectedSubmission ? (
            <div className="hub-detail-card" style={{ marginTop: '16px' }}>
              <h3>Payment and launch</h3>
              <p className="hub-muted-copy">
                After your creative and terms are saved, you can authorize payment here. This uses the same Stripe flow as the mobile app.
              </p>
              {!publishableKey ? (
                <p className="hub-feedback hub-feedback--bad">
                  This website build is missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, so card entry cannot start in the browser.
                </p>
              ) : null}
              {activeSubmission ? (
                <div className="hub-summary">
                  <div><strong>Submission status:</strong> {activeSubmission.status || 'unknown'}</div>
                  <div><strong>Payment status:</strong> {activeSubmission.paymentStatus || 'not started'}</div>
                  <div><strong>Payment mode:</strong> {activeSubmission.paymentMode || 'unknown'}</div>
                  <div>
                    <strong>Quoted total:</strong>{' '}
                    {formatMoney(activeSubmission.totalPriceInCents || activeSubmission.package?.totalPriceInCents || activeSubmission.package?.priceInCents || 0)}
                  </div>
                </div>
              ) : (
                <p className="hub-muted-copy">Loading submission payment state…</p>
              )}
              <label className="hub-field hub-field--full">
                <span>Discount code (optional)</span>
                <input value={paymentDiscountCode} onChange={(event) => setPaymentDiscountCode(event.target.value)} />
              </label>
              <div ref={paymentMountRef} className="hub-field hub-field--full" style={{ minHeight: '10px' }} />
              <div className="hub-actions-inline">
                <button
                  type="button"
                  className="btn btn-teal"
                  disabled={
                    paymentBusy
                    || busy
                    || !publishableKey
                    || !activeSubmission
                    || String(activeSubmission.status || '').toLowerCase() === 'paid'
                    || String(activeSubmission.status || '').toLowerCase() === 'cancelled'
                  }
                  onClick={startAdPayment}
                >
                  {paymentBusy ? 'Processing payment…' : 'Authorize payment'}
                </button>
                <button type="button" className="btn btn-outline hub-btn-dark" disabled={paymentBusy} onClick={destroyPaymentUi}>
                  Clear card form
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Saved drafts</h2>
              <p>Come back to unfinished ads, cancel them before launch, or remove drafts you no longer need.</p>
            </div>
          </div>
          <div className="hub-list">
            {submissions.length === 0 ? <p className="hub-empty">No submissions loaded yet.</p> : submissions.map((submission) => (
              <article key={submission._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{draftCardTitle(submission, advertiser)}</h3>
                    <p>Step {submission.currentStep || 0} - Updated {formatDateTime(submission.updatedAt)}</p>
                    <p className="hub-list-ref-id">ID {String(submission._id)}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${hubAdvertiserPillClass(submission.status)}`}>{submission.status || 'unknown'}</span>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => setSelectedSubmission(submission._id)}>Use this draft</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => cancelSubmission(submission._id)}>Cancel before launch</button>
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => deleteDraft(submission._id)}>Delete draft</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Live and past campaigns</h2>
              <p>See how often your ad was shown, how often people tapped it, and which campaign is selected right now.</p>
            </div>
          </div>
          <div className="hub-list">
            {campaigns.length === 0 ? <p className="hub-empty">No campaigns loaded yet.</p> : campaigns.map((campaign) => {
              const st = String(campaign.status || '').toLowerCase();
              const canCancel = st !== 'cancelled' && st !== 'canceled' && st !== 'completed';
              return (
              <article key={campaign._id} className="hub-list-card">
                <div className="hub-list-head">
                  <div>
                    <h3>{campaign.businessName || campaign.headline || campaign._id}</h3>
                    <p>{campaign.targetedCityLabels?.join(', ') || 'No areas listed'} - {formatDateOnly(campaign.startDateCalendar)} to {formatDateOnly(campaign.endDateCalendar)}</p>
                  </div>
                  <span className={`hub-pill hub-pill--${hubAdvertiserPillClass(campaign.status)}`}>{campaign.status || 'unknown'}</span>
                </div>
                <div className="hub-stats-grid">
                  <div><strong>{campaign.impressions || 0}</strong><span>Times shown</span></div>
                  <div><strong>{campaign.clicks || 0}</strong><span>Taps</span></div>
                  <div><strong>{((campaign.ctr || 0) * 100).toFixed(1)}%</strong><span>Tap rate</span></div>
                </div>
                <div className="hub-actions-inline">
                  <button type="button" className="btn btn-outline hub-btn-dark" onClick={() => loadCampaignDetail(campaign._id)}>View results</button>
                  <button
                    type="button"
                    className="btn btn-outline hub-btn-dark"
                    disabled={!canCancel || busy}
                    title={!canCancel ? 'This campaign is already ended or cancelled.' : undefined}
                    onClick={() => cancelCampaign(campaign._id)}
                  >
                    Cancel campaign
                  </button>
                </div>
              </article>
            );})}
          </div>
          {campaignDetail ? (
            <div className="hub-detail-card">
              <h3>Selected campaign</h3>
              <p><strong>Status:</strong> {campaignDetail.campaign?.status || 'Unknown'}</p>
              <p><strong>Where it appears:</strong> {trackingPlacementLabel(campaignDetail.campaign?.placement)}</p>
              <p><strong>Areas included:</strong> {campaignDetail.campaign?.targetedCityLabels?.join(', ') || 'None'}</p>
              {campaignDetail.campaign?.creativePreview ? (
                <AdPreviewCard
                  title="Current live version"
                  description="This is the version people currently see in the app."
                  placement={campaignDetail.campaign?.placement || 'inline_listing'}
                  isEvent={Boolean(campaignDetail.campaign?.isEvent)}
                  businessName={campaignDetail.campaign?.creativePreview?.businessName}
                  headline={campaignDetail.campaign?.creativePreview?.headline}
                  body={campaignDetail.campaign?.creativePreview?.body}
                  ctaText={campaignDetail.campaign?.creativePreview?.ctaText}
                  imageUrl={campaignDetail.campaign?.creativePreview?.imageUrl}
                  eventName={campaignDetail.campaign?.creativePreview?.eventName}
                  eventDate={campaignDetail.campaign?.creativePreview?.eventDate}
                  eventTime={campaignDetail.campaign?.creativePreview?.eventTime}
                  eventLocation={campaignDetail.campaign?.creativePreview?.eventLocation}
                  isRecurring={Boolean(campaignDetail.campaign?.creativePreview?.isRecurring)}
                />
              ) : null}
              {campaignDetail.campaign?.pendingCreativePreview ? (
                <AdPreviewCard
                  title="Waiting on review"
                  description="These requested changes will not replace the live ad until approval."
                  placement={campaignDetail.campaign?.placement || 'inline_listing'}
                  isEvent={Boolean(campaignDetail.campaign?.isEvent)}
                  businessName={campaignDetail.campaign?.pendingCreativePreview?.businessName}
                  headline={campaignDetail.campaign?.pendingCreativePreview?.headline}
                  body={campaignDetail.campaign?.pendingCreativePreview?.body}
                  ctaText={campaignDetail.campaign?.pendingCreativePreview?.ctaText}
                  imageUrl={campaignDetail.campaign?.pendingCreativePreview?.imageUrl}
                  eventName={campaignDetail.campaign?.pendingCreativePreview?.eventName}
                  eventDate={campaignDetail.campaign?.pendingCreativePreview?.eventDate}
                  eventTime={campaignDetail.campaign?.pendingCreativePreview?.eventTime}
                  eventLocation={campaignDetail.campaign?.pendingCreativePreview?.eventLocation}
                  isRecurring={Boolean(campaignDetail.campaign?.pendingCreativePreview?.isRecurring)}
                  tone="pending"
                />
              ) : null}
              {(() => {
                const a = campaignDetail.analytics || {};
                const imps = a.totals?.impressions ?? a.impressions ?? 0;
                const clks = a.totals?.clicks ?? a.clicks ?? 0;
                const ctr = a.totals?.ctr != null
                  ? a.totals.ctr
                  : (imps > 0 ? clks / imps : 0);
                const reach = a.totals?.uniqueReach ?? a.uniqueReach ?? 0;
                const freq = a.totals?.frequency != null
                  ? a.totals.frequency
                  : a.frequency;
                const daily = a.daily || [];
                return (
                  <>
                    <div className="hub-stats-grid hub-stats-grid--four" style={{ marginTop: 16 }}>
                      <div><strong>{imps.toLocaleString()}</strong><span>Times shown</span></div>
                      <div><strong>{clks.toLocaleString()}</strong><span>Taps</span></div>
                      <div><strong>{(ctr * 100).toFixed(2)}%</strong><span>Tap rate (CTR)</span></div>
                      <div><strong>{reach.toLocaleString()}</strong><span>Est. unique viewers</span></div>
                    </div>
                    {typeof freq === 'number' && freq > 0 && (
                      <p className="hub-analytics-sub" style={{ marginTop: 8 }}>
                        Avg. impressions per viewer (frequency):
                        <strong> {freq.toFixed(2)}</strong>
                      </p>
                    )}

                    <div className="hub-analytics-section">
                      <h4>By placement (screen)</h4>
                      <p className="hub-analytics-sub">
                        Shown and tapped in each inventory slot; map pins and search listings are tracked separately when both apply.
                      </p>
                      {(!a.byPlacement || a.byPlacement.length === 0) ? (
                        <p className="hub-muted-copy">No placement detail yet. Open the app in your regions to accrue data.</p>
                      ) : (
                        <div className="hub-table-wrap">
                          <table className="hub-table">
                            <thead>
                              <tr>
                                <th>Placement</th>
                                <th>Views</th>
                                <th>Taps</th>
                                <th>CTR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.byPlacement.map((r) => (
                                <tr key={r.placement || 'p'}>
                                  <td>{trackingPlacementLabel(r.placement)}</td>
                                  <td>{(r.impressions ?? 0).toLocaleString()}</td>
                                  <td>{(r.clicks ?? 0).toLocaleString()}</td>
                                  <td>{((r.ctr || 0) * 100).toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="hub-analytics-section">
                      <h4>By area (region key)</h4>
                      <p className="hub-analytics-sub">Counts rely on the city/region the app sent when the event was recorded.</p>
                      {(!a.byCity || a.byCity.length === 0) ? (
                        <p className="hub-muted-copy">No regional breakdown yet.</p>
                      ) : (
                        <div className="hub-table-wrap">
                          <table className="hub-table">
                            <thead>
                              <tr>
                                <th>Area</th>
                                <th>Region key</th>
                                <th>Views</th>
                                <th>Taps</th>
                                <th>CTR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.byCity.map((r) => (
                                <tr key={r.cityId || r.label || 'c'}>
                                  <td>{r.label || r.cityId || '—'}</td>
                                  <td style={{ fontSize: 12, color: '#5a7d80' }}>{r.cityId || '—'}</td>
                                  <td>{(r.impressions ?? 0).toLocaleString()}</td>
                                  <td>{(r.clicks ?? 0).toLocaleString()}</td>
                                  <td>{((r.ctr || 0) * 100).toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <DailyImpressionsChart daily={daily} />

                    <div className="hub-analytics-section">
                      <h4>Day-by-day</h4>
                      <p className="hub-analytics-sub">Same daily totals as the mobile campaign screen; export for spreadsheets.</p>
                      <div className="hub-actions-inline" style={{ marginBottom: 10 }}>
                        <button
                          type="button"
                          className="btn btn-outline hub-btn-dark hub-csv-btn"
                          onClick={() => {
                            const title = (selectedCampaign || 'campaign').toString().replace(/[^\w-]+/g, '_');
                            downloadTextFile(`ad-analytics-${title}.csv`, buildAnalyticsCsv(daily));
                          }}
                        >
                          Download CSV
                        </button>
                      </div>
                      <div className="hub-table-wrap">
                        <table className="hub-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Times shown</th>
                              <th>Taps</th>
                              <th>CTR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {daily.length === 0 ? (
                              <tr><td colSpan={4}><span className="hub-muted-copy">No daily rows yet.</span></td></tr>
                            ) : (
                              daily.map((row) => {
                                const ymd = row.date || row.ymd;
                                const dCtr = row.ctr != null
                                  ? row.ctr
                                  : (row.impressions > 0 ? (row.clicks || 0) / row.impressions : 0);
                                return (
                                  <tr key={ymd}>
                                    <td>{ymd}</td>
                                    <td>{(row.impressions || 0).toLocaleString()}</td>
                                    <td>{(row.clicks || 0).toLocaleString()}</td>
                                    <td>{(dCtr * 100).toFixed(2)}%</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
