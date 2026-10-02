import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { qrDataUrl } from '../../lib/qr';
import { ArrowLeft, Download, Printer, ExternalLink, QrCode, ScanLine, LogIn, ClipboardList } from 'lucide-react';
import { REQUEST_LINKS, requestLinkUrl, ghostBtn } from './invShared';

type RequestLink = (typeof REQUEST_LINKS)[number];

interface RequestLinksViewProps {
  onBack: () => void;
}

const POSTER_ID = 'inv-request-poster';

const STEPS = [
  { icon: ScanLine, title: 'Scan or open the link', text: 'Works on any phone or computer' },
  { icon: LogIn, title: 'Sign in', text: 'With their own EVOne account' },
  { icon: ClipboardList, title: 'Submit the request', text: 'It lands in this list as Pending, under their name' },
];

export function RequestLinksView({ onBack }: RequestLinksViewProps) {
  const [poster, setPoster] = useState<{ link: RequestLink; qr: string } | null>(null);

  // Print just the poster: hide the app for the print, then put everything back.
  // Layout effect so the poster never flashes on screen before its style lands.
  useLayoutEffect(() => {
    if (!poster) return;
    const style = document.createElement('style');
    style.textContent = `@media screen { #${POSTER_ID} { display: none !important; } }
@media print {
  @page { size: A4 portrait; margin: 0; }
  body > *:not(#${POSTER_ID}) { display: none !important; }
  #${POSTER_ID} { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
    document.head.appendChild(style);
    let cancelled = false;
    const finish = () => { if (!cancelled) setPoster(null); };
    window.addEventListener('afterprint', finish, { once: true });
    const imgs = [...(document.getElementById(POSTER_ID)?.querySelectorAll('img') ?? [])];
    void Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))))
      .then(() => { if (!cancelled) window.print(); });
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', finish);
      style.remove();
    };
  }, [poster]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={14} /> Requests</button>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Request links</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Share a link or QR code so anyone in the company can raise a stock request from their phone.</div>
        </div>
      </div>

      <div style={{ background: C.honeydew, borderRadius: 14, padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {STEPS.map((s, i) => (
          <div key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 32, height: 32, borderRadius: 99, background: C.white, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <s.icon size={16} strokeWidth={2.25} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{i + 1}. {s.title}</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{s.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {REQUEST_LINKS.map((l) => <LinkCard key={l.slug} link={l} onPrint={(qr) => setPoster({ link: l, qr })} />)}
      </div>

      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
        The link on its own gives no access — nothing can be seen or submitted without signing in, so a poster that travels does no harm.
        Department links only pre-fill the department; the requester can still change it.
      </div>

      {poster && createPortal(<Poster link={poster.link} qr={poster.qr} />, document.body)}
    </div>
  );
}

function LinkCard({ link, onPrint }: { link: RequestLink; onPrint: (qr: string) => void }) {
  const url = requestLinkUrl(link.slug);
  const [qr, setQr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    qrDataUrl(url).then((d) => { if (live) setQr(d); }).catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [url]);

  const copy = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const download = async () => {
    const img = new Image();
    img.src = qr;
    await img.decode();
    const size = 512, pad = 48, caption = 96;
    const c = document.createElement('canvas');
    c.width = size + pad * 2;
    c.height = size + pad * 2 + caption;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = C.white;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, pad, pad, size, size);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.green;
    ctx.font = '700 32px Figtree, sans-serif';
    ctx.fillText('Stock request', c.width / 2, size + pad + 52);
    ctx.fillStyle = C.slate;
    ctx.font = '500 22px Figtree, sans-serif';
    ctx.fillText(link.department ? `${link.department} department` : 'Scan to request stock', c.width / 2, size + pad + 88);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `stock-request-${link.slug}.png`;
    a.click();
  };

  const smallBtn: React.CSSProperties = { ...ghostBtn, padding: '7px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1 };

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{link.label}</div>
        <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{link.department ? `Department pre-filled as ${link.department}` : 'The requester picks their department'}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 168, height: 168, padding: 12, borderRadius: 12, border: '1px solid #EBEBEB', background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {err ? <div style={{ fontSize: 12, color: '#C0321A', textAlign: 'center' }}>{err}</div>
            : qr ? <img src={qr} alt={`QR code for ${link.label}`} style={{ width: 168, height: 168, display: 'block' }} />
            : <QrCode size={32} strokeWidth={1.5} color={C.slate} />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div title={url} style={{ flex: 1, minWidth: 0, background: C.seasalt, borderRadius: 10, padding: '8px 12px', fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
        <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.green}`, background: copied ? C.honeydew : 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void download()} disabled={!qr} style={smallBtn}><Download size={13} /> QR</button>
        <button onClick={() => onPrint(qr)} disabled={!qr} style={smallBtn}><Printer size={13} /> Poster</button>
        <button onClick={() => window.open(url, '_blank', 'noopener')} style={smallBtn}><ExternalLink size={13} /> Open</button>
      </div>
    </div>
  );
}

// A4 poster, rendered straight into <body> so the print can hide the app around it.
function Poster({ link, qr }: { link: RequestLink; qr: string }) {
  return (
    <div id={POSTER_ID} style={{ position: 'fixed', inset: 0, background: C.white, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 64, boxSizing: 'border-box', fontFamily: 'Figtree, sans-serif', textAlign: 'center' }}>
      <Logo height={64} />
      <div>
        <div style={{ fontSize: 56, fontWeight: 700, color: C.green, letterSpacing: '-0.03em', lineHeight: 1.05 }}>Need stock?</div>
        <div style={{ fontSize: 22, color: C.slate, marginTop: 12 }}>Scan to raise a stock request</div>
      </div>
      {link.department && (
        <div style={{ fontSize: 18, fontWeight: 700, color: C.green, background: C.honeydew, borderRadius: 99, padding: '8px 22px' }}>{link.department} department</div>
      )}
      <div style={{ padding: 20, borderRadius: 20, border: '1px solid #EBEBEB' }}>
        <img src={qr} alt="" style={{ width: 360, height: 360, display: 'block' }} />
      </div>
      <div style={{ display: 'flex', gap: 28, justifyContent: 'center' }}>
        {['Scan the code', 'Sign in with your EVOne account', 'Fill in what you need'].map((t, i) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: '#1a1a1a', fontWeight: 600 }}>
            <span style={{ width: 28, height: 28, borderRadius: 99, background: C.green, color: C.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{i + 1}</span>
            {t}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.slate }}>{requestLinkUrl(link.slug)}</div>
    </div>
  );
}
