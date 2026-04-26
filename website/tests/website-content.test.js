const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const legalDir = path.join(__dirname, '..', 'content', 'legal');
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function readAppFile(relativePath) {
  return fs.readFileSync(path.join(appDir, relativePath), 'utf8');
}

function readLegalMd(filename) {
  return fs.readFileSync(path.join(legalDir, filename), 'utf8');
}

const legalPagePaths = new Set(['privacy/page.js', 'terms/page.js', 'advertiser-agreement/page.js']);

const routes = [
  { path: 'page.js', name: 'home', requiredText: ['Find Kid-Friendly Play Places Near You', 'Get it on Google Play'] },
  { path: 'advertise/page.js', name: 'advertise', requiredText: ['Reach Local Families', 'Advertising Packages'] },
  { path: 'login/page.js', name: 'login', requiredText: ['Login - Play Spotter', 'AccountWorkspaceClient'] },
  { path: 'account/page.js', name: 'account', requiredText: ['My account - Play Spotter', 'AccountWorkspaceClient'] },
  { path: 'advertiser-hub/page.js', name: 'advertiser hub', requiredText: ['Advertiser Hub', 'AdvertiserHubClient'] },
  { path: 'admin-hub/page.js', name: 'admin hub', requiredText: ['Advertising Admin Hub', 'AdminHubClient'] },
  {
    path: 'advertiser-agreement/page.js',
    name: 'advertiser agreement',
    requiredText: ['LegalDocPage', 'slug="advertiser-agreement"'],
  },
  { path: 'privacy/page.js', name: 'privacy', requiredText: ['LegalDocPage', 'slug="privacy"'] },
  { path: 'terms/page.js', name: 'terms', requiredText: ['LegalDocPage', 'slug="terms"'] },
];

function readWebsiteFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('all public app routes exist and export a page component', () => {
  for (const route of routes) {
    const source = readAppFile(route.path);

    assert.match(source, /export default function [A-Za-z0-9_]+\(/, `${route.name} route should export a default component`);
    for (const text of route.requiredText) {
      assert.ok(source.includes(text), `${route.name} route should include "${text}"`);
    }
  }
});

test('site navigation keeps critical public links reachable', () => {
  const expectedLinks = ['href="/"', 'href="/advertise"', 'href="/privacy"', 'href="/terms"'];
  const navSource = readAppFile('components/SiteNav.js');
  for (const link of expectedLinks) {
    assert.ok(navSource.includes(link), `SiteNav should include navigation link ${link}`);
  }
  assert.ok(navSource.includes('NavSessionLinks'), 'SiteNav should include session-aware navigation links');
  const navSessionLinks = readAppFile('components/NavSessionLinks.js');
  assert.ok(navSessionLinks.includes('href="/account"'), 'session-aware nav should include an account/login link');
  assert.ok(navSessionLinks.includes('href="/admin-hub"'), 'session-aware nav should include an admin hub link');
  const legalShell = readAppFile('components/LegalDocPage.js');
  assert.ok(
    legalShell.includes("from './SiteNav'"),
    'LegalDocPage should import shared SiteNav for legal routes',
  );
  for (const route of routes) {
    const source = readAppFile(route.path);
    if (legalPagePaths.has(route.path)) {
      assert.ok(source.includes('LegalDocPage'), `${route.name} should render through LegalDocPage`);
      continue;
    }
    assert.ok(
      source.includes("from './components/SiteNav'") || source.includes("from '../components/SiteNav'"),
      `${route.name} should import shared SiteNav`,
    );
  }
});

test('metadata is present for search and sharing surfaces', () => {
  const layout = readAppFile('layout.js');

  assert.ok(layout.includes('export const metadata'), 'root layout should export metadata');
  assert.ok(layout.includes('Play Spotter'), 'metadata should include the product name');
  assert.ok(layout.includes('playground finder'), 'metadata should include search keywords');
  assert.ok(layout.includes('<html lang="en">'), 'layout should set the document language');
  assert.ok(layout.includes('name="viewport"'), 'layout should include a viewport meta tag');
  assert.ok(layout.includes('playplace-app-icon.png'), 'layout should reference launcher-aligned PNG favicon');
  assert.ok(!layout.includes('playplace-mark.svg'), 'layout should not reference legacy vector mark');
});

test('conversion and contact paths stay intact', () => {
  const home = readAppFile('page.js');
  const advertise = readAppFile('advertise/page.js');
  const login = readAppFile('login/page.js');
  const advertiserHub = readAppFile('advertiser-hub/page.js');
  const adminHub = readAppFile('admin-hub/page.js');

  assert.ok(home.includes('https://play.google.com/store'), 'home page should link to Google Play');
  assert.ok(home.includes('Coming Soon to iOS'), 'home page should set iOS launch expectations');
  assert.ok(advertise.includes('mailto:playplacefinder@gmail.com'), 'advertise page should include an email CTA');
  assert.ok(advertise.includes('Open advertiser dashboard'), 'advertise page should include the advertiser dashboard entry');
  assert.ok(advertise.includes('Admin Sign In'), 'advertise page footer should include admin sign-in');
  assert.ok(advertise.includes('href="/advertiser-hub"'), 'advertise page should link to the dedicated advertiser hub');
  assert.ok(login.includes('AccountWorkspaceClient'), 'login page should render the account workspace');
  assert.ok(advertiserHub.includes('AdvertiserHubClient'), 'advertiser hub route should render the advertiser client');
  assert.ok(adminHub.includes('AdminHubClient'), 'admin hub route should render the admin client');
  assert.ok(advertise.includes('Prime Placement'), 'advertise page should show Prime Placement package details');
  assert.ok(advertise.includes('Inline Listing'), 'advertise page should show Inline Listing package details');
  assert.ok(advertise.includes('Event Spotlight'), 'advertise page should show Event Spotlight package details');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'playplace-app-icon.png')), 'launcher-aligned PNG should exist for nav / favicon');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'media', 'playground-1.jpg')), 'hero strip image 1 should exist');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'media', 'playground-2.jpg')), 'hero strip image 2 should exist');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'media', 'playground-3.jpg')), 'hero strip image 3 should exist');
});

