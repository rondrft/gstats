/**
 * Landing page.
 *
 * A single self-contained document: no build step, no framework, no external
 * scripts. It is served by the same Worker that renders the cards, so shipping a
 * bundler alongside it would double the project's moving parts to save nothing.
 *
 * The generator is the point of the page. Reading a parameter table and guessing
 * is a worse experience than turning a knob and watching the card change, and
 * the snippet it produces is the artefact people actually came for.
 *
 * The embedded script is written without template literals because the whole
 * document is itself a template literal; string concatenation keeps the two
 * layers from interfering.
 */

import { DEFAULTS } from './params'
import { CARD_IDS, DEFAULT_CARD, LANGS_CEILING, MAX_LANGUAGES } from './render/cards/registry'
import { THEME_NAMES, THEMES } from './render/themes'
import { SERVICE_NAME } from './service'

const REPO_URL = 'https://github.com/rondrft/gstats'

/**
 * One title and one description, used by the `<title>`, the meta description
 * and both sets of sharing tags. They were going to drift the first time one of
 * them was reworded.
 */
const PAGE_TITLE = `${SERVICE_NAME} — GitHub stats cards for your README`
const PAGE_DESCRIPTION =
  'Generate an SVG GitHub stats card for any username. Contributions, streaks and languages, rendered on the edge.'

/**
 * The sharing image, served by GitHub rather than by this Worker.
 *
 * It is 69 KB of already-compressed PNG — over half the entire bundle — to be
 * fetched a handful of times ever, by scrapers rather than by readers. Bundling
 * it to save a cross-origin hop would be the wrong way round. The same file is
 * what gets uploaded by hand as the repository's social preview, so there is
 * one image and one copy of it.
 */
const SOCIAL_PREVIEW_URL = `${REPO_URL.replace('github.com', 'raw.githubusercontent.com')}/main/assets/brand/social-preview.png`

/** Profile used for the hero card and the theme gallery. */
const DEMO_USER = 'rondrft'

/**
 * The designs that draw fewer languages than the parameter accepts, named.
 *
 * Derived rather than written out, so a design added with a lower ceiling — or
 * one whose ceiling changes — cannot leave a wrong sentence behind in the table.
 * This is the long form of what the control's one-line hint says about whichever
 * design is selected; the table is where the detail belongs, because it has the
 * width for it and the control does not.
 */
function lowerCeilings(): string {
  const fewer = CARD_IDS.filter((id) => MAX_LANGUAGES[id] > 0 && MAX_LANGUAGES[id] < LANGS_CEILING)
  const none = CARD_IDS.filter((id) => MAX_LANGUAGES[id] === 0)

  return [
    ...fewer.map((id) => `${id} ${MAX_LANGUAGES[id]}`),
    ...none.map((id) => `${id} none`),
  ].join(', ')
}

/**
 * Every parameter `/api` accepts, with its default.
 *
 * It was seven of them once, with the descriptions cut short, chosen so the
 * panel finished level with the taller control column beside it. That is
 * choosing the layout over the content: somebody looking for `lang_mode` found
 * a table that did not mention it and no indication that it existed. The
 * columns are uneven now, which is the correct thing for them to be — and it is
 * why the detail a control cannot caption in one line lives here.
 */
