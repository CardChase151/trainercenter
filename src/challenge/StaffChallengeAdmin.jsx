import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import {
  Activity, Settings as SettingsIcon, Layers, Trophy, Loader2, Save,
  Power, Plus, Trash2, Users, Check, AlertCircle, Copy, RefreshCw,
  Play, Image as ImageIcon,
} from 'lucide-react';

// Dexter's Challenge — Staff admin console.
// Section A Status | B Settings | C Card pool | D Raffle.
// Inline-style visual language matching src/App.js (brand red #C8102E).
const RED = '#C8102E';
const DEFAULT_EVENT_ID = '3717f8d5-772a-42a9-ab09-bb6fe04ae349';

// ── Shared inline style fragments ────────────────────────────────
const cardShell = {
  backgroundColor: '#fff',
  border: '1px solid #eee',
  borderRadius: '14px',
  padding: '20px',
  marginBottom: '20px',
};
const sectionLabel = {
  fontSize: '11px',
  fontWeight: 800,
  color: '#666',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '14px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};
const inputStyle = {
  width: '100%',
  background: '#fff',
  border: '1.5px solid #e5e7eb',
  borderRadius: '10px',
  padding: '11px 12px',
  fontSize: '14px',
  color: '#1a1a1a',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#525252',
  marginBottom: '6px',
  display: 'block',
};
const primaryBtn = {
  backgroundColor: RED,
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '11px 18px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  fontFamily: 'inherit',
};
const ghostBtn = {
  backgroundColor: '#fff',
  color: '#1a1a1a',
  border: '1.5px solid #d1d5db',
  borderRadius: '10px',
  padding: '10px 14px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'inherit',
};

// ── Small reusable toast/note ────────────────────────────────────
function Note({ kind, children }) {
  if (!children) return null;
  const palette = kind === 'error'
    ? { bg: '#fef2f2', border: '#fecaca', fg: '#991b1b', Icon: AlertCircle }
    : { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857', Icon: Check };
  const { bg, border, fg, Icon } = palette;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      background: bg, border: `1px solid ${border}`, color: fg,
      borderRadius: '8px', padding: '9px 12px',
      fontSize: '13px', fontWeight: 600, marginTop: '12px',
    }}>
      <Icon size={15} />{children}
    </div>
  );
}