test('legal pages cover core risk disclosures', () => {
  const privacy = readLegalMd('privacy.md');
  const terms = readLegalMd('terms.md');
  const agreement = readLegalMd('advertiser-agreement.md');

  assert.ok(privacy.includes('We do not sell personal data'), 'privacy policy should disclose no-sale posture');
  assert.ok(privacy.includes('do not knowingly collect personal data from children'), 'privacy policy should address COPPA risk');
  assert.ok(terms.includes('Use of the app is at your own risk'), 'terms should disclose use-at-own-risk');
  assert.ok(terms.includes('paid ads'), 'terms should disclose paid advertising');
  assert.ok(agreement.includes('Payment does not guarantee approval or placement'), 'advertiser agreement should address approval risk');
  assert.ok(
    agreement.includes('once an advertisement has gone live, cancellation does not entitle you to a refund'),
    'advertiser agreement should state no refund after go-live cancellation',
  );
});

test('legal markdown sources exist for each public legal route', () => {
  for (const name of ['privacy.md', 'terms.md', 'advertiser-agreement.md']) {
    const filePath = path.join(legalDir, name);
    assert.ok(fs.existsSync(filePath), `expected ${name} under content/legal`);
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.ok(/^\s*---\r?\n/.test(raw), `${name} should start with YAML frontmatter`);
    assert.ok(/\r?\n---\r?\n/.test(raw), `${name} should close frontmatter before Markdown body`);
  }
});

test('website sources do not contain obvious broken placeholders', () => {
  const brokenMarkers = ['TODO', 'FIXME', 'undefined', 'null"', 'href=""', 'src=""', '<<<<<<<', '>>>>>>>'];

  for (const route of routes) {
    const source = readAppFile(route.path);
    for (const marker of brokenMarkers) {
      assert.ok(!source.includes(marker), `${route.name} route contains broken marker ${marker}`);
    }
  }
});

test('static export config is deploy-ready for host-only static hosting', () => {
  const config = readWebsiteFile('next.config.js');

  assert.ok(config.includes("output: 'export'"), 'Next config should use static export output');
  assert.ok(config.includes('trailingSlash: true'), 'Next config should keep static trailing slashes');
  assert.ok(config.includes('images: { unoptimized: true }'), 'Next config should disable image optimizer for static export');
});

test('global CSS includes responsive and brand-critical styles', () => {
  const css = readAppFile('globals.css');

  for (const token of ['--teal', '--teal-dark', '--launcher-teal', '--brand-blue', '--amber', '.hero', '.howitworks', '.photo-strip', '.home-cta-band', '.packages-grid', '.footer', '.legal-markdown', '.hub-page', '.hub-card', '.hub-pill']) {
    assert.ok(css.includes(token), `global CSS should include ${token}`);
  }
  assert.ok(css.includes('@media (max-width: 768px)'), 'global CSS should include mobile breakpoint');
  assert.ok(css.includes('box-sizing: border-box'), 'global CSS should set predictable box sizing');
});

test('advertising page keeps every paid package and FAQ represented', () => {
  const advertise = readAppFile('advertise/page.js');
  const packages = ['Prime Placement', 'Inline Listing', 'Event Spotlight'];
  const faqs = ['How does targeting work?', 'Can I cancel my campaign?', 'What content is allowed?', 'Can I edit my ad after it goes live?', 'How do I track performance?'];

  for (const packageName of packages) {
    assert.ok(advertise.includes(packageName), `advertising page should include package ${packageName}`);
  }
  for (const faq of faqs) {
    assert.ok(advertise.includes(faq), `advertising page should include FAQ "${faq}"`);
  }
});

for (const { name, fn } of tests) {
  fn();
  console.log(`ok - ${name}`);
}

console.log(`${tests.length} website content tests passed.`);