const REFERENCE: [name: string, values: string, fallback: string][] = [
  ['username', 'a GitHub login', 'required'],
  ['card', 'terminal, heatmap, pass, press, gauge, vinyl', 'terminal'],
  ['theme', 'phosphor, amber, ice, mono, light', 'phosphor'],
  ['ring', 'hex — the contribution and record rings', 'theme'],
  ['accent', 'hex — the streak ring and its icon', 'theme'],
  ['bg', 'hex, or transparent', 'theme'],
  ['text', 'hex — the numbers and language rows', 'theme'],
  ['muted', 'hex — the labels', 'theme'],
  ['border', 'hex, or none to hide the frame', 'theme'],
  ['radius', 'corner radius, 0 to 24', '6'],
  ['hide', 'total, streak, best, langs — comma separated', 'nothing hidden'],
  [
    'langs_count',
    `at most this many, 1 to ${LANGS_CEILING}. Some designs draw fewer (${lowerCeilings()}), and so does a profile whose remaining languages are under 0.5% or on the by-product list — <code>include_langs</code> brings those back`,
    String(DEFAULTS.langsCount),
  ],
  ['lang_mode', 'bytes, or repos to count what each language leads', 'bytes'],
  ['exclude_langs', 'languages to drop, comma separated', 'none'],
  ['include_langs', 'bring back HTML, CSS, Shell and the rest', 'none'],
  ['lang_style', 'blocks or bars', 'blocks'],
  ['scanlines', 'CRT banding over the background', 'true'],
  ['animate', 'draw-on animation', 'true'],
  ['locale', 'label language: en or es', 'en'],
  ['tz', 'IANA zone the streak day ends in', 'Anywhere on Earth'],
  ['show_credit', 'a small project credit on the card', 'false'],
  ['cache_seconds', 'how long a client may reuse the card, 1800 to 86400', 'instance default'],
]

export function landingPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE_TITLE}</title>
<meta name="description" content="${PAGE_DESCRIPTION}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/favicon-180.png">
<!-- Without these a shared link is a blank rectangle, which reads as a dead
     link rather than as a page nobody wrote tags for. The image is absolute
     because every scraper requires it to be, and og:url is built from the
     origin the request arrived on so that a self-hosted instance advertises
     itself rather than this one. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SERVICE_NAME}">
