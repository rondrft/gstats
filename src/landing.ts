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

import { THEME_NAMES, THEMES } from './render/themes'

const REPO_URL = 'https://github.com/rondrft/phosphor-stats'

/** Profile used for the hero card and the theme gallery. */
const DEMO_USER = 'rondrft'

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
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem 5rem;
    background: var(--bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.7;
    /* Same banding as the cards, so the page reads as part of the same object. */
    background-image: repeating-linear-gradient(
      to bottom, rgba(239, 159, 39, 0.04) 0 2px, transparent 2px 4px
    );
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.02em; }
  h2 { font-size: 1rem; margin: 3rem 0 1rem; color: var(--accent); font-weight: 600; }
  p { margin: 0 0 1rem; }
  a { color: var(--accent); }
  .tagline { color: var(--muted); margin-bottom: 2rem; }
  .hero { margin: 0 0 1rem; }
  .hero img { max-width: 100%; height: auto; }
  .badges { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 2rem; }
  .badges img { height: 20px; }

  .generator { display: grid; grid-template-columns: 260px 1fr; gap: 1.5rem; align-items: start; }
  @media (max-width: 720px) { .generator { grid-template-columns: 1fr; } }

  .controls {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem;
    background: var(--panel);
    display: grid;
    gap: .75rem;
  }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: .2rem; }
  input[type=text], select {
    width: 100%;
    padding: .4rem .5rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 13px;
  }
  input[type=color] {
    width: 100%; height: 30px; padding: 0; background: none;
    border: 1px solid var(--border); border-radius: 3px; cursor: pointer;
  }
  .colors { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
  .checks { display: grid; grid-template-columns: repeat(2, 1fr); gap: .25rem .5rem; }
  .checks label { display: flex; align-items: center; gap: .4rem; color: var(--text); margin: 0; }
  input[type=checkbox] { accent-color: var(--accent); }

  /* A grid item defaults to min-width:auto, which lets a long line push the
     column wider than its track instead of scrolling. Every ancestor of the
     scroll container has to opt out before overflow-x can take effect. */
  .preview { display: grid; gap: 1rem; min-width: 0; }
  .preview img { max-width: 100%; height: auto; }
  .snippet { position: relative; min-width: 0; }
  pre {
    margin: 0; padding: .85rem 3.5rem .85rem 1rem; overflow-x: auto; max-width: 100%;
    background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
    font-size: 12px; line-height: 1.6;
  }
  button {
    position: absolute; top: .5rem; right: .5rem;
    background: var(--bg); color: var(--accent);
    border: 1px solid var(--accent); border-radius: 3px;
    padding: .2rem .6rem; font-family: var(--mono); font-size: 11px; cursor: pointer;
  }
  button:hover { background: var(--accent); color: var(--bg); }

  .gallery { display: grid; gap: 1.25rem; }
  .gallery figure { margin: 0; }
  .gallery figcaption { color: var(--muted); font-size: 12px; margin-bottom: .35rem; }
  /* The card's own width varies with the modules shown, so let the intrinsic
     aspect ratio win rather than the width/height hints. */
  .gallery img { max-width: 100%; height: auto; }

  .notice {
    border-left: 2px solid var(--accent);
    padding: .25rem 0 .25rem 1rem;
    color: var(--muted);
  }
  footer { margin-top: 4rem; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>phosphor-stats</h1>
  <p class="tagline">GitHub stats cards for your README. Contributions, streaks and languages, rendered as SVG on the edge.</p>

  <div class="hero">
    <img src="/api?username=${DEMO_USER}" alt="Example stats card">
  </div>

  <div class="badges">
    <a href="${REPO_URL}"><img src="https://img.shields.io/github/stars/rondrft/phosphor-stats?style=flat-square&labelColor=080D08&color=EF9F27" alt="GitHub stars"></a>
    <a href="${REPO_URL}/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-1D9E75?style=flat-square&labelColor=080D08" alt="MIT license"></a>
  </div>

  <p>If it is useful to you, a star helps other people find it — <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>.</p>

  <h2>Build your card</h2>
  <div class="generator">
    <form class="controls" id="controls" onsubmit="return false">
      <div>
        <label for="username">username</label>
        <input type="text" id="username" value="${DEMO_USER}" autocomplete="off" spellcheck="false">
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
        <label>colour overrides</label>
        <div class="colors">
          <input type="color" id="ring" value="#5DCAA5" title="ring">
          <input type="color" id="accent" value="#EF9F27" title="accent">
          <input type="color" id="bg" value="#080D08" title="background">
        </div>
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
      <div>
        <label>options</label>
        <div class="checks">
          <label><input type="checkbox" id="scanlines" checked> scanlines</label>
          <label><input type="checkbox" id="animate" checked> animate</label>
          <label><input type="checkbox" id="credit"> credit</label>
          <label><input type="checkbox" id="bars"> bar style</label>
        </div>
      </div>
      <div>
        <label for="langs_count">languages shown</label>
        <input type="text" id="langs_count" value="4" inputmode="numeric">
      </div>
    </form>

    <div class="preview">
      <img id="preview" src="/api?username=${DEMO_USER}" alt="Live preview">
      <div class="snippet">
        <button id="copy" type="button">copy</button>
        <pre><code id="markdown"></code></pre>
      </div>
    </div>
  </div>

  <h2>Themes</h2>
  <div class="gallery">
${THEME_NAMES.map(
  (name) => `    <figure>
      <figcaption>?theme=${name}</figcaption>
      <img src="/api?username=${DEMO_USER}&amp;theme=${name}" alt="${name} theme" loading="lazy">
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

    if (theme !== 'phosphor') params.push('theme=' + theme);
    if (value('locale') !== 'en') params.push('locale=' + value('locale'));

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
    markdown.textContent =
      '[![' + username + "'s GitHub stats](" + absolute + ')](https://github.com/' + username + ')';
  }

  // Repaint the colour pickers when the theme changes, so an override is always
  // relative to what is actually on screen.
  document.getElementById('theme').addEventListener('change', function () {
    var defaults = THEME_COLORS[this.value];
    ['ring', 'accent', 'bg'].forEach(function (key) {
      document.getElementById(key).value = defaults[key];
    });
    render();
  });

  form.addEventListener('input', render);
  form.addEventListener('change', render);

  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(markdown.textContent).then(function () {
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
