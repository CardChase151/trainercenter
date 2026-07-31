import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import {
  X, Search, Check, CheckCircle2, Loader2, ArrowRight, Trophy,
  Ticket, ShieldCheck, RotateCcw, AlertCircle, Delete, Sparkles, Star,
  ArrowLeft, HelpCircle,
} from 'lucide-react';

// ─── Dexter's Challenge — full guest scavenger-hunt experience ─────────────
// Flow: intro pop-up -> DexterIntro boot video -> 3-2-1 countdown ->
// start_challenge_run -> play grid (searchable vendor picker per card) ->
// submit (aggregate score only, never per-card) -> claim ticket + staff PIN.
//
// NEVER reveals which cards are right. Aggregate "X of N" only.

const RED = '#C8102E';
const DEFAULT_EVENT_ID = '3717f8d5-772a-42a9-ab09-bb6fe04ae349';

// Local vendor display helpers (mirrors App.js conventions, kept self-contained)
function vDisplayName(v) {
  return v?.business_name || v?.name || '';
}
function vHandle(v) {
  const h = (v?.ig_handle || '').trim();
  if (!h) return '';
  return h.startsWith('@') ? h : `@${h}`;
}
function vInitials(v) {
  const src = vDisplayName(v) || v?.name || '?';
  return (
    src.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
  );
}
const AV_PALETTE = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'];
function vColor(v) {
  const src = v?.name || v?.business_name || '?';
  const hash = src.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return AV_PALETTE[Math.abs(hash) % AV_PALETTE.length];
}

function MiniAvatar({ vendor, size = 34 }) {
  if (vendor?.avatar_url) {
    return (
      <img
        src={vendor.avatar_url}
        alt={vDisplayName(vendor)}
        loading="lazy"
        style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover',
          display: 'block', flexShrink: 0, backgroundColor: '#f3f4f6',
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: vColor(vendor), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: Math.round(size * 0.4), flexShrink: 0,
    }}>{vInitials(vendor)}</div>
  );
}