// ── Section A: Status ───────────────────────────────────────────
function StatusSection({ settings, summary, onToggle, toggling }) {
  const active = !!settings?.active;
  const stats = [
    { label: 'Total runs', value: summary?.total_runs },
    { label: 'Perfect', value: summary?.perfect },
    { label: 'Claimed', value: summary?.claimed },
    { label: 'Playing', value: summary?.playing },
  ];
  return (
    <div style={cardShell}>
      <div style={sectionLabel}><Activity size={14} /> Status</div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '14px', flexWrap: 'wrap', marginBottom: '18px',
      }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a' }}>
            Challenge is {active ? 'LIVE' : 'off'}
          </div>
          <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>
            {active ? 'Guests can play right now.' : 'Guests cannot start a run.'}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={toggling}
          style={{
            ...primaryBtn,
            backgroundColor: active ? '#16a34a' : RED,
            opacity: toggling ? 0.6 : 1,
          }}
        >
          {toggling ? <Loader2 size={15} className="spin" /> : <Power size={15} />}
          {active ? 'Turn OFF' : 'Turn ON'}
        </button>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: '10px',
      }}>
        {stats.map(s => (
          <div key={s.label} style={{
            background: '#fafafa', border: '1px solid #eee',
            borderRadius: '12px', padding: '14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1 }}>
              {s.value == null ? '—' : s.value}
            </div>
            <div style={{
              fontSize: '11px', fontWeight: 700, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '6px',
            }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section B: Settings ─────────────────────────────────────────
function SettingsSection({ settings, eventId, onSaved }) {
  const [form, setForm] = useState({
    pin: '', list_size: '', prize_tier1: '', prize_tier2: '', prize_tier3: '', participation_prize: '',
  });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null); // {kind, msg}

  useEffect(() => {
    if (!settings) return;
    setForm({
      pin: settings.pin ?? '',
      list_size: settings.list_size ?? '',
      prize_tier1: settings.prize_tier1 ?? '',
      prize_tier2: settings.prize_tier2 ?? '',
      prize_tier3: settings.prize_tier3 ?? '',
      participation_prize: settings.participation_prize ?? '',
    });
  }, [settings]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const listSizeNum = parseInt(form.list_size, 10);
      const payload = {
        pin: String(form.pin || '').trim(),
        list_size: Number.isFinite(listSizeNum) ? listSizeNum : null,
        prize_tier1: form.prize_tier1,
        prize_tier2: form.prize_tier2,
        prize_tier3: form.prize_tier3,
        participation_prize: form.participation_prize,
      };
      const { error } = await supabase
        .from('challenge_settings')
        .update(payload)
        .eq('event_id', eventId);
      if (error) throw error;
      setNote({ kind: 'ok', msg: 'Settings saved.' });
      if (onSaved) onSaved();
    } catch (err) {
      console.error('[StaffChallengeAdmin] save settings', err);
      setNote({ kind: 'error', msg: err.message || 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={cardShell}>
      <div style={sectionLabel}><SettingsIcon size={14} /> Settings</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
        <div>
          <label style={labelStyle}>Staff PIN</label>
          <input style={inputStyle} value={form.pin} onChange={set('pin')} inputMode="numeric" placeholder="e.g. 1234" />
        </div>
        <div>
          <label style={labelStyle}>List size</label>
          <input style={inputStyle} value={form.list_size} onChange={set('list_size')} inputMode="numeric" placeholder="e.g. 12" />
        </div>
      </div>
      <div style={{ marginTop: '14px', display: 'grid', gap: '14px' }}>
        <div>
          <label style={labelStyle}>Prize — Tier 1 (top)</label>
          <input style={inputStyle} value={form.prize_tier1} onChange={set('prize_tier1')} placeholder="Grand prize copy" />
        </div>
        <div>
          <label style={labelStyle}>Prize — Tier 2</label>
          <input style={inputStyle} value={form.prize_tier2} onChange={set('prize_tier2')} placeholder="Second tier copy" />
        </div>
        <div>
          <label style={labelStyle}>Prize — Tier 3</label>
          <input style={inputStyle} value={form.prize_tier3} onChange={set('prize_tier3')} placeholder="Third tier copy" />
        </div>
        <div>
          <label style={labelStyle}>Participation prize</label>
          <input style={inputStyle} value={form.participation_prize} onChange={set('participation_prize')} placeholder="Everyone who finishes copy" />
        </div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save settings
        </button>
      </div>
      <Note kind={note?.kind}>{note?.msg}</Note>
    </div>
  );
}

// ── Section C: Card pool ────────────────────────────────────────
function CardRow({ card, count, vendors, onDelete, onAddVendor, isMobile }) {
  const [selVendor, setSelVendor] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowNote, setRowNote] = useState(null);

  const addVendor = async () => {
    if (!selVendor) return;
    setAdding(true);
    setRowNote(null);
    try {
      await onAddVendor(card.id, selVendor);
      setSelVendor('');
    } catch (err) {
      setRowNote(err.message || 'Could not add vendor.');
    } finally {
      setAdding(false);
    }
  };

  const del = async () => {
    if (!window.confirm(`Delete "${card.card_name}" from the pool?`)) return;
    setDeleting(true);
    try {
      await onDelete(card.id);
    } catch (err) {
      setRowNote(err.message || 'Could not delete card.');
      setDeleting(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '10px',
      padding: '12px', border: '1px solid #eee', borderRadius: '12px',
      background: '#fafafa',
    }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{
          width: '48px', height: '66px', flexShrink: 0, borderRadius: '8px',
          overflow: 'hidden', background: '#eee',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {card.image_url
            ? <img src={card.image_url} alt={card.card_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <ImageIcon size={18} color="#bbb" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: '#1a1a1a' }}>{card.card_name}</div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
            {[card.set_name, card.number && `#${card.number}`, card.rarity].filter(Boolean).join(' · ') || '—'}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            marginTop: '6px', fontSize: '11px', fontWeight: 700, color: RED,
            background: '#fff0f0', border: '1px solid #fecdd3',
            borderRadius: '999px', padding: '3px 9px',
          }}>
            <Users size={11} /> {count == null ? '…' : count} vendor{count === 1 ? '' : 's'} hold this
          </div>
        </div>
        <button onClick={del} disabled={deleting} title="Delete card" style={{
          ...ghostBtn, padding: '8px', borderColor: '#fecaca', color: '#b91c1c',
        }}>
          {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexDirection: isMobile ? 'column' : 'row' }}>
        <select value={selVendor} onChange={e => setSelVendor(e.target.value)} style={{ ...inputStyle, flex: 1, padding: '9px 10px' }}>
          <option value="">Add a vendor answer…</option>
          {vendors.map(v => (
            <option key={v.id} value={v.id}>{v.business_name || v.name}{v.ig_handle ? ` (${v.ig_handle})` : ''}</option>
          ))}
        </select>
        <button onClick={addVendor} disabled={!selVendor || adding} style={{ ...ghostBtn, opacity: (!selVendor || adding) ? 0.5 : 1 }}>
          {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      {rowNote && (
        <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>{rowNote}</div>
      )}
    </div>
  );
}

function CardPoolSection({ cards, counts, vendors, eventId, onChanged, isMobile }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ card_name: '', set_name: '', number: '', rarity: '', image_url: '' });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const addCard = async () => {
    if (!form.card_name.trim()) { setNote({ kind: 'error', msg: 'Card name is required.' }); return; }
    setSaving(true);
    setNote(null);
    try {
      const maxSort = cards.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
      const { error } = await supabase.from('challenge_cards').insert({
        event_id: eventId,
        card_name: form.card_name.trim(),
        set_name: form.set_name.trim() || null,
        number: form.number.trim() || null,
        rarity: form.rarity.trim() || null,
        image_url: form.image_url.trim() || null,
        sort_order: maxSort + 1,
      });
      if (error) throw error;
      setForm({ card_name: '', set_name: '', number: '', rarity: '', image_url: '' });
      setShowAdd(false);
      setNote({ kind: 'ok', msg: 'Card added.' });
      await onChanged();
    } catch (err) {
      console.error('[StaffChallengeAdmin] add card', err);
      setNote({ kind: 'error', msg: err.message || 'Could not add card.' });
    } finally {
      setSaving(false);
    }
  };

  const deleteCard = async (cardId) => {
    const { error } = await supabase.from('challenge_cards').delete().eq('id', cardId);
    if (error) throw error;
    await onChanged();
  };

  const addVendorAnswer = async (cardId, vendorId) => {
    const { error } = await supabase.from('challenge_card_vendors').insert({
      card_id: cardId, vendor_id: vendorId, added_by: 'staff',
    });
    if (error) {
      if (error.code === '23505') throw new Error('That vendor is already on this card.');
      throw error;
    }
    await onChanged();
  };

  return (
    <div style={cardShell}>
      <div style={{ ...sectionLabel, justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={14} /> Card pool ({cards.length})
        </span>
        <button onClick={() => setShowAdd(s => !s)} style={{ ...ghostBtn, padding: '6px 12px' }}>
          <Plus size={13} /> {showAdd ? 'Close' : 'Add card'}
        </button>
      </div>

      {showAdd && (
        <div style={{
          border: '1px solid #eee', borderRadius: '12px', padding: '14px',
          background: '#fafafa', marginBottom: '16px',
          animation: 'fadeSlide 0.25s ease-out',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Card name *</label>
              <input style={inputStyle} value={form.card_name} onChange={set('card_name')} placeholder="Charizard" />
            </div>
            <div>
              <label style={labelStyle}>Set name</label>
              <input style={inputStyle} value={form.set_name} onChange={set('set_name')} placeholder="Base Set" />
            </div>
            <div>
              <label style={labelStyle}>Number</label>
              <input style={inputStyle} value={form.number} onChange={set('number')} placeholder="4/102" />
            </div>
            <div>
              <label style={labelStyle}>Rarity</label>
              <input style={inputStyle} value={form.rarity} onChange={set('rarity')} placeholder="Rare Holo" />
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={labelStyle}>Image URL</label>
            <input style={inputStyle} value={form.image_url} onChange={set('image_url')} placeholder="https://…" />
          </div>
          <div style={{ marginTop: '12px' }}>
            <button onClick={addCard} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Add to pool
            </button>
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#999', fontSize: '14px' }}>
          No cards in the pool yet. Add one above.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {cards.map(c => (
            <CardRow
              key={c.id}
              card={c}
              count={counts[c.id]}
              vendors={vendors}
              onDelete={deleteCard}
              onAddVendor={addVendorAnswer}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
      <Note kind={note?.kind}>{note?.msg}</Note>
    </div>
  );
}

// ── Section D: Raffle ───────────────────────────────────────────
const BUCKET_DEFS = [
  { window: 'A', tier: 'tier1', label: 'Window A · Tier 1' },
  { window: 'A', tier: 'tier2', label: 'Window A · Tier 2' },
  { window: 'A', tier: 'tier3', label: 'Window A · Tier 3' },
  { window: 'B', tier: 'tier1', label: 'Window B · Tier 1' },
  { window: 'B', tier: 'tier2', label: 'Window B · Tier 2' },
  { window: 'B', tier: 'tier3', label: 'Window B · Tier 3' },
];

function RaffleSection({ eventId, isMobile }) {
  const [rows, setRows] = useState(null); // null = not drawn yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [spinToken, setSpinToken] = useState(0);
  const [copied, setCopied] = useState(false);
  const [winners, setWinners] = useState([]); // collected after each spin settles

  // Group rows into the 6 fixed buckets.
  const buckets = BUCKET_DEFS.map(def => ({
    def,
    members: (rows || []).filter(r => r.time_window === def.window && r.tier === def.tier),
  }));

  const draw = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    setWinners([]);
    try {
      const { data, error: rpcErr } = await supabase.rpc('challenge_qualifiers', { p_event_id: eventId });
      if (rpcErr) throw rpcErr;
      setRows(data || []);
      // Bump token on next tick so the freshly-rendered buckets pick it up.
      setTimeout(() => setSpinToken(t => t + 1), 60);
    } catch (err) {
      console.error('[StaffChallengeAdmin] challenge_qualifiers', err);
      setError(err.message || 'Could not load qualifiers.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // After a spin token fires, deterministically recompute the winner set so the
  // "Copy emails" list matches what the wheels landed on. We reuse the same RNG
  // contract as the wheels by having each wheel report; simpler: recompute here
  // by re-picking is unsafe, so we let wheels be the source of truth via a small
  // registration effect below.
  const winnerRef = useRef({});
  const registerWinner = useCallback((key, winner) => {
    winnerRef.current[key] = winner;
    setWinners(BUCKET_DEFS.map(d => winnerRef.current[`${d.window}-${d.tier}`]).filter(Boolean));
  }, []);

  const copyEmails = async () => {
    const emails = winners.map(w => w.email).filter(Boolean).join(', ');
    if (!emails) return;
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: temporary textarea
      const ta = document.createElement('textarea');
      ta.value = emails;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div style={cardShell}>
      <div style={{ ...sectionLabel, justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={14} /> Raffle
        </span>
        <button onClick={draw} disabled={loading} style={{ ...primaryBtn, padding: '8px 14px', opacity: loading ? 0.6 : 1 }}>
          {loading ? <Loader2 size={14} className="spin" /> : (rows ? <RefreshCw size={14} /> : <Play size={14} />)}
          {rows ? 'Re-draw' : 'Draw winners'}
        </button>
      </div>

      {error && <Note kind="error">{error}</Note>}

      {rows == null ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#999', fontSize: '14px' }}>
          Press "Draw winners" to spin each of the 6 buckets.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
          }}>
            {buckets.map((b) => (
              <WheelBucketRegistered
                key={b.def.label}
                def={b.def}
                members={b.members}
                spinToken={spinToken}
                onSettled={registerWinner}
              />
            ))}
          </div>

          {winners.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <button onClick={copyEmails} style={ghostBtn}>
                {copied ? <Check size={14} color="#047857" /> : <Copy size={14} />}
                {copied ? 'Copied' : `Copy winner emails (${winners.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Wraps WheelBucket to report its landed winner up to the parent for the
// "Copy emails" list, keeping the wheel the single source of truth.
function WheelBucketRegistered({ def, members, spinToken, onSettled }) {
  const key = `${def.window}-${def.tier}`;
  return (
    <WheelBucketReporter
      def={def}
      members={members}
      spinToken={spinToken}
      onWinner={(w) => onSettled(key, w)}
    />
  );
}

// WheelBucket variant that calls onWinner once it settles.
function WheelBucketReporter({ def, members, spinToken, onWinner }) {
  const [highlight, setHighlight] = useState(-1);
  const [winner, setWinner] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!spinToken) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setWinner(null);
    const n = members.length;
    if (n === 0) { setHighlight(-1); setSpinning(false); return; }
    if (n === 1) { setHighlight(0); setWinner(members[0]); setSpinning(false); onWinner(members[0]); return; }

    const winnerIdx = Math.floor(Math.random() * n);
    const totalSteps = n * 3 + winnerIdx;
    let step = 0;
    setSpinning(true);
    const tick = () => {
      setHighlight(step % n);
      if (step >= totalSteps) {
        setWinner(members[winnerIdx]);
        setSpinning(false);
        onWinner(members[winnerIdx]);
        return;
      }
      const progress = step / totalSteps;
      const delay = 45 + progress * progress * 260;
      step += 1;
      timerRef.current = setTimeout(tick, delay);
    };
    tick();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken]);

  const nameOf = (m) => m?.display_name || m?.email || '—';
  const tierLabel = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3' }[def.tier];

  return (
    <div style={{ border: '1px solid #eee', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
      <div style={{
        background: '#1a1a1a', color: '#fff', padding: '8px 12px',
        fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em',
        textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{def.label}</span>
        <span style={{ color: '#9ca3af' }}>{members.length}</span>
      </div>
      <div style={{ padding: '12px', minHeight: '76px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {members.length === 0 ? (
          <div style={{ color: '#999', fontSize: '13px', fontStyle: 'italic' }}>No qualifiers.</div>
        ) : winner && !spinning ? (
          <div style={{ textAlign: 'center', animation: 'fadeSlide 0.3s ease-out' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '11px', fontWeight: 800, color: '#047857',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px',
            }}>
              <Trophy size={12} /> Winner
            </div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a1a' }}>{nameOf(winner)}</div>
            <div style={{ fontSize: '12px', color: '#666', wordBreak: 'break-all' }}>{winner.email}</div>
            <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{tierLabel} · Window {def.window}</div>
          </div>
        ) : spinning ? (
          <div style={{ fontSize: '15px', fontWeight: 800, color: RED, textAlign: 'center' }}>
            {nameOf(members[highlight >= 0 ? highlight : 0])}
          </div>
        ) : (
          <div style={{ color: '#bbb', fontSize: '13px' }}>Ready</div>
        )}
      </div>
    </div>
  );
}

// ── Root component ──────────────────────────────────────────────
export default function StaffChallengeAdmin({ eventId = DEFAULT_EVENT_ID, isMobile }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [cards, setCards] = useState([]);
  const [counts, setCounts] = useState({});
  const [vendors, setVendors] = useState([]);
  const [toggling, setToggling] = useState(false);

  const evId = eventId || DEFAULT_EVENT_ID;

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [settingsRes, summaryRes, cardsRes, vendorsRes] = await Promise.all([
        supabase.from('challenge_settings').select('*').eq('event_id', evId).maybeSingle(),
        supabase.rpc('challenge_admin_summary', { p_event_id: evId }),
        supabase.from('challenge_cards').select('*').eq('event_id', evId).order('sort_order', { ascending: true }),
        supabase.from('vendors').select('id, name, business_name, ig_handle, avatar_url, status').eq('status', 'approved').order('business_name', { ascending: true }),
      ]);

      if (settingsRes.error) throw settingsRes.error;
      setSettings(settingsRes.data || null);

      if (summaryRes.error) console.error('[StaffChallengeAdmin] summary', summaryRes.error);
      const sm = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
      setSummary(sm || null);

      if (cardsRes.error) throw cardsRes.error;
      const cardList = cardsRes.data || [];
      setCards(cardList);

      if (vendorsRes.error) console.error('[StaffChallengeAdmin] vendors', vendorsRes.error);
      setVendors(vendorsRes.data || []);

      // Vendor-hold counts per card.
      const cardIds = cardList.map(c => c.id);
      if (cardIds.length) {
        const { data: cvRows, error: cvErr } = await supabase
          .from('challenge_card_vendors')
          .select('card_id')
          .in('card_id', cardIds);
        if (cvErr) {
          console.error('[StaffChallengeAdmin] card_vendors count', cvErr);
          setCounts({});
        } else {
          const map = {};
          cardIds.forEach(id => { map[id] = 0; });
          (cvRows || []).forEach(r => { map[r.card_id] = (map[r.card_id] || 0) + 1; });
          setCounts(map);
        }
      } else {
        setCounts({});
      }
    } catch (err) {
      console.error('[StaffChallengeAdmin] loadAll', err);
      setError(err.message || 'Could not load challenge admin data.');
    } finally {
      setLoading(false);
    }
  }, [evId]);

  useEffect(() => { setLoading(true); loadAll(); }, [loadAll]);

  const toggleActive = async () => {
    if (!settings) return;
    setToggling(true);
    const next = !settings.active;
    try {
      const { error: upErr } = await supabase
        .from('challenge_settings')
        .update({ active: next })
        .eq('event_id', evId);
      if (upErr) throw upErr;
      setSettings(s => ({ ...s, active: next }));
    } catch (err) {
      console.error('[StaffChallengeAdmin] toggleActive', err);
      setError(err.message || 'Could not toggle status.');
    } finally {
      setToggling(false);
    }
  };

  // Refresh just the pool-related data (cards + counts) after edits.
  const refreshPool = useCallback(async () => {
    try {
      const { data: cardList, error: cErr } = await supabase
        .from('challenge_cards').select('*').eq('event_id', evId).order('sort_order', { ascending: true });
      if (cErr) throw cErr;
      setCards(cardList || []);
      const cardIds = (cardList || []).map(c => c.id);
      if (cardIds.length) {
        const { data: cvRows } = await supabase.from('challenge_card_vendors').select('card_id').in('card_id', cardIds);
        const map = {};
        cardIds.forEach(id => { map[id] = 0; });
        (cvRows || []).forEach(r => { map[r.card_id] = (map[r.card_id] || 0) + 1; });
        setCounts(map);
      } else {
        setCounts({});
      }
    } catch (err) {
      console.error('[StaffChallengeAdmin] refreshPool', err);
    }
  }, [evId]);

  const refreshSummary = useCallback(async () => {
    const { data } = await supabase.rpc('challenge_admin_summary', { p_event_id: evId });
    const sm = Array.isArray(data) ? data[0] : data;
    setSummary(sm || null);
  }, [evId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
        <Loader2 size={24} className="spin" />
        <div style={{ marginTop: '10px', fontSize: '14px' }}>Loading challenge admin…</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: isMobile ? '0 4px' : 0 }}>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 900, color: '#1a1a1a', margin: '0 0 4px' }}>
          Dexter's Challenge — Admin
        </h2>
        <div style={{ fontSize: '13px', color: '#666' }}>Manage status, settings, the card pool, and the raffle.</div>
      </div>

      {error && (
        <div style={{ marginBottom: '16px' }}>
          <Note kind="error">{error}</Note>
        </div>
      )}

      {!settings && !error && (
        <div style={{ ...cardShell, textAlign: 'center', color: '#999' }}>
          No challenge settings row found for this event.
        </div>
      )}

      {settings && (
        <StatusSection settings={settings} summary={summary} onToggle={toggleActive} toggling={toggling} />
      )}
      {settings && (
        <SettingsSection settings={settings} eventId={evId} onSaved={() => { loadAll(); }} />
      )}
      <CardPoolSection
        cards={cards}
        counts={counts}
        vendors={vendors}
        eventId={evId}
        onChanged={async () => { await refreshPool(); await refreshSummary(); }}
        isMobile={isMobile}
      />
      <RaffleSection eventId={evId} isMobile={isMobile} />
    </div>
  );
}
