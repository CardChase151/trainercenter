import React from 'react';
import { supabase } from '../supabaseClient';
import { Check, Lock, Loader2, AlertCircle, PackageCheck } from 'lucide-react';

const RED = '#C8102E';
const DEFAULT_EVENT_ID = '3717f8d5-772a-42a9-ab09-bb6fe04ae349';

// ─── Vendor Challenge Checklist ──────────────────────────────
// A vendor sees the "Pokedex July 31" card pool and marks which cards
// they also have in stock. Toggling ON inserts a challenge_card_vendors
// row (added_by:'vendor'); OFF deletes it. The card the vendor originally
// brought (source_vendor_id === vendorId) is locked on ("You brought this").
export default function VendorChallengeChecklist({ eventId = DEFAULT_EVENT_ID, vendorId, isMobile }) {
  const [cards, setCards] = React.useState([]);
  const [checked, setChecked] = React.useState(() => new Set()); // card_ids this vendor holds
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);
  const [busy, setBusy] = React.useState(() => new Set());       // card_ids mid-request
  const [rowError, setRowError] = React.useState(null);          // { cardId, msg }

  React.useEffect(() => {
    if (!vendorId) { setLoading(false); setLoadError('Missing vendor.'); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [cardsRes, minesRes] = await Promise.all([
          supabase
            .from('challenge_cards')
            .select('id, card_name, set_name, number, rarity, image_url, source_vendor_id, sort_order')
            .eq('event_id', eventId)
            .order('sort_order', { ascending: true }),
          supabase
            .from('challenge_card_vendors')
            .select('card_id')
            .eq('vendor_id', vendorId),
        ]);
        if (cancelled) return;
        if (cardsRes.error) throw cardsRes.error;
        if (minesRes.error) throw minesRes.error;
        setCards(cardsRes.data || []);
        setChecked(new Set((minesRes.data || []).map(r => r.card_id)));
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load the card list.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, vendorId]);

  async function toggle(card) {
    const cardId = card.id;
    const isBrought = card.source_vendor_id === vendorId;
    if (isBrought) return;               // locked on — can't un-check
    if (busy.has(cardId)) return;

    const currentlyOn = checked.has(cardId);
    setRowError(null);
    setBusy(prev => new Set(prev).add(cardId));

    // Optimistic flip
    setChecked(prev => {
      const next = new Set(prev);
      if (currentlyOn) next.delete(cardId); else next.add(cardId);
      return next;
    });

    try {
      if (currentlyOn) {
        const { error } = await supabase
          .from('challenge_card_vendors')
          .delete()
          .eq('card_id', cardId)
          .eq('vendor_id', vendorId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('challenge_card_vendors')
          .insert({ card_id: cardId, vendor_id: vendorId, added_by: 'vendor' });
        if (error) throw error;
      }
    } catch (err) {
      // Roll back optimistic change
      setChecked(prev => {
        const next = new Set(prev);
        if (currentlyOn) next.add(cardId); else next.delete(cardId);
        return next;
      });
      setRowError({ cardId, msg: err.message || 'Could not save. Try again.' });
    } finally {
      setBusy(prev => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    }
  }

  const pad = isMobile ? '16px' : '24px';

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ padding: pad, display: 'flex', alignItems: 'center', gap: '10px', color: '#666', fontSize: '14px' }}>
        <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
        Loading the Pokedex...
      </div>
    );
  }

  // ── Load error ──
  if (loadError) {
    return (
      <div style={{ padding: pad }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: '#fef2f2', border: `1px solid ${RED}33`, color: RED,
          borderRadius: '12px', padding: '14px 16px', fontSize: '14px', fontWeight: 700,
        }}>
          <AlertCircle size={18} />
          {loadError}
        </div>
      </div>
    );
  }

  const checkedCount = cards.reduce((n, c) => n + (checked.has(c.id) ? 1 : 0), 0);

  return (
    <div style={{ padding: pad, maxWidth: '760px', margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '12px',
          background: '#fff0f0', color: RED,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <PackageCheck size={22} />
        </div>
        <h1 style={{ fontSize: isMobile ? '1.35rem' : '1.6rem', fontWeight: 900, color: '#1a1a1a', margin: 0 }}>
          Pokedex July 31
        </h1>
      </div>

      <p style={{ fontSize: '13px', color: '#666', lineHeight: 1.5, margin: '0 0 8px' }}>
        Check any of these cards you also have in stock — you'll count as a correct answer for that card in
        Dexter's Challenge.
      </p>

      <div style={{ fontSize: '12px', fontWeight: 800, color: RED, marginBottom: '18px' }}>
        {checkedCount} of {cards.length} marked in stock
      </div>

      {cards.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px', fontStyle: 'italic' }}>
          No cards in the pool yet.
        </div>
      )}

      {/* Card list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {cards.map(card => {
          const isBrought = card.source_vendor_id === vendorId;
          const isOn = isBrought || checked.has(card.id);
          const isBusy = busy.has(card.id);
          const err = rowError && rowError.cardId === card.id ? rowError.msg : null;

          return (
            <div
              key={card.id}
              onClick={() => toggle(card)}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                background: '#ffffff',
                border: isOn ? `2px solid ${RED}` : '2px solid #eee',
                borderRadius: '14px',
                padding: isMobile ? '12px' : '14px 16px',
                cursor: isBrought ? 'default' : 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                opacity: isBusy ? 0.7 : 1,
              }}
            >
              {/* Card image */}
              <div style={{
                width: isMobile ? '52px' : '60px',
                height: isMobile ? '72px' : '84px',
                borderRadius: '8px', overflow: 'hidden', flexShrink: 0,
                background: '#f3f4f6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {card.image_url ? (
                  <img
                    src={card.image_url}
                    alt={card.card_name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ fontSize: '10px', color: '#bbb' }}>No image</span>
                )}
              </div>

              {/* Card details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? '0.95rem' : '1rem', fontWeight: 800, color: '#1a1a1a', marginBottom: '2px' }}>
                  {card.card_name}
                </div>
                <div style={{ fontSize: '12px', color: '#666', lineHeight: 1.4 }}>
                  {[card.set_name, card.number ? `#${card.number}` : null, card.rarity]
                    .filter(Boolean)
                    .join('  ·  ')}
                </div>
                {isBrought && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    marginTop: '6px',
                    background: '#fff0f0', color: RED,
                    border: `1px solid ${RED}33`,
                    padding: '3px 10px', borderRadius: '999px',
                    fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    <Lock size={11} strokeWidth={3} />
                    You brought this
                  </div>
                )}
                {err && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: RED, fontWeight: 700 }}>
                    {err}
                  </div>
                )}
              </div>

              {/* Toggle indicator */}
              <div style={{ flexShrink: 0 }}>
                {isBrought ? (
                  <div style={{
                    width: '44px', height: '26px', borderRadius: '999px',
                    background: RED, position: 'relative', opacity: 0.6,
                  }}>
                    <div style={{
                      position: 'absolute', top: '3px', right: '3px',
                      width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Lock size={11} color={RED} strokeWidth={3} />
                    </div>
                  </div>
                ) : (
                  <div style={{
                    width: '44px', height: '26px', borderRadius: '999px',
                    background: isOn ? RED : '#d1d5db',
                    position: 'relative', transition: 'background 0.15s',
                  }}>
                    <div style={{
                      position: 'absolute', top: '3px',
                      left: isOn ? '21px' : '3px',
                      width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'left 0.15s',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }}>
                      {isBusy
                        ? <Loader2 size={12} color={RED} style={{ animation: 'spin 1s linear infinite' }} />
                        : (isOn ? <Check size={12} color={RED} strokeWidth={3} /> : null)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: '11px', color: '#999', lineHeight: 1.5, margin: '18px 0 0' }}>
        "I have this card in stock" — toggling on lists you as a valid answer for guests hunting that card.
      </p>
    </div>
  );
}