// ─── Vendor picker modal (type-to-filter + scroll) ─────────────────────────
function VendorPicker({ card, vendors, currentVendorId, onPick, onClear, onClose, isMobile }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => { try { inputRef.current?.focus(); } catch (e) {} }, 120);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      (v.business_name || '').toLowerCase().includes(q) ||
      (v.name || '').toLowerCase().includes(q) ||
      (v.ig_handle || '').toLowerCase().includes(q)
    );
  }, [query, vendors]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: '460px',
          borderRadius: isMobile ? '20px 20px 0 0' : '18px',
          maxHeight: isMobile ? '82vh' : '78vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
          animation: 'fadeSlide 0.25s ease-out',
        }}
      >
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#999', fontWeight: 800 }}>
                Which vendor has it?
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card?.card_name}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: '#f3f4f6', border: 'none', borderRadius: '10px',
                width: '34px', height: '34px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}
            ><X size={18} color="#555" /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendor name or @handle..."
              style={{
                width: '100%', background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '12px', padding: '12px 14px 12px 40px',
                fontSize: '15px', color: '#1a1a1a', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '22px 18px', color: '#999', fontSize: '13px', fontStyle: 'italic', textAlign: 'center' }}>
              No vendors match that search.
            </div>
          )}
          {filtered.map(v => {
            const selected = v.id === currentVendorId;
            return (
              <div
                key={v.id}
                onClick={() => onPick(v.id)}
                style={{
                  padding: '11px 18px', cursor: 'pointer',
                  borderBottom: '1px solid #f5f5f5',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  background: selected ? '#fff0f0' : '#fff',
                }}
              >
                <MiniAvatar vendor={v} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {vDisplayName(v)}
                  </div>
                  {vHandle(v) && (
                    <div style={{ fontSize: '11px', color: '#999' }}>{vHandle(v)}</div>
                  )}
                </div>
                {selected && (
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%', background: RED,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}><Check size={15} color="#fff" strokeWidth={3} /></div>
                )}
              </div>
            );
          })}
        </div>

        {currentVendorId && (
          <div style={{ padding: '10px 18px', borderTop: '1px solid #f0f0f0' }}>
            <button
              onClick={onClear}
              style={{
                width: '100%', background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '12px', padding: '11px', fontSize: '13px', fontWeight: 700,
                color: '#666', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Clear selection</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Staff PIN pad ─────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onEnter, onCancel, busy, error, confirmLabel = 'Enter' }) {
  const [pin, setPin] = useState('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

  const press = (k) => {
    if (busy) return;
    if (k === 'clear') { setPin(''); return; }
    if (k === 'back') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 8) return;
    setPin(p => p + k);
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: '340px', borderRadius: '20px',
          padding: '24px 22px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          animation: 'fadeSlide 0.25s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <ShieldCheck size={20} color={RED} />
          <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a1a' }}>{title}</div>
        </div>
        {subtitle && <p style={{ fontSize: '13px', color: '#888', margin: '0 0 16px', lineHeight: 1.4 }}>{subtitle}</p>}

        <div style={{
          display: 'flex', justifyContent: 'center', gap: '10px', margin: '4px 0 16px',
        }}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <div key={i} style={{
              width: '12px', height: '12px', borderRadius: '50%',
              background: i < pin.length ? RED : '#e5e7eb',
            }} />
          ))}
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '10px', padding: '9px 12px', fontSize: '13px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={15} />{error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {keys.map(k => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={busy}
              style={{
                padding: '16px 0', fontSize: '20px', fontWeight: 700,
                border: '1.5px solid #e5e7eb', borderRadius: '14px',
                background: '#fff', color: '#1a1a1a', cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {k === 'back' ? <Delete size={20} /> : k === 'clear' ? <span style={{ fontSize: '13px', fontWeight: 800, color: '#888' }}>CLR</span> : k}
            </button>
          ))}
        </div>

        <button
          onClick={() => onEnter(pin)}
          disabled={busy || pin.length === 0}
          style={{
            width: '100%', marginTop: '16px',
            background: (busy || pin.length === 0) ? '#f3f4f6' : RED,
            color: (busy || pin.length === 0) ? '#9ca3af' : '#fff',
            fontSize: '16px', fontWeight: 800, border: 'none', borderRadius: '14px',
            padding: '15px', cursor: (busy || pin.length === 0) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}
        >
          {busy ? <Loader2 size={18} className="dx-spin" /> : <Check size={18} strokeWidth={3} />}
          {busy ? 'Checking...' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            width: '100%', marginTop: '8px', background: 'transparent', border: 'none',
            color: '#999', fontSize: '13px', fontWeight: 700, cursor: 'pointer', padding: '8px',
            fontFamily: 'inherit',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function DexterChallenge({ eventId, session, isMobile, onExit }) {
  const evId = eventId || DEFAULT_EVENT_ID;
  const profileId = session?.user?.id || null;

  // phase: 'intro' | 'video' | 'countdown' | 'play' | 'ticket'
  const [phase, setPhase] = useState('intro');

  const [settings, setSettings] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [prep, setPrep] = useState({ loading: true, error: null });

  const [runId, setRunId] = useState(null);
  const [cards, setCards] = useState([]);
  const [runError, setRunError] = useState(null);
  const [runStarting, setRunStarting] = useState(false);

  const [picks, setPicks] = useState({}); // card_id -> vendor_id
  const [pickerCardId, setPickerCardId] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null); // {attempt_no, correct_count, total, perfect}

  const [countdown, setCountdown] = useState(3);
  const [showRules, setShowRules] = useState(false);

  // Claim / ticket state
  const [pinMode, setPinMode] = useState(null); // 'award' | 'retry' | null
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [awarded, setAwarded] = useState(false);
  const [awardedKind, setAwardedKind] = useState(null);

  const startedRef = useRef(false);

  // ── Load settings + approved vendors up front ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPrep({ loading: true, error: null });
      try {
        const [sRes, vRes] = await Promise.all([
          supabase.from('challenge_settings').select('*').eq('event_id', evId).maybeSingle(),
          supabase.from('vendors').select('id, name, business_name, ig_handle, avatar_url, status')
            .eq('status', 'approved'),
        ]);
        if (cancelled) return;
        if (sRes.error) throw sRes.error;
        if (vRes.error) throw vRes.error;
        const vlist = (vRes.data || []).slice().sort((a, b) =>
          vDisplayName(a).localeCompare(vDisplayName(b))
        );
        setSettings(sRes.data || null);
        setVendors(vlist);
        setPrep({ loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setPrep({ loading: false, error: e?.message || 'Could not load the challenge.' });
      }
    })();
    return () => { cancelled = true; };
  }, [evId]);

  // ── Start the run (idempotent per user/event) ──
  const startRun = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunStarting(true);
    setRunError(null);
    try {
      const { data, error } = await supabase.rpc('start_challenge_run', { p_event_id: evId });
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) throw new Error('No cards were returned for this challenge.');
      const rid = rows[0].run_id;
      const sorted = rows.slice().sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
      setRunId(rid);
      setCards(sorted);
    } catch (e) {
      startedRef.current = false; // allow retry
      setRunError(e?.message || 'Could not start your challenge.');
    } finally {
      setRunStarting(false);
    }
  }, [evId]);

  // ── Kick off the run as soon as the play grid opens (no countdown) ──
  useEffect(() => {
    if (phase !== 'play') return;
    startRun();
  }, [phase, startRun]);

  const totalCards = cards.length;
  const pickedCount = useMemo(
    () => cards.reduce((acc, c) => acc + (picks[c.card_id] ? 1 : 0), 0),
    [cards, picks]
  );

  const vendorById = useMemo(() => {
    const m = {};
    vendors.forEach(v => { m[v.id] = v; });
    return m;
  }, [vendors]);

  // ── Submit an attempt ──
  async function handleSubmit() {
    if (submitting || !runId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.rpc('submit_challenge_attempt', {
        p_run_id: runId,
        p_picks: picks,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('No result came back. Please try again.');
      setResult(row);
    } catch (e) {
      setSubmitError(e?.message || 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Claim / PIN actions ──
  async function handlePin(pin, action) {
    if (pinBusy || !runId) return;
    setPinBusy(true);
    setPinError(null);
    try {
      const { data, error } = await supabase.rpc('claim_challenge_prize', {
        p_run_id: runId,
        p_pin: pin,
        p_action: action,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.ok === false) {
        if (row?.error === 'bad_pin') {
          setPinError('That PIN was not right. Try again.');
        } else {
          setPinError(row?.error ? String(row.error).replace(/_/g, ' ') : 'Could not complete that. Try again.');
        }
        setPinBusy(false);
        return;
      }
      // Success
      if (action === 'award') {
        setAwarded(true);
        setAwardedKind(row.prize_kind || null);
        setPinMode(null);
      } else {
        // retry -> back to the game, fresh attempt
        setPinMode(null);
        setResult(null);
        setSubmitError(null);
        setPhase('play');
      }
    } catch (e) {
      setPinError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setPinBusy(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const styleTag = (
    <style>{`
      @keyframes fadeSlide { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes dxSpin { to { transform: rotate(360deg); } }
      @keyframes dxPop { 0% { transform: scale(0.4); opacity: 0; } 40% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes dxWhiteFlash { from { opacity: 0.7; } to { opacity: 0; } }
      .dx-spin { animation: dxSpin 0.9s linear infinite; }
    `}</style>
  );

  // ── INTRO POP-UP ──
  if (phase === 'intro') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0b0b0d', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: isMobile ? '14px 14px 40px' : '24px' }}>
        {styleTag}
        <div style={{
          background: '#fff', width: '100%', maxWidth: '480px', borderRadius: '22px',
          overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.5)', animation: 'fadeSlide 0.4s ease-out',
        }}>
          {/* Header band */}
          <div style={{
            background: `linear-gradient(135deg, ${RED} 0%, #FF1A8C 100%)`,
            padding: isMobile ? '26px 22px' : '32px 28px', color: '#fff', position: 'relative',
          }}>
            {onExit && (
              <button
                onClick={onExit}
                aria-label="Close"
                style={{
                  position: 'absolute', top: '14px', right: '14px', background: 'rgba(255,255,255,0.2)',
                  border: 'none', borderRadius: '10px', width: '32px', height: '32px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><X size={17} color="#fff" /></button>
            )}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', background: 'rgba(255,255,255,0.18)', padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>
              <Sparkles size={13} />Dexter's Challenge
            </div>
            <h1 style={{ fontSize: isMobile ? '24px' : '28px', fontWeight: 900, margin: 0, lineHeight: 1.1 }}>
              The Pokedex Scavenger Hunt
            </h1>
          </div>

          {/* Body */}
          <div style={{ padding: isMobile ? '20px' : '26px 28px' }}>
            {prep.loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '30px 0', color: '#888' }}>
                <Loader2 size={20} className="dx-spin" />Loading the challenge...
              </div>
            ) : prep.error ? (
              <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '12px', padding: '14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={16} />{prep.error}
              </div>
            ) : settings && settings.active === false ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#666' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>The challenge isn't open right now.</div>
                <div style={{ fontSize: '13px' }}>Check back a little later, or ask a staff member.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a', marginBottom: '12px', lineHeight: 1.35 }}>
                  Find the vendor who has each card!
                </div>
                <ol style={{ margin: '0 0 18px', paddingLeft: '22px', color: '#444', fontSize: '15px', lineHeight: 1.7 }}>
                  <li>The next screen has your list of cards.</li>
                  <li>Find the vendor who has each one.</li>
                  <li>Tap the card and pick that vendor.</li>
                  <li>Tap Submit when you have them all.</li>
                </ol>

                <div style={{ background: '#fff8f9', border: '1px solid #ffe0e6', borderRadius: '14px', padding: '16px', marginBottom: '18px' }}>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#15803d', marginBottom: '10px' }}>
                    Finish the list and you win a prize!
                  </div>
                  <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
                    Get 100% and you earn a raffle ticket:
                  </div>
                  {[
                    ['on your 1st try', '$100'],
                    ['on tries 2-3', '$50'],
                    ['on tries 4-7', '$25'],
                  ].map(([d, amt]) => (
                    <div key={amt} style={{ fontSize: '14px', color: '#444', marginBottom: '7px', lineHeight: 1.4 }}>
                      100% correct {d} = 1 raffle ticket, chance to win <span style={{ fontWeight: 900, color: RED }}>{amt}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: '13px', color: '#888', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #ffd6de', lineHeight: 1.5 }}>
                    Winners drawn from all tickets. Credit toward Aug 21.
                  </div>
                </div>

                {/* One start — everyone who finishes wins a prize, accuracy ranks the raffle */}
                <button
                  onClick={() => setPhase('play')}
                  style={{
                    width: '100%', background: `linear-gradient(135deg, ${RED} 0%, #FF1A8C 100%)`,
                    color: '#fff', border: 'none', borderRadius: '14px', padding: '16px',
                    fontSize: '16px', fontWeight: 800, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px',
                    boxShadow: '0 12px 28px rgba(200,16,46,0.28)', fontFamily: 'inherit',
                  }}
                >
                  <Trophy size={18} />Start the hunt
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── DEXTER BOOT VIDEO ──
  // ── 3-2-1 COUNTDOWN ──
  if (phase === 'countdown') {
    return (
      <div style={{ minHeight: '100vh', background: '#0b0b0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
        {styleTag}
        <div style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.2em', color: '#888', fontWeight: 800, marginBottom: '18px' }}>
          Get ready
        </div>
        <div
          key={countdown}
          style={{
            fontSize: isMobile ? '120px' : '160px', fontWeight: 900, lineHeight: 1,
            background: `linear-gradient(135deg, ${RED} 0%, #FF1A8C 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            animation: 'dxPop 0.6s ease-out',
          }}
        >{countdown}</div>
      </div>
    );
  }

  // ── TICKET / CLAIM SCREEN ──
  if (phase === 'ticket') {
    return (
      <div style={{ minHeight: '100vh', background: `linear-gradient(160deg, ${RED} 0%, #8a0a20 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '16px' : '24px' }}>
        {styleTag}
        <div style={{
          background: '#fff', width: '100%', maxWidth: '440px', borderRadius: '24px',
          overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.4)', animation: 'fadeSlide 0.4s ease-out',
        }}>
          <div style={{ padding: isMobile ? '30px 22px 22px' : '38px 30px 26px', textAlign: 'center' }}>
            {awarded ? (
              <>
                <div style={{ width: '76px', height: '76px', borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
                  <CheckCircle2 size={44} color="#16a34a" />
                </div>
                <h1 style={{ fontSize: '24px', fontWeight: 900, color: '#1a1a1a', margin: '0 0 8px' }}>Prize awarded</h1>
                <p style={{ fontSize: '15px', color: '#666', margin: '0 0 6px', lineHeight: 1.5 }}>
                  You're all set. {awardedKind ? `Prize: ${String(awardedKind).replace(/_/g, ' ')}.` : ''}
                </p>
                <p style={{ fontSize: '13px', color: '#999', margin: '0 0 22px' }}>
                  Thanks for playing Dexter's Challenge.
                </p>
                {onExit && (
                  <button
                    onClick={onExit}
                    style={{
                      width: '100%', background: '#1a1a1a', color: '#fff', border: 'none',
                      borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: 800,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >Done</button>
                )}
              </>
            ) : (
              <>
                <div style={{ width: '76px', height: '76px', borderRadius: '20px', background: '#fff0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
                  <Ticket size={40} color={RED} />
                </div>
                <h1 style={{ fontSize: isMobile ? '22px' : '26px', fontWeight: 900, color: '#1a1a1a', margin: '0 0 10px', lineHeight: 1.15 }}>
                  Show this screen to a staff member.
                </h1>
                <p style={{ fontSize: '15px', color: '#666', margin: '0 0 4px', fontWeight: 700 }}>
                  Don't close it.
                </p>
                <p style={{ fontSize: '13px', color: '#999', margin: '0 0 20px', lineHeight: 1.5 }}>
                  {result?.perfect
                    ? 'You matched the whole list. A staff member will award your prize.'
                    : result
                      ? `You got ${result.correct_count} of ${result.total}. A staff member will take it from here.`
                      : 'A staff member will take it from here.'}
                </p>

                <div style={{ background: '#fafafa', border: '1px dashed #ddd', borderRadius: '14px', padding: '14px', marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#aaa', fontWeight: 800, marginBottom: '4px' }}>Run</div>
                  <div style={{ fontSize: '12px', color: '#888', fontFamily: 'monospace', wordBreak: 'break-all' }}>{runId}</div>
                </div>

                <button
                  onClick={() => { setPinError(null); setPinMode('award'); }}
                  style={{
                    width: '100%', background: RED, color: '#fff', border: 'none', borderRadius: '14px',
                    padding: '15px', fontSize: '15px', fontWeight: 800, cursor: 'pointer', marginBottom: '10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontFamily: 'inherit',
                  }}
                ><ShieldCheck size={18} />Staff: award prize</button>

                <button
                  onClick={() => { setPinError(null); setPinMode('retry'); }}
                  style={{
                    width: '100%', background: '#fff', color: '#666', border: '1.5px solid #e5e7eb',
                    borderRadius: '14px', padding: '13px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontFamily: 'inherit',
                  }}
                ><RotateCcw size={16} />Try again instead (staff)</button>
              </>
            )}
          </div>
        </div>

        {pinMode && (
          <PinPad
            title={pinMode === 'award' ? 'Staff PIN' : 'Staff PIN to retry'}
            subtitle={pinMode === 'award'
              ? 'A staff member enters the PIN to award this prize.'
              : 'A staff member enters the PIN to send this guest back to the game.'}
            confirmLabel={pinMode === 'award' ? 'Award prize' : 'Send back'}
            busy={pinBusy}
            error={pinError}
            onEnter={(pin) => handlePin(pin, pinMode)}
            onCancel={() => { if (!pinBusy) { setPinMode(null); setPinError(null); } }}
          />
        )}
      </div>
    );
  }

  // ── PLAY GRID ──
  const startingOrEmpty = runStarting || (!runId && !runError);
  const activePickerCard = pickerCardId ? cards.find(c => c.card_id === pickerCardId) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f6f6f8' }}>
      {styleTag}

      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: '#fff', borderBottom: '1px solid #eee',
        padding: isMobile ? '10px 16px 12px' : '12px 22px',
      }}>
        <div style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button
            onClick={() => onExit && onExit()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none',
              color: '#666', fontWeight: 700, fontSize: '13px', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit',
            }}
          ><ArrowLeft size={16} />Back</button>
          <button
            onClick={() => setShowRules(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff0f0', border: '1px solid #ffd6de',
              color: RED, fontWeight: 800, fontSize: '13px', cursor: 'pointer', padding: '7px 14px', borderRadius: '999px', fontFamily: 'inherit',
            }}
          ><HelpCircle size={15} />Rules</button>
        </div>
        <div style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <Sparkles size={13} />Dexter's Challenge
            </div>
            <div style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: 800, color: '#1a1a1a' }}>
              Match each card to its vendor
            </div>
          </div>
          {totalCards > 0 && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '20px', fontWeight: 900, color: pickedCount === totalCards ? '#16a34a' : '#1a1a1a', lineHeight: 1 }}>
                {pickedCount}<span style={{ color: '#bbb', fontSize: '15px' }}>/{totalCards}</span>
              </div>
              <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>picked</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: '820px', margin: '0 auto', padding: isMobile ? '16px 12px 140px' : '22px 20px 160px' }}>
        {runError ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 22px', textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <AlertCircle size={30} color={RED} style={{ marginBottom: '10px' }} />
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Couldn't start the challenge</div>
            <div style={{ fontSize: '13px', color: '#888', marginBottom: '18px' }}>{runError}</div>
            <button
              onClick={() => { startedRef.current = false; setRunError(null); startRun(); }}
              style={{ background: RED, color: '#fff', border: 'none', borderRadius: '12px', padding: '12px 22px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
            >Try again</button>
          </div>
        ) : startingOrEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: '#888' }}>
            <Loader2 size={28} className="dx-spin" style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Dealing your cards...</div>
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: isMobile ? '12px' : '16px',
            }}>
              {cards.map((card, idx) => {
                const chosenId = picks[card.card_id];
                const chosen = chosenId ? vendorById[chosenId] : null;
                return (
                  <div
                    key={card.card_id}
                    style={{
                      background: '#fff', borderRadius: '16px', overflow: 'hidden',
                      border: chosen ? `1.5px solid ${RED}` : '1px solid #eee',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column',
                    }}
                  >
                    {/* Card image */}
                    <div style={{ position: 'relative', background: '#f0f0f2', aspectRatio: '3 / 4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {card.image_url ? (
                        <img
                          src={card.image_url}
                          alt={card.card_name}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ color: '#bbb', fontSize: '12px', padding: '12px', textAlign: 'center' }}>{card.card_name}</div>
                      )}
                      <div style={{ position: 'absolute', top: '8px', left: '8px', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '11px', fontWeight: 800, borderRadius: '8px', padding: '3px 8px' }}>
                        #{idx + 1}
                      </div>
                    </div>

                    {/* Card meta */}
                    <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2, marginBottom: '2px' }}>
                        {card.card_name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#999', marginBottom: '10px' }}>
                        {[card.set_name, card.number ? `#${card.number}` : null].filter(Boolean).join(' · ')}
                      </div>

                      <div style={{ marginTop: 'auto' }}>
                        {chosen ? (
                          <button
                            onClick={() => setPickerCardId(card.card_id)}
                            style={{
                              width: '100%', background: '#fff0f0', border: `1.5px solid ${RED}`,
                              borderRadius: '11px', padding: '8px 10px', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', textAlign: 'left',
                            }}
                          >
                            <MiniAvatar vendor={chosen} size={28} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '12px', fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {vDisplayName(chosen)}
                              </div>
                              <div style={{ fontSize: '10px', color: RED, fontWeight: 700 }}>Tap to change</div>
                            </div>
                          </button>
                        ) : (
                          <button
                            onClick={() => setPickerCardId(card.card_id)}
                            style={{
                              width: '100%', background: RED, color: '#fff', border: 'none',
                              borderRadius: '11px', padding: '10px', fontSize: '13px', fontWeight: 800,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              gap: '6px', fontFamily: 'inherit',
                            }}
                          >
                            <Search size={14} />Select vendor
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Result banner (aggregate only — never per-card) */}
            {result && (
              <div style={{
                marginTop: '20px', background: '#fff', borderRadius: '16px', padding: '20px',
                border: result.perfect ? '1.5px solid #16a34a' : '1px solid #eee',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)', textAlign: 'center', animation: 'fadeSlide 0.3s ease-out',
              }}>
                {result.perfect ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#16a34a', marginBottom: '6px' }}>
                    <CheckCircle2 size={22} /><span style={{ fontSize: '18px', fontWeight: 900 }}>Perfect list!</span>
                  </div>
                ) : (
                  <Trophy size={22} color={RED} style={{ marginBottom: '4px' }} />
                )}
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#1a1a1a' }}>
                  You got {result.correct_count} of {result.total} correct
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                  {result.perfect
                    ? 'You matched the whole list. Claim your prize below.'
                    : `Attempt ${result.attempt_no || ''}. Re-check the cards and try again, or claim what you've got.`}
                </div>
              </div>
            )}

            {submitError && (
              <div style={{ marginTop: '14px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} />{submitError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky action bar */}
      {!runError && !startingOrEmpty && cards.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 60,
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(10px)', borderTop: '1px solid #e5e7eb',
          padding: isMobile ? '12px 14px' : '14px 20px',
        }}>
          <div style={{ maxWidth: '820px', margin: '0 auto' }}>
            {!result ? (
              <button
                onClick={handleSubmit}
                disabled={submitting || pickedCount === 0}
                style={{
                  width: '100%', background: (submitting || pickedCount === 0) ? '#f3f4f6' : RED,
                  color: (submitting || pickedCount === 0) ? '#9ca3af' : '#fff', border: 'none', borderRadius: '14px',
                  padding: '16px', fontSize: '16px', fontWeight: 800,
                  cursor: (submitting || pickedCount === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', fontFamily: 'inherit',
                }}
              >
                {submitting ? <Loader2 size={18} className="dx-spin" /> : <Check size={18} strokeWidth={3} />}
                {submitting ? 'Checking...' : pickedCount < totalCards ? `Submit ${pickedCount}/${totalCards}` : 'Submit my answers'}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => { setResult(null); setSubmitError(null); }}
                  style={{
                    flex: 1, background: '#fff', color: '#1a1a1a', border: '1.5px solid #e5e7eb',
                    borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: 800, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', fontFamily: 'inherit',
                  }}
                ><RotateCcw size={16} />Try again</button>
                <button
                  onClick={() => setPhase('ticket')}
                  style={{
                    flex: 1, background: RED, color: '#fff', border: 'none',
                    borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: 800, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', fontFamily: 'inherit',
                  }}
                ><Ticket size={16} />Claim my prize</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vendor picker modal */}
      {activePickerCard && (
        <VendorPicker
          card={activePickerCard}
          vendors={vendors}
          currentVendorId={picks[activePickerCard.card_id] || null}
          isMobile={isMobile}
          onPick={(vendorId) => {
            setPicks(p => ({ ...p, [activePickerCard.card_id]: vendorId }));
            setPickerCardId(null);
          }}
          onClear={() => {
            setPicks(p => {
              const next = { ...p };
              delete next[activePickerCard.card_id];
              return next;
            });
            setPickerCardId(null);
          }}
          onClose={() => setPickerCardId(null)}
        />
      )}

      {showRules && (
        <div
          onClick={() => setShowRules(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(3px)', display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'center', padding: isMobile ? '14px' : '24px', overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', width: '100%', maxWidth: '460px', borderRadius: '22px', overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.4)', animation: 'fadeSlide 0.3s ease-out' }}
          >
            <div style={{ background: `linear-gradient(135deg, ${RED} 0%, #FF1A8C 100%)`, padding: isMobile ? '20px 22px' : '24px 26px', color: '#fff', position: 'relative' }}>
              <button
                onClick={() => setShowRules(false)}
                aria-label="Close"
                style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '10px', width: '32px', height: '32px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              ><X size={18} /></button>
              <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.9 }}>Dexter's Challenge</div>
              <div style={{ fontSize: '22px', fontWeight: 900, marginTop: '2px' }}>Rules</div>
            </div>
            <div style={{ padding: isMobile ? '20px' : '24px 26px' }}>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a', marginBottom: '14px', lineHeight: 1.45 }}>
                We give you a list of cards. Your job is to find and match the vendor who has each one.
              </div>
              <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#999', fontWeight: 800, marginBottom: '8px' }}>How it works</div>
              <ol style={{ margin: '0 0 16px', paddingLeft: '20px', color: '#444', fontSize: '14px', lineHeight: 1.6 }}>
                <li>Go through the event and find the vendor who has each card.</li>
                <li>Tap a card and pick that vendor.</li>
                <li>Once you've collected them all, hit Submit.</li>
                <li>We tell you how many are right — never which. Keep trying as much as you like.</li>
              </ol>

              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px 16px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#1a1a1a', marginBottom: '6px' }}>Where to look</div>
                <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.55 }}>
                  A card could be in a binder, in a slab, in a frame, or loose outside the box. Check everywhere and ask the vendors.
                </div>
              </div>

              <div style={{ background: '#fff8f9', border: '1px solid #ffe0e6', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#15803d', marginBottom: '10px' }}>Finish the list and you win a prize!</div>
                <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
                  Get 100% and you earn a raffle ticket:
                </div>
                {[
                  ['on your 1st try', '$100'],
                  ['on tries 2-3', '$50'],
                  ['on tries 4-7', '$25'],
                ].map(([d, amt]) => (
                  <div key={amt} style={{ fontSize: '14px', color: '#444', marginBottom: '7px', lineHeight: 1.4 }}>
                    100% correct {d} = 1 raffle ticket, chance to win <span style={{ fontWeight: 900, color: RED }}>{amt}</span>
                  </div>
                ))}
                <div style={{ fontSize: '13px', color: '#888', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #ffd6de', lineHeight: 1.5 }}>
                  Winners drawn from all tickets. Credit toward Aug 21.
                </div>
              </div>

              <div style={{ fontSize: '12px', color: '#999', fontStyle: 'italic', textAlign: 'center', marginBottom: '16px' }}>
                Questions? Ask a staff member.
              </div>
              <button
                onClick={() => setShowRules(false)}
                style={{ width: '100%', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '15px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
              >Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
