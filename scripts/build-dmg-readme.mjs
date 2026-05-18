// Generates the README files (HTML + PDF) bundled in the macOS DMG.
// HTML is self-contained (logo embedded as base64). PDF is rendered from
// the HTML via headless Google Chrome — no extra dev dependency required.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICON_PATH = path.join(PROJECT_ROOT, 'src/renderer/assets/icon.png');
const OUT_DIR = path.join(PROJECT_ROOT, 'build/dmg-readme');
const HTML_OUT = path.join(OUT_DIR, 'README.html');
const PDF_OUT = path.join(OUT_DIR, 'README.pdf');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const iconBase64 = fs.readFileSync(ICON_PATH).toString('base64');

const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>DGI-Whisper — Primo avvio</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    :root {
      --text: #1f2937;
      --muted: #6b7280;
      --accent: #2563eb;
      --border: #e5e7eb;
      --bg-soft: #f9fafb;
      --bg-warn: #fff7ed;
      --bd-warn: #fed7aa;
      --code-bg: #f3f4f6;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      line-height: 1.55;
      font-size: 12pt;
      margin: 0;
    }
    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 8mm 0 6mm;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8mm;
    }
    .hero img {
      width: 88px;
      height: 88px;
      border-radius: 18px;
      box-shadow: 0 8px 22px rgba(0,0,0,0.12);
      margin-bottom: 8px;
    }
    .hero h1 {
      font-size: 22pt;
      margin: 6px 0 2px;
      letter-spacing: -0.01em;
    }
    .hero .claim {
      color: var(--muted);
      font-size: 11pt;
      margin: 0;
    }
    h2 {
      font-size: 14pt;
      margin: 16px 0 6px;
      letter-spacing: -0.005em;
    }
    .step-h {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
    }
    .step-h .num {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12pt;
    }
    .step-h h2 {
      margin: 0;
    }
    p { margin: 6px 0; }
    ol, ul { margin: 4px 0 10px 18px; padding: 0; }
    li { margin: 3px 0; }
    .note {
      background: var(--bg-warn);
      border: 1px solid var(--bd-warn);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 8px 0;
      font-size: 10.5pt;
    }
    blockquote {
      margin: 6px 0;
      padding: 6px 12px;
      background: var(--bg-soft);
      border-left: 3px solid var(--accent);
      font-style: italic;
      color: #374151;
      border-radius: 0 4px 4px 0;
    }
    code, kbd {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      background: var(--code-bg);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.92em;
    }
    pre {
      background: var(--code-bg);
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 10pt;
      margin: 6px 0;
    }
    pre code { background: none; padding: 0; }
    .trouble h3 {
      font-size: 11pt;
      margin: 12px 0 4px;
      color: #111827;
    }
    .footer {
      margin-top: 14mm;
      padding-top: 8mm;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--muted);
      font-size: 10pt;
      line-height: 1.6;
    }
    .footer a { color: var(--accent); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .divider { border: 0; border-top: 1px solid var(--border); margin: 12mm 0 6mm; }
  </style>
</head>
<body>

<div class="hero">
  <img src="data:image/png;base64,${iconBase64}" alt="DGI-Whisper logo">
  <h1>DGI-Whisper</h1>
  <p class="claim">Trascrizione AI locale, privacy-first</p>
</div>

<h2 style="margin-top:0;">Benvenuto — Primo avvio</h2>

<p>DGI-Whisper non è firmata con un certificato Apple Developer. macOS bloccherà l'apertura la prima volta. Questi sono i <strong>passaggi una tantum</strong> per sbloccarla — dalla seconda apertura in poi funzionerà normalmente come qualsiasi altra app.</p>

<div class="note">
  ⚠️ <strong>Solo per la prima apertura.</strong> Una volta sbloccata, l'app si avvia normalmente con doppio click.
</div>

<div class="step-h"><span class="num">1</span><h2>Installa l'app</h2></div>
<ol>
  <li>Trascina <strong>DGI-Whisper.app</strong> sopra l'icona <strong>Applications</strong> in questa finestra DMG</li>
  <li>Espelli la DMG (click destro sul Desktop → Espelli)</li>
</ol>

<div class="step-h"><span class="num">2</span><h2>Primo tentativo (verrà bloccato — è normale)</h2></div>
<ol>
  <li>Apri <strong>Applicazioni</strong> dal Finder</li>
  <li>Doppio click su <strong>DGI-Whisper</strong></li>
  <li>macOS mostrerà:</li>
</ol>
<blockquote>"DGI-Whisper non può essere aperta perché Apple non può verificare che sia priva di malware."</blockquote>
<p>Clicca <strong>Fine</strong> per chiudere il messaggio. <strong>Non è un errore.</strong></p>

<div class="step-h"><span class="num">3</span><h2>Sblocca l'app dalle Impostazioni di Sistema</h2></div>
<ol>
  <li>Apri il menu Apple (<span style="font-size:1.1em;"></span>) in alto a sinistra → <strong>Impostazioni di Sistema…</strong></li>
  <li>Nella sidebar a sinistra clicca <strong>Privacy e sicurezza</strong></li>
  <li>Scorri il pannello fino in fondo, alla sezione <strong>Sicurezza</strong></li>
  <li>Vedrai questo messaggio:</li>
</ol>
<blockquote>"DGI-Whisper è stata bloccata perché non proviene da uno sviluppatore identificato."</blockquote>
<ol start="5">
  <li>Clicca il pulsante <strong>Apri comunque</strong> accanto al messaggio</li>
  <li>Autenticati con <strong>Touch ID</strong> o <strong>password</strong> quando richiesto</li>
  <li>Nella finestra di conferma che appare, clicca di nuovo <strong>Apri comunque</strong></li>
</ol>

<div class="step-h"><span class="num">4</span><h2>Pronto</h2></div>
<p>L'app si apre. Dal prossimo avvio non dovrai più ripetere questi passaggi — basta doppio click come una qualsiasi altra app.</p>

<hr class="divider">

<div class="trouble">
  <h2 style="margin-top:0;">Problemi comuni</h2>

  <h3>"L'app è danneggiata e non può essere aperta"</h3>
  <p>Può capitare se il download ha lasciato un attributo di quarantena particolarmente rigido. Apri il <strong>Terminale</strong> (<kbd>⌘ Spazio</kbd> → scrivi "Terminale" → Invio) ed esegui:</p>
  <pre><code>xattr -cr /Applications/DGI-Whisper.app</code></pre>
  <p>Poi torna al passo <strong>2</strong>.</p>

  <h3>"Non vedo il pulsante Apri comunque nelle Impostazioni"</h3>
  <p>Devi avere provato ad aprire l'app <strong>almeno una volta</strong> dal Finder. Solo dopo il tentativo bloccato compare il pulsante. Ripeti il passo 2 e ricontrolla.</p>

  <h3>"Mi chiede di nuovo l'autorizzazione ad ogni avvio"</h3>
  <p>Non dovrebbe. Se succede, lancia il comando <code>xattr</code> qui sopra e riprova.</p>
</div>

<div class="footer">
  Design Group Italia – Team PM ❤️<br>
  <a href="mailto:giovanni.lombi@designgroupitalia.it">Bisogno di aiuto?</a>
</div>

</body>
</html>
`;

fs.writeFileSync(HTML_OUT, html, 'utf-8');
console.log(`✅ HTML: ${path.relative(PROJECT_ROOT, HTML_OUT)} (${(fs.statSync(HTML_OUT).size / 1024).toFixed(0)} KB)`);

if (!fs.existsSync(CHROME_PATH)) {
  console.error(`❌ Chrome not found at ${CHROME_PATH} — skipping PDF generation`);
  process.exit(0);
}

const fileUrl = `file://${HTML_OUT}`;
const chromeResult = spawnSync(
  CHROME_PATH,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${PDF_OUT}`,
    fileUrl,
  ],
  { stdio: 'inherit' }
);

if (chromeResult.status !== 0) {
  console.error('❌ Chrome failed to render the PDF');
  process.exit(1);
}

console.log(`✅ PDF:  ${path.relative(PROJECT_ROOT, PDF_OUT)} (${(fs.statSync(PDF_OUT).size / 1024).toFixed(0)} KB)`);