<meta property="og:title" content="${PAGE_TITLE}">
<meta property="og:description" content="${PAGE_DESCRIPTION}">
<meta property="og:url" content="${origin}/">
<meta property="og:image" content="${SOCIAL_PREVIEW_URL}">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="${SERVICE_NAME} — GitHub stats cards rendered as SVG">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${PAGE_TITLE}">
<meta name="twitter:description" content="${PAGE_DESCRIPTION}">
<meta name="twitter:image" content="${SOCIAL_PREVIEW_URL}">
<style>
  :root {
    --bg: #080D08;
    --panel: #0C140F;
    --border: #1D9E75;
    --text: #9FE1CB;
    --muted: #1D9E75;
    --accent: #EF9F27;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;

    /* Two spacing values and no others. One separates things that belong to the
       same section, the other separates sections. Anything in between reads as
       an accident and stops the eye from telling where one thing ends. */
    --gap: 0.75rem;
    --section: 3rem;

    --radius: 6px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem 5rem;
    background: var(--bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.65;
    /* Same banding as the cards, so the page reads as part of the same object. */
    background-image: repeating-linear-gradient(
      to bottom, rgba(239, 159, 39, 0.04) 0 2px, transparent 2px 4px
    );
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0; letter-spacing: -.02em; }
  h2 {
    font-size: 1rem; margin: var(--section) 0 var(--gap);
    color: var(--accent); font-weight: 600;
  }
  p { margin: 0 0 var(--gap); }
  p:last-child { margin-bottom: 0; }
  a { color: var(--accent); }
  code { color: var(--text); }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }

  /* One panel, used everywhere something is a container: the hero card, the
     control column, the preview, the snippet, the reference table and every
     gallery cell. Before this the controls had a border and the preview did
     not, which is most of why the top of the page felt unmoored. */
  .panel {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    padding: var(--gap);
  }

  .hero { display: grid; gap: var(--gap); }
  .hero-head { display: flex; align-items: center; gap: var(--gap); flex-wrap: wrap; }
  /* Beside the title rather than above it, and small enough to read as a mark
     rather than as an illustration. The file is already rounded, so it needs no
     radius here; it must not shrink when the badges wrap. */
  .hero-head .mark { width: 32px; height: 32px; display: block; flex: 0 0 auto; }
  .hero-card { display: flex; justify-content: center; }
  .hero-card img { max-width: 100%; height: auto; }
  .badges { display: flex; gap: .4rem; flex-wrap: wrap; }
  .badges img { height: 20px; display: block; }

  .generator {
    display: grid; grid-template-columns: 320px 1fr;
    gap: var(--gap); align-items: start; margin-top: var(--gap);
  }
  @media (max-width: 760px) { .generator { grid-template-columns: 1fr; } }

  /* The fields are narrow; one per row wasted the panel's width and made the
     column twice as tall as the one beside it. */
  .controls { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
  .controls .wide { grid-column: 1 / -1; }
  label { display: block; font-size: 11px; color: var(--muted); margin-bottom: .2rem; }
  input[type=text], select {
    width: 100%;
    padding: .35rem .45rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 13px;
  }

  /* Under a control, in the label's own voice: it is saying what the control
     cannot promise, not adding a second thing to read. */
  .hint { font-size: 10px; color: var(--muted); margin: .25rem 0 0; line-height: 1.4; }

  .colors { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; }
  .colors label { text-align: center; margin: .25rem 0 0; font-size: 10px; }
  input[type=color] {
    width: 100%; height: 26px; padding: 0; background: none;
    border: 1px solid var(--border); border-radius: 3px; cursor: pointer; display: block;
  }
  .colors-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }

  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem .5rem; }
  .checks label { display: flex; align-items: center; gap: .35rem; color: var(--text); margin: 0; font-size: 12px; }
  input[type=checkbox] { accent-color: var(--accent); margin: 0; }

  .preview { display: grid; gap: var(--gap); min-width: 0; }
  .preview-card { display: flex; justify-content: center; }
  .preview-card img { max-width: 100%; height: auto; }

  .snippet { min-width: 0; padding: 0; }
  /* The copy button shared the top right corner with the text until the format
     toggle needed somewhere to live. A row above the box holds both, which also
     means the textarea no longer has to reserve a corner. */
  .snippet-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: .4rem; padding: .5rem .5rem 0;
  }
  .formats { display: flex; gap: .4rem; }
  .formats button.on { color: var(--bg); background: var(--accent); }
  /* Lines that wrap. The URL is long, and horizontal scrolling inside a box you
     are meant to copy out of is the worst of both. */
  textarea {
    display: block; width: 100%; resize: vertical;
    padding: .5rem .8rem .7rem;
    background: transparent; color: var(--text);
    border: 0; border-radius: var(--radius);
    font-family: var(--mono); font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-all;
  }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

  button {
    background: var(--bg); color: var(--accent);
    border: 1px solid var(--accent); border-radius: 3px;
    padding: .2rem .6rem; font-family: var(--mono); font-size: 11px; cursor: pointer;
  }
  button:hover { background: var(--accent); color: var(--bg); }

  .reference { padding: 0; overflow: hidden; }
  .reference table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .reference caption {
    text-align: left; color: var(--muted); font-size: 11px;
    padding: .5rem .8rem; border-bottom: 1px solid var(--border);
  }
  .reference th, .reference td { text-align: left; padding: .28rem .8rem; vertical-align: top; }
  .reference th { color: var(--accent); font-weight: 400; white-space: nowrap; }
  .reference td { color: var(--muted); }
  /* The default is the answer to "what happens if I leave this out", which is
     worth a column of its own rather than a parenthesis inside the description. */
  .reference td.default { text-align: right; white-space: nowrap; opacity: .75; }
  .reference tr + tr th, .reference tr + tr td { border-top: 1px solid rgba(29, 158, 117, .18); }

  .designs { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: var(--gap); }
  .designs button { color: var(--muted); border-color: var(--muted); padding: .3rem .8rem; }
  .designs button.on { color: var(--bg); background: var(--accent); border-color: var(--accent); }

  /* Two columns of themes, so the six previews of one design read as a set
     rather than as a list. */
  .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); }
  @media (max-width: 760px) { .gallery { grid-template-columns: 1fr; } }
  .gallery figure { margin: 0; min-width: 0; }
  .gallery figcaption {
    display: flex; align-items: center; justify-content: space-between; gap: .5rem;
    color: var(--muted); font-size: 12px; margin-bottom: .5rem;
  }
  .gallery figcaption button { padding: .1rem .5rem; }
  /* The card's own width varies with the design and the modules shown, so let
     the intrinsic aspect ratio win rather than any width hint. */
  .gallery-card { display: flex; justify-content: center; }
  .gallery img { max-width: 100%; height: auto; display: block; }

  .notice { border-left: 2px solid var(--accent); padding-left: 1rem; color: var(--muted); }
  footer { margin-top: var(--section); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <div class="hero">
    <div class="hero-head">
      <!-- Served by the Worker rather than inlined: the file carries gradient
           ids, and inlining would put them in the same document as the page. -->
      <img class="mark" src="/logo.svg" width="32" height="32" alt="" aria-hidden="true">
      <h1>${SERVICE_NAME}</h1>
      <div class="badges">
        <a href="${REPO_URL}"><img src="https://img.shields.io/github/stars/rondrft/gstats?style=flat-square&labelColor=080D08&color=EF9F27" alt="GitHub stars"></a>
        <a href="${REPO_URL}/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-1D9E75?style=flat-square&labelColor=080D08" alt="MIT license"></a>
      </div>
    </div>
    <p class="muted">GitHub stats cards for your README. Contributions, streaks and languages, rendered as SVG on the edge.</p>
    <div class="panel hero-card">
      <img src="/api?username=${DEMO_USER}" alt="Example stats card">
    </div>
    <p class="small muted">If it is useful to you, a star helps other people find it — <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>.</p>
  </div>

  <h2>Build your card</h2>
  <div class="generator">
    <form class="panel controls" id="controls" onsubmit="return false">
      <div class="wide">
        <label for="username">username</label>
        <input type="text" id="username" value="${DEMO_USER}" autocomplete="off" spellcheck="false">
      </div>
      <div>
        <label for="card">design</label>
        <select id="card">
${CARD_IDS.map((id) => `          <option value="${id}">${id}</option>`).join('\n')}
        </select>
      </div>
      <div>
        <label for="theme">theme</label>
        <select id="theme">
${THEME_NAMES.map((name) => `          <option value="${name}">${name}</option>`).join('\n')}
        </select>
      </div>
      <div>
        <label for="locale">locale</label>
        <select id="locale">
          <option value="en">en</option>
          <option value="es">es</option>
        </select>
      </div>
      <div>
        <label for="lang_mode">language mode</label>
        <select id="lang_mode">
          <option value="bytes">bytes</option>
          <option value="repos">repos</option>
        </select>
      </div>
      <!-- A dropdown rather than a text field, because every value it can offer
           is one the service will honour. The free field accepted anything and
           the service clamped the rest in silence, which is part of why a card
           drawing three languages for langs_count=6 read as a bug rather than
           as a design's ceiling. -->
      <div>
        <label for="langs_count">languages shown</label>
        <select id="langs_count">
${Array.from(
  { length: LANGS_CEILING },
  (_, index) =>
    `          <option value="${index + 1}"${index + 1 === DEFAULTS.langsCount ? ' selected' : ''}>${index + 1}</option>`,
).join('\n')}
        </select>
        <!-- Written out for the default design rather than left to the script:
             an empty caption that fills in on first render is a line of the
             column appearing after the page has settled. -->
        <p class="hint" id="langs_hint">at most ${MAX_LANGUAGES[DEFAULT_CARD]} here</p>
      </div>
      <div>
        <label>modules</label>
        <div class="checks">
          <label><input type="checkbox" data-module="total" checked> total</label>
          <label><input type="checkbox" data-module="streak" checked> streak</label>
          <label><input type="checkbox" data-module="best" checked> best</label>
          <label><input type="checkbox" data-module="langs" checked> langs</label>
        </div>
      </div>
      <div class="wide">
        <label>options</label>
        <div class="checks">
          <label><input type="checkbox" id="scanlines" checked> scanlines</label>
          <label><input type="checkbox" id="animate" checked> animate</label>
          <label><input type="checkbox" id="credit"> credit</label>
          <label><input type="checkbox" id="bars"> bar style</label>
        </div>
      </div>
      <div class="wide">
        <div class="colors-head">
          <label>colour overrides</label>
          <button type="button" id="reset-colors">reset to theme</button>
        </div>
        <div class="colors">
          <div><input type="color" id="ring" value="#5DCAA5"><label for="ring">ring</label></div>
          <div><input type="color" id="accent" value="#EF9F27"><label for="accent">accent</label></div>
          <div><input type="color" id="bg" value="#080D08"><label for="bg">background</label></div>
        </div>
      </div>
    </form>

    <div class="preview">
      <div class="panel preview-card">
        <img id="preview" src="/api?username=${DEMO_USER}" alt="Live preview">
      </div>
      <div class="panel snippet">
        <div class="snippet-bar">
          <!-- HTML first because it is the one that gives the card a link. The
               plain markdown form is one click away for anybody who wants the
               image and nothing around it. -->
          <div class="formats" id="formats">
            <button type="button" data-format="html" class="on">html</button>
            <button type="button" data-format="markdown">markdown</button>
          </div>
          <button id="copy" type="button">copy</button>
        </div>
        <textarea id="snippet" rows="3" readonly spellcheck="false"></textarea>
      </div>
      <div class="panel reference">
        <table>
          <caption>Every parameter. Anything invalid falls back to its default.</caption>
          <tbody>
${REFERENCE.map(
  ([name, values, fallback]) =>
    `            <tr><th><code>${name}</code></th><td>${values}</td><td class="default">${fallback}</td></tr>`,
).join('\n')}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <h2>Designs and themes</h2>
  <p class="tagline">
    Two independent axes. Pick a design and every theme below redraws in it; each
    cell loads the pairing into the generator above.
  </p>
  <div class="designs" id="designs">
${CARD_IDS.map(
  (id, index) =>
    `    <button type="button" data-card="${id}"${index === 0 ? ' class="on"' : ''}>${id}</button>`,
).join('\n')}
  </div>
  <div class="gallery" id="gallery">
${THEME_NAMES.map(
  (name) => `    <figure>
      <figcaption><code>?theme=${name}</code><button type="button" data-theme="${name}">use</button></figcaption>
      <div class="panel gallery-card">
        <img data-theme-preview="${name}" src="/api?username=${DEMO_USER}&amp;theme=${name}" alt="${name} theme" loading="lazy">
      </div>
    </figure>`,
).join('\n')}
  </div>

  <h2>Before you embed this</h2>
  <p class="notice">
    This instance is best effort. It runs on one GitHub token with a shared budget of
    5,000 requests per hour, and it is not on call for anyone. If your README matters to
    you, deploy your own — it takes about five minutes and gives you your own budget.
    <a href="${REPO_URL}/blob/main/docs/self-hosting.md">Self-hosting guide</a>.
  </p>

  <footer>
    MIT licensed. Icons from <a href="https://tabler.io/icons">Tabler Icons</a> (MIT).
    <a href="${REPO_URL}">Source</a>.
  </footer>
</main>

<script>
(function () {
  var origin = ${JSON.stringify(origin)};
  var repo = ${JSON.stringify(REPO_URL)};
  var form = document.getElementById('controls');
  var preview = document.getElementById('preview');
  var snippet = document.getElementById('snippet');
  var formats = document.getElementById('formats');
  var copy = document.getElementById('copy');
  var langsCount = document.getElementById('langs_count');
  var langsHint = document.getElementById('langs_hint');

  // Which of the two forms the box is showing. HTML is the default because it is
  // the one that carries a link; markdown is the same card with nothing round it.
  var format = 'html';

  // Defaults are omitted from the generated URL: a snippet full of redundant
  // parameters is harder to read and harder to hand-edit later.
  var THEME_COLORS = ${JSON.stringify(themeColorDefaults())};

  // What each design will actually draw. Three of them stop below the eight the
  // parameter accepts, and until this was here the only way to find that out was
  // to ask for six and count three.
  var LANG_CEILINGS = ${JSON.stringify(MAX_LANGUAGES)};
  var LANGS_DEFAULT = ${DEFAULTS.langsCount};

  function value(id) { return document.getElementById(id).value; }
  function checked(id) { return document.getElementById(id).checked; }

  /**
   * Narrows the count to what the chosen design draws, and says so underneath.
   *
   * The hint is one line, and shorter than the control it belongs to. It said
   * both of the reasons a card lists fewer languages and ran to seven lines in
   * a column this narrow — taller than the select, and enough to push the whole
   * left column out of step with the preview beside it. **Inline help in a form
   * has to be shorter than the field it explains**, or it stops being a caption
   * and becomes something to read instead. The other reason, and every detail
   * of this one, is in the parameter table, which has the width for it.
   *
   * What is left here is the half the control cannot express on its own: the
   * options stop at the design's ceiling, and this says what that ceiling is
   * rather than leaving the reader to count the entries in a closed dropdown.
   */
  function syncLangs() {
    var ceiling = LANG_CEILINGS[value('card')];
    var options = langsCount.querySelectorAll('option');
    for (var index = 0; index < options.length; index++) {
      // Both, because hiding an option is not honoured everywhere; disabling it
      // is, so an unreachable value is unreachable even where it still shows.
      var beyond = Number(options[index].value) > ceiling;
      options[index].hidden = beyond;
      options[index].disabled = beyond;
    }

    langsCount.disabled = ceiling === 0;
    if (ceiling > 0 && Number(langsCount.value) > ceiling) langsCount.value = String(ceiling);

    langsHint.textContent = ceiling === 0 ? 'none on this design' : 'at most ' + ceiling + ' here';
  }

  function build() {
    var username = value('username').trim() || '${DEMO_USER}';
    var theme = value('theme');
    var params = ['username=' + encodeURIComponent(username)];

    if (value('card') !== 'terminal') params.push('card=' + value('card'));
    if (theme !== 'phosphor') params.push('theme=' + theme);
    if (value('locale') !== 'en') params.push('locale=' + value('locale'));
    if (value('lang_mode') !== 'bytes') params.push('lang_mode=' + value('lang_mode'));

    var defaults = THEME_COLORS[theme];
    ['ring', 'accent', 'bg'].forEach(function (key) {
      var picked = value(key).toLowerCase();
      if (picked !== defaults[key].toLowerCase()) {
        params.push(key + '=' + picked.replace('#', ''));
      }
    });

    var hidden = [];
    form.querySelectorAll('[data-module]').forEach(function (box) {
      if (!box.checked) hidden.push(box.getAttribute('data-module'));
    });
    if (hidden.length) params.push('hide=' + hidden.join(','));

    if (!checked('scanlines')) params.push('scanlines=false');
    if (!checked('animate')) params.push('animate=false');
    if (checked('credit')) params.push('show_credit=true');
    if (checked('bars')) params.push('lang_style=bars');

    // Omitted when it is what this design would do anyway — which on a design
    // whose ceiling is below the default is the ceiling, not the default.
    var ceiling = LANG_CEILINGS[value('card')];
    var count = parseInt(value('langs_count'), 10);
    if (ceiling > 0 && count >= 1 && count <= ceiling && count !== Math.min(LANGS_DEFAULT, ceiling)) {
      params.push('langs_count=' + count);
    }

    return '/api?' + params.join('&');
  }

  /**
   * Nothing here is written into this page — the snippet is text in a textarea —
   * but the username is whatever somebody typed, and it lands inside an HTML
   * attribute in what they are about to paste into their own README. A stray
   * quote there would hand them a broken snippet.
   */
  function attribute(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function snippetFor(url, username) {
    var alt = username + "'s GitHub stats";
    if (format === 'markdown') return '![' + alt + '](' + url + ')';

    // The ampersands between parameters have to be escaped for the attribute to
    // be valid HTML; GitHub decodes them before it fetches the card, so the two
    // forms render the same image.
    return (
      '<a href="' + repo + '"><img alt="' + attribute(alt) + '" src="' + attribute(url) + '" /></a>'
    );
  }

  /**
   * How long the username field has to be quiet before the preview refetches.
   *
   * Repainting the preview is a card request, and an 'input' event fires on every
   * keystroke — so typing a login used to fetch a card for every prefix of it.
   * That is not a rounding error: most prefixes of a real login are themselves
   * real logins, so each one became a cache entry, three to five GitHub queries
   * and a KV write, on the scarcest resource this service has, for a profile
   * nobody had asked for. The prefixes that are not real accounts were upstream
   * 404s instead — cheaper, and still spending a shared quota on nothing.
   *
   * Long enough to sit through ordinary typing, short enough that the preview
   * still feels attached to the controls.
   */
  var PREVIEW_DEBOUNCE_MS = 500;
  var previewTimer = null;
  var previewSrc = null;

  function repaintPreview(path) {
    // The colour pickers fire 'input' continuously while being dragged, and
    // colours are not in the cache key — every step of a drag was a request for
    // a card the service had already drawn. Nothing is refetched for a URL that
    // is already on screen.
    if (path === previewSrc) return;
    previewSrc = path;
    preview.src = path;
  }

  /**
   * The snippet is text and costs nothing, so it stays instant. Only the
   * preview waits, which is the only part of this that is a request.
   */
  function render() {
    // Before the URL is built, so a design change that lowers the ceiling is
    // reflected in the snippet on the same pass rather than one behind.
    syncLangs();

    var path = build();
    var username = value('username').trim() || '${DEMO_USER}';
    snippet.value = snippetFor(origin + path, username);

    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      previewTimer = null;
      repaintPreview(path);
    }, PREVIEW_DEBOUNCE_MS);
  }

  // Repaint the colour pickers from the theme, so an override is always
  // relative to what is actually on screen — and so "reset to theme" has
  // something to reset to.
  function adoptThemeColors() {
    var defaults = THEME_COLORS[value('theme')];
    ['ring', 'accent', 'bg'].forEach(function (key) {
      document.getElementById(key).value = defaults[key];
    });
  }

  document.getElementById('theme').addEventListener('change', function () {
    adoptThemeColors();
    render();
  });

  document.getElementById('reset-colors').addEventListener('click', function () {
    adoptThemeColors();
    render();
  });

  form.addEventListener('input', render);
  form.addEventListener('change', render);

  // The gallery has two axes and cannot be a flat grid of every pairing: six
  // themes times six designs is thirty-six cards nobody scrolls through. One
  // design is selected at a time and the six themes redraw underneath it.
  var gallery = document.getElementById('gallery');
  var designs = document.getElementById('designs');
  var galleryCard = '${DEFAULT_CARD}';

  function repaintGallery() {
    gallery.querySelectorAll('[data-theme-preview]').forEach(function (img) {
      var theme = img.getAttribute('data-theme-preview');
      var query = 'username=' + encodeURIComponent(value('username').trim() || '${DEMO_USER}');
      if (galleryCard !== 'terminal') query += '&card=' + galleryCard;
      if (theme !== 'phosphor') query += '&theme=' + theme;
      img.src = '/api?' + query;
    });
  }

  designs.addEventListener('click', function (event) {
    var button = event.target.closest('[data-card]');
    if (!button) return;
    galleryCard = button.getAttribute('data-card');
    designs.querySelectorAll('button').forEach(function (other) {
      other.classList.toggle('on', other === button);
    });
    repaintGallery();
  });

  // Each cell loads its own pairing into the generator, which is the point of
  // showing it: the gallery is a picker, not a poster.
  gallery.addEventListener('click', function (event) {
    var button = event.target.closest('[data-theme]');
    if (!button) return;
    document.getElementById('card').value = galleryCard;
    document.getElementById('theme').value = button.getAttribute('data-theme');
    document.getElementById('theme').dispatchEvent(new Event('change'));
    document.getElementById('controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.getElementById('username').addEventListener('change', repaintGallery);

  formats.addEventListener('click', function (event) {
    var button = event.target.closest('[data-format]');
    if (!button) return;
    format = button.getAttribute('data-format');
    formats.querySelectorAll('button').forEach(function (other) {
      other.classList.toggle('on', other === button);
    });
    render();
  });

  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(snippet.value).then(function () {
      copy.textContent = 'copied';
      setTimeout(function () { copy.textContent = 'copy'; }, 1400);
    });
  });

  render();
})();
</script>
</body>
</html>`
}

/**
 * The subset of each theme the colour pickers can override, shipped to the page
 * so it can tell a deliberate override from a value that merely matches.
 */
function themeColorDefaults(): Record<string, { ring: string; accent: string; bg: string }> {
  const defaults: Record<string, { ring: string; accent: string; bg: string }> = {}
  for (const name of THEME_NAMES) {
    const theme = THEMES[name]
    if (theme === undefined) continue
    defaults[name] = { ring: theme.ring, accent: theme.accent, bg: theme.bg }
  }
  return defaults
}
