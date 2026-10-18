// Lock now, plus when to lock by itself and how it unlocks (Windows Hello, a PIN, or any key). Also full screen.
import React, { useEffect, useRef, useState } from 'react';
import { hashPin, helloAvailable, LockPrefs, registerHello } from '../lock';
import { Icon } from './ui';

const field = { width: '100%', background: 'var(--surface)', border: '1px solid var(--outline-2)', borderRadius: 12, padding: '8px 12px', color: 'var(--text)', font: 'inherit' } as const;

export const LockMenu: React.FC<{ prefs: LockPrefs; onPrefs: (p: LockPrefs) => void; onLock: () => void }> = ({ prefs, onPrefs, onLock }) => {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [hello, setHello] = useState<'yes' | 'needs-localhost' | 'no' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { helloAvailable().then(setHello); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const here = `http://localhost:${location.port}${location.pathname}${location.hash}`;
  return (
    <div ref={box} style={{ position: 'relative', display: 'flex', gap: 6 }}>
      <button type="button" className="lockbtn" style={{ flex: 1 }} onClick={onLock} title="Lock (Ctrl+Shift+L)">{Icon.lock}Lock</button>
      <button type="button" className="lockbtn" style={{ width: 42, padding: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Lock and screen settings" title="Lock and screen settings">⋯</button>
      {open && (
        <div className="lockmenu" role="dialog" aria-label="Lock settings">
          <label className="label" style={{ display: 'grid', gap: 6 }}>Lock by itself after
            <select value={prefs.autoMin} onChange={(e) => onPrefs({ ...prefs, autoMin: Number(e.target.value) })} style={field}>
              {[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} idle minutes` : 'never'}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="label">Windows Hello {prefs.hello ? '· on' : ''}</span>
            {hello === 'needs-localhost' && <span className="tiny muted">Needs the app at localhost. <a href={here} style={{ color: 'var(--accent)' }}>Open it there</a> and install it from that address.</span>}
            {hello === 'no' && <span className="tiny muted">Windows Hello is not set up on this PC (Settings, Accounts, Sign-in options).</span>}
            {hello === 'yes' && !prefs.hello && <button type="button" className="btn primary" onClick={async () => { try { onPrefs({ ...prefs, hello: await registerHello() }); setMsg('Windows Hello unlocks it now'); } catch { setMsg('Windows Hello was cancelled'); } }}>Use Windows Hello to unlock</button>}
            {prefs.hello && <button type="button" className="ghost" style={{ justifySelf: 'start' }} onClick={() => { onPrefs({ ...prefs, hello: null }); setMsg('Windows Hello off'); }}>Turn off Windows Hello</button>}
          </div>
          <form style={{ display: 'grid', gap: 6 }} onSubmit={async (e) => { e.preventDefault(); if (pin.length < 4) { setMsg('Use at least 4 characters'); return; } onPrefs({ ...prefs, pinHash: await hashPin(pin) }); setPin(''); setMsg('PIN saved'); }}>
            <label htmlFor="lockpin" className="label">PIN {prefs.hello ? 'if Windows Hello fails' : 'to unlock'}{prefs.pinHash ? ' · set' : prefs.hello ? '' : ' · none, any key wakes it'}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="lockpin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => { setPin(e.target.value); setMsg(''); }} placeholder={prefs.pinHash ? 'New PIN' : 'Set a PIN'} style={field} />
              <button type="submit" className="btn text">Save</button>
            </div>
            {prefs.pinHash && <button type="button" className="ghost" style={{ justifySelf: 'start' }} onClick={() => { onPrefs({ ...prefs, pinHash: null }); setMsg('PIN removed'); }}>Remove PIN</button>}
          </form>
          <button type="button" className="doc" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>Full screen (F11)</button>
          {msg && <span className="tiny" style={{ color: 'var(--accent)' }}>{msg}</span>}
          <p className="tiny dim" style={{ margin: 0 }}>A privacy screen for this window, not account security. Win+L locks the computer.</p>
        </div>
      )}
    </div>
  );
};
