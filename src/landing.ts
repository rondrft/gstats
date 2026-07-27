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

import { CARD_IDS, DEFAULT_CARD } from './render/cards/registry'
import { THEME_NAMES, THEMES } from './render/themes'

const REPO_URL = 'https://github.com/rondrft/phosphor-stats'

/** Profile used for the hero card and the theme gallery. */
const DEMO_USER = 'rondrft'

/**
 * The parameters worth knowing about without leaving the page, in the order
 * somebody reaches for them. It fills the space beside the taller control
 * column and saves a trip to the README for the common cases; the exhaustive
 * table stays in the README, where it can afford the room.
 */
const REFERENCE: [string, string][] = [
  ['hide', 'total, streak, best, langs'],
  ['exclude_langs', 'drop languages, comma separated'],
  ['include_langs', 'bring back HTML, CSS, Shell'],
  ['lang_style', 'blocks or bars'],
  ['text / muted / border', 'hex, or none for the border'],
  ['radius', 'corner radius, 0 to 24'],
  ['cache_seconds', '1800 to 86400'],
]

export function landingPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>phosphor-stats — GitHub stats cards for your README</title>
<meta name="description" content="Generate an SVG GitHub stats card for any username. Contributions, streaks and languages, rendered on the edge.">
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

  .snippet { position: relative; min-width: 0; padding: 0; }
  /* Two lines that wrap. The URL is long, and horizontal scrolling inside a box
     you are meant to copy out of is the worst of both. */
  textarea {
    display: block; width: 100%; resize: vertical;
    /* Clear of the copy button, which floats over the top right corner. */
    padding: .7rem 4.5rem .7rem .8rem;
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
  .snippet button { position: absolute; top: .5rem; right: .5rem; }

  .reference { padding: 0; overflow: hidden; }
  .reference table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .reference caption {
    text-align: left; color: var(--muted); font-size: 11px;
    padding: .5rem .8rem; border-bottom: 1px solid var(--border);
  }
  .reference th, .reference td { text-align: left; padding: .28rem .8rem; vertical-align: top; }
  .reference th { color: var(--accent); font-weight: 400; white-space: nowrap; }
  .reference td { color: var(--muted); }
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
      <h1>phosphor-stats</h1>
      <div class="badges">
        <a href="${REPO_URL}"><img src="https://img.shields.io/github/stars/rondrft/phosphor-stats?style=flat-square&labelColor=080D08&color=EF9F27" alt="GitHub stars"></a>
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
      <div>
        <label for="langs_count">languages shown</label>
        <input type="text" id="langs_count" value="4" inputmode="numeric">
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
        <button id="copy" type="button">copy</button>
        <textarea id="markdown" rows="2" readonly spellcheck="false"></textarea>
      </div>
      <div class="panel reference">
        <table>
          <caption>Everything else is a query parameter. Full table in the README.</caption>
          <tbody>
${REFERENCE.map(
  ([name, description]) =>
    `            <tr><th><code>${name}</code></th><td>${description}</td></tr>`,
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
  var form = document.getElementById('controls');
  var preview = document.getElementById('preview');
  var markdown = document.getElementById('markdown');
  var copy = document.getElementById('copy');

  // Defaults are omitted from the generated URL: a snippet full of redundant
  // parameters is harder to read and harder to hand-edit later.
  var THEME_COLORS = ${JSON.stringify(themeColorDefaults())};

  function value(id) { return document.getElementById(id).value; }
  function checked(id) { return document.getElementById(id).checked; }

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

    var count = parseInt(value('langs_count'), 10);
    if (count >= 1 && count <= 8 && count !== 4) params.push('langs_count=' + count);

    return '/api?' + params.join('&');
  }

  function render() {
    var path = build();
    preview.src = path;
    var absolute = origin + path;
    var username = value('username').trim() || '${DEMO_USER}';
    markdown.value =
      '[![' + username + "'s GitHub stats](" + absolute + ')](https://github.com/' + username + ')';
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

  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(markdown.value).then(function () {
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
