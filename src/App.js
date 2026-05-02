import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from 'react';
import { Link, Routes, Route, Navigate, useLocation, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import BLOG_DATA from './blogData';
import { supabase } from './supabaseClient';
import { Lock, Unlock, Menu, X, Phone, MapPin, Clock, Award, ShoppingBag, GraduationCap, Mail, Users, Calendar as CalendarIcon, CheckCircle2, AlertCircle, ArrowRight, LogOut, Loader2, Image as ImageIcon, Film, Trash2, Upload as UploadIcon, Edit2, Plus, Instagram, Facebook, ChevronDown, List, Grid3x3 } from 'lucide-react';
import * as tus from 'tus-js-client';
import './App.css';

const IgIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

// ─── Time formatting helper (shared) ──────────────────────
// Converts "18:00" or "18:00:00" → "6:00 PM"
const formatTime12h = (t) => {
  if (!t) return '';
  const [h, m] = t.slice(0, 5).split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
};

// Format an ISO timestamp to a relative-friendly local string
const formatAuditTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
};

// ─── Scroll To Top on Route Change ──────────────────────
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// ─── Photo Grid ───────────────────────────────────────────
function PhotoGrid({ photos, isMobile }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(250px, 1fr))' : 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '16px'
    }}>
      {photos.map((photo, i) => (
        <div key={i} style={{
          borderRadius: '14px',
          overflow: 'hidden',
          border: '1px solid #eee',
          backgroundColor: '#fff',
          transition: 'transform 0.2s, box-shadow 0.2s',
          cursor: 'pointer'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        >
          <img
            src={photo.src}
            alt={photo.alt}
            style={{
              width: '100%',
              height: '240px',
              objectFit: 'cover',
              display: 'block'
            }}
          />
          {photo.caption && (
            <div style={{ padding: '14px 16px' }}>
              <p style={{
                fontSize: '0.85rem',
                fontWeight: '600',
                color: '#444',
                margin: 0
              }}>
                {photo.caption}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '8px'
      }}>
        <div style={{
          width: '4px',
          height: '28px',
          backgroundColor: '#C8102E',
          borderRadius: '2px'
        }} />
        <h2 style={{
          fontSize: '1.4rem',
          fontWeight: '800',
          color: '#C8102E',
          margin: 0,
          letterSpacing: '0.06em',
          textTransform: 'uppercase'
        }}>
          {title}
        </h2>
      </div>
      {subtitle && (
        <p style={{ color: '#999', fontSize: '0.85rem', marginBottom: '28px', marginLeft: '16px', marginTop: '4px' }}>
          {subtitle}
        </p>
      )}
    </>
  );
}


// ─── Calendar Component ───────────────────────────────────
// ─── Staff Login Modal ────────────────────────────────────
function StaffLogin({ onClose, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showVendorLink, setShowVendorLink] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setShowVendorLink(false);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    // Auth succeeded -- now gate on is_admin. Non-admins are signed back
    // out so they don't end up in a half-authenticated state.
    const userId = data?.user?.id;
    let isAdmin = false;
    if (userId) {
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', userId).maybeSingle();
      isAdmin = !!profile?.is_admin;
    }
    if (!isAdmin) {
      await supabase.auth.signOut();
      setError("That email isn't on the staff list.");
      setShowVendorLink(true);
      setLoading(false);
      return;
    }
    onLogin();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }} onClick={onClose}>
      <div style={{
        backgroundColor: '#fff', borderRadius: '16px', padding: '32px',
        width: '100%', maxWidth: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>Staff Login</h2>
        <p style={{ fontSize: '0.8rem', color: '#999', margin: '0 0 20px 0' }}>Trainer Center HB staff only</p>
        <form onSubmit={handleLogin}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            style={{
              width: '100%', padding: '12px 14px', fontSize: '0.9rem', border: '1px solid #ddd',
              borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box', outline: 'none'
            }}
          />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            style={{
              width: '100%', padding: '12px 14px', fontSize: '0.9rem', border: '1px solid #ddd',
              borderRadius: '8px', marginBottom: '16px', boxSizing: 'border-box', outline: 'none'
            }}
          />
          {error && (
            <div style={{ margin: '0 0 12px 0' }}>
              <p style={{ color: '#C8102E', fontSize: '0.8rem', margin: '0 0 4px 0' }}>{error}</p>
              {showVendorLink && (
                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>
                  Are you a vendor?{' '}
                  <Link
                    to="/vendors/dashboard"
                    onClick={onClose}
                    style={{ color: '#C8102E', fontWeight: 700, textDecoration: 'none' }}
                  >
                    Vendor sign-in →
                  </Link>
                </p>
              )}
            </div>
          )}
          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '12px', backgroundColor: '#C8102E', color: '#fff',
            border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '0.9rem',
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1
          }}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Site Context ─────────────────────────────────────────
// Holds editable site config (Visit Us section) + active/upcoming
// special-hours overrides. Provided by App, consumed by VisitUsSection,
// OpenNowBanner, and Footer.
const SiteContext = createContext({
  siteSettings: null,
  specialHours: [],
  isAdmin: false,
  refresh: () => {},
});
const useSite = () => useContext(SiteContext);

// ─── Auth Context ─────────────────────────────────────────
// Single source of truth for "who is this person and what roles do they
// have right now." App subscribes to supabase.auth.onAuthStateChange ONCE
// at root and fetches profile + vendor + member rows in parallel on every
// session change. Dashboards (VendorDashboardPage, VendorReviewPage) and
// the lock icon all consume this instead of running their own listeners,
// so navigation between routes is instant (no per-page session refetch).
//
// Roles layer on top of one auth.users account:
//   profiles.is_admin = true → Staff (can edit)
//   row in vendors            → Vendor
//   row in members            → Guest (UI term; DB stays "members")
// The same person can be all three.
const AuthContext = createContext({
  session: null,
  user: null,
  profile: null,
  vendor: null,
  member: null,
  isAdmin: false,
  isVendor: false,
  isGuest: false,
  isLoading: true,
  signOut: async () => {},
  refresh: async () => {},
});
const useAuth = () => useContext(AuthContext);

// Resolve which special_hours entry (if any) covers a given YYYY-MM-DD.
// Returns the row, or null if no override applies.
function specialHoursForDate(specialHours, isoDate) {
  if (!specialHours) return null;
  for (const sh of specialHours) {
    if (isoDate >= sh.start_date && isoDate <= sh.end_date) return sh;
  }
  return null;
}

// Single source of truth for "is the shop open right now." Reads from the
// site_settings.hours map (DB-driven) and applies any special_hours overrides
// for today. Used by the homepage OpenNowBanner and the Calendar page pill so
// they can never disagree.
function computeOpenNowState(siteSettings, specialHours) {
  if (!siteSettings) return { isOpen: false, effectiveRange: null };
  const toFractionalHour = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
  };
  const hoursMap = siteSettings.hours || {};
  const dow = new Date().getDay();
  const todaySpecial = specialHoursForDate(specialHours, todayISO());

  let effectiveRange = null;
  const regular = hoursMap[dow];
  if (regular) effectiveRange = [toFractionalHour(regular.open), toFractionalHour(regular.close)];
  if (todaySpecial) {
    effectiveRange = todaySpecial.closed
      ? null
      : [toFractionalHour(todaySpecial.open_time), toFractionalHour(todaySpecial.close_time)];
  }

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const isOpen = !!effectiveRange && currentHour >= effectiveRange[0] && currentHour < effectiveRange[1];
  return { isOpen, effectiveRange };
}

// Pretty-format "10:00" → "10 AM", "14:30" → "2:30 PM", "Closed" if null
function formatTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  if (h12 === 12 && period === 'PM' && m === 0) return 'Noon';
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Category Colors ──────────────────────────────────────
// The 8 locked-in event categories. These drive: calendar grid colors, the
// "Check out our events" filter chips above the calendar, calendar event tags,
// and (for the marked subscribable ones below) per-category email subs.
// `description` is shown as the chip subtitle and used for SEO meta copy.
const CATEGORIES = {
  trade_night:  { label: 'Trade Night',  color: '#C8102E', description: 'Bring cards. Trade with the community. Walk out with the binder you have been chasing.' },
  tournament:   { label: 'Tournament',   color: '#2563eb', description: 'Compete in TCG, video games, or board games. Prizes for top finishers.' },
  game_day:     { label: 'Game Day',     color: '#0891b2', description: 'Video games, board games, TCG. Bring your stuff or play what is at the shop.' },
  crafts:       { label: 'Crafts & Art', color: '#ec4899', description: 'Family-friendly. Paint Pokemon, do crafts, hang out.' },
  consultation: { label: 'Consultations',color: '#059669', description: 'Book 1-on-1 with Chef for appraisals, strategy, or learn the TCG.' },
  card_show:    { label: 'Card Show',    color: '#7c3aed', description: 'Card shows we host at Trainer Center, plus signings and in-store special days.' },
  on_the_road:  { label: 'On the Road',  color: '#d97706', description: 'Off-site shows where you can find us — Front Row, conventions, regional trade days.' },
  other:        { label: 'Other',        color: '#ea580c', description: 'Everything else on the schedule.' },
};

// ─── Event Modal (Add/Edit) ───────────────────────────────
function EventModal({ date, existingEvents, onClose, onSave, onDelete, onCancelEvent, isMobile, staff }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('20:00');
  const [location, setLocation] = useState('');
  const [categories, setCategories] = useState(['other']);
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [hasVendors, setHasVendors] = useState(false);
  const [vendorStartTime, setVendorStartTime] = useState('');
  const [vendorEndTime, setVendorEndTime] = useState('');
  const [vendorNote, setVendorNote] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventToDelete, setEventToDelete] = useState(null);

  const dateStr = `${date.toLocaleString('default', { month: 'long' })} ${date.getDate()}, ${date.getFullYear()}`;

  const resetForm = () => {
    setTitle(''); setDescription(''); setStartTime('18:00'); setEndTime('20:00');
    setLocation(''); setCategories(['other']); setRecurrence('none'); setRecurrenceEndDate('');
    setHasVendors(false); setVendorStartTime(''); setVendorEndTime(''); setVendorNote('');
    setEditingEvent(null);
  };

  const loadEvent = (event) => {
    setEditingEvent(event);
    setTitle(event.title);
    setDescription(event.description || '');
    setStartTime(event.start_time?.slice(0, 5) || '18:00');
    setEndTime(event.end_time?.slice(0, 5) || '20:00');
    setLocation(event.location || '');
    setCategories(event.categories?.length ? event.categories : ['other']);
    setRecurrence(event.recurrence || 'none');
    setRecurrenceEndDate(event.recurrence_end_date || '');
    setHasVendors(!!event.has_vendors);
    setVendorStartTime(event.vendor_start_time?.slice(0, 5) || '');
    setVendorEndTime(event.vendor_end_time?.slice(0, 5) || '');
    setVendorNote(event.vendor_note || '');
  };

  // When Add Vendors flips on, default the vendor window to the event's
  // current start/end so staff don't retype the common case (vendor window
  // matches the event window). They can override after.
  const toggleHasVendors = (next) => {
    setHasVendors(next);
    if (next) {
      if (!vendorStartTime) setVendorStartTime(startTime);
      if (!vendorEndTime) setVendorEndTime(endTime);
    }
  };

  const clearRecurrence = () => {
    setRecurrence('none');
    setRecurrenceEndDate('');
  };

  const handleSave = () => {
    if (!title.trim()) return;
    const dateFormatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const eventData = {
      title: title.trim(),
      description: description.trim() || null,
      event_date: dateFormatted,
      start_time: startTime,
      end_time: endTime,
      location: location.trim() || null,
      categories: categories.length > 0 ? categories : ['other'],
      recurrence,
      recurrence_end_date: recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null,
      has_vendors: hasVendors,
      vendor_start_time: hasVendors ? (vendorStartTime || startTime) : null,
      vendor_end_time: hasVendors ? (vendorEndTime || endTime) : null,
      vendor_note: hasVendors ? (vendorNote.trim() || null) : null,
    };
    if (editingEvent?.id) {
      eventData.id = editingEvent.id;
      eventData.updated_by = staff?.id || null;
      eventData.updated_by_name = staff?.name || null;
    } else {
      eventData.created_by = staff?.id || null;
      eventData.created_by_name = staff?.name || null;
    }
    onSave(eventData);
    resetForm();
  };

  // Inputs use 16px font on mobile to prevent iOS Safari's zoom-on-focus.
  const inputStyle = {
    width: '100%', padding: '12px 14px', fontSize: '16px', border: '1px solid #ddd',
    borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box', outline: 'none',
    fontFamily: 'inherit'
  };

  const textareaStyle = {
    ...inputStyle,
    minHeight: '90px',
    resize: 'vertical',
    lineHeight: '1.4'
  };

  // On mobile, the modal becomes a full-screen sheet. On desktop it's a centered card.
  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    justifyContent: 'center',
    padding: isMobile ? '0' : '24px'
  };

  // Container is a flex column. Header + footer are flex-shrink:0; body
  // takes the remaining space and scrolls. overflow:hidden on the container
  // makes the rounded corners actually clip the inner content (otherwise the
  // scrolling area paints over the corners).
  const containerStyle = isMobile
    ? {
        backgroundColor: '#fff',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        backgroundColor: '#fff', borderRadius: '16px',
        width: '100%', maxWidth: '480px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      };
  const headerStyle = {
    padding: isMobile ? '16px 20px 12px' : '22px 28px 14px',
    borderBottom: '1px solid #f0f0f0',
    flexShrink: 0,
    backgroundColor: '#fff',
  };
  const bodyStyle = {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: isMobile ? '14px 20px' : '16px 28px',
  };
  const footerStyle = {
    padding: isMobile ? '12px 20px 24px' : '14px 28px 22px',
    borderTop: '1px solid #f0f0f0',
    flexShrink: 0,
    backgroundColor: '#fff',
    display: 'flex',
    gap: '8px',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={containerStyle} onClick={e => e.stopPropagation()}>
        {/* Sticky header — title swaps between Add and Edit modes so it's
            always obvious which event the form is targeting. */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {editingEvent ? (
                <>
                  <button onClick={resetForm} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#666', fontSize: '0.78rem', fontWeight: '700',
                    padding: 0, marginBottom: '4px',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}>
                    ← Back to events on this day
                  </button>
                  <p style={{ fontSize: '0.7rem', color: '#C8102E', fontWeight: '800', margin: '0 0 2px 0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Editing
                  </p>
                  <h2 style={{
                    fontSize: '1.15rem', fontWeight: '800', color: '#1a1a1a',
                    margin: '0 0 2px 0',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {editingEvent.title}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: '#888', margin: 0 }}>
                    {dateStr}
                    {editingEvent.start_time && ` · ${formatTime12h(editingEvent.start_time)} – ${formatTime12h(editingEvent.end_time)}`}
                  </p>
                </>
              ) : (
                <>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 2px 0' }}>
                    {dateStr}
                  </h2>
                  <p style={{ fontSize: '0.8rem', color: '#999', margin: 0 }}>
                    {existingEvents.length > 0 ? `${existingEvents.length} event${existingEvents.length === 1 ? '' : 's'} on this day · Add another` : 'Add a new event'}
                  </p>
                </>
              )}
            </div>
            <button onClick={onClose} style={{
              background: '#f0f0f0', border: 'none', borderRadius: '50%',
              width: '36px', height: '36px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={bodyStyle}>
        {/* Audit info — only when editing */}
        {editingEvent && (editingEvent.created_by_name || editingEvent.updated_by_name) && (
          <div style={{
            backgroundColor: '#fafafa', border: '1px solid #eee', borderRadius: '8px',
            padding: '8px 12px', marginBottom: '12px', fontSize: '0.75rem', color: '#666',
            lineHeight: '1.5'
          }}>
            {editingEvent.created_by_name && (
              <div>Created by <strong>{editingEvent.created_by_name}</strong>{editingEvent.created_at ? ` · ${formatAuditTime(editingEvent.created_at)}` : ''}</div>
            )}
            {editingEvent.updated_by_name && (
              <div>Last edited by <strong>{editingEvent.updated_by_name}</strong>{editingEvent.updated_at ? ` · ${formatAuditTime(editingEvent.updated_at)}` : ''}</div>
            )}
          </div>
        )}

        {/* Existing events on this day */}
        {existingEvents.length > 0 && !editingEvent && (
          <div style={{ marginBottom: '16px' }}>
            {existingEvents.map(ev => (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', backgroundColor: '#f8f8f8', borderRadius: '8px',
                marginBottom: '6px', border: '1px solid #eee'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: CATEGORIES[(ev.categories || [])[0]]?.color || '#ea580c'
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: '700', fontSize: '0.85rem',
                      color: ev.cancelled ? '#999' : '#1a1a1a',
                      textDecoration: ev.cancelled ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {ev.title}
                      {ev.cancelled && (
                        <span style={{
                          marginLeft: '6px', fontSize: '0.65rem', fontWeight: '800',
                          color: '#dc2626', backgroundColor: '#fef2f2',
                          padding: '1px 6px', borderRadius: '4px',
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          textDecoration: 'none'
                        }}>
                          Cancelled
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>
                      {formatTime12h(ev.start_time)} - {formatTime12h(ev.end_time)}
                      {ev.recurrence !== 'none' && <span style={{ color: '#C8102E', marginLeft: '8px' }}>{ev.recurrence}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => loadEvent(ev)} style={{
                    background: '#eee', border: 'none', borderRadius: '6px', padding: '6px 10px',
                    fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer'
                  }}>Edit</button>
                  <button onClick={() => setEventToDelete(ev)} style={{
                    background: '#fee', border: 'none', borderRadius: '6px', padding: '6px 10px',
                    fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', color: '#C8102E'
                  }}>Delete</button>
                </div>
              </div>
            ))}
            <div style={{ borderBottom: '1px solid #eee', margin: '12px 0' }} />
          </div>
        )}

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Title</label>
        <input placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Description (optional)</label>
        <textarea
          placeholder="Use **bold** or *italic* for emphasis. Press Enter for new lines."
          value={description}
          onChange={e => setDescription(e.target.value)}
          style={textareaStyle}
        />
        <div style={{ fontSize: '0.7rem', color: '#aaa', margin: '-4px 0 12px 2px' }}>
          Markdown supported: <strong>**bold**</strong> · <em>*italic*</em>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Start</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>End</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Location (optional)</label>
        <input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} />

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Categories (pick all that apply)</label>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '6px', marginBottom: '10px'
        }}>
          {Object.entries(CATEGORIES).map(([key, { label, color }]) => {
            const checked = categories.includes(key);
            return (
              <label key={key} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px',
                backgroundColor: checked ? color : '#fafafa',
                color: checked ? '#fff' : '#444',
                borderRadius: '8px',
                border: `1px solid ${checked ? color : '#ddd'}`,
                cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: '600',
                userSelect: 'none'
              }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setCategories(prev => checked
                      ? prev.filter(c => c !== key)
                      : [...prev, key]
                    );
                  }}
                  style={{ accentColor: '#fff' }}
                />
                {label}
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
          <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Repeat</label>
          {recurrence !== 'none' && (
            <button
              type="button"
              onClick={clearRecurrence}
              style={{
                background: 'none', border: 'none', color: '#C8102E',
                fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer', padding: '4px 8px'
              }}
            >
              Clear repeat
            </button>
          )}
        </div>
        <select value={recurrence} onChange={e => setRecurrence(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="none">Does not repeat</option>
          <option value="weekly">Every week</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Every month</option>
        </select>

        {recurrence !== 'none' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Repeat until (optional)</label>
              {recurrenceEndDate && (
                <button
                  type="button"
                  onClick={() => setRecurrenceEndDate('')}
                  style={{
                    background: 'none', border: 'none', color: '#C8102E',
                    fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer', padding: '4px 8px'
                  }}
                >
                  Clear end date
                </button>
              )}
            </div>
            <input type="date" value={recurrenceEndDate} onChange={e => setRecurrenceEndDate(e.target.value)} style={inputStyle} />
          </>
        )}

        {/* Vendor block. Any event can opt-in to having vendors; toggle drives
            the public-facing "Vendors will be there X to Y" line, the See lineup
            link, and notifies approved vendors so they can apply. */}
        <div style={{
          marginTop: '4px', marginBottom: '4px', padding: '14px 16px',
          borderRadius: '10px', border: '1px solid #e5e7eb',
          backgroundColor: hasVendors ? '#f0fdf4' : '#fafafa',
          transition: 'background-color 0.15s'
        }}>
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            cursor: 'pointer', userSelect: 'none'
          }}>
            <input
              type="checkbox"
              checked={hasVendors}
              onChange={e => toggleHasVendors(e.target.checked)}
              style={{ marginTop: '3px', width: '18px', height: '18px', cursor: 'pointer', accentColor: '#16a34a' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1a1a1a' }}>
                Add Vendors
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px', lineHeight: '1.4' }}>
                Vendors will be notified of this event to apply.
              </div>
            </div>
          </label>

          {hasVendors && (
            <div style={{ marginTop: '14px' }}>
              <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>What time do vendors participate?</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="time"
                    value={vendorStartTime}
                    onChange={e => setVendorStartTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    type="time"
                    value={vendorEndTime}
                    onChange={e => setVendorEndTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>
                Note for vendors (optional, only vendors see this)
              </label>
              <textarea
                placeholder='e.g. "DM people on IG to show up" or "Long day, bring food"'
                value={vendorNote}
                onChange={e => setVendorNote(e.target.value)}
                style={{ ...textareaStyle, minHeight: '70px' }}
              />
            </div>
          )}
        </div>

        </div>
        <div style={footerStyle}>
          {editingEvent && (
            <button onClick={resetForm} style={{
              padding: '14px 18px', backgroundColor: '#f0f0f0', color: '#666',
              border: 'none', borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer'
            }}>
              Cancel
            </button>
          )}
          <button onClick={handleSave} style={{
            flex: 1, padding: '14px', backgroundColor: '#C8102E', color: '#fff',
            border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '0.95rem', cursor: 'pointer'
          }}>
            {editingEvent ? 'Save changes' : 'Add Event'}
          </button>
        </div>
      </div>
      {eventToDelete && (
        <DeleteEventConfirmModal
          event={eventToDelete}
          onClose={() => setEventToDelete(null)}
          onCancelWithEmail={async (reason) => {
            await onCancelEvent(eventToDelete.id, reason);
            setEventToDelete(null);
            onClose();
          }}
          onPermanentDelete={async () => {
            await onDelete(eventToDelete.id);
            setEventToDelete(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}

// Two-path confirm dialog for the calendar Delete button.
//   Soft cancel: notifies applicants + stops reminders, keeps data.
//   Permanent delete: cascades through applications/attendance/votes; no email.
function DeleteEventConfirmModal({ event, onClose, onCancelWithEmail, onPermanentDelete }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmHard, setConfirmHard] = useState(false);

  const handleSoftCancel = async () => {
    setBusy(true);
    await onCancelWithEmail(reason.trim() || null);
    setBusy(false);
  };
  const handleHardDelete = async () => {
    setBusy(true);
    await onPermanentDelete();
    setBusy(false);
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 4px 0', color: '#dc2626' }}>
          Delete "{event.title}"?
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 16px 0' }}>
          Pick how to handle this event below. The default option notifies applicants — use the permanent delete only for events you created by mistake.
        </p>

        <div style={{
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '12px 14px', marginBottom: '14px',
          fontSize: '0.85rem', color: '#991b1b', lineHeight: '1.6'
        }}>
          <strong>Cancel event (recommended):</strong> sends a cancellation email to every approved + pending applicant and tells future reminder emails to skip this date. Applications, attendance, and votes are preserved.
        </div>

        <label style={{ fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Reason for cancellation (optional)
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          placeholder="Included in the email"
          style={{
            width: '100%', padding: '10px 12px', fontSize: '0.9rem',
            border: '1px solid #ddd', borderRadius: '8px',
            marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box',
            fontFamily: 'inherit', resize: 'vertical'
          }}
        />

        <button onClick={handleSoftCancel} disabled={busy} style={{
          width: '100%', padding: '12px',
          backgroundColor: busy ? '#999' : '#dc2626', color: '#fff',
          border: 'none', borderRadius: '8px',
          fontWeight: '700', fontSize: '0.95rem',
          cursor: busy ? 'wait' : 'pointer',
          marginBottom: '12px'
        }}>
          {busy ? 'Cancelling...' : 'Cancel event + email applicants'}
        </button>

        <details style={{ marginBottom: '14px' }}>
          <summary style={{ fontSize: '0.78rem', color: '#888', cursor: 'pointer', fontWeight: '600', userSelect: 'none' }}>
            Or permanently delete (no notifications)
          </summary>
          <div style={{
            marginTop: '10px',
            backgroundColor: '#fff7ed', border: '1px solid #fed7aa',
            borderRadius: '8px', padding: '12px 14px',
            fontSize: '0.82rem', color: '#9a3412', lineHeight: '1.6'
          }}>
            <strong>Permanent delete:</strong> removes the event row and cascade-deletes every related application, attendance row, vote, and submission. <em>No emails sent.</em> Use this only if the event was created by mistake.
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            margin: '10px 0', fontSize: '0.85rem', color: '#444', cursor: 'pointer'
          }}>
            <input type="checkbox" checked={confirmHard} onChange={e => setConfirmHard(e.target.checked)} />
            I understand this destroys all related data with no notifications
          </label>
          <button onClick={handleHardDelete} disabled={!confirmHard || busy} style={{
            width: '100%', padding: '10px',
            backgroundColor: (!confirmHard || busy) ? '#ccc' : '#7f1d1d', color: '#fff',
            border: 'none', borderRadius: '8px',
            fontWeight: '700', fontSize: '0.85rem',
            cursor: (!confirmHard || busy) ? 'not-allowed' : 'pointer'
          }}>
            Permanently delete event
          </button>
        </details>

        <button onClick={onClose} style={{ ...cancelBtnStyle, width: '100%' }}>
          Keep event, close
        </button>
      </div>
    </div>
  );
}

// ─── Calendar Component ───────────────────────────────────
function Calendar({ isStaff, isMobile, staff, activeCategory, calendarRef, events, fetchEvents }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  const detailPanelRef = useRef(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  // Calendar grid is Mon–Sun. JS getDay() returns 0=Sun…6=Sat, so we remap
  // (Sun=0)→6, (Mon=1)→0, …, (Sat=6)→5 with `(getDay() + 6) % 7` to compute
  // how many empty cells precede the 1st of the month.
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

  // Expose current year/month on the calendarRef for the print function
  useEffect(() => {
    if (calendarRef?.current) {
      calendarRef.current.dataset.year = year;
      calendarRef.current.dataset.month = month;
    }
  }, [year, month, calendarRef]);

  // On mobile, when a public visitor (non-staff) selects a day, scroll the
  // detail panel into view so they don't miss the events that appeared below.
  // Staff are excluded — they have their own add/edit flow and the auto-scroll
  // would fight with the modal.
  useEffect(() => {
    if (selectedDay !== null && isMobile && !isStaff && detailPanelRef.current) {
      detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDay, isMobile, isStaff]);

  const getEventsForDay = (day) => {
    const dateObj = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return events.filter(ev => {
      if (ev.event_date === dateStr) return true;
      if (ev.recurrence === 'none') return false;

      const evDate = new Date(ev.event_date + 'T00:00:00');
      if (dateObj < evDate) return false;
      if (ev.recurrence_end_date && dateObj > new Date(ev.recurrence_end_date + 'T00:00:00')) return false;

      const diffDays = Math.floor((dateObj - evDate) / (1000 * 60 * 60 * 24));
      if (ev.recurrence === 'weekly') return diffDays % 7 === 0;
      if (ev.recurrence === 'biweekly') return diffDays % 14 === 0;
      if (ev.recurrence === 'monthly') return evDate.getDate() === day;
      return false;
    }).filter(ev => {
      if (!activeCategory) return true;
      // Virtual filter: 'vendors' isn't a category, it's the has_vendors
      // flag. Used by the about-page CTA and the Vendors chip on the
      // calendar header so visitors can find every vendor-bearing event
      // regardless of which category it lives under.
      if (activeCategory === 'vendors') return !!ev.has_vendors;
      return (ev.categories || []).includes(activeCategory);
    });
  };

  const handleDayClick = (day) => {
    setSelectedDay(selectedDay === day ? null : day);
  };

  const openAddEvent = () => {
    if (selectedDay) {
      setModalDate(new Date(year, month, selectedDay));
      setShowEventModal(true);
    }
  };

  const handleSaveEvent = async (eventData) => {
    const op = eventData.id
      ? supabase.from('events').update(eventData).eq('id', eventData.id).select()
      : supabase.from('events').insert([eventData]).select();
    const { data, error } = await op;
    if (error) {
      console.error('[Calendar] save failed', error);
      alert(`Could not save event: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      console.warn('[Calendar] save returned no rows — likely RLS blocked it');
      alert('Save was blocked. Make sure you are still logged in as staff (the lock icon in the nav should be red).');
      return;
    }
    fetchEvents();
  };

  const handleDeleteEvent = async (eventId) => {
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) {
      console.error('[Calendar] delete failed', error);
      alert(`Could not delete event: ${error.message}`);
      return;
    }
    fetchEvents();
  };

  // Soft-cancel: marks events.cancelled=true and fires email to applicants.
  // Preserves all related data (applications, attendance, votes, media).
  const handleCancelEvent = async (eventId, reason) => {
    const { error } = await supabase
      .from('events')
      .update({
        cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      })
      .eq('id', eventId);
    if (error) {
      alert(`Could not cancel event: ${error.message}`);
      return;
    }
    sendVendorEmail({ type: 'event_cancelled', event_id: eventId, reason: reason || null });
    fetchEvents();
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} style={{ padding: '22px 8px 18px' }} />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayEvents = getEventsForDay(day);
    const isToday = isCurrentMonth && today.getDate() === day;
    const isSelected = selectedDay === day;

    // Get unique category colors for dots
    const dotColors = [...new Set(dayEvents.flatMap(e => (e.categories || []).map(c => CATEGORIES[c]?.color || '#ea580c')))];

    cells.push(
      <div
        key={day}
        onClick={() => handleDayClick(day)}
        style={{
          padding: '22px 8px 18px',
          textAlign: 'center',
          borderRadius: '10px',
          cursor: 'pointer',
          position: 'relative',
          backgroundColor: isSelected ? '#1a1a1a' : isToday ? '#fff0f0' : 'transparent',
          color: isSelected ? '#ffffff' : '#1a1a1a',
          fontWeight: isToday || dayEvents.length > 0 ? '700' : '400',
          fontSize: '0.9rem',
          transition: 'all 0.15s',
          border: isToday && !isSelected ? '2px solid #C8102E' : '2px solid transparent'
        }}
      >
        {day}
        {dotColors.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '3px', marginTop: '4px'
          }}>
            {dotColors.map((color, i) => (
              <div key={i} style={{
                width: '5px', height: '5px', borderRadius: '50%',
                backgroundColor: isSelected ? '#ffffff' : color
              }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];
  const hasSelection = selectedDay !== null;

  // Use the shared module-level formatTime12h helper
  const formatTime = formatTime12h;

  return (
    <>
      <div style={{
        borderRadius: '16px',
        border: '1px solid #eee',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        transition: 'all 0.3s ease'
      }}>
        {/* Shared header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', backgroundColor: '#C8102E', color: '#ffffff'
        }}>
          <button onClick={prevMonth} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
            fontSize: '0.8rem', cursor: 'pointer', fontWeight: '600', padding: '6px 10px'
          }}>Prev</button>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700' }}>
            {hasSelection
              ? `${monthName} ${selectedDay}, ${year}`
              : `${monthName} ${year}`
            }
          </h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {hasSelection && isStaff && (
              <button onClick={openAddEvent} style={{
                background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
                borderRadius: '6px', padding: '4px 12px', cursor: 'pointer',
                fontSize: '1rem', fontWeight: '700', lineHeight: '1'
              }}>+</button>
            )}
            {hasSelection && (
              <button onClick={() => setSelectedDay(null)} style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', color: 'rgba(255,255,255,0.8)',
                borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                fontSize: '0.7rem', fontWeight: '600'
              }}>Close</button>
            )}
            <button onClick={nextMonth} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
              fontSize: '0.8rem', cursor: 'pointer', fontWeight: '600', padding: '6px 10px'
            }}>Next</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Calendar side */}
        <div style={{
          flex: isMobile ? '1' : (hasSelection ? '0 0 58%' : '1'),
          transition: 'flex 0.3s ease',
          minWidth: 0
        }}>

          {/* Day headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            padding: '10px 12px 4px', borderBottom: '1px solid #f0f0f0'
          }}>
            {dayNames.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.7rem', fontWeight: '700',
                color: '#999', letterSpacing: '0.05em', padding: '4px'
              }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            padding: '8px 12px 20px', gap: '4px'
          }}>
            {cells}
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex', gap: '16px', padding: '12px 20px 16px',
            borderTop: '1px solid #f0f0f0', flexWrap: 'wrap'
          }}>
            {Object.entries(CATEGORIES).map(([key, { label, color }]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color
                }} />
                <span style={{ fontSize: '0.7rem', color: '#888', fontWeight: '600' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day detail panel (slides in from right, or below on mobile) */}
        {hasSelection && (
          <div ref={detailPanelRef} style={{
            flex: isMobile ? '1' : '0 0 42%',
            borderLeft: isMobile ? 'none' : '1px solid #eee',
            borderTop: isMobile ? '1px solid #eee' : 'none',
            backgroundColor: '#fafafa',
            padding: '0',
            display: 'flex',
            flexDirection: 'column',
            scrollMarginTop: '80px',
            animation: isMobile ? 'none' : 'slideIn 0.25s ease-out'
          }}>
            {/* Events list */}
            <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map((event) => {
                  const catColor = CATEGORIES[(event.categories || [])[0]]?.color || '#ea580c';
                  return (
                    <div key={event.id} style={{
                      padding: '14px 16px',
                      backgroundColor: '#ffffff',
                      borderRadius: '10px',
                      border: '1px solid #eee',
                      marginBottom: '10px',
                      borderLeft: `4px solid ${catColor}`
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: '700', color: catColor,
                          backgroundColor: catColor + '15', padding: '2px 8px',
                          borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}>
                          {(event.categories || []).map(c => CATEGORIES[c]?.label || c).join(' · ') || 'Other'}
                        </span>
                        {event.cancelled && (
                          <span style={{
                            fontSize: '0.6rem', fontWeight: '800', color: '#dc2626',
                            backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                            padding: '2px 8px', borderRadius: '4px',
                            textTransform: 'uppercase', letterSpacing: '0.05em'
                          }}>
                            Cancelled
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontWeight: '700', fontSize: '0.95rem',
                        color: event.cancelled ? '#999' : '#1a1a1a', marginBottom: '4px',
                        textDecoration: event.cancelled ? 'line-through' : 'none'
                      }}>
                        {event.title}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#888' }}>
                        {formatTime(event.start_time)} - {formatTime(event.end_time)}
                        {event.location && ` | ${event.location}`}
                      </div>
                      {event.has_vendors && (
                        <div style={{
                          marginTop: '12px',
                          padding: '12px 14px',
                          backgroundColor: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '10px',
                        }}>
                          <div style={{
                            fontSize: '0.62rem', fontWeight: '800',
                            color: '#15803d', textTransform: 'uppercase',
                            letterSpacing: '0.08em', marginBottom: '4px'
                          }}>
                            Vendors
                          </div>
                          {(event.vendor_start_time || event.vendor_end_time) && (
                            <div style={{
                              fontSize: '0.9rem', fontWeight: '700',
                              color: '#166534', marginBottom: '10px'
                            }}>
                              {formatTime(event.vendor_start_time)} – {formatTime(event.vendor_end_time)}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <Link
                              to={`/vendor-day?event=${event.id}`}
                              style={{
                                fontSize: '0.72rem', fontWeight: '700',
                                color: '#166534', backgroundColor: '#fff',
                                padding: '7px 14px', borderRadius: '8px',
                                textDecoration: 'none',
                                border: '1px solid #bbf7d0',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                              }}
                            >
                              See lineup <ArrowRight size={12} />
                            </Link>
                            <Link
                              to="/vendors/apply"
                              style={{
                                fontSize: '0.72rem', fontWeight: '700',
                                color: '#fff', backgroundColor: '#16a34a',
                                padding: '7px 14px', borderRadius: '8px',
                                textDecoration: 'none',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                              }}
                            >
                              Apply <ArrowRight size={12} />
                            </Link>
                          </div>
                        </div>
                      )}
                      {event.description && (
                        <div className="event-md" style={{ fontSize: '0.8rem', color: '#666', marginTop: '6px', lineHeight: '1.4' }}>
                          <ReactMarkdown
                            components={{
                              p: ({ node, children, ...props }) => <p style={{ margin: '0 0 6px 0' }} {...props}>{children}</p>,
                              strong: ({ node, children, ...props }) => <strong style={{ color: '#1a1a1a' }} {...props}>{children}</strong>,
                              a: ({ node, children, href, ...props }) => <a style={{ color: '#C8102E' }} href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                            }}
                          >
                            {event.description}
                          </ReactMarkdown>
                        </div>
                      )}
                      {event.recurrence !== 'none' && (
                        <div style={{
                          fontSize: '0.7rem', color: '#999', marginTop: '6px',
                          fontStyle: 'italic'
                        }}>
                          Repeats {event.recurrence}
                        </div>
                      )}
                      {isStaff && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                          <button onClick={() => {
                            setModalDate(new Date(year, month, selectedDay));
                            setShowEventModal(true);
                          }} style={{
                            background: '#f0f0f0', border: 'none', borderRadius: '6px',
                            padding: '5px 12px', fontSize: '0.7rem', fontWeight: '600',
                            cursor: 'pointer', color: '#333'
                          }}>Edit</button>
                          <button onClick={() => handleDeleteEvent(event.id)} style={{
                            background: '#fee', border: 'none', borderRadius: '6px',
                            padding: '5px 12px', fontSize: '0.7rem', fontWeight: '600',
                            cursor: 'pointer', color: '#C8102E'
                          }}>Delete</button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{
                  textAlign: 'center', color: '#bbb', fontSize: '0.85rem',
                  padding: '40px 20px'
                }}>
                  No events this day
                </div>
              )}
            </div>
          </div>
        )}
      </div>{/* end body flex */}
      </div>{/* end outer container */}

      {/* Staff event modal */}
      {showEventModal && modalDate && (
        <EventModal
          date={modalDate}
          existingEvents={getEventsForDay(modalDate.getDate())}
          onClose={() => setShowEventModal(false)}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onCancelEvent={handleCancelEvent}
          isMobile={isMobile}
          staff={staff}
        />
      )}
    </>
  );
}

// ─── Visit Us Section ─────────────────────────────────────
function VisitUsSection({ isMobile }) {
  const { siteSettings, specialHours, isAdmin, refresh } = useSite();
  const [editPanel, setEditPanel] = useState(null); // 'location' | 'phone' | 'contact' | 'hours' | null

  if (!siteSettings) return null;

  const s = siteSettings;
  const igUrl = s.ig_handle ? `https://www.instagram.com/${s.ig_handle}/` : null;
  const phoneTel = s.phone ? `tel:+1${s.phone.replace(/\D/g, '')}` : null;

  const today = todayISO();
  const upcomingBlocks = (specialHours || []).filter(sh => sh.end_date >= today).slice(0, 5);

  return (
    <div id="visit-us" style={{
      padding: isMobile ? '48px 20px' : '64px 48px',
      maxWidth: '1200px',
      margin: '0 auto'
    }}>
      <SectionHeader title="Visit Us" subtitle={s.address_subtitle ? `Come check us out, ${s.address_subtitle.toLowerCase()}` : 'Come check us out'} />

      {/* Active special-hours banner (public) */}
      {upcomingBlocks.length > 0 && (
        <div style={{
          backgroundColor: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: '12px', padding: '14px 18px', marginBottom: '20px',
          display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap'
        }}>
          <CalendarIcon size={18} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: '#92400e', lineHeight: '1.6' }}>
            <strong>Heads up:</strong> {upcomingBlocks.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ' · '}
                {formatDateRange(b.start_date, b.end_date)} — {b.title}
                {b.closed ? ' (closed)' : (b.open_time && b.close_time ? ` (${formatTime(b.open_time)} – ${formatTime(b.close_time)})` : '')}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: '24px'
      }}>
        {/* Location & Contact */}
        <div style={visitCardStyle}>
          {/* Location */}
          <CardHeader icon={<MapPin size={20} color="#C8102E" />} title="Location" onEdit={isAdmin ? () => setEditPanel('location') : null} />
          {s.address_line_1 && <p style={addrLineStyle}>{s.address_line_1}</p>}
          {s.address_line_2 && <p style={{ ...addrLineStyle, marginBottom: '16px' }}>{s.address_line_2}</p>}
          {s.address_subtitle && <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 24px 0' }}>{s.address_subtitle}</p>}

          {/* Phone */}
          <CardHeader icon={<Phone size={20} color="#C8102E" />} title="Phone" onEdit={isAdmin ? () => setEditPanel('phone') : null} />
          {s.phone && (
            <a href={phoneTel} style={{
              display: 'inline-block', backgroundColor: '#C8102E', color: '#fff',
              padding: '12px 28px', borderRadius: '10px', fontSize: '0.95rem', fontWeight: '700',
              textDecoration: 'none', marginBottom: '24px'
            }}>{s.phone}</a>
          )}

          {/* Contact */}
          <CardHeader icon={<Mail size={20} color="#C8102E" />} title="Contact" onEdit={isAdmin ? () => setEditPanel('contact') : null} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {s.email && (
              <a href={`mailto:${s.email}`} style={contactLinkStyle}>
                <Mail size={16} /> {s.email}
              </a>
            )}
            {igUrl && (
              <a href={igUrl} target="_blank" rel="noopener noreferrer" style={contactLinkStyle}>
                <IgIcon size={16} /> @{s.ig_handle}
              </a>
            )}
          </div>
        </div>

        {/* Hours */}
        <div style={visitCardStyle}>
          <CardHeader icon={<Clock size={20} color="#C8102E" />} title="Hours" onEdit={isAdmin ? () => setEditPanel('hours') : null} />
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {DAY_LABELS.map((day, idx) => {
                const h = s.hours?.[idx];
                const display = h ? `${formatTime(h.open)} - ${formatTime(h.close)}` : 'Closed';
                const isClosed = !h;
                return (
                  <tr key={day}>
                    <td style={{
                      padding: '8px 0', fontSize: '0.9rem', fontWeight: '600',
                      color: isClosed ? '#999' : '#1a1a1a', borderBottom: '1px solid #f0f0f0'
                    }}>{day}</td>
                    <td style={{
                      padding: '8px 0', fontSize: '0.9rem',
                      color: isClosed ? '#ccc' : '#444', textAlign: 'right',
                      fontWeight: isClosed ? '400' : '600', borderBottom: '1px solid #f0f0f0'
                    }}>{display}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Special hours admin panel — only visible to admin */}
          {isAdmin && (
            <SpecialHoursAdminPanel specialHours={specialHours} onChange={refresh} />
          )}
        </div>
      </div>

      {editPanel && (
        <SiteSettingsEditModal
          panel={editPanel}
          settings={s}
          onClose={() => setEditPanel(null)}
          onSaved={() => { setEditPanel(null); refresh(); }}
        />
      )}
    </div>
  );
}

const visitCardStyle = {
  backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee', padding: '28px'
};
const addrLineStyle = { fontSize: '0.9rem', color: '#444', margin: '0 0 4px 0', lineHeight: '1.6' };
const contactLinkStyle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  fontSize: '0.85rem', fontWeight: '600', color: '#C8102E', textDecoration: 'none'
};

// Card header with icon + title + optional edit pencil
function CardHeader({ icon, title, onEdit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
      {icon}
      <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: 0, flex: 1 }}>{title}</h3>
      {onEdit && (
        <button
          onClick={onEdit}
          title={`Edit ${title.toLowerCase()}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px', color: '#999', borderRadius: '6px',
            display: 'inline-flex', alignItems: 'center'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#C8102E'}
          onMouseLeave={e => e.currentTarget.style.color = '#999'}
        >
          <Edit2 size={15} />
        </button>
      )}
    </div>
  );
}

// Format a date range like "Dec 25" or "Dec 24 – 26".
function formatDateRange(startISO, endISO) {
  const opts = { month: 'short', day: 'numeric' };
  const s = new Date(startISO + 'T12:00:00').toLocaleDateString('en-US', opts);
  if (startISO === endISO) return s;
  const e = new Date(endISO + 'T12:00:00').toLocaleDateString('en-US', opts);
  return `${s} – ${e}`;
}

// ─── Site Settings Edit Modal ─────────────────────────────
// Different panels: location | phone | contact | hours.
function SiteSettingsEditModal({ panel, settings, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    address_line_1: settings.address_line_1 || '',
    address_line_2: settings.address_line_2 || '',
    address_subtitle: settings.address_subtitle || '',
    phone: settings.phone || '',
    email: settings.email || '',
    ig_handle: settings.ig_handle || '',
    hours: settings.hours || {},
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }));

  const setDayHours = (dayIdx, field, value) => {
    setDraft(d => {
      const next = { ...d.hours };
      if (field === 'closed') {
        next[dayIdx] = value ? null : { open: '12:00', close: '20:00', theme: '' };
      } else {
        next[dayIdx] = { ...(next[dayIdx] || { open: '12:00', close: '20:00', theme: '' }), [field]: value };
      }
      return { ...d, hours: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    let payload = {};
    if (panel === 'location') {
      payload = {
        address_line_1: draft.address_line_1.trim() || null,
        address_line_2: draft.address_line_2.trim() || null,
        address_subtitle: draft.address_subtitle.trim() || null,
      };
    } else if (panel === 'phone') {
      payload = { phone: draft.phone.trim() || null };
    } else if (panel === 'contact') {
      payload = {
        email: draft.email.trim() || null,
        ig_handle: cleanHandle(draft.ig_handle),
      };
    } else if (panel === 'hours') {
      payload = { hours: draft.hours };
    }
    const { error: upErr } = await supabase.from('site_settings').update(payload).eq('id', 1);
    setSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    onSaved();
  };

  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };
  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box'
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={{ ...modalCardStyle, maxWidth: panel === 'hours' ? '600px' : '480px' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 14px 0' }}>
          Edit {panel === 'location' ? 'location' : panel === 'phone' ? 'phone' : panel === 'contact' ? 'contact' : 'hours'}
        </h3>

        {panel === 'location' && (
          <>
            <label style={labelCss}>Address line 1</label>
            <input value={draft.address_line_1} onChange={setField('address_line_1')} style={inputCss} placeholder="4911 Warner Ave #210" />
            <label style={labelCss}>Address line 2</label>
            <input value={draft.address_line_2} onChange={setField('address_line_2')} style={inputCss} placeholder="Huntington Beach, CA 92649" />
            <label style={labelCss}>Subtitle</label>
            <input value={draft.address_subtitle} onChange={setField('address_subtitle')} style={inputCss} placeholder="Located in Harbour Landing" />
          </>
        )}

        {panel === 'phone' && (
          <>
            <label style={labelCss}>Phone number</label>
            <input value={draft.phone} onChange={setField('phone')} style={inputCss} placeholder="(714) 951-9100" />
          </>
        )}

        {panel === 'contact' && (
          <>
            <label style={labelCss}>Email</label>
            <input value={draft.email} onChange={setField('email')} style={inputCss} placeholder="info@trainercenter.com" />
            <label style={labelCss}>Instagram handle</label>
            <input value={draft.ig_handle} onChange={setField('ig_handle')} style={inputCss} placeholder="@trainercenter.pokemon" />
          </>
        )}

        {panel === 'hours' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {DAY_LABELS.map((day, idx) => {
              const h = draft.hours[idx];
              const isClosed = !h;
              return (
                <div key={day} style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr',
                  alignItems: 'center', gap: '12px',
                  padding: '8px 12px', backgroundColor: '#fafafa', borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#444' }}>{day}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isClosed}
                        onChange={e => setDayHours(idx, 'closed', e.target.checked)}
                      />
                      Closed
                    </label>
                    {!isClosed && (
                      <>
                        <input
                          type="time"
                          value={h?.open || ''}
                          onChange={e => setDayHours(idx, 'open', e.target.value)}
                          style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' }}
                        />
                        <span style={{ color: '#888' }}>–</span>
                        <input
                          type="time"
                          value={h?.close || ''}
                          onChange={e => setDayHours(idx, 'close', e.target.value)}
                          style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem' }}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <div style={{ ...errorStyle, marginTop: '12px' }}><AlertCircle size={16} />{error}</div>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: '12px', backgroundColor: saving ? '#999' : '#C8102E',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontWeight: '700', fontSize: '0.95rem', cursor: saving ? 'wait' : 'pointer'
          }}>{saving ? 'Saving...' : 'Save changes'}</button>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Special Hours Admin Panel ────────────────────────────
// Shows list of upcoming special hours blocks + Add/Edit/Delete UI.
function SpecialHoursAdminPanel({ specialHours, onChange }) {
  const [editing, setEditing] = useState(null); // null | 'new' | row object
  const today = todayISO();
  const upcoming = (specialHours || []).filter(sh => sh.end_date >= today);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this block?')) return;
    await supabase.from('special_hours').delete().eq('id', id);
    onChange();
  };

  return (
    <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: '800', color: '#374151', margin: 0,
          textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Block of days / holidays
        </h4>
        <button onClick={() => setEditing('new')} style={{
          backgroundColor: '#16a34a', color: '#fff', border: 'none',
          padding: '6px 12px', borderRadius: '6px', fontWeight: '700',
          fontSize: '0.78rem', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: '4px'
        }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: '#999', fontStyle: 'italic', margin: 0 }}>
          No upcoming holidays or blocks. Use this for things like Christmas closure, Thanksgiving early-close, or off-day events.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {upcoming.map(b => (
            <div key={b.id} style={{
              padding: '8px 12px', backgroundColor: '#fffbeb', borderRadius: '6px',
              border: '1px solid #fde68a',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'
            }}>
              <div style={{ minWidth: 0, fontSize: '0.85rem' }}>
                <div style={{ fontWeight: '700', color: '#92400e' }}>{b.title}</div>
                <div style={{ fontSize: '0.78rem', color: '#a16207' }}>
                  {formatDateRange(b.start_date, b.end_date)}
                  {b.closed ? ' · Closed' : b.open_time && b.close_time ? ` · ${formatTime(b.open_time)} – ${formatTime(b.close_time)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setEditing(b)} title="Edit" style={iconBtnStyle}>
                  <Edit2 size={13} />
                </button>
                <button onClick={() => handleDelete(b.id)} title="Delete" style={iconBtnStyle}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SpecialHoursEditModal
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }}
        />
      )}
    </div>
  );
}

const iconBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '4px 6px', color: '#92400e', borderRadius: '4px',
  display: 'inline-flex', alignItems: 'center'
};

// ─── Special Hours Edit Modal ─────────────────────────────
function SpecialHoursEditModal({ row, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    title: row?.title || '',
    description: row?.description || '',
    start_date: row?.start_date || todayISO(),
    end_date: row?.end_date || todayISO(),
    closed: row?.closed ?? true,
    open_time: row?.open_time?.slice(0, 5) || '12:00',
    close_time: row?.close_time?.slice(0, 5) || '20:00',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }));

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (draft.end_date < draft.start_date) {
      setError('End date must be on or after start date.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      start_date: draft.start_date,
      end_date: draft.end_date,
      closed: draft.closed,
      open_time: draft.closed ? null : draft.open_time,
      close_time: draft.closed ? null : draft.close_time,
    };
    const op = row?.id
      ? supabase.from('special_hours').update(payload).eq('id', row.id)
      : supabase.from('special_hours').insert(payload);
    const { error: upErr } = await op;
    setSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    onSaved();
  };

  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };
  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box'
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 14px 0' }}>
          {row?.id ? 'Edit block' : 'Add a block of days'}
        </h3>

        <label style={labelCss}>Title</label>
        <input value={draft.title} onChange={setField('title')} style={inputCss}
          placeholder="Christmas Day · Thanksgiving · Early close" />

        <label style={labelCss}>Description (optional)</label>
        <input value={draft.description} onChange={setField('description')} style={inputCss}
          placeholder="Anything to mention" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelCss}>Start date</label>
            <input type="date" value={draft.start_date} onChange={setField('start_date')} style={inputCss} />
          </div>
          <div>
            <label style={labelCss}>End date</label>
            <input type="date" value={draft.end_date} onChange={setField('end_date')} style={inputCss} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px',
          padding: '12px 14px', backgroundColor: '#fafafa', borderRadius: '8px',
          cursor: 'pointer', marginBottom: '14px' }}>
          <input type="checkbox" checked={draft.closed} onChange={e => setDraft(d => ({ ...d, closed: e.target.checked }))} />
          <span style={{ fontSize: '0.9rem', color: '#333' }}>Closed all day</span>
        </label>

        {!draft.closed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelCss}>Special open</label>
              <input type="time" value={draft.open_time} onChange={setField('open_time')} style={inputCss} />
            </div>
            <div>
              <label style={labelCss}>Special close</label>
              <input type="time" value={draft.close_time} onChange={setField('close_time')} style={inputCss} />
            </div>
          </div>
        )}

        {error && <div style={{ ...errorStyle, marginTop: '8px' }}><AlertCircle size={16} />{error}</div>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: '12px', backgroundColor: saving ? '#999' : '#16a34a',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontWeight: '700', fontSize: '0.95rem', cursor: saving ? 'wait' : 'pointer'
          }}>{saving ? 'Saving...' : (row?.id ? 'Save changes' : 'Add block')}</button>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      backgroundColor: '#1a1a1a',
      color: '#999',
      padding: '40px 24px',
      textAlign: 'center'
    }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px', overflow: 'hidden'
      }}>
        <img src="/logo-circle-transparent.png" alt="TrainerCenter" style={{ width: '76px', height: '76px', objectFit: 'contain' }} />
      </div>
      <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#ccc', margin: '0 0 8px 0' }}>
        Trainer <span style={{ color: '#C8102E' }}>Center HB</span>
      </p>
      <p style={{ fontSize: '0.75rem', margin: '0 0 12px 0' }}>
        Pokemon cards, collectibles, and community events
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <a href="tel:+17149519100" style={{ color: '#ccc', textDecoration: 'none', fontSize: '0.75rem', fontWeight: '600' }}>(714) 951-9100</a>
        <a href="mailto:Trainercenter.pokemon@gmail.com" style={{ color: '#ccc', textDecoration: 'none', fontSize: '0.75rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}><Mail size={13} /> Trainercenter.pokemon@gmail.com</a>
        <a href="https://www.instagram.com/trainercenter.pokemon/" target="_blank" rel="noopener noreferrer" style={{ color: '#ccc', textDecoration: 'none', fontSize: '0.75rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}><IgIcon size={13} /> @trainercenter.pokemon</a>
      </div>
      <a
        href="https://appcatalyst.org"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#555',
          textDecoration: 'none',
          fontSize: '0.65rem',
          transition: 'color 0.2s'
        }}
      >
        Built by App Catalyst
      </a>
    </footer>
  );
}

// ─── Page Wrapper ─────────────────────────────────────────
function PageWrapper({ children, isMobile }) {
  return (
    <>
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '100px 16px 40px' : '120px 24px 60px' }}>
        {children}
      </main>
      <VisitUsSection isMobile={isMobile} />
      <Footer />
    </>
  );
}

// ─── Home Page ────────────────────────────────────────────
function OpenNowBanner({ isMobile }) {
  const { siteSettings, specialHours } = useSite();
  if (!siteSettings) return null;

  const hoursMap = siteSettings.hours || {};
  const themeFor = (idx) => hoursMap[idx]?.theme || null;
  const { isOpen } = computeOpenNowState(siteSettings, specialHours);

  // Find next open day with an event (skipping closed days + special-closed days)
  let nextDayName = '';
  let nextTheme = '';
  if (!isOpen) {
    const now = new Date();
    for (let offset = 1; offset <= 14; offset++) {
      const checkDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
      const checkDow = checkDate.getDay();
      const checkISO = checkDate.toISOString().slice(0, 10);
      const checkSpecial = specialHoursForDate(specialHours, checkISO);
      if (checkSpecial?.closed) continue;
      if (!hoursMap[checkDow] && !checkSpecial) continue;
      const theme = checkSpecial?.title || themeFor(checkDow);
      if (theme) {
        nextDayName = DAY_LABELS[checkDow];
        nextTheme = theme;
        break;
      }
    }
  }

  if (isOpen) {
    return (
      <Link to="/calendar" style={{ textDecoration: 'none' }}>
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '12px',
          padding: '14px 20px',
          margin: isMobile ? '0 16px 24px' : '0 auto 32px',
          maxWidth: '1100px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#22c55e',
              boxShadow: '0 0 6px rgba(34,197,94,0.5)',
            }} />
            <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#166534' }}>
              We're open right now
            </span>
            <span style={{ fontSize: '0.8rem', color: '#15803d' }}>
              See what's happening today
            </span>
          </div>
          <span style={{ fontSize: '1.1rem', color: '#22c55e', fontWeight: '700' }}>&#8250;</span>
        </div>
      </Link>
    );
  }

  // Closed -- show next event
  return (
    <Link to="/calendar" style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
        borderRadius: '16px',
        padding: isMobile ? '20px' : '24px 32px',
        margin: isMobile ? '24px 16px 32px' : '40px auto 48px',
        maxWidth: '1100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? '6px' : '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444',
            }} />
            <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Currently closed
            </span>
          </div>
          {nextTheme && (
            <span style={{ fontSize: isMobile ? '1rem' : '1.1rem', fontWeight: '700', color: '#fff' }}>
              Up next: <span style={{ color: '#C8102E' }}>{nextTheme}</span> on {nextDayName}
            </span>
          )}
        </div>
        <div style={{
          backgroundColor: '#C8102E',
          borderRadius: '8px',
          padding: isMobile ? '6px 12px' : '8px 16px',
          color: '#fff',
          fontSize: '0.75rem',
          fontWeight: '700',
          flexShrink: 0,
        }}>
          See Calendar
        </div>
      </div>
    </Link>
  );
}

function HomePage({ isMobile }) {
  return (
    <>
      {/* Hero - Full Viewport */}
      <header style={{
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {/* Background image */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/photos/IMG_5663.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'brightness(0.8)'
        }} />
        {/* Overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.55))'
        }} />
        {/* Content */}
        <div style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px'
        }}>
          <div style={{
            width: isMobile ? '150px' : '220px',
            height: isMobile ? '150px' : '220px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 4px 30px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
            overflow: 'hidden'
          }}>
            <img src="/logo-circle-transparent.png" alt="Logo" style={{
              width: isMobile ? '260px' : '380px',
              height: isMobile ? '260px' : '380px',
              objectFit: 'contain'
            }} />
          </div>
          <h1 style={{
            fontSize: isMobile ? 'clamp(2.2rem, 10vw, 3.5rem)' : '5rem',
            fontWeight: '900',
            margin: '0 0 12px 0',
            letterSpacing: '-0.03em',
            color: '#ffffff',
            textShadow: '0 2px 20px rgba(0,0,0,0.4)',
            textAlign: 'center'
          }}>
            Trainer <span style={{ color: '#C8102E', backgroundColor: '#ffffff', padding: '0px 5px', borderRadius: '6px', marginLeft: '4px' }}>Center HB</span>
          </h1>
          <p style={{
            fontSize: isMobile ? 'clamp(1rem, 4vw, 1.3rem)' : '1.6rem',
            color: 'rgba(255,255,255,0.9)',
            maxWidth: '600px',
            margin: '0 auto 40px',
            textAlign: 'center',
            textShadow: '0 1px 8px rgba(0,0,0,0.3)'
          }}>
            Huntington Beach's trusted Pokemon only store.
          </p>
          {/* Marquee Banner */}
          <div style={{
            width: '700px',
            maxWidth: '90vw',
            overflow: 'hidden',
            marginTop: '36px',
            position: 'relative',
            maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)'
          }}>
            <div style={{
              display: 'flex',
              animation: 'marquee 12s linear infinite',
              whiteSpace: 'nowrap',
              width: 'max-content'
            }}>
              {[...Array(4)].map((_, i) => (
                <span key={i} style={{
                  fontSize: isMobile ? '1rem' : '1.3rem',
                  fontWeight: '800',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase'
                }}>
                  <span style={{ color: '#ffffff', margin: isMobile ? '0 12px' : '0 20px' }}>Buy</span>
                  <span style={{ color: '#C8102E', margin: '0 8px' }}>-</span>
                  <span style={{ color: '#ffffff', margin: isMobile ? '0 12px' : '0 20px' }}>Battle</span>
                  <span style={{ color: '#C8102E', margin: '0 8px' }}>-</span>
                  <span style={{ color: '#ffffff', margin: isMobile ? '0 12px' : '0 20px' }}>Collect</span>
                  <span style={{ color: '#C8102E', margin: '0 8px' }}>-</span>
                  <span style={{ color: '#ffffff', margin: isMobile ? '0 12px' : '0 20px' }}>Sell</span>
                  <span style={{ color: '#C8102E', margin: '0 8px' }}>-</span>
                  <span style={{ color: '#ffffff', margin: isMobile ? '0 12px' : '0 20px' }}>Donate</span>
                  <span style={{ color: '#C8102E', margin: '0 8px' }}>-</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <OpenNowBanner isMobile={isMobile} />

      {/* Mission section + Visit Us + Footer */}
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '40px 16px' : '60px 24px' }}>
        {/* ── NEXT VENDOR DAY BANNER (above mission) ── */}
        <NextVendorDayBanner isMobile={isMobile} />

        <div id="mission" style={{ marginBottom: '64px' }}>
          <SectionHeader title="Our Mission" />
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #eee',
            padding: isMobile ? '20px 16px' : '40px',
            maxWidth: '800px',
            margin: '0 auto'
          }}>
            <p style={{
              fontSize: '1.05rem',
              color: '#333',
              lineHeight: '1.8',
              marginBottom: '20px'
            }}>
              Trainer Center HB is a Pokemon only store. We are an education and community driven store that promotes math, reading, critical thinking, social engagement, friendship and community action through Pokemon. We host an after school social club for collectors, traders, friends and family that promotes social interaction in a clean, safe, fun, fair and supervised environment. Our goal is to become fully licensed and a part of the Pokemon Company family and have Pokemon be a positive staple in the Huntington Beach area.
            </p>
            <p style={{
              fontSize: '1.05rem',
              color: '#333',
              lineHeight: '1.8',
              marginBottom: '20px'
            }}>
              Though we are a TCG shop that does sell cards and anything Pokemon we strive to be an organic based community driven business. We plan to have social events like birthday parties, league events, competitions and community days where we go out into the community with volunteers and clean up the surrounding areas as well as beach and park days.
            </p>
            <p style={{
              fontSize: '1.1rem',
              color: '#C8102E',
              fontWeight: '700',
              fontStyle: 'italic',
              margin: 0,
              textAlign: 'center',
              paddingTop: '8px'
            }}>
              We hope you will join us on this journey and let us help you catch them all.
            </p>
          </div>
        </div>

        {/* ── CARDS ── */}
        <div id="cards" style={{ marginBottom: '64px' }}>
          <SectionHeader title="Cards" subtitle="We carry Pokemon cards from every era" />
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '20px'
          }}>
            <div style={{
              borderRadius: '16px', overflow: 'hidden', backgroundColor: '#ffffff',
              border: '1px solid #eee', transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <img src="/photos/IMG_5650.jpg" alt="Vintage Cards" style={{ width: '100%', height: '360px', objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>Vintage & Classic</h3>
                <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#C8102E', backgroundColor: '#fff0f0', padding: '3px 10px', borderRadius: '6px' }}>1995 - 2017</span>
                <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: '1.6', marginTop: '10px' }}>Base Set, Jungle, Fossil, Team Rocket, Neo series, Diamond & Pearl through Sun & Moon.</p>
              </div>
            </div>
            <div style={{
              borderRadius: '16px', overflow: 'hidden', backgroundColor: '#ffffff',
              border: '1px solid #eee', transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <img src="/photos/IMG_5654.jpg" alt="Modern Cards" style={{ width: '100%', height: '360px', objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>Current & Modern</h3>
                <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#C8102E', backgroundColor: '#fff0f0', padding: '3px 10px', borderRadius: '6px' }}>2018 - Present</span>
                <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: '1.6', marginTop: '10px' }}>Sword & Shield, Scarlet & Violet. VMAX, VSTAR, ex cards, illustration rares, and sealed product.</p>
              </div>
            </div>
            <div style={{
              borderRadius: '16px', overflow: 'hidden', backgroundColor: '#ffffff',
              border: '1px solid #eee', transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <img src="/photos/IMG_5660.jpg" alt="Graded Cards" style={{ width: '100%', height: '360px', objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>Graded Cards & Slabs</h3>
                <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: '1.6', marginTop: '10px' }}>PSA, CGC, and BGS graded cards. Authenticated, encapsulated, and ready for your collection.</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── MERCHANDISE & COLLECTIBLES ── */}
        <div id="merchandise" style={{ marginBottom: '64px' }}>
          <SectionHeader title="Merchandise & Collectibles" subtitle="Beyond the cards - consoles, plushies, figures, and more" />
          <PhotoGrid isMobile={isMobile} photos={[
            { src: '/photos/IMG_5668.jpg', alt: 'Retro consoles' },
            { src: '/photos/IMG_5666.jpg', alt: 'Switch and Game Boy' },
            { src: '/photos/IMG_5665.jpg', alt: 'Graded games' },
            { src: '/photos/IMG_5667.jpg', alt: 'Games collection' },
            { src: '/photos/IMG_5675.jpg', alt: 'Pikachu plushies' },
            { src: '/photos/IMG_5674.jpg', alt: 'Pokemon plushies' },
            { src: '/photos/IMG_5676.jpg', alt: 'Plush display' },
            { src: '/photos/IMG_5652.jpg', alt: 'Plush case' },
            { src: '/photos/IMG_5679.jpg', alt: 'Plush shelves' },
            { src: '/photos/IMG_5680.jpg', alt: 'Plush collection' },
            { src: '/photos/IMG_5670.jpg', alt: 'Select figures' },
            { src: '/photos/IMG_5671.jpg', alt: 'Funko Pops' },
            { src: '/photos/IMG_5672.jpg', alt: 'More Pops' },
            { src: '/photos/IMG_5669.jpg', alt: 'Figure sets' },
          ]} />
        </div>
      </main>

      <VisitUsSection isMobile={isMobile} />
      <Footer />
    </>
  );
}

// ─── Consultation Page ────────────────────────────────────
function ConsultationPage({ isMobile }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Consultation" subtitle="Learn before you sell, trade, or grade" />
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              backgroundColor: '#fff0f0', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <GraduationCap size={24} color="#C8102E" />
            </div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>
              Private Consultation with Chef
            </h3>
          </div>
          <div style={{
            backgroundColor: '#fff0f0',
            borderRadius: '10px',
            padding: '16px 20px',
            marginBottom: '24px',
            border: '1px solid #fecaca'
          }}>
            <p style={{ fontSize: '0.95rem', color: '#C8102E', fontWeight: '700', margin: '0 0 4px 0' }}>
              Thursdays - By Appointment
            </p>
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
              Chef dedicates Thursdays to private one-on-one consultations. Schedule anytime during store hours.
            </p>
          </div>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '20px' }}>
            Whether you found a box of old cards in the attic or you have been collecting for years, Chef will sit down with you and walk through what you have. This is not a sales pitch. The goal is to educate you so you know what your collection is actually worth and you do not get taken advantage of.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '28px' }}>
            We may make you an offer, but the real value of the consultation is the knowledge you walk away with.
          </p>

          <h4 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>What we cover:</h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: '12px',
            marginBottom: '28px'
          }}>
            {[
              { title: 'Card Identification', desc: 'We help you identify what you have, from Base Set shadowless to modern illustration rares.' },
              { title: 'Market Value', desc: 'Learn what apps and tools to use to look up real-time prices so you always know what your cards are worth.' },
              { title: 'Grading Advice', desc: 'Not every card is worth grading. We show you how to evaluate condition and which cards are worth the investment.' },
              { title: 'Best Time to Buy or Sell', desc: 'Pokemon card values fluctuate with sets, seasons, and trends. We help you understand timing.' },
              { title: 'Pokemon History', desc: 'Understand the eras, the rare prints, the errors, and the cards that collectors chase. Knowledge is your best tool.' },
              { title: 'Vintage Collections', desc: 'Got old cards, sealed product, or Japanese imports? We help you sort through it all and understand what stands out.' }
            ].map((item, i) => (
              <div key={i} style={{
                padding: '16px',
                borderRadius: '10px',
                backgroundColor: '#fafafa',
                border: '1px solid #f0f0f0'
              }}>
                <h5 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#C8102E', margin: '0 0 4px 0' }}>{item.title}</h5>
                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0, lineHeight: '1.5' }}>{item.desc}</p>
              </div>
            ))}
          </div>

          <div style={{
            backgroundColor: '#fff0f0',
            borderRadius: '10px',
            padding: '20px',
          }}>
            <p style={{ fontSize: '0.95rem', color: '#C8102E', fontWeight: '700', margin: '0 0 12px 0', textAlign: 'center' }}>
              Contact Chef to schedule your consultation
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <a href="tel:+17149519100" style={{
                fontSize: '1rem', fontWeight: '700', color: '#C8102E', textDecoration: 'none'
              }}>
                (714) 951-9100
              </a>
              <a href="mailto:Trainercenter.pokemon@gmail.com" style={{
                fontSize: '0.9rem', fontWeight: '600', color: '#C8102E', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center'
              }}>
                <Mail size={15} /> Trainercenter.pokemon@gmail.com
              </a>
              <a href="https://www.instagram.com/trainercenter.pokemon/" target="_blank" rel="noopener noreferrer" style={{
                fontSize: '0.9rem', fontWeight: '600', color: '#C8102E', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center'
              }}>
                <IgIcon size={15} /> @trainercenter.pokemon
              </a>
            </div>
          </div>
        </div>

        {/* What to bring */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            What to bring to your consultation
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            The short answer is bring everything. We have had people walk in with a single childhood binder and walk out realizing they had a Base Set Charizard worth more than their car. We have also had people bring five storage bins thinking they had a fortune and leave with a realistic plan for what to actually keep, what to sell, and what to let go. Either outcome is useful, and neither is embarrassing. The whole point of the consultation is to give you the truth.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            If you can, bring your cards in something that protects them. Toploaders, sleeves, or even a closed shoe box beats a loose pile in a grocery bag. If the cards are old, leave them as they are. Do not wipe, polish, or try to straighten corners before the appointment. Well-meaning cleaning almost always reduces the value of a vintage card. Let us look at them in their original state first.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            If you have sealed product, bring that too. Booster boxes, ETBs, and tins from older sets can be worth significantly more sealed than their individual cards. Japanese product in particular is often undervalued by casual sellers. If you have any paperwork, receipts, or original packaging, bring that as well. Provenance matters, especially for vintage and Japanese market cards.
          </p>
        </div>

        {/* What you walk away with */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            What you walk away with
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            By the end of an hour you will know which of your cards are valuable, which are not, and which are in the gray zone where condition determines everything. You will know how to use pricing tools like TCGplayer, eBay sold listings, and PSA population reports so you never have to trust anyone else blindly again. You will understand why the same Charizard can be worth fifty dollars or five thousand depending on the variant, print, and grade.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            You will also get honest advice on timing. Pokemon values rise and fall with new set releases, anniversary reprints, and market momentum on specific cards. If now is not the right moment to sell, we will tell you. If grading a specific card will pay for itself several times over, we will tell you that too. The point of the session is not to buy cards from you. It is to make sure that when you do decide to sell, grade, or hold, you are making the decision with the same information we would use.
          </p>
        </div>

        {/* FAQ */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 20px 0' }}>
            Frequently asked questions
          </h3>
          {[
            {
              q: 'Is the consultation free?',
              a: 'Yes. Chef offers consultations at no cost because the goal is long-term relationships with collectors, not a one-time transaction. If we happen to buy cards from you that same visit, that is fine, but there is no pressure and no fee either way.'
            },
            {
              q: 'How long does it take?',
              a: 'Most consultations run between thirty and sixty minutes. If you bring a very large collection or a lot of vintage, we may schedule a second session so nothing gets rushed.'
            },
            {
              q: 'What if I just inherited cards and know nothing about Pokemon?',
              a: 'That is the most common consultation we do. You do not need to know anything. Chef will start from zero and explain what you have in plain language. The harder part for us is when someone partially knows and has already decided what everything is worth from TikTok videos.'
            },
            {
              q: 'Are my cards safe during the appointment?',
              a: 'Yes. Everything stays on the counter in front of you the entire time. We never take cards into a back room, and you are free to photograph or video the evaluation if you want a record.'
            },
            {
              q: 'Do I have to sell to you afterward?',
              a: 'No. The consultation exists to educate you. We may make an offer on specific cards if you want to sell, but you are free to take what you learned, go home, and sell anywhere else. Many people do exactly that, and we are fine with it.'
            }
          ].map((item, i) => (
            <div key={i} style={{
              padding: i === 0 ? '0 0 16px' : '16px 0',
              borderTop: i === 0 ? 'none' : '1px solid #f0f0f0'
            }}>
              <p style={{ fontSize: '1rem', fontWeight: '700', color: '#1a1a1a', margin: '0 0 8px 0' }}>{item.q}</p>
              <p style={{ fontSize: '0.95rem', color: '#555', margin: 0, lineHeight: '1.7' }}>{item.a}</p>
            </div>
          ))}
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', marginTop: '24px', marginBottom: 0 }}>
            Ready to sit down with Chef? See what we do on the <Link to="/grading" style={{ color: '#C8102E', fontWeight: '700' }}>grading side</Link>, check <Link to="/buy-sell" style={{ color: '#C8102E', fontWeight: '700' }}>buy and sell</Link> if you already know what you want to do with your cards, or call the shop at (714) 951-9100 to book your session.
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Grading Page ─────────────────────────────────────────
function GradingPage({ isMobile }) {
  const steps = [
    { num: '1', title: 'We Evaluate', desc: 'Bring your cards in and we assess condition, help you decide which ones are worth grading.' },
    { num: '2', title: 'We Submit', desc: 'We handle the entire PSA submission. No account needed, no shipping headaches.' },
    { num: '3', title: 'You Profit', desc: 'A graded card is worth significantly more. Grading protects and increases your collection value.' },
  ];

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Grading" subtitle="PSA Grading Services" />

        {/* YES hero */}
        <div style={{
          backgroundColor: '#1a1a1a',
          borderRadius: '16px',
          padding: isMobile ? '32px 20px' : '48px 40px',
          textAlign: 'center',
          marginBottom: '32px',
          maxWidth: '900px',
          margin: '0 auto 32px'
        }}>
          <p style={{ fontSize: isMobile ? '0.9rem' : '1.1rem', color: '#999', fontWeight: '600', margin: '0 0 8px 0' }}>
            Do you guys help grade cards?
          </p>
          <h2 style={{ fontSize: isMobile ? '3rem' : '4.5rem', fontWeight: '900', color: '#C8102E', margin: '0 0 12px 0', letterSpacing: '-0.03em' }}>
            YES
          </h2>
          <p style={{ fontSize: isMobile ? '0.85rem' : '1rem', color: '#ccc', margin: 0, maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.6' }}>
            We evaluate your cards, handle the PSA submission, and get them back to you graded and protected.
          </p>
        </div>

        {/* 3 Steps with arrows */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isMobile ? '0' : '0',
          marginBottom: '40px',
          maxWidth: '900px',
          margin: '0 auto 40px'
        }}>
          {steps.map((step, i) => (
            <React.Fragment key={i}>
              <div style={{
                flex: 1,
                padding: isMobile ? '24px 20px' : '32px 24px',
                borderRadius: '14px',
                backgroundColor: '#ffffff',
                border: '2px solid #eee',
                textAlign: 'center',
                minWidth: 0,
              }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  backgroundColor: '#C8102E', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.3rem', fontWeight: '900',
                  margin: '0 auto 14px',
                }}>
                  {step.num}
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 8px 0' }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: 0, lineHeight: '1.5' }}>
                  {step.desc}
                </p>
              </div>
              {i < 2 && (
                <div style={{
                  padding: isMobile ? '8px 0' : '0 8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#C8102E', fontSize: '1.8rem', fontWeight: '900', flexShrink: 0,
                }}>
                  {isMobile ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C8102E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
                    </svg>
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C8102E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                    </svg>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Details + Pricing */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              backgroundColor: '#fff0f0', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Award size={24} color="#C8102E" />
            </div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>
              PSA Pricing Tiers
            </h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
            PSA (Professional Sports Authenticator) is the most recognized grading service in the hobby. Here are their current pricing tiers:
          </p>

          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#1a1a1a' }}>
                  {['Service', 'Price/Card', 'Turnaround', 'Max Value'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left', color: '#fff',
                      fontWeight: '700', fontSize: '0.8rem'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Value Bulk', '$25', '~95 days', '$500'],
                  ['Value', '$33', '~75 days', '$500'],
                  ['Value Plus', '$50', '~45 days', '$1,000'],
                  ['Value Max', '$65', '~35 days', '$1,500'],
                  ['Regular', '$80', '~25 days', '$1,500'],
                  ['Express', '$160', '~10 days', '$2,999'],
                  ['Super Express', '$300', '~5 days', '$4,999'],
                ].map(([service, price, time, max], i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#ffffff' }}>
                    <td style={{ padding: '10px 16px', fontWeight: '600', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }}>{service}</td>
                    <td style={{ padding: '10px 16px', color: '#C8102E', fontWeight: '700', borderBottom: '1px solid #f0f0f0' }}>{price}</td>
                    <td style={{ padding: '10px 16px', color: '#666', borderBottom: '1px solid #f0f0f0' }}>{time}</td>
                    <td style={{ padding: '10px 16px', color: '#666', borderBottom: '1px solid #f0f0f0' }}>{max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '0', lineHeight: '1.5' }}>
            Prices are per card and set by PSA. Value Bulk requires a 20-card minimum. Max Value is the maximum declared value per card for that tier. Prices as of early 2026 and subject to change.
          </p>
        </div>

        {/* Which cards are worth grading */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            Which Pokemon cards are actually worth grading?
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            The honest answer is: not most of them. Grading a card costs between twenty-five dollars on the cheapest PSA tier and several hundred on the express tiers, and those fees do not include shipping or the time the card spends out of your hands. If the raw ungraded card is worth ten dollars, a PSA 9 might bring it to twenty-five and a PSA 10 to seventy. That math works on a few cards. It does not work on a binder full of bulk.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            Cards that tend to make sense for grading fall into a few buckets. Vintage holographics from Base Set, Jungle, Fossil, and Neo era cards are almost always candidates because the population is fixed and demand is steady. Modern chase cards like alt arts, special illustration rares, and secret rares from newer sets are candidates when the raw market price is already meaningfully above the grading fee. Error cards, first editions, and cards with strong centering and clean surfaces are almost always worth at least an evaluation.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            Cards that usually should not get graded include non-holo commons, recent mass-produced promos, cards with visible whitening on the edges or print lines on the surface, and anything where the raw price is under about fifteen dollars. Before you spend money on a submission, bring the card in so we can look at it under a light and give you a real read on whether the fee makes sense.
          </p>
        </div>

        {/* Understanding the 1-10 scale */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            What do the grades 1 through 10 actually mean?
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '20px' }}>
            PSA grades four things on every Pokemon card: centering, corners, edges, and surface. Your final grade is capped by the weakest of those four. A perfect surface cannot save a card with off-center borders, and sharp corners cannot save a card with a print line on the holo. Here is a plain-English breakdown of where each grade lands.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '0' }}>
            {[
              { grade: 'PSA 10', label: 'Gem Mint', desc: 'Essentially perfect to the naked eye. Centering is 55/45 or better on both axes, corners are sharp, edges are clean, and surface shows no print defects or whitening.' },
              { grade: 'PSA 9', label: 'Mint', desc: 'One minor flaw. Maybe slight off-centering or a single soft corner. Still a collectible, investable grade.' },
              { grade: 'PSA 8', label: 'Near Mint-Mint', desc: 'Light wear visible on close inspection. Edges or corners show handling. Most raw pack-fresh cards that have been played or sleeved casually land here.' },
              { grade: 'PSA 7', label: 'Near Mint', desc: 'Obvious flaws on one or two of the four criteria but still clean overall. Good choice for vintage cards where a 7 is still meaningful.' },
              { grade: 'PSA 5-6', label: 'Excellent', desc: 'Visible wear but no creases, no holes. Vintage collectors still value these for rare cards.' },
              { grade: 'PSA 1-4', label: 'Poor to Very Good', desc: 'Heavier wear, creases, surface damage, or alignment issues. Mostly valuable only on rare vintage where any graded example matters.' }
            ].map((row, i) => (
              <div key={i} style={{ padding: '16px', borderRadius: '10px', backgroundColor: '#fafafa', border: '1px solid #f0f0f0' }}>
                <p style={{ fontSize: '0.9rem', fontWeight: '800', color: '#C8102E', margin: '0 0 2px 0' }}>{row.grade} <span style={{ color: '#1a1a1a', fontWeight: '700' }}>— {row.label}</span></p>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: 0, lineHeight: '1.5' }}>{row.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 20px 0' }}>
            Common questions about grading through Trainer Center HB
          </h3>
          {[
            {
              q: 'Do I need a PSA account to submit through you?',
              a: 'No. We submit on our shop account, so you skip the signup, the bulk requirements, the shipping supplies, and the hassle of insuring your own package. You hand the cards to us over the counter, we track everything, and you get them back graded and encapsulated.'
            },
            {
              q: 'How long does the whole process take?',
              a: 'It depends on which PSA tier we use. Value Bulk runs around 95 business days, Regular runs about 25, and Express is typically back in 10. These are PSA turnaround estimates, not promises, and they move based on their internal queue. We update you when PSA receives the order, when grading is complete, and when the cards ship back.'
            },
            {
              q: 'Can I watch you sleeve and package the submission?',
              a: 'Yes. We prep every submission in front of you at the counter if you want. Each card gets a penny sleeve, a semi-rigid holder, and its own line on the order form. Nothing gets mixed up and you see exactly what goes in the box.'
            },
            {
              q: 'What if the card comes back a lower grade than expected?',
              a: 'We tell you what we think before we submit. If we say we think a card is borderline 9, we will tell you honestly. PSA grades strictly and small flaws matter. The only way to guarantee a grade is to never submit, so we only recommend sending in cards where we believe the expected grade outweighs the fee.'
            },
            {
              q: 'Do you grade anything other than PSA?',
              a: 'We primarily use PSA because it is the most recognized grader in the Pokemon market and resale prices reflect that. We can walk you through CGC and BGS if a specific card benefits from their slab style or rules, but for most Pokemon cards PSA is the right call.'
            },
            {
              q: 'Can you grade Japanese Pokemon cards?',
              a: 'Yes. PSA grades Japanese cards on the same scale as English. Japanese vintage and modern alt arts are a growing segment of the hobby, and we submit them regularly. Bring them in and we will evaluate them the same way.'
            }
          ].map((item, i) => (
            <div key={i} style={{
              padding: i === 0 ? '0 0 16px' : '16px 0',
              borderTop: i === 0 ? 'none' : '1px solid #f0f0f0'
            }}>
              <p style={{ fontSize: '1rem', fontWeight: '700', color: '#1a1a1a', margin: '0 0 8px 0' }}>{item.q}</p>
              <p style={{ fontSize: '0.95rem', color: '#555', margin: 0, lineHeight: '1.7' }}>{item.a}</p>
            </div>
          ))}
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', marginTop: '24px', marginBottom: 0 }}>
            Have a card or a whole collection you are not sure about? Book a <Link to="/consultation" style={{ color: '#C8102E', fontWeight: '700' }}>private consultation with Chef</Link> and we will walk through everything before you spend a dollar on grading fees.
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Buy/Sell Page ────────────────────────────────────────
function BuySellPage({ isMobile }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Buy / Sell" subtitle="We buy collections and offer consignment for sellers" />
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: '24px',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          {/* Buying */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #eee',
            padding: '28px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                backgroundColor: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <ShoppingBag size={20} color="#2e7d32" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>We Buy</h3>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.7', marginBottom: '16px' }}>
              We buy Pokemon cards, collections, plushies, figures, sealed product, and collectible inventory. Whether it is a shoebox of old cards or an entire collection you are looking to move, we are interested.
            </p>
            <ul style={{ margin: 0, padding: '0 0 0 20px', fontSize: '0.85rem', color: '#555', lineHeight: '2' }}>
              <li>Single cards and bulk lots</li>
              <li>Vintage and modern collections</li>
              <li>Sealed booster boxes, ETBs, and tins</li>
              <li>Plushies, figures, and merchandise</li>
              <li>Old collections and estate lots</li>
            </ul>
            <div style={{
              backgroundColor: '#e8f5e9', borderRadius: '8px',
              padding: '12px 16px', marginTop: '20px', textAlign: 'center'
            }}>
              <p style={{ fontSize: '0.85rem', color: '#2e7d32', fontWeight: '600', margin: 0 }}>
                Call or visit the store for a quote
              </p>
            </div>
          </div>

          {/* Selling / Consignment */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #eee',
            padding: '28px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                backgroundColor: '#fff0f0', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <ShoppingBag size={20} color="#C8102E" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>Consignment</h3>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.7', marginBottom: '16px' }}>
              Want to sell your graded cards or qualifying merchandise but do not want to deal with online marketplaces? We offer consignment. You leave your items at the store, we display and sell them, and when they sell you get paid.
            </p>
            <ul style={{ margin: 0, padding: '0 0 0 20px', fontSize: '0.85rem', color: '#555', lineHeight: '2' }}>
              <li>Graded cards (PSA, CGC, BGS)</li>
              <li>Qualifying merchandise and collectibles</li>
              <li>Your items displayed in-store</li>
              <li>You get paid when they sell</li>
            </ul>
            <div style={{
              backgroundColor: '#fff0f0', borderRadius: '8px',
              padding: '12px 16px', marginTop: '20px', textAlign: 'center'
            }}>
              <p style={{ fontSize: '0.85rem', color: '#C8102E', fontWeight: '600', margin: 0 }}>
                Call to set up pricing and details
              </p>
              <a href="tel:+17149519100" style={{
                fontSize: '0.95rem', fontWeight: '800', color: '#C8102E', textDecoration: 'none'
              }}>
                (714) 951-9100
              </a>
            </div>
          </div>
        </div>

        {/* How buying works */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            How selling cards to Trainer Center HB works
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            You walk in with your cards. We sit at the counter together. Chef looks through the collection card by card for anything meaningful and bulks the rest into obvious lots. You watch the entire process. Nothing goes into a back room. Once we have a picture of what is there, we price each meaningful card or lot using live TCGplayer market data, eBay sold listings, and our own read on current Pokemon market movement.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            The offer is a single number you can take or leave. We will tell you how we got there and which cards drove the bulk of the value. If you want to think about it, take the list home. If you want to sell only a portion of the collection, we are happy to break it up. If our offer is lower than something you saw online, we will explain why our number is what it is and you can decide what makes sense for you.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            We pay in cash or Zelle the same visit, not on some future payment schedule. There are no processing fees, no shipping risk, and no waiting two weeks for a check. If your collection is large enough that the evaluation takes more than an hour, we can schedule a dedicated session so nothing gets rushed.
          </p>
        </div>

        {/* What we buy and what we pass on */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            What we buy and what we tell you to hold
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            We actively buy vintage cards from Base Set through Neo, especially holographics and first editions. We buy sealed product from any era, including booster boxes, Elite Trainer Boxes, Japanese promos, and older tins. We buy modern chase cards like alt arts, special illustration rares, secret rares, and any card that has meaningful aftermarket demand. We also buy graded cards outright and on consignment depending on the grade and the card.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            Plushies, figures, vintage Japanese merchandise, and unopened promotional items are all worth bringing in. The Pokemon merchandise market has grown significantly in recent years and some items people assume are worthless turn out to be in demand. When in doubt, bring it in and let us look.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            If we see something in your collection where we think you are better off holding, we will tell you. The resale market for certain cards is in a clear upswing and selling into a rising market is usually the wrong move. Our job during a buy is not to extract every dollar from you. It is to give you a fair offer on what you want to part with and honest guidance on what you should keep.
          </p>
        </div>

        {/* Consignment details */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '32px auto 0'
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            When consignment makes more sense than selling outright
          </h3>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            If you have graded cards or high-end singles, consignment usually pays better than selling to us outright. We list your items in the shop and online where collectors see them, and when they sell you get paid the agreed amount minus a small consignment fee. You skip eBay fees, shipping hassles, and the risk of dealing with dishonest buyers. The tradeoff is time. Outright buys put cash in your hand today. Consignment gets you a higher number but takes days, weeks, or sometimes months depending on the card.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '0' }}>
            We talk through both paths with every seller so you pick the one that matches what you actually need. Call the shop at (714) 951-9100 to set up a consignment agreement, or if you are just exploring, book a <Link to="/consultation" style={{ color: '#C8102E', fontWeight: '700' }}>free consultation</Link> first so you know exactly what you have before deciding how to move it.
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Calendar Page ────────────────────────────────────────
function CalendarPage({ isMobile, isAdmin, staff }) {
  const { siteSettings, specialHours } = useSite();
  const [searchParams] = useSearchParams();
  // Read the initial filter from the URL so deep links from elsewhere on the
  // site (the about-page calendar CTA, the See-lineup chips on the calendar
  // header, etc.) can land users in a pre-filtered state.
  const initialFilter = searchParams.get('filter');
  // 'vendors' is the virtual has_vendors filter; the rest must match a
  // real CATEGORIES key. Anything else is ignored.
  const [activeFilter, setActiveFilter] = useState(
    initialFilter === 'vendors' || (initialFilter && CATEGORIES[initialFilter])
      ? initialFilter : null
  );
  const [events, setEvents] = useState([]);
  const calendarRef = useRef(null);

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true });
    setEvents(data || []);
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // When a filter was passed via the URL, smooth-scroll to the calendar grid
  // once the events are in. View Transitions on the source page handles the
  // morph; this finishes the journey by landing the user on the grid.
  useEffect(() => {
    if (initialFilter && events.length > 0 && calendarRef.current) {
      const id = requestAnimationFrame(() => {
        calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [initialFilter, events.length]);

  // Derive weekly schedule from recurring weekly events
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Weekly themes run Tue → Sun (Mon is closed; Sun goes last so the row
  // doesn't have a visual gap where Monday would sit).
  const DAY_ORDER = [2, 3, 4, 5, 6, 0]; // Tue, Wed, Thu, Fri, Sat, Sun
  const weeklyEvents = events
    .filter(ev => ev.recurrence === 'weekly')
    .map(ev => {
      const evDate = new Date(ev.event_date + 'T00:00:00');
      const dow = evDate.getDay();
      return { ...ev, dow, dayName: DAY_NAMES[dow] };
    })
    .sort((a, b) => DAY_ORDER.indexOf(a.dow) - DAY_ORDER.indexOf(b.dow));

  // Live count of how many distinct, non-cancelled events fall into each
  // category. Powers the chip-count badges + dims chips for empty categories.
  const categoryCounts = events.reduce((acc, ev) => {
    if (ev.cancelled) return acc;
    (ev.categories || []).forEach(c => { acc[c] = (acc[c] || 0) + 1; });
    return acc;
  }, {});

  // Derive special events (vendor-bearing or card shows).
  // Pull non-recurring "headline" events for the top-of-calendar callout.
  // Anything with `has_vendors=true` or tagged `card_show` qualifies, sorted
  // by soonest first so the upcoming lineup surfaces ahead of older callouts.
  const specialEvents = events
    .filter(ev => !ev.cancelled && ev.recurrence === 'none' && (ev.has_vendors || (ev.categories || []).includes('card_show')))
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  // Get today's events
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayEvents = events.filter(ev => {
    if (ev.event_date === todayStr) return true;
    if (ev.recurrence === 'none') return false;
    const evDate = new Date(ev.event_date + 'T00:00:00');
    if (today < evDate) return false;
    if (ev.recurrence_end_date && today > new Date(ev.recurrence_end_date + 'T00:00:00')) return false;
    const diffDays = Math.floor((today - evDate) / (1000 * 60 * 60 * 24));
    if (ev.recurrence === 'weekly') return diffDays % 7 === 0;
    if (ev.recurrence === 'biweekly') return diffDays % 14 === 0;
    if (ev.recurrence === 'monthly') return evDate.getDate() === today.getDate();
    return false;
  });

  // If nothing today, find next day with events (up to 7 days ahead)
  let nextDayEvents = [];
  let nextDayLabel = '';
  if (todayEvents.length === 0) {
    for (let offset = 1; offset <= 7; offset++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() + offset);
      const checkStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      const found = events.filter(ev => {
        if (ev.event_date === checkStr) return true;
        if (ev.recurrence === 'none') return false;
        const evDate = new Date(ev.event_date + 'T00:00:00');
        if (checkDate < evDate) return false;
        if (ev.recurrence_end_date && checkDate > new Date(ev.recurrence_end_date + 'T00:00:00')) return false;
        const diffDays = Math.floor((checkDate - evDate) / (1000 * 60 * 60 * 24));
        if (ev.recurrence === 'weekly') return diffDays % 7 === 0;
        if (ev.recurrence === 'biweekly') return diffDays % 14 === 0;
        if (ev.recurrence === 'monthly') return evDate.getDate() === checkDate.getDate();
        return false;
      });
      if (found.length > 0) {
        nextDayEvents = found;
        nextDayLabel = offset === 1 ? 'Tomorrow' : DAY_NAMES[checkDate.getDay()];
        break;
      }
    }
  }

  const formatTime = formatTime12h;

  const handlePrint = () => {
    if (!calendarRef.current) return;
    const printWin = window.open('', '_blank');
    const calEl = calendarRef.current;
    const calDate = calEl.dataset.year && calEl.dataset.month
      ? new Date(parseInt(calEl.dataset.year), parseInt(calEl.dataset.month))
      : new Date();
    const yr = calDate.getFullYear();
    const mo = calDate.getMonth();
    const moName = calDate.toLocaleString('default', { month: 'long' });
    // Print grid is Mon–Sun (matches the on-screen calendar).
    const firstDay = (new Date(yr, mo, 1).getDay() + 6) % 7;
    const daysInMo = new Date(yr, mo + 1, 0).getDate();

    // Build day-to-events map from actual data
    const getEventsForPrintDay = (d) => {
      const dateObj = new Date(yr, mo, d);
      const dateStr = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return events.filter(ev => {
        if (ev.event_date === dateStr) return true;
        if (ev.recurrence === 'none') return false;
        const evDate = new Date(ev.event_date + 'T00:00:00');
        if (dateObj < evDate) return false;
        if (ev.recurrence_end_date && dateObj > new Date(ev.recurrence_end_date + 'T00:00:00')) return false;
        const diffDays = Math.floor((dateObj - evDate) / (1000 * 60 * 60 * 24));
        if (ev.recurrence === 'weekly') return diffDays % 7 === 0;
        if (ev.recurrence === 'biweekly') return diffDays % 14 === 0;
        if (ev.recurrence === 'monthly') return evDate.getDate() === d;
        return false;
      });
    };

    printWin.document.write(`
      <html><head><title>Trainer Center HB - ${moName} ${yr}</title>
      <style>
        @page { size: landscape; margin: 0.5in; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
        .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #C8102E; }
        .header img { width: 50px; height: 50px; border-radius: 10px; }
        .header h1 { margin: 0; font-size: 22px; color: #1a1a1a; }
        .header span { color: #888; font-size: 14px; }
        .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; border: 1px solid #ddd; }
        .day-header { background: #1a1a1a; color: #fff; padding: 8px; text-align: center; font-weight: 700; font-size: 12px; }
        .day-cell { border: 1px solid #eee; padding: 8px; min-height: 80px; font-size: 11px; vertical-align: top; }
        .day-num { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
        .event-title { background: #f5f5f5; border-radius: 4px; padding: 2px 6px; margin: 2px 0; font-size: 10px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-title.trade_night { border-left: 3px solid #C8102E; }
        .event-title.card_show { border-left: 3px solid #7c3aed; }
        .event-title.game_day { border-left: 3px solid #0891b2; }
        .event-title.crafts { border-left: 3px solid #ec4899; }
        .event-title.consultation { border-left: 3px solid #059669; }
        .event-title.on_the_road { border-left: 3px solid #d97706; }
        .event-title.tournament { border-left: 3px solid #2563eb; }
        .event-title.other { border-left: 3px solid #ea580c; }
        .empty { background: #fafafa; }
        .weekly { margin-top: 20px; display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: #666; }
        .weekly strong { color: #1a1a1a; }
      </style></head><body>
      <div class="header">
        <img src="/logo-square.png" alt="Trainer Center HB" />
        <div><h1>Trainer Center HB - ${moName} ${yr}</h1><span>4911 Warner Ave #210, Huntington Beach, CA 92649 | (714) 951-9100</span></div>
      </div>
    `);

    printWin.document.write('<div class="grid">');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => {
      printWin.document.write('<div class="day-header">' + d + '</div>');
    });
    for (let i = 0; i < firstDay; i++) printWin.document.write('<div class="day-cell empty"></div>');

    for (let d = 1; d <= daysInMo; d++) {
      const dayEvts = getEventsForPrintDay(d);
      const evHtml = dayEvts.map(ev => '<div class="event-title ' + ((ev.categories || ['other'])[0]) + '">' + ev.title + '</div>').join('');
      printWin.document.write('<div class="day-cell"><div class="day-num">' + d + '</div>' + evHtml + '</div>');
    }
    const totalCells = firstDay + daysInMo;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) printWin.document.write('<div class="day-cell empty"></div>');
    printWin.document.write('</div>');

    // Dynamic weekly legend from DB
    printWin.document.write('<div class="weekly">');
    weeklyEvents.forEach(ev => {
      const shortDay = ev.dayName.slice(0, 3);
      printWin.document.write('<span><strong>' + shortDay + ':</strong> ' + ev.title + '</span>');
    });
    if (specialEvents.length > 0) {
      printWin.document.write('<span><strong>Special:</strong> ' + specialEvents[0].title + ' (see calendar)</span>');
    }
    printWin.document.write('</div>');

    printWin.document.write('</body></html>');
    printWin.document.close();
    setTimeout(() => printWin.print(), 300);
  };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ position: 'relative' }}>
        <SectionHeader title="Calendar" subtitle="Upcoming events and activities" />

        {/* What's Happening Today / Next Up */}
        {(todayEvents.length > 0 || nextDayEvents.length > 0) && (() => {
          const { isOpen } = computeOpenNowState(siteSettings, specialHours);
          const hasToday = todayEvents.length > 0;
          const headerLabel = hasToday ? "What's Happening Today" : `Next Up: ${nextDayLabel}`;
          const headerColor = hasToday ? '#C8102E' : '#2563eb';
          const bgColor = hasToday ? '#fff0f0' : '#f0f7ff';
          const borderColor = hasToday ? '1px solid #fecaca' : '1px solid #dbeafe';
          return (
          <div style={{
            backgroundColor: bgColor,
            border: borderColor,
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <p style={{
                fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px',
                color: headerColor, margin: 0
              }}>
                {headerLabel}
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 10px', borderRadius: '20px',
                backgroundColor: isOpen ? '#f0fdf4' : '#fef2f2',
                border: isOpen ? '1px solid #bbf7d0' : '1px solid #fecaca',
              }}>
                <div style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  backgroundColor: isOpen ? '#22c55e' : '#ef4444',
                  boxShadow: isOpen ? '0 0 4px rgba(34,197,94,0.5)' : 'none',
                }} />
                <span style={{
                  fontSize: '0.7rem', fontWeight: '700',
                  color: isOpen ? '#166534' : '#991b1b',
                }}>
                  {isOpen ? 'Open Now' : 'Currently Closed'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(todayEvents.length > 0 ? todayEvents : nextDayEvents).map((ev, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: CATEGORIES[(ev.categories || [])[0]]?.color || '#ea580c'
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1a1a1a' }}>{ev.title}</span>
                    {ev.start_time && (
                      <span style={{ fontSize: '0.8rem', color: '#888', marginLeft: '8px' }}>
                        {formatTime(ev.start_time)}{ev.end_time ? ` - ${formatTime(ev.end_time)}` : ''}
                      </span>
                    )}
                    {ev.has_vendors && (ev.vendor_start_time || ev.vendor_end_time) && (
                      <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '700', marginTop: '2px' }}>
                        Vendors: {formatTime(ev.vendor_start_time)} - {formatTime(ev.vendor_end_time)}
                      </div>
                    )}
                  </div>
                  {ev.has_vendors && (
                    <Link
                      to={`/vendor-day?event=${ev.id}`}
                      style={{
                        fontSize: '0.7rem', fontWeight: '700',
                        color: '#16a34a', backgroundColor: '#fff',
                        padding: '4px 10px', borderRadius: '6px',
                        textDecoration: 'none',
                        border: '1px solid #bbf7d0',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      See lineup <ArrowRight size={11} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
          );
        })()}

        {/* Check out our events — category filter chips replacing the old
            day-tagged weekly cards. Each chip filters the calendar grid by
            category and doubles as the SEO-friendly description of what we
            do at the shop. The 7 keys here mirror the CATEGORIES dict.
            Categories with zero events on the calendar are dimmed. */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ marginBottom: '10px' }}>
            <h3 style={{
              fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a',
              margin: '0 0 2px 0',
            }}>
              Check out our events
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#888', margin: 0 }}>
              Tap one to see it on the calendar.
            </p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '10px',
          }}>
            {/* Virtual chip: Vendors. Filters by has_vendors flag, not by
                category, so it surfaces every vendor-bearing event no
                matter which category they're tagged with. */}
            {(() => {
              const vendorCount = events.filter(e => !e.cancelled && e.has_vendors).length;
              const isActive = activeFilter === 'vendors';
              const dim = vendorCount === 0;
              const vendorColor = '#16a34a';
              const description = 'Events with vendors set up — Vendor Days and special trade nights.';
              return (
                <button
                  key="vendors"
                  type="button"
                  onClick={() => setActiveFilter(isActive ? null : 'vendors')}
                  disabled={dim}
                  title={dim ? 'No vendor events on the calendar yet' : description}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: isActive ? vendorColor : '#fff',
                    border: `1px solid ${isActive ? vendorColor : '#eee'}`,
                    borderLeft: `3px solid ${vendorColor}`,
                    cursor: dim ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: dim ? 0.55 : 1,
                    transition: 'all 0.15s',
                    boxShadow: isActive ? `0 4px 12px ${vendorColor}33` : 'none',
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <h4 style={{
                      fontSize: '0.88rem', fontWeight: '800',
                      color: isActive ? '#fff' : '#1a1a1a',
                      margin: 0, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      Vendors
                    </h4>
                    {vendorCount > 0 && (
                      <span style={{
                        fontSize: '0.65rem', fontWeight: '800',
                        color: isActive ? '#fff' : vendorColor,
                        backgroundColor: isActive ? 'rgba(255,255,255,0.22)' : vendorColor + '1a',
                        padding: '2px 7px', borderRadius: '999px',
                        flexShrink: 0,
                      }}>{vendorCount}</span>
                    )}
                  </div>
                  <p style={{
                    fontSize: '0.72rem',
                    color: isActive ? 'rgba(255,255,255,0.9)' : '#666',
                    margin: 0, lineHeight: '1.35',
                  }}>
                    {description}
                  </p>
                </button>
              );
            })()}
            {Object.entries(CATEGORIES).map(([key, cat]) => {
              const isActive = activeFilter === key;
              const count = categoryCounts[key] || 0;
              const dim = count === 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(isActive ? null : key)}
                  disabled={dim}
                  title={dim ? `No ${cat.label} events on the calendar yet` : cat.description}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: isActive ? cat.color : '#fff',
                    border: `1px solid ${isActive ? cat.color : '#eee'}`,
                    borderLeft: `3px solid ${cat.color}`,
                    cursor: dim ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: dim ? 0.55 : 1,
                    transition: 'all 0.15s',
                    boxShadow: isActive ? `0 4px 12px ${cat.color}33` : 'none',
                    minWidth: 0,
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    marginBottom: '4px',
                  }}>
                    <h4 style={{
                      fontSize: '0.88rem', fontWeight: '800',
                      color: isActive ? '#fff' : '#1a1a1a',
                      margin: 0, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {cat.label}
                    </h4>
                    {count > 0 && (
                      <span style={{
                        fontSize: '0.65rem', fontWeight: '800',
                        color: isActive ? '#fff' : cat.color,
                        backgroundColor: isActive ? 'rgba(255,255,255,0.22)' : cat.color + '1a',
                        padding: '2px 7px', borderRadius: '999px',
                        flexShrink: 0,
                      }}>
                        {count}
                      </span>
                    )}
                  </div>
                  <p style={{
                    fontSize: '0.72rem',
                    color: isActive ? 'rgba(255,255,255,0.9)' : '#666',
                    margin: 0, lineHeight: '1.35',
                  }}>
                    {cat.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Special Events callout (dynamic, color matches primary category) */}
        {specialEvents.length > 0 && (() => {
          const ev = specialEvents[0];
          // Vendor-bearing events read green; otherwise pick the first category.
          const primaryKey = ev.has_vendors ? 'vendor' : ((ev.categories || [])[0] || 'card_show');
          const tone = primaryKey === 'vendor'
            ? { color: '#16a34a', label: 'Vendors' }
            : (CATEGORIES[primaryKey] || CATEGORIES.card_show);
          // Tint the bg with a transparent overlay of the category color so red,
          // green, blue, purple, etc. all read like soft callouts in their hue.
          const bg = tone.color + '12';
          const border = tone.color + '44';
          return (
            <div style={{
              padding: '14px 20px', borderRadius: '10px', backgroundColor: bg,
              border: `1px solid ${border}`, marginBottom: '20px',
              display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
            }}>
              <span style={{
                fontSize: '0.65rem', fontWeight: '800', color: tone.color,
                backgroundColor: tone.color + '1f', padding: '2px 8px',
                borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>
                {[
                  ...(ev.categories || []).map(c => CATEGORIES[c]?.label || c),
                  ev.has_vendors ? 'Vendors' : null,
                ].filter(Boolean).join(' · ')}
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: '800', color: tone.color }}>
                {ev.title}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>
                {new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              {ev.has_vendors && (ev.vendor_start_time || ev.vendor_end_time) && (
                <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '700' }}>
                  Vendors {formatTime(ev.vendor_start_time)} - {formatTime(ev.vendor_end_time)}
                </span>
              )}
              {ev.description && (
                <span style={{ fontSize: '0.75rem', color: '#888' }}>
                  · {ev.description.length > 80 ? ev.description.slice(0, 80) + '...' : ev.description}
                </span>
              )}
              {ev.has_vendors && (
                <Link
                  to={`/vendor-day?event=${ev.id}`}
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.75rem', fontWeight: '700',
                    color: '#fff', backgroundColor: tone.color,
                    padding: '5px 12px', borderRadius: '6px',
                    textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  See lineup <ArrowRight size={13} />
                </Link>
              )}
            </div>
          );
        })()}

        {/* Print button row (filtering is handled by the weekly cards above). */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap'
        }}>
          {activeFilter && (
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700',
                cursor: 'pointer', border: '2px solid #e0e0e0', backgroundColor: '#fff', color: '#666',
                display: 'inline-flex', alignItems: 'center', gap: '6px'
              }}
            >
              <X size={12} /> Clear filter
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={handlePrint}
            style={{
              padding: '6px 14px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700',
              cursor: 'pointer', border: '2px solid #e0e0e0', backgroundColor: '#fff', color: '#666',
            }}
          >
            Print Month
          </button>
        </div>

        <div ref={calendarRef} data-year="" data-month="" style={{
          position: 'relative',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden'
        }}>
          <img
            src="/logo-transparent.png"
            alt=""
            style={{
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '420px',
              opacity: 0.08,
              pointerEvents: 'none',
              zIndex: 1
            }}
          />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <Calendar isStaff={isAdmin} isMobile={isMobile} staff={staff} activeCategory={activeFilter} calendarRef={calendarRef} events={events} fetchEvents={fetchEvents} />
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Blog List Page ──────────────────────────────────────
const BLOG_RELEASE_DATES = [
  'Mar 31', 'Apr 7', 'Apr 14', 'Apr 21', 'Apr 28', 'May 5',
  'May 12', 'May 19', 'May 26', 'Jun 2', 'Jun 9', 'Jun 16'
];

function BlogListPage({ isMobile }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Blog" subtitle="Tips, guides, and everything Pokemon" />
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {BLOG_DATA.map((blog, i) => {
            const isPublished = blog.published;
            const releaseDate = BLOG_RELEASE_DATES[i] || '';

            const card = (
              <div style={{
                backgroundColor: isPublished ? '#ffffff' : '#fafafa',
                borderRadius: '12px',
                border: '1px solid #eee',
                padding: '20px 24px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                flexDirection: isMobile ? 'column' : 'row',
                gap: isMobile ? '8px' : '16px',
                transition: isPublished ? 'transform 0.2s, box-shadow 0.2s' : 'none',
                cursor: isPublished ? 'pointer' : 'default',
                opacity: isPublished ? 1 : 0.55
              }}
              onMouseEnter={isPublished ? e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; } : undefined}
              onMouseLeave={isPublished ? e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; } : undefined}
              >
                <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: isPublished ? '#1a1a1a' : '#999', margin: 0, flex: 1 }}>
                  {blog.title}
                </h3>
                {!isPublished && (
                  <span style={{
                    fontSize: '0.7rem', fontWeight: '700', color: '#C8102E',
                    backgroundColor: '#fff0f0', padding: '4px 10px', borderRadius: '6px',
                    whiteSpace: 'nowrap'
                  }}>
                    Coming {releaseDate}
                  </span>
                )}
              </div>
            );

            if (isPublished) {
              return (
                <Link key={blog.slug} to={`/blog/${blog.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  {card}
                </Link>
              );
            }
            return <div key={blog.slug}>{card}</div>;
          })}
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Blog Post Page ──────────────────────────────────────
function BlogPostPage({ isMobile }) {
  const { slug } = useParams();
  const blog = BLOG_DATA.find(b => b.slug === slug);

  if (!blog || !blog.published) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1a1a1a', marginBottom: '16px' }}>Post not found</h2>
          <Link to="/blog" style={{ color: '#C8102E', textDecoration: 'none', fontWeight: '600' }}>Back to Blog</Link>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px 64px' }}>
        <Link to="/blog" style={{ color: '#C8102E', textDecoration: 'none', fontWeight: '600', fontSize: '0.9rem', display: 'inline-block', marginBottom: '24px' }}>
          &larr; Back to Blog
        </Link>
        <h1 style={{ fontSize: isMobile ? '1.5rem' : '2rem', fontWeight: '800', color: '#1a1a1a', lineHeight: 1.3, marginBottom: '32px' }}>
          {blog.title}
        </h1>
        {blog.content.map((block, i) => {
          if (block.type === 'h2') {
            return <h2 key={i} style={{ fontSize: '1.3rem', fontWeight: '700', color: '#1a1a1a', marginTop: '32px', marginBottom: '12px', lineHeight: 1.3 }}>{block.text}</h2>;
          }
          if (block.type === 'h3') {
            return <h3 key={i} style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1a1a1a', marginTop: '24px', marginBottom: '8px', lineHeight: 1.3 }}>{block.text}</h3>;
          }
          if (block.type === 'p') {
            return <p key={i} style={{ fontSize: '1rem', color: '#333', lineHeight: 1.75, marginBottom: '16px' }} dangerouslySetInnerHTML={{ __html: block.text }} />;
          }
          if (block.type === 'li') {
            return (
              <ul key={i} style={{ paddingLeft: '24px', marginBottom: '16px' }}>
                {block.items.map((item, j) => (
                  <li key={j} style={{ fontSize: '1rem', color: '#333', lineHeight: 1.75, marginBottom: '8px' }}>{item}</li>
                ))}
              </ul>
            );
          }
          return null;
        })}
      </div>
    </PageWrapper>
  );
}

// ─── Vendor avatar (logo or initials fallback) ────────────
// Vendors don't always upload a logo. When they do, render it. When they
// don't, render a colored circle with their initials. Color is hashed from
// the vendor name so the same person always gets the same color.
function VendorAvatar({ vendor, size = 96 }) {
  const palette = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'];
  const hash = (vendor?.name || '?').split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const color = palette[Math.abs(hash) % palette.length];
  const initials = (vendor?.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('') || '?';

  if (vendor?.avatar_url) {
    return (
      <img
        src={vendor.avatar_url}
        alt={vendor.name}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', display: 'block',
          border: '3px solid #fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          backgroundColor: '#f3f4f6'
        }}
        loading="lazy"
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: '800', fontSize: Math.round(size * 0.38),
      letterSpacing: '0.02em',
      border: '3px solid #fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      flexShrink: 0
    }}>
      {initials}
    </div>
  );
}

// ─── Vendor card for the vendor-day showcase ──────────────
function VendorCard({ vendor, isOwn }) {
  const handles = [
    vendor.ig_handle && {
      platform: 'IG',
      handle: vendor.ig_handle,
      href: `https://instagram.com/${vendor.ig_handle.replace(/^@/, '')}`,
      bg: 'linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)',
    },
    vendor.tiktok_handle && {
      platform: 'TikTok',
      handle: vendor.tiktok_handle,
      href: `https://tiktok.com/@${vendor.tiktok_handle.replace(/^@/, '')}`,
      bg: '#000',
    },
    vendor.fb_handle && {
      platform: 'FB',
      handle: vendor.fb_handle,
      href: `https://facebook.com/${vendor.fb_handle.replace(/^@/, '')}`,
      bg: '#1877f2',
    },
  ].filter(Boolean);

  return (
    <div style={{
      backgroundColor: '#fff',
      border: isOwn ? '2px solid #C8102E' : '1px solid #eee',
      borderRadius: '16px',
      padding: '24px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: '12px',
      transition: 'transform 0.2s, box-shadow 0.2s',
      cursor: 'default',
      position: 'relative',
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.08)'; }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {isOwn && (
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          fontSize: '0.62rem', fontWeight: '800', letterSpacing: '0.06em',
          color: '#C8102E', backgroundColor: '#fff0f0',
          padding: '3px 8px', borderRadius: '999px',
          textTransform: 'uppercase',
        }}>
          You
        </div>
      )}
      <VendorAvatar vendor={vendor} size={104} />
      <div style={{ minWidth: 0, width: '100%' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: '800', color: '#1a1a1a', lineHeight: 1.2 }}>
          {vendor.name}
        </h3>
        {vendor.specialty && (
          <span style={{
            display: 'inline-block', fontSize: '0.7rem', fontWeight: '700',
            color: '#C8102E', backgroundColor: '#fff0f0', padding: '3px 10px',
            borderRadius: '999px', letterSpacing: '0.04em', textTransform: 'uppercase'
          }}>
            {vendor.specialty}
          </span>
        )}
        {(vendor.requested_start_time || vendor.requested_end_time) && (
          <div style={{
            marginTop: '6px',
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            fontSize: '0.72rem', fontWeight: '700',
            color: '#15803d', backgroundColor: '#f0fdf4',
            padding: '3px 10px', borderRadius: '999px',
          }}>
            <Clock size={11} />
            {formatTime12h(vendor.requested_start_time) || '?'} – {formatTime12h(vendor.requested_end_time) || '?'}
          </div>
        )}
      </div>
      {vendor.bio && (
        <p style={{
          margin: 0, fontSize: '0.85rem', color: '#555', lineHeight: 1.5,
          fontStyle: 'italic'
        }}>
          "{vendor.bio}"
        </p>
      )}
      {handles.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
          {handles.map(h => (
            <a key={h.platform} href={h.href} target="_blank" rel="noopener noreferrer" style={{
              fontSize: '0.72rem', fontWeight: '700',
              padding: '5px 10px', borderRadius: '6px',
              color: '#fff', textDecoration: 'none',
              background: h.bg,
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              maxWidth: '100%',
            }}>
              <span>{h.platform}</span>
              <span style={{ opacity: 0.85, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                @{h.handle.replace(/^@/, '')}
              </span>
            </a>
          ))}
        </div>
      )}
      {isOwn && (
        <Link to="/vendors/edit" style={{
          marginTop: '6px',
          fontSize: '0.78rem', fontWeight: '700',
          color: '#fff', backgroundColor: '#1a1a1a',
          padding: '8px 14px', borderRadius: '8px',
          textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: '6px',
        }}>
          <Edit2 size={13} /> Edit profile
        </Link>
      )}
    </div>
  );
}

// ─── Home page banner: next Vendor Day promo ──────────────
// Pulls the next future event with category 'vendor_day' (not cancelled),
// shows the dynamic title + date + approved-vendor count, links to the
// public showcase. If there are no upcoming Vendor Days, renders nothing.
function NextVendorDayBanner({ isMobile }) {
  const [event, setEvent] = useState(null);
  const [vendorCount, setVendorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = todayISO();
      const { data } = await supabase
        .from('events')
        .select('id, title, event_date, cancelled, vendor_applications(id, status)')
        .eq('has_vendors', true)
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(1);
      if (cancelled) return;
      const ev = (data || []).find(e => !e.cancelled);
      if (ev) {
        setEvent(ev);
        const approved = (ev.vendor_applications || []).filter(a => a.status === 'approved').length;
        setVendorCount(approved);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !event) return null;

  const d = new Date(event.event_date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const today = new Date(); today.setHours(0,0,0,0);
  const dayDiff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const relativeLabel = dayDiff === 0 ? 'TODAY' : dayDiff === 1 ? 'TOMORROW' : (dayDiff <= 7 ? 'THIS WEEK' : 'COMING UP');

  // Hot mode: lineup is built enough or close enough that the count + lineup
  // page are the right surface. Cold mode: we don't want to show "1 vendor
  // confirmed" while it builds, so we route to the educational about page
  // instead and lead with what the event IS, not who's there.
  const HOT_VENDOR_THRESHOLD = 15;
  const hotMode = dayDiff <= 7 || vendorCount >= HOT_VENDOR_THRESHOLD;
  const ctaTo = hotMode ? `/vendor-day?event=${event.id}` : '/vendor-day/about';
  const ctaLabel = hotMode ? 'See the lineup' : 'What is this?';
  const subline = hotMode
    ? `${vendorCount} vendor${vendorCount === 1 ? '' : 's'} confirmed. Tap to see who's setting up.`
    : 'A platform for vendors. A community for collectors. Tap to learn how it works.';

  return (
    <div
      onClick={() => navigate(ctaTo)}
      style={{
        marginBottom: '64px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2a0a0a 50%, #C8102E 100%)',
        borderRadius: '20px',
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
        boxShadow: '0 12px 40px rgba(200,16,46,0.25)',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 16px 48px rgba(200,16,46,0.35)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(200,16,46,0.25)'; }}
    >
      <div style={{
        padding: isMobile ? '28px 24px' : '40px 48px',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: '20px',
        color: '#fff',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'inline-block',
            fontSize: '0.7rem', fontWeight: '800',
            letterSpacing: '0.12em',
            color: '#fff',
            backgroundColor: 'rgba(255,255,255,0.15)',
            padding: '5px 12px',
            borderRadius: '999px',
            marginBottom: '12px',
            border: '1px solid rgba(255,255,255,0.25)',
          }}>
            {relativeLabel} · {dateStr.toUpperCase()}
          </div>
          <h2 style={{
            margin: '0 0 8px',
            fontSize: isMobile ? '1.6rem' : '2.2rem',
            fontWeight: '900',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}>
            {event.title || 'Vendor Day'}
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.95rem',
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.5,
          }}>
            {subline}
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backgroundColor: '#fff',
          color: '#C8102E',
          padding: '12px 22px',
          borderRadius: '12px',
          fontSize: '0.95rem',
          fontWeight: '800',
          flexShrink: 0,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {ctaLabel} <ArrowRight size={18} />
        </div>
      </div>
    </div>
  );
}

// CTA banner shown on /vendor-day pointing prospective vendors at the apply
// flow. Reused by both the populated and empty states of the page.
function ApplyToVendBanner({ isMobile }) {
  return (
    <div style={{
      maxWidth: '1100px',
      margin: '0 auto 28px',
      padding: isMobile ? '18px 18px' : '20px 24px',
      background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
      border: '1px solid #bbf7d0',
      borderRadius: '12px',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: '14px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.65rem', fontWeight: '800',
          color: '#15803d', textTransform: 'uppercase',
          letterSpacing: '0.1em', marginBottom: '4px'
        }}>
          For vendors
        </div>
        <div style={{
          fontSize: isMobile ? '1rem' : '1.05rem',
          fontWeight: '800', color: '#14532d',
          lineHeight: '1.35'
        }}>
          Want to vend at Trainer Center events?
        </div>
        <div style={{ fontSize: '0.85rem', color: '#166534', marginTop: '2px' }}>
          Apply once and pick the dates you want.
        </div>
      </div>
      <Link
        to="/vendors/apply"
        style={{
          fontSize: '0.9rem', fontWeight: '700',
          color: '#fff', backgroundColor: '#16a34a',
          padding: '12px 22px', borderRadius: '10px',
          textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Apply to vend <ArrowRight size={15} />
      </Link>
    </div>
  );
}

// ─── Public Vendor Day Showcase Page ──────────────────────
// ─── Vendor Day "About" / educational page ───────────────
// /vendor-day/about — what these events ARE, why they exist, how vendors
// get involved. Linked from the home banner during cold periods (more than
// a week out, fewer than 15 confirmed) so first-time visitors learn the
// program before they see counts that are still building.
function VendorDayAboutPage({ isMobile }) {
  const navigate = useNavigate();
  const [nextEvent, setNextEvent] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = todayISO();
      const { data } = await supabase
        .from('events')
        .select('id, title, event_date, cancelled')
        .eq('has_vendors', true)
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(1);
      if (cancelled) return;
      const ev = (data || []).find(e => !e.cancelled);
      setNextEvent(ev || null);
    })();
    return () => { cancelled = true; };
  }, []);

  const para = { fontSize: '1rem', color: '#333', lineHeight: 1.75, margin: '0 0 16px 0' };
  const h2 = { fontSize: isMobile ? '1.25rem' : '1.4rem', fontWeight: '800', color: '#1a1a1a', margin: '32px 0 12px 0', letterSpacing: '-0.01em' };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '760px', margin: '0 auto' }}>
        <SectionHeader
          title="What are TC's Beach City Trade Nights?"
          subtitle="A platform for vendors. A community for collectors."
        />

        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '16px',
          padding: isMobile ? '24px 18px' : '40px',
        }}>
          <p style={para}>
            Once a month, Trainer Center HB hosts our biggest event: a Vendor Day where Pokemon vendors set up tables across the shop. Collectors come through, swap cards, talk shop, and walk out with the binder they have been chasing.
          </p>
          <p style={para}>
            New to trading? Even better. Plenty of regulars are happy to walk you through fair values and what to look for.
          </p>

          <h2 style={h2}>What makes it different</h2>
          <p style={para}>
            <strong>About 90% of our Vendor Days are completely free for vendors.</strong> No table fees. No gatekeeping. We provide the room, the foot traffic, and the platform. Vendors bring their inventory.
          </p>

          <h2 style={h2}>Beyond Vendor Day — what else we do</h2>
          <p style={para}>
            Vendor Day is one night a month. The rest of the time we're still working with the same vendors and collectors:
          </p>
          <ul style={{ ...para, paddingLeft: '20px', margin: '0 0 16px 0' }}>
            <li style={{ marginBottom: '10px' }}>
              <strong>Consignment</strong> — drop off inventory any time of the month and we'll move it for you.{' '}
              <Link to="/consultation" style={{ color: '#C8102E', fontWeight: '700' }}>Talk to Chef →</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Buy &amp; sell</strong> — we buy collections and singles, and we keep stock on hand to sell back to the community.{' '}
              <Link to="/buy-sell" style={{ color: '#C8102E', fontWeight: '700' }}>Buy / sell with us →</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Grading</strong> — we run submissions out and walk you through what to send, when, and why.{' '}
              <Link to="/grading" style={{ color: '#C8102E', fontWeight: '700' }}>How grading works →</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>1-on-1 consultations</strong> — appraisals, collecting strategy, learning the TCG. Book a slot with Chef.{' '}
              <Link to="/consultation" style={{ color: '#C8102E', fontWeight: '700' }}>Book a consultation →</Link>
            </li>
          </ul>

          <h2 style={h2}>How vending here works</h2>
          <ol style={{ ...para, paddingLeft: '20px', margin: '0 0 16px 0' }}>
            <li style={{ marginBottom: '12px' }}>
              <strong>Apply once to partner.</strong> Short application. We review profiles to keep the room healthy: no flippers, no shady dealers.
            </li>
            <li style={{ marginBottom: '12px' }}>
              <strong>Pick the dates you want.</strong> Once approved, every Vendor Day on the calendar shows up in your dashboard. Apply for the dates you want with two taps.
            </li>
            <li style={{ marginBottom: '12px' }}>
              <strong>Show up. Sell. Trade. Build relationships.</strong> Bring what you specialize in. Singles, sealed, slabs, vintage, Japanese — whatever you bring real value with.
            </li>
            <li style={{ marginBottom: '12px' }}>
              <strong>Boost your IG.</strong> After the event, post on your IG. Share Trainer Center's posts via DM with friends. The IG algorithm rewards DM-shares more than likes — that is how a low-volume page like ours grows. We don't try to play the algo with daily posts. We let the community do the talking.
            </li>
          </ol>

          <h2 style={h2}>Coming up</h2>
          {nextEvent ? (
            <p style={para}>
              Next event: <strong>{nextEvent.title || 'Vendor Day'}</strong> on{' '}
              <strong>{new Date(nextEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>.
            </p>
          ) : (
            <p style={para}>They generally run the last Friday of every month.</p>
          )}

          {/* Hero calendar CTA — Chase wants this loud since the calendar
              is the answer to "when is the next one and the one after that".
              Click triggers a View Transitions morph (where supported) and
              hands off to /calendar with ?filter=card_show pre-applied. */}
          <button
            type="button"
            onClick={() => {
              // View Transitions API gives a free cross-fade/morph on
              // browsers that support it (Chrome/Edge/Safari). Falls back
              // cleanly to instant SPA navigation in Firefox.
              const go = () => navigate('/calendar?filter=vendors');
              if (typeof document !== 'undefined' && document.startViewTransition) {
                document.startViewTransition(() => go());
              } else {
                go();
              }
            }}
            style={{
              width: '100%', marginTop: '20px',
              background: 'linear-gradient(135deg, #1a1a1a 0%, #2a0a0a 50%, #C8102E 100%)',
              color: '#fff',
              padding: isMobile ? '20px 22px' : '24px 28px',
              border: 'none', borderRadius: '14px',
              fontSize: isMobile ? '1rem' : '1.05rem', fontWeight: '800',
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '14px',
              boxShadow: '0 12px 40px rgba(200,16,46,0.25)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 16px 48px rgba(200,16,46,0.35)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(200,16,46,0.25)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '10px',
                backgroundColor: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <CalendarIcon size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85, marginBottom: '4px' }}>
                  Pick a date that works
                </div>
                <div style={{ fontSize: isMobile ? '1rem' : '1.1rem', fontWeight: '900', letterSpacing: '-0.01em' }}>
                  See every Vendor Day on the calendar
                </div>
              </div>
            </div>
            <ArrowRight size={20} style={{ flexShrink: 0 }} />
          </button>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '20px' }}>
            <Link to="/vendor-day" style={{
              backgroundColor: '#fff', color: '#1a1a1a',
              padding: '12px 22px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              border: '1px solid #ddd',
            }}>
              See current vendor lineup <ArrowRight size={16} />
            </Link>
            <Link to="/vendors/apply" style={{
              backgroundColor: '#1a1a1a', color: '#fff',
              padding: '12px 22px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
            }}>
              Apply to vend <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}


// /vendor-day — promotes who's vending. Two views:
//   default: one event at a time (date selector at top)
//   ?view=list: every vendor_day event in a long scrollable list
// Event title is dynamic from events.title — never hardcoded.
function VendorDayPage({ isMobile }) {
  const [allEvents, setAllEvents] = useState([]); // events with vendor_applications joined
  const [loading, setLoading] = useState(true);
  const [myVendorId, setMyVendorId] = useState(null); // for inline edit-on-own-card affordance
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'list' ? 'list' : 'single';
  const requestedEventId = searchParams.get('event');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull every vendor_day event with its approved-vendor lineup. Ordered
      // chronologically; we'll split past/future on the client.
      const eventsP = supabase
        .from('events')
        .select(`
          id, title, event_date, cancelled,
          vendor_applications (
            id, status, requested_start_time, requested_end_time,
            vendor:vendors ( id, name, avatar_url, specialty, bio, ig_handle, tiktok_handle, fb_handle )
          )
        `)
        .eq('has_vendors', true)
        .order('event_date', { ascending: true });

      // If a vendor is logged in, look up their vendor row id so we can
      // surface an inline "Edit profile" button on their own card. Public
      // visitors get null → no button.
      const meP = (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const { data } = await supabase
          .from('vendors').select('id').eq('user_id', session.user.id).maybeSingle();
        return data?.id || null;
      })();

      const [{ data, error }, mineId] = await Promise.all([eventsP, meP]);
      if (cancelled) return;
      if (error) console.error('[VendorDayPage] fetch', error);
      // Filter cancelled; keep approved vendors only on each event.
      // Showcase order: vendors with uploaded logos lead the lineup so the
      // page reads as a wall of brand marks instead of a sea of initials.
      // Within each tier (logo / no-logo) the order is shuffled per page
      // load so no one gets a permanent #1 slot. Stable within a single
      // render — `Math.random` runs once at fetch time, not on every paint.
      const shuffle = (arr) => {
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
      };
      const cleaned = (data || [])
        .filter(ev => !ev.cancelled)
        .map(ev => {
          const all = (ev.vendor_applications || [])
            .filter(a => a.status === 'approved' && a.vendor)
            .map(a => ({
              ...a.vendor,
              requested_start_time: a.requested_start_time,
              requested_end_time: a.requested_end_time,
            }));
          const withLogo = shuffle(all.filter(v => !!v.avatar_url));
          const noLogo = shuffle(all.filter(v => !v.avatar_url));
          return { ...ev, approved_vendors: [...withLogo, ...noLogo] };
        });
      setAllEvents(cleaned);
      setMyVendorId(mineId);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Determine which event to show in single-view mode.
  const todayStr = todayISO();
  const futureEvents = allEvents.filter(e => e.event_date >= todayStr);
  const pastEvents = allEvents.filter(e => e.event_date < todayStr).slice().reverse();
  const defaultEvent = futureEvents[0] || pastEvents[0] || null;
  const selectedEvent = (requestedEventId && allEvents.find(e => e.id === requestedEventId)) || defaultEvent;

  const setEvent = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('event', id); else next.delete('event');
    setSearchParams(next);
  };

  const setView = (next) => {
    const sp = new URLSearchParams(searchParams);
    if (next === 'list') sp.set('view', 'list'); else sp.delete('view');
    setSearchParams(sp);
  };

  if (loading) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#999' }}>
          <Loader2 size={24} className="spin" />
        </div>
      </PageWrapper>
    );
  }

  if (allEvents.length === 0) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
          <SectionHeader title="Vendor Day" subtitle="Coming soon" />
          <p style={{ color: '#666', marginBottom: '24px' }}>No Vendor Day events scheduled yet. Check back soon.</p>
          <ApplyToVendBanner isMobile={isMobile} />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        {/* Apply-to-vend CTA — shown above the lineup so anyone scrolling the
            roster sees the on-ramp without having to hunt for it. */}
        <ApplyToVendBanner isMobile={isMobile} />

        {/* Top control bar: event picker + view toggle */}
        <div style={{
          maxWidth: '1100px', margin: '0 auto 24px',
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          {view === 'single' && (
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <label style={{
                position: 'absolute', top: '-9px', left: '14px',
                fontSize: '0.65rem', fontWeight: '800',
                color: '#666', backgroundColor: '#fff',
                padding: '0 6px', letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                Select other dates
              </label>
              <select
                value={selectedEvent?.id || ''}
                onChange={(e) => setEvent(e.target.value)}
                style={{
                  width: '100%', padding: '14px 18px',
                  fontSize: '0.95rem', fontWeight: '700',
                  color: '#1a1a1a',
                  border: '2px solid #1a1a1a', borderRadius: '10px',
                  backgroundColor: '#fff',
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 16px center',
                  backgroundSize: '14px',
                  paddingRight: '44px',
                }}
              >
                {futureEvents.length > 0 && (
                  <optgroup label="Upcoming">
                    {futureEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' — '}{ev.title || 'Vendor Day'}
                      </option>
                    ))}
                  </optgroup>
                )}
                {pastEvents.length > 0 && (
                  <optgroup label="Past">
                    {pastEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        {' — '}{ev.title || 'Vendor Day'}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
          <div style={{
            display: 'flex', gap: '0',
            border: '2px solid #1a1a1a', borderRadius: '10px',
            overflow: 'hidden', flexShrink: 0,
            alignSelf: isMobile ? 'stretch' : 'auto',
          }}>
            <button
              onClick={() => setView('single')}
              style={{
                padding: '14px 18px', border: 'none',
                backgroundColor: view === 'single' ? '#1a1a1a' : '#fff',
                color: view === 'single' ? '#fff' : '#1a1a1a',
                fontSize: '0.85rem', fontWeight: '700',
                cursor: 'pointer', flex: isMobile ? 1 : 'initial',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <Grid3x3 size={15} /> One date
            </button>
            <button
              onClick={() => setView('list')}
              style={{
                padding: '14px 18px', border: 'none',
                backgroundColor: view === 'list' ? '#1a1a1a' : '#fff',
                color: view === 'list' ? '#fff' : '#1a1a1a',
                fontSize: '0.85rem', fontWeight: '700',
                cursor: 'pointer', flex: isMobile ? 1 : 'initial',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                borderLeft: '2px solid #1a1a1a',
              }}
            >
              <List size={15} /> List all
            </button>
          </div>
        </div>

        {view === 'single' && selectedEvent && (
          <VendorDaySingleEvent event={selectedEvent} myVendorId={myVendorId} isMobile={isMobile} />
        )}

        {view === 'list' && (
          <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '48px' }}>
            {[...futureEvents, ...pastEvents].map(ev => (
              <VendorDaySingleEvent key={ev.id} event={ev} myVendorId={myVendorId} isMobile={isMobile} compact />
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

// One Vendor Day section: hero header + grid of approved vendors.
// Used both as the single-event view and as a row in the list view.
function VendorDaySingleEvent({ event, myVendorId, isMobile, compact = false }) {
  const d = new Date(event.event_date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const today = new Date(); today.setHours(0,0,0,0);
  const dayDiff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const isPast = dayDiff < 0;
  const relativeLabel = isPast ? 'PAST' : dayDiff === 0 ? 'TODAY' : dayDiff === 1 ? 'TOMORROW' : (dayDiff <= 7 ? 'THIS WEEK' : 'COMING UP');
  const vendors = event.approved_vendors || [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{
        textAlign: 'center',
        marginBottom: compact ? '24px' : '40px',
        padding: compact ? '0' : '0 16px',
      }}>
        <div style={{
          display: 'inline-block',
          fontSize: '0.7rem', fontWeight: '800',
          letterSpacing: '0.12em',
          color: isPast ? '#666' : '#C8102E',
          backgroundColor: isPast ? '#f3f4f6' : '#fff0f0',
          padding: '5px 14px',
          borderRadius: '999px',
          marginBottom: '12px',
        }}>
          {relativeLabel} · {dateStr.toUpperCase()}
        </div>
        <h1 style={{
          margin: '0 0 6px',
          fontSize: compact ? (isMobile ? '1.5rem' : '1.9rem') : (isMobile ? '2rem' : '2.8rem'),
          fontWeight: '900',
          letterSpacing: '-0.02em',
          color: '#1a1a1a',
          lineHeight: 1.1,
        }}>
          {event.title || 'Vendor Day'}
        </h1>
        <p style={{
          margin: 0,
          fontSize: '0.95rem',
          color: '#666',
        }}>
          {vendors.length > 0
            ? `${vendors.length} vendor${vendors.length === 1 ? '' : 's'} ${isPast ? 'set up' : 'confirmed'}`
            : (isPast ? 'No vendors recorded for this date.' : 'Lineup coming together.')}
        </p>
      </div>

      {vendors.length === 0 ? (
        <div style={{
          backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
          padding: '48px 20px', textAlign: 'center', color: '#888',
          maxWidth: '520px', margin: '0 auto',
        }}>
          {isPast ? 'No vendors recorded for this date.' : "No vendors confirmed yet — check back soon."}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'repeat(auto-fill, minmax(160px, 1fr))'
            : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: isMobile ? '12px' : '20px',
        }}>
          {vendors.map(v => (
            <VendorCard key={v.id} vendor={v} isOwn={myVendorId === v.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Vendors Page ─────────────────────────────────────────
function VendorsPage({ isMobile, staff }) {
  const isAdmin = !!staff?.isAdmin;
  // Auth-aware fast path: if the viewer is already a logged-in vendor or
  // member/guest, skip the public landing and drop them straight into their
  // dashboard. `replace` keeps the back button from looping back to /vendors.
  const { vendor, member, isLoading: authLoading } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [winners, setWinners] = useState(null);

  useEffect(() => {
    supabase
      .from('vendor_submissions')
      .select('*, vendor:vendors(id, name, avatar_url, ig_handle, tiktok_handle, fb_handle, specialty), event:events(id, title, event_date), media:vendor_media(*)')
      .eq('visible', true)
      .order('submitted_at', { ascending: false })
      .limit(24)
      .then(({ data, error }) => {
        if (error) console.error('[VendorsPage] feed fetch', error);
        setSubmissions(data || []);
        setFeedLoading(false);
      });

    // Fetch last Vendor Day winners (most recent past event with at least one vote)
    supabase.rpc('get_last_voted_vendor_day').then(async ({ data }) => {
      if (!data || data.length === 0) return;
      const ev = data[0];
      const { data: w } = await supabase.rpc('get_event_winners', { p_event_id: ev.event_id });
      if (w && w.length > 0) setWinners({ event: ev, winners: w });
    });
  }, []);

  // Wait for auth state to settle before deciding — otherwise the public
  // page flashes for a frame on logged-in users while the session resolves.
  if (!authLoading && vendor) {
    return <Navigate to="/vendors/dashboard" replace />;
  }
  if (!authLoading && member && !vendor) {
    return <Navigate to="/vendors/review" replace />;
  }

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Vendors" subtitle="Last-Friday Vendor Day at Trainer Center HB" />

        {/* Intro + Apply CTA */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '0 auto 32px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              backgroundColor: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Users size={24} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>
              Vendor Day at Trainer Center HB
            </h3>
          </div>

          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '16px' }}>
            Every last Friday of the month, Pokemon vendors set up tables at Trainer Center HB, Huntington Beach. Bring your singles, sealed product, slabs, vintage, Japanese imports - whatever you specialize in. Trade with collectors, sell to walk-ins, and connect with the community.
          </p>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '28px' }}>
            Apply once, return every month with two clicks. After each event, share photos and a short clip from your table - we feature recent vendor posts right here on the page.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <Link to="/vendors/apply" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              backgroundColor: '#C8102E', color: '#fff',
              padding: '12px 24px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
            }}>
              Apply to Vend
            </Link>
            <Link to="/vendors/review" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              backgroundColor: '#16a34a', color: '#fff',
              padding: '12px 24px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
            }}>
              Sign in as Guest to Review
            </Link>
            <Link to="/vendors/dashboard" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              backgroundColor: '#fff', color: '#1a1a1a',
              padding: '12px 24px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none',
              border: '1px solid #ddd'
            }}>
              Vendor Login
            </Link>
            {isAdmin && (
              <Link to="/staff/vendors" style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#1a1a1a', color: '#fff',
                padding: '12px 24px', borderRadius: '10px',
                fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
              }}>
                Manage Vendors
              </Link>
            )}
          </div>
        </div>

        {/* Last Vendor Day winners */}
        {winners && (
          <div style={{ maxWidth: '1100px', margin: '0 auto 36px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>
              Last Vendor Day Winners
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#888', margin: '0 0 16px 0' }}>
              {winners.event.event_title || 'Vendor Day'} · {new Date(winners.event.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: '14px'
            }}>
              {VOTE_CATEGORIES.map(c => {
                const w = winners.winners.find(x => x.category === c.key);
                return (
                  <div key={c.key} style={{
                    backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
                    padding: '20px', textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.7rem', color: '#16a34a', fontWeight: '800',
                      textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px'
                    }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1a1a1a', marginBottom: '4px' }}>
                      {w ? w.vendor_name : '—'}
                    </div>
                    {w && (
                      <div style={{ fontSize: '0.78rem', color: '#888' }}>
                        {w.vote_count} {w.vote_count === 1 ? 'vote' : 'votes'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent vendor submissions feed */}
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            Recent Vendor Posts
          </h3>
          {feedLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
              <Loader2 size={20} className="spin" />
            </div>
          ) : submissions.length === 0 ? (
            <div style={{
              backgroundColor: '#fafafa',
              border: '1px dashed #ddd',
              borderRadius: '12px',
              padding: '40px 24px',
              textAlign: 'center',
              color: '#888',
              fontSize: '0.9rem'
            }}>
              Vendor posts from past Vendor Days will appear here once vendors start uploading after events.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '16px'
            }}>
              {submissions.map(sub => (
                <VendorSubmissionCard key={sub.id} submission={sub} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Vendor submission card on public feed ────────────────
function VendorSubmissionCard({ submission }) {
  const v = submission.vendor || {};
  const ev = submission.event || {};
  const media = (submission.media || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const photos = media.filter(m => m.kind === 'photo');
  const video = media.find(m => m.kind === 'video');
  const dateStr = ev.event_date
    ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column'
    }}>
      {/* Media area — when link_url is set, the tile becomes an outbound
          tap that sends the visitor to the vendor's IG post. That's the
          point of the upload flow: drive collectors back to the vendor. */}
      {video ? (
        (() => {
          const videoBlock = (
            <div style={{ position: 'relative', paddingTop: '56.25%', backgroundColor: '#000' }}>
              <iframe
                src={`https://iframe.mediadelivery.net/embed/${process.env.REACT_APP_BUNNY_LIBRARY_ID}/${video.bunny_video_id}?autoplay=true&loop=true&muted=true&preload=true&responsive=true`}
                loading="lazy"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={`Video by ${v.name}`}
              />
              {video.link_url && (
                <a
                  href={video.link_url}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    position: 'absolute', bottom: '8px', right: '8px',
                    backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff',
                    padding: '6px 12px', borderRadius: '999px',
                    fontSize: '0.7rem', fontWeight: '800', letterSpacing: '0.04em',
                    textTransform: 'uppercase', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    zIndex: 2,
                  }}
                >
                  View on IG  →
                </a>
              )}
            </div>
          );
          return videoBlock;
        })()
      ) : photos.length > 0 ? (
        photos[0].link_url ? (
          <a href={photos[0].link_url} target="_blank" rel="noopener noreferrer" style={{
            display: 'block', textDecoration: 'none', position: 'relative',
            aspectRatio: '16 / 9',
            backgroundColor: '#000',
            backgroundImage: `url(${photoUrl(photos[0].supabase_path)})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}>
            <span style={{
              position: 'absolute', bottom: '8px', right: '8px',
              backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff',
              padding: '6px 12px', borderRadius: '999px',
              fontSize: '0.7rem', fontWeight: '800', letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              View on IG  →
            </span>
          </a>
        ) : (
          <div style={{
            aspectRatio: '16 / 9',
            backgroundColor: '#000',
            backgroundImage: `url(${photoUrl(photos[0].supabase_path)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }} />
        )
      ) : null}

      {/* Photo strip if multiple — each tile links to its own IG post if set. */}
      {photos.length > 1 && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px', backgroundColor: '#fafafa' }}>
          {photos.slice(0, 4).map(p => {
            const tile = (
              <div style={{
                flex: 1,
                aspectRatio: '1 / 1',
                backgroundImage: `url(${photoUrl(p.supabase_path)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: '4px',
                minWidth: 0
              }} />
            );
            return p.link_url ? (
              <a key={p.id} href={p.link_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, textDecoration: 'none' }}>
                {tile}
              </a>
            ) : <div key={p.id} style={{ flex: 1, minWidth: 0 }}>{tile}</div>;
          })}
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {v.avatar_url && (
              <img
                src={v.avatar_url}
                alt={`${v.name} logo`}
                style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  objectFit: 'cover', flexShrink: 0,
                  border: '1px solid #eee'
                }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a' }}>{v.name}</div>
              {v.specialty && (
                <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '700', marginTop: '2px' }}>
                  {v.specialty}
                </div>
              )}
            </div>
          </div>
          {dateStr && (
            <div style={{ fontSize: '0.75rem', color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {dateStr}
            </div>
          )}
        </div>
        {submission.caption && (
          <p style={{ fontSize: '0.9rem', color: '#444', lineHeight: '1.6', margin: '8px 0 10px 0' }}>
            {submission.caption}
          </p>
        )}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
          {v.ig_handle && (
            <a href={`https://instagram.com/${v.ig_handle}`} target="_blank" rel="noopener noreferrer" style={socialLinkStyle}>
              IG @{v.ig_handle}
            </a>
          )}
          {v.tiktok_handle && (
            <a href={`https://tiktok.com/@${v.tiktok_handle}`} target="_blank" rel="noopener noreferrer" style={socialLinkStyle}>
              TikTok @{v.tiktok_handle}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const socialLinkStyle = {
  fontSize: '0.78rem',
  color: '#C8102E',
  fontWeight: '700',
  textDecoration: 'none'
};

// Build a Supabase Storage public URL for a photo path in the vendor-media bucket.
function photoUrl(path) {
  if (!path) return '';
  const base = process.env.REACT_APP_SUPABASE_URL;
  return `${base}/storage/v1/object/public/vendor-media/${path}`;
}

// ─── Password Auth Card (shared by vendor + member flows) ─
// Standard email + password signup or login. Uses Supabase auth with email
// confirmation disabled in project settings, so signUp returns a session
// immediately. Toggle between Create account / Log in modes.
function PasswordAuthCard({ accent, signupCopy, loginCopy, onSuccess }) {
  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    let result;
    if (mode === 'signup') {
      result = await supabase.auth.signUp({ email: cleanEmail, password });
    } else {
      result = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    }
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (!result.data.session) {
      // signUp without a session usually means the email already exists.
      setError('Email already has an account. Try logging in instead.');
      setMode('login');
      return;
    }
    onSuccess({ isNew: mode === 'signup', user: result.data.user });
  };

  const accentColor = accent === 'green' ? '#16a34a' : '#C8102E';
  const inputCss = {
    width: '100%', padding: '12px 14px', fontSize: '1rem',
    border: '1px solid #ddd', borderRadius: '10px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box'
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <form onSubmit={handleSubmit}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <button type="button" onClick={() => { setMode('signup'); setError(''); }} style={{
          flex: 1, padding: '10px', borderRadius: '8px',
          backgroundColor: mode === 'signup' ? accentColor : '#fff',
          color: mode === 'signup' ? '#fff' : '#666',
          border: mode === 'signup' ? 'none' : '1px solid #ddd',
          fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer'
        }}>Create account</button>
        <button type="button" onClick={() => { setMode('login'); setError(''); }} style={{
          flex: 1, padding: '10px', borderRadius: '8px',
          backgroundColor: mode === 'login' ? accentColor : '#fff',
          color: mode === 'login' ? '#fff' : '#666',
          border: mode === 'login' ? 'none' : '1px solid #ddd',
          fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer'
        }}>Log in</button>
      </div>

      <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 18px 0' }}>
        {mode === 'signup' ? signupCopy : loginCopy}
      </p>

      <label style={labelCss}>Email</label>
      <input type="email" required placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)} style={inputCss} />

      <label style={labelCss}>Password</label>
      <div style={{ position: 'relative', marginBottom: '18px' }}>
        <input type={showPw ? 'text' : 'password'} required
          placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
          minLength={6}
          value={password} onChange={e => setPassword(e.target.value)}
          style={{ ...inputCss, marginBottom: 0, paddingRight: '70px' }}
        />
        <button type="button" onClick={() => setShowPw(s => !s)} style={{
          position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#888', fontSize: '0.8rem', fontWeight: '600', padding: '4px 10px'
        }}>{showPw ? 'Hide' : 'Show'}</button>
      </div>

      {error && (
        <div style={{
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
          fontSize: '0.85rem', color: '#dc2626',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <AlertCircle size={16} />
          <span style={{ flex: 1 }}>{error}</span>
        </div>
      )}

      <button type="submit" disabled={submitting} style={{
        width: '100%', padding: '14px',
        backgroundColor: submitting ? '#999' : accentColor, color: '#fff',
        border: 'none', borderRadius: '10px',
        fontSize: '1rem', fontWeight: '700',
        cursor: submitting ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
      }}>
        {submitting
          ? <><Loader2 size={18} className="spin" /> {mode === 'signup' ? 'Creating account...' : 'Logging in...'}</>
          : <>{mode === 'signup' ? 'Create account' : 'Log in'} <ArrowRight size={18} /></>
        }
      </button>
    </form>
  );
}

// ─── Vendor Apply Page ────────────────────────────────────
// Email + password signup. After auth, user lands on /vendors/dashboard
// where the onboarding form fires for first-time vendors.
function VendorApplyPage({ isMobile }) {
  const navigate = useNavigateInternal();
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto' }}>
        <SectionHeader title="Apply to Vend" subtitle="Create an account or log back in" />
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '36px',
        }}>
          <PasswordAuthCard
            accent="red"
            signupCopy="New here? Create your vendor account in seconds. Right after, you'll fill out a one-time application Chef will review."
            loginCopy="Already a vendor? Log back in to apply for upcoming Vendor Days."
            onSuccess={() => navigate('/vendors/dashboard')}
          />
        </div>
      </div>
    </PageWrapper>
  );
}

// Tiny helper so we can navigate after auth without dragging useNavigate
// imports through (avoids changing the existing react-router imports).
function useNavigateInternal() {
  return (path) => { window.location.href = path; };
}

// ─── Vendor Edit Profile Page ─────────────────────────────
// /vendors/edit — logged-in vendors update logo, tagline (bio), socials,
// specialty, etc. Re-uses VendorOnboardingForm in edit mode (existingVendor).
// Auth-gated: kicks back to /vendors/apply if not signed in or no vendor row.
function VendorEditProfilePage({ isMobile }) {
  const [session, setSession] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);

  // useNavigateInternal returns a NEW function on every render, so listing
  // `navigate` as a dep here triggered an infinite re-fetch loop
  // (ERR_INSUFFICIENT_RESOURCES). Use a stable inline redirect instead and
  // run the effect exactly once on mount.
  useEffect(() => {
    let cancelled = false;
    const goto = (path) => { window.location.href = path; };
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!s) { goto('/vendors/apply'); return; }
      setSession(s);
      const { data: v } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', s.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (!v) { goto('/vendors/dashboard'); return; }
      setVendor(v);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const navigate = useNavigateInternal();

  if (loading || !vendor || !session) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#999' }}>
          <Loader2 size={24} className="spin" />
        </div>
      </PageWrapper>
    );
  }

  return (
    <VendorOnboardingForm
      isMobile={isMobile}
      session={session}
      existingVendor={vendor}
      onComplete={() => navigate('/vendors/dashboard')}
    />
  );
}

// ─── Vendor Dashboard Page ────────────────────────────────
// Logged-in vendor home. Three states:
//   1. Not logged in → prompt to go to /vendors/apply
//   2. Logged in but no vendor row → onboarding form (collect full profile)
//   3. Logged in with vendor row → normal dashboard with event apply/check-in
function VendorDashboardPage({ isMobile }) {
  // Single source of truth for auth + roles. No local session/vendor
  // listeners -- they live at App root via AuthContext now, so navigating
  // away and back is instant (no per-page session refetch).
  const { user, vendor, isAdmin, isLoading: authRolesLoading, signOut, refresh: refreshAuth } = useAuth();
  const session = user ? { user } : null; // shape compatibility with downstream forms
  const authReady = !authRolesLoading;
  const vendorLoading = authRolesLoading;
  const [events, setEvents] = useState([]);
  const [applications, setApplications] = useState({}); // keyed by event_id

  // Fetch Vendor Day events (recent + upcoming) + applications + attendance
  // Past 14 days included so vendors can upload content after the event.
  const [attendance, setAttendance] = useState({});
  useEffect(() => {
    if (!vendor?.id) return;
    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const fromISO = fourteenDaysAgo.toISOString().slice(0, 10);
    Promise.all([
      supabase.from('events')
        .select('*')
        .eq('has_vendors', true)
        .gte('event_date', fromISO)
        .order('event_date', { ascending: true })
        .limit(20),
      supabase.from('vendor_applications')
        .select('*')
        .eq('vendor_id', vendor.id),
      supabase.from('vendor_attendance')
        .select('*')
        .eq('vendor_id', vendor.id),
    ]).then(([eventsRes, appsRes, attRes]) => {
      if (eventsRes.error) console.error('[VendorDashboard] events fetch', eventsRes.error);
      if (appsRes.error)   console.error('[VendorDashboard] applications fetch', appsRes.error);
      if (attRes.error)    console.error('[VendorDashboard] attendance fetch', attRes.error);
      setEvents(eventsRes.data || []);
      const appsByEvent = {};
      (appsRes.data || []).forEach(a => { appsByEvent[a.event_id] = a; });
      setApplications(appsByEvent);
      const attByEvent = {};
      (attRes.data || []).forEach(a => { attByEvent[a.event_id] = a; });
      setAttendance(attByEvent);
    });
  }, [vendor?.id]);

  const handleLogout = async () => {
    await signOut();
  };

  // ─── State 1: not logged in ───────────────────
  if (authReady && !session) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
          <SectionHeader title="Vendor Dashboard" subtitle="Log in to apply for upcoming Vendor Days" />
          <div style={{
            backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #eee',
            padding: isMobile ? '24px 20px' : '36px'
          }}>
            <p style={{ fontSize: '0.95rem', color: '#666', lineHeight: '1.7', marginBottom: '20px' }}>
              You need to be logged in to see your dashboard.
            </p>
            <Link to="/vendors/apply" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              backgroundColor: '#C8102E', color: '#fff',
              padding: '12px 24px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
            }}>
              Log in / Apply
            </Link>
          </div>
        </div>
      </PageWrapper>
    );
  }

  // ─── Staff bypass: admins skip vendor onboarding ─────────
  if (authReady && session && isAdmin && !vendorLoading && !vendor) {
    return <StaffBypassScreen isMobile={isMobile} title="You're staff, not a vendor" body="This dashboard is for outside vendors applying to Vendor Days. As staff you don't need a vendor profile." linkTo="/staff/vendors" linkLabel="Open Vendor Admin" />;
  }

  // ─── State 2: logged in but no vendor row → onboarding ───
  if (authReady && session && !vendorLoading && !vendor) {
    return <VendorOnboardingForm isMobile={isMobile} session={session} onComplete={() => refreshAuth()} />;
  }

  // ─── State 3 (or loading): vendor dashboard ──────────────
  if (vendorLoading || !vendor) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <Loader2 size={24} className="spin" /> Loading your dashboard...
        </div>
      </PageWrapper>
    );
  }

  // Computed surfaces for the new dashboard quick-actions:
  const todayStr = todayISO();
  // Today's event the vendor is approved for + not yet checked in.
  const todayEvent = events.find(ev =>
    ev.event_date === todayStr &&
    applications[ev.id]?.status === 'approved' &&
    !attendance[ev.id]
  );
  // Most recent past event the vendor checked into — drives the "Upload latest"
  // CTA at the bottom of the dashboard.
  const recentAttended = Object.keys(attendance)
    .map(eventId => ({ eventId, event: events.find(e => e.id === eventId) }))
    .filter(x => x.event && x.event.event_date < todayStr)
    .sort((a, b) => b.event.event_date.localeCompare(a.event.event_date))[0];
  const recentAttendedDateStr = recentAttended
    ? new Date(recentAttended.event.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const isApproved = vendor.status === 'approved';
  const isPending = vendor.status === 'pending';
  const isSuspended = vendor.status === 'suspended';

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title={`Welcome, ${vendor.name}`} subtitle="Your Vendor Day dashboard" />

        {/* ── Partnership journey strip ───────────────────────
            5-step lifecycle visualizer. Step 1 reflects the vendor's
            current partner status; steps 2-5 are the recurring rhythm
            that keeps the partnership active. */}
        <PartnershipJourney vendorStatus={vendor.status} isMobile={isMobile} />

        {/* Profile summary */}
        <div style={{
          backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #eee',
          padding: isMobile ? '20px 16px' : '24px 28px',
          maxWidth: '900px', margin: '0 auto 24px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap'
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              Status
            </div>
            <VendorStatusBadge status={vendor.status} />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={handleLogout} style={{
              backgroundColor: '#fff', color: '#666',
              padding: '10px 16px', borderRadius: '8px',
              fontSize: '0.85rem', fontWeight: '600',
              border: '1px solid #ddd', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '6px'
            }}>
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>

        {/* Edit profile entry point */}
        <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
          <Link to="/vendors/edit" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
            padding: isMobile ? '14px 16px' : '16px 20px',
            textDecoration: 'none', color: '#1a1a1a',
            transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                backgroundColor: '#fff0f0', color: '#C8102E',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Edit2 size={18} />
              </div>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '2px' }}>
                  Edit profile
                </div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  Update your logo, tagline, socials, or specialty
                </div>
              </div>
            </div>
            <ArrowRight size={18} color="#999" />
          </Link>
        </div>

        {/* Check in to today's event — only when there is one to check into. */}
        {isApproved && todayEvent && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <DashboardActionRow
              accentBg="#16a34a"
              accentFg="#fff"
              title={`Check in to today's event`}
              subtitle={`${todayEvent.title || 'Vendor Day'} · ${new Date(todayEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
              icon={<CheckCircle2 size={18} />}
              onClick={() => {
                const el = document.getElementById('upcoming-events');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              isMobile={isMobile}
            />
          </div>
        )}

        {/* Apply for more events — only useful when there are unapplied future events. */}
        {isApproved && events.some(e => e.event_date >= todayStr && !applications[e.id]) && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <DashboardActionRow
              accentBg="#fff0f0"
              accentFg="#C8102E"
              title="Apply for more events"
              subtitle="Pick the upcoming Vendor Days you want to be at"
              icon={<CalendarIcon size={18} />}
              onClick={() => {
                const el = document.getElementById('upcoming-events');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              isMobile={isMobile}
            />
          </div>
        )}

        {(isPending || isSuspended) && (
          <div style={{
            maxWidth: '900px', margin: '0 auto 24px',
            backgroundColor: isSuspended ? '#fef2f2' : '#fff7ed',
            border: `1px solid ${isSuspended ? '#fecaca' : '#fed7aa'}`,
            borderRadius: '12px',
            padding: isMobile ? '16px' : '18px 22px',
            fontSize: '0.88rem',
            color: isSuspended ? '#991b1b' : '#9a3412',
            lineHeight: 1.6,
          }}>
            {isPending
              ? "Trainer Center HB is reviewing your profile. You'll be able to apply for events once approved."
              : "Your account is suspended. Reach out to Trainer Center HB to re-activate."}
          </div>
        )}

        {/* Upcoming Vendor Days */}
        <div id="upcoming-events" style={{ maxWidth: '900px', margin: '0 auto', scrollMarginTop: '20px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 16px 0' }}>
            Upcoming Vendor Days
          </h3>
          {events.filter(ev => {
            // Hide past events the vendor never applied to
            return !(ev.event_date < todayISO() && !applications[ev.id]);
          }).length === 0 ? (
            <div style={{
              backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
              padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
            }}>
              No Vendor Days scheduled yet. Check back soon — they happen the last Friday of every month.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {events
                .filter(ev => !(ev.event_date < todayISO() && !applications[ev.id]))
                .map(ev => (
                  <VendorEventCard
                    key={ev.id}
                    event={ev}
                    application={applications[ev.id]}
                    attendance={attendance[ev.id]}
                    vendorId={vendor.id}
                    vendorStatus={vendor.status}
                    isFirstApplication={Object.keys(applications).length === 0}
                    onApplied={(app) => setApplications(prev => ({ ...prev, [ev.id]: app }))}
                    onCheckedIn={(att) => setAttendance(prev => ({ ...prev, [ev.id]: att }))}
                    isMobile={isMobile}
                  />
              ))}
            </div>
          )}
        </div>

        {/* Upload latest — bottom CTA when there's a past event the vendor
            attended. Routes to the same upload page as the per-event card,
            just elevated so it's hard to miss after a show. */}
        {recentAttended && (
          <div style={{ maxWidth: '900px', margin: '32px auto 0' }}>
            <Link to={`/vendors/upload/${recentAttended.eventId}`} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#1a1a1a', color: '#fff',
              borderRadius: '12px',
              padding: isMobile ? '16px 18px' : '18px 22px',
              textDecoration: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <UploadIcon size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '2px' }}>
                    Upload from {recentAttended.event.title || 'last event'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)' }}>
                    {recentAttendedDateStr} · paste your IG link too — boosts your traffic
                  </div>
                </div>
              </div>
              <ArrowRight size={18} color="rgba(255,255,255,0.85)" />
            </Link>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

// ─── Partnership Journey strip ────────────────────────────
// 5-step horizontal (or vertical on mobile) lifecycle the vendor moves
// through. Step 1 mirrors `vendor.status`. Steps 2-5 are recurring per
// event cycle. Pending or suspended vendors see steps 2-5 dimmed.
function PartnershipJourney({ vendorStatus, isMobile }) {
  const STEPS = [
    { num: 1, label: 'Partner status', desc: 'Apply to partner with Trainer Center HB.' },
    { num: 2, label: 'Pick events', desc: 'Apply for the Vendor Days you want to be at.' },
    { num: 3, label: 'Promote before', desc: 'DM-share TC posts to friends. The IG algo rewards DMs more than likes — that is how a low-volume page like ours grows.' },
    { num: 4, label: 'Capture during', desc: 'Take photos and a short clip from your table.' },
    { num: 5, label: 'Upload after', desc: 'Post freely on your IG. Then upload here so it shows on our public Vendors page.' },
  ];
  const isApproved = vendorStatus === 'approved';
  const isPending = vendorStatus === 'pending';
  const isSuspended = vendorStatus === 'suspended';

  // Step 1 takes the partner-status color. Steps 2-5 are dimmed unless approved.
  const step1Color = isApproved ? '#16a34a' : isSuspended ? '#dc2626' : '#c2410c';
  const step1Pill = isApproved ? 'Approved partner' : isSuspended ? 'Suspended' : 'Pending review';

  const stepStyle = (i) => {
    const isFirst = i === 0;
    const dimmed = !isFirst && !isApproved;
    return {
      flex: 1,
      minWidth: isMobile ? 'auto' : '0',
      backgroundColor: '#fff',
      border: `1px solid ${isFirst ? step1Color : dimmed ? '#eee' : '#1a1a1a'}`,
      borderRadius: '12px',
      padding: isMobile ? '14px 14px' : '14px 16px',
      opacity: dimmed ? 0.55 : 1,
    };
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto 24px' }}>
      <h3 style={{
        fontSize: '0.78rem', fontWeight: '800', color: '#666',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        margin: '0 0 12px 6px',
      }}>
        Your Trainer Center HB partnership · 5 steps
      </h3>
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: '10px',
        alignItems: 'stretch',
      }}>
        {STEPS.map((s, i) => {
          const dimmed = i > 0 && !isApproved;
          return (
            <div key={s.num} style={stepStyle(i)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  backgroundColor: i === 0 ? step1Color : dimmed ? '#e5e7eb' : '#1a1a1a',
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.72rem', fontWeight: '800',
                  flexShrink: 0,
                }}>
                  {s.num}
                </div>
                <div style={{
                  fontSize: '0.78rem', fontWeight: '800',
                  color: dimmed ? '#9ca3af' : '#1a1a1a',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                }}>
                  {s.label}
                </div>
              </div>
              {i === 0 ? (
                <>
                  <div style={{
                    display: 'inline-block',
                    fontSize: '0.7rem', fontWeight: '800',
                    color: step1Color,
                    backgroundColor: step1Color + '14',
                    padding: '3px 10px', borderRadius: '999px',
                    marginBottom: '6px',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    {step1Pill}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', lineHeight: 1.45 }}>
                    {isPending
                      ? 'Awaiting Trainer Center HB review.'
                      : isSuspended
                        ? 'Reach out to Chef to re-activate.'
                        : 'You are an approved partner.'}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '0.78rem', color: dimmed ? '#9ca3af' : '#444', lineHeight: 1.45 }}>
                  {s.desc}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Reusable button-row card for dashboard quick actions (Check in, Apply, etc.)
function DashboardActionRow({ accentBg, accentFg, title, subtitle, icon, onClick, isMobile }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
      padding: isMobile ? '14px 16px' : '16px 20px',
      width: '100%', textAlign: 'left', cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%',
          backgroundColor: accentBg, color: accentFg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '2px' }}>
            {title}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#666' }}>
            {subtitle}
          </div>
        </div>
      </div>
      <ArrowRight size={18} color="#999" />
    </button>
  );
}

// ─── Vendor status badge ──────────────────────────────────
function VendorStatusBadge({ status }) {
  const styles = {
    pending: { bg: '#fff7ed', text: '#c2410c', label: 'Pending review' },
    approved: { bg: '#f0fdf4', text: '#15803d', label: 'Approved vendor' },
    suspended: { bg: '#fef2f2', text: '#991b1b', label: 'Suspended' },
  }[status] || { bg: '#f3f4f6', text: '#374151', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      backgroundColor: styles.bg, color: styles.text,
      padding: '6px 12px', borderRadius: '20px',
      fontSize: '0.8rem', fontWeight: '700'
    }}>
      {styles.label}
    </span>
  );
}

// ─── Per-event card on vendor dashboard ───────────────────
function VendorEventCard({ event, application, attendance, vendorId, vendorStatus, isFirstApplication, onApplied, onCheckedIn, isMobile }) {
  const [showApply, setShowApply] = useState(false); // open the apply modal
  const [showCheckIn, setShowCheckIn] = useState(false);

  const eventDate = new Date(event.event_date + 'T12:00:00');
  const dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const today = todayISO();
  const isToday = event.event_date === today;
  const isPast = event.event_date < today;

  const submitApplication = async ({ requested_start_time, requested_end_time, vendor_note }) => {
    const { data, error: insertError } = await supabase
      .from('vendor_applications')
      .insert({
        vendor_id: vendorId,
        event_id: event.id,
        requested_start_time: requested_start_time || null,
        requested_end_time: requested_end_time || null,
        vendor_note: vendor_note || null,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    onApplied(data);
    sendVendorEmail({
      type: 'application_received',
      application_id: data.id,
      is_first_time: !!isFirstApplication,
    });
    return data;
  };

  // Determine the action area content for this event card based on status,
  // attendance, and whether the event is today / past / future.
  let actionEl = null;
  if (event.cancelled) {
    actionEl = (
      <span style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: '700' }}>
        Event cancelled
      </span>
    );
  } else if (!application) {
    if (vendorStatus !== 'approved') {
      // Profile gate — until the vendor's profile is approved, hide the
      // apply button on every event card and show why.
      actionEl = (
        <span style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic', maxWidth: '240px', textAlign: 'right' }}>
          {vendorStatus === 'suspended'
            ? 'Account suspended — contact Chef.'
            : "Profile pending Chef's review. You'll be able to apply once approved."}
        </span>
      );
    } else {
      actionEl = (
        <button onClick={() => setShowApply(true)} style={{
          backgroundColor: '#C8102E', color: '#fff',
          padding: '10px 18px', borderRadius: '8px',
          fontSize: '0.9rem', fontWeight: '700',
          border: 'none', cursor: 'pointer'
        }}>
          Apply for this date
        </button>
      );
    }
  } else if (application.status === 'pending') {
    actionEl = <span style={{ fontSize: '0.85rem', color: '#c2410c', fontWeight: '700' }}>Pending Chef's approval</span>;
  } else if (application.status === 'declined') {
    actionEl = <span style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: '700' }}>Not approved this time</span>;
  } else if (application.status === 'cancelled') {
    actionEl = <span style={{ fontSize: '0.85rem', color: '#666', fontWeight: '700' }}>Cancelled</span>;
  } else if (application.status === 'approved') {
    if (isToday && !attendance) {
      // Event day with no check-in yet
      actionEl = (
        <button onClick={() => setShowCheckIn(true)} style={{
          backgroundColor: '#16a34a', color: '#fff',
          padding: '10px 18px', borderRadius: '8px',
          fontSize: '0.9rem', fontWeight: '700',
          border: 'none', cursor: 'pointer'
        }}>
          Check in
        </button>
      );
    } else if (attendance) {
      // Already checked in (today or past)
      actionEl = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <span style={{
            fontSize: '0.78rem', backgroundColor: '#f0fdf4', color: '#15803d',
            padding: '4px 10px', borderRadius: '20px', fontWeight: '700',
            display: 'inline-flex', alignItems: 'center', gap: '4px'
          }}>
            <CheckCircle2 size={12} /> {attendance.geo_verified ? 'Checked in (verified)' : 'Checked in'}
          </span>
          <Link to={`/vendors/upload/${event.id}`} style={{
            backgroundColor: '#1a1a1a', color: '#fff',
            padding: '8px 14px', borderRadius: '8px',
            fontSize: '0.8rem', fontWeight: '700',
            textDecoration: 'none'
          }}>
            Upload content
          </Link>
        </div>
      );
    } else if (isPast) {
      // Approved but didn't check in
      actionEl = (
        <span style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
          Did not check in
        </span>
      );
    } else {
      // Future approved — surface the start time so the vendor knows when
      // to show up. Falls back to a generic message if no start_time set.
      const startStr = formatTime12h(event.start_time);
      actionEl = (
        <span style={{ fontSize: '0.85rem', color: '#15803d', fontWeight: '700' }}>
          {startStr ? `Approved — starts ${startStr}` : 'Approved — see you there'}
        </span>
      );
    }
  }

  return (
    <>
      <div style={{
        backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
        padding: isMobile ? '16px' : '20px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center',
        gap: '16px', flexDirection: isMobile ? 'column' : 'row'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            backgroundColor: '#f0fdf4', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <CalendarIcon size={20} color="#16a34a" />
          </div>
          <div>
            <div style={{
              fontSize: '0.95rem', fontWeight: '800',
              color: event.cancelled ? '#999' : '#1a1a1a',
              textDecoration: event.cancelled ? 'line-through' : 'none'
            }}>
              {event.title || 'Vendor Day'}
              {event.cancelled && (
                <span style={{
                  marginLeft: '8px', fontSize: '0.65rem', backgroundColor: '#fef2f2', color: '#dc2626',
                  border: '1px solid #fecaca',
                  padding: '2px 8px', borderRadius: '10px', fontWeight: '800', textTransform: 'uppercase',
                  textDecoration: 'none'
                }}>
                  Cancelled
                </span>
              )}
              {!event.cancelled && isToday && (
                <span style={{
                  marginLeft: '8px', fontSize: '0.65rem', backgroundColor: '#fef2f2', color: '#dc2626',
                  padding: '2px 8px', borderRadius: '10px', fontWeight: '800', textTransform: 'uppercase'
                }}>
                  Today
                </span>
              )}
              {!event.cancelled && isPast && !isToday && (
                <span style={{
                  marginLeft: '8px', fontSize: '0.65rem', backgroundColor: '#f3f4f6', color: '#6b7280',
                  padding: '2px 8px', borderRadius: '10px', fontWeight: '800', textTransform: 'uppercase'
                }}>
                  Past
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '2px' }}>
              {dateStr}
            </div>
          </div>
        </div>
        <div>
          {actionEl}
        </div>
      </div>
      {showApply && (
        <ApplyForEventModal
          event={event}
          onClose={() => setShowApply(false)}
          onSubmit={submitApplication}
        />
      )}
      {showCheckIn && (
        <VendorCheckInModal
          vendorId={vendorId}
          eventId={event.id}
          onClose={() => setShowCheckIn(false)}
          onCheckedIn={() => {
            setShowCheckIn(false);
            onCheckedIn();
          }}
        />
      )}
    </>
  );
}

// ─── Onboarding form (also used in edit mode) ─────────────
// When `existingVendor` is passed, the form runs in edit mode: pre-populated,
// signup-only fields hidden (heard_from + referral), submits an UPDATE
// rather than an INSERT, and skips the welcome email + marketing upsert.
function VendorOnboardingForm({ isMobile, session, onComplete, existingVendor }) {
  const isEdit = !!existingVendor;
  const [form, setForm] = useState({
    first_name: existingVendor?.first_name || '',
    last_name: existingVendor?.last_name || '',
    phone: existingVendor?.phone || '',
    ig_handle: existingVendor?.ig_handle || '',
    tiktok_handle: existingVendor?.tiktok_handle || '',
    fb_handle: existingVendor?.fb_handle || '',
    specialty: existingVendor?.specialty || '',
    bio: existingVendor?.bio || '',
    heard_from: existingVendor?.heard_from || '',
    referred_by_name: existingVendor?.referred_by_name || '',
    referred_by_contact: existingVendor?.referred_by_contact || '',
    referred_by_handle: existingVendor?.referred_by_handle || '',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [removeExistingLogo, setRemoveExistingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const setField = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First and last name both required.');
      return;
    }
    setSubmitting(true);
    setError('');
    const fullName = `${form.first_name.trim()} ${form.last_name.trim()}`;

    // Build the row payload shared by both modes.
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      name: fullName,
      phone: form.phone.trim() || null,
      ig_handle: cleanHandle(form.ig_handle),
      tiktok_handle: cleanHandle(form.tiktok_handle),
      fb_handle: cleanHandle(form.fb_handle),
      specialty: form.specialty.trim() || null,
      bio: form.bio.trim() || null,
    };

    let savedVendor = null;
    if (isEdit) {
      // Edit: update existing row, keep heard_from/referral as-is.
      const { data, error: updErr } = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', existingVendor.id)
        .select()
        .single();
      if (updErr) {
        setSubmitting(false);
        setError(updErr.message);
        return;
      }
      savedVendor = data;
    } else {
      // Signup: insert new row including signup-only fields.
      const { data, error: insertError } = await supabase
        .from('vendors')
        .insert({
          ...payload,
          user_id: session.user.id,
          email: session.user.email,
          heard_from: form.heard_from.trim() || null,
          referred_by_name: form.referred_by_name.trim() || null,
          referred_by_contact: form.referred_by_contact.trim() || null,
          referred_by_handle: cleanHandle(form.referred_by_handle),
        })
        .select()
        .single();
      if (insertError) {
        setSubmitting(false);
        setError(insertError.message);
        return;
      }
      savedVendor = data;
    }

    // Logo handling: upload new file, OR clear existing if user removed it.
    if (logoFile) {
      const safeName = logoFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${savedVendor.id}/logo/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('vendor-media')
        .upload(path, logoFile, { contentType: logoFile.type, upsert: false });
      if (!upErr) {
        const url = `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/vendor-media/${path}`;
        const { data: updated } = await supabase
          .from('vendors')
          .update({ avatar_url: url })
          .eq('id', savedVendor.id)
          .select()
          .single();
        if (updated) savedVendor = updated;
      } else {
        console.error('[VendorOnboarding] logo upload failed', upErr);
      }
    } else if (isEdit && removeExistingLogo) {
      const { data: cleared } = await supabase
        .from('vendors')
        .update({ avatar_url: null })
        .eq('id', savedVendor.id)
        .select()
        .single();
      if (cleared) savedVendor = cleared;
    }

    setSubmitting(false);
    onComplete(savedVendor);

    // Signup-only side effects: welcome email + marketing list opt-in.
    if (!isEdit) {
      sendVendorEmail({ type: 'vendor_welcome', vendor_id: savedVendor.id });
      supabase.rpc('upsert_marketing_contact_from_app', {
        p_email: savedVendor.email,
        p_first_name: savedVendor.first_name || null,
        p_last_name: savedVendor.last_name || null,
        p_phone: savedVendor.phone || null,
        p_source: 'app_vendor',
        p_member_id: null,
        p_vendor_id: savedVendor.id,
      }).then(({ error: mcErr }) => {
        if (mcErr) console.warn('[marketing] vendor upsert failed', mcErr);
      });
    }
  };

  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box'
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '720px', margin: '0 auto' }}>
        <SectionHeader
          title={isEdit ? 'Edit Your Profile' : 'Complete Your Application'}
          subtitle={isEdit ? 'Update your logo, tagline, socials, or specialty' : 'Tell us about you so Chef can approve you'}
        />
        <form onSubmit={handleSubmit} style={{
          backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '36px',
        }}>
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 24px 0' }}>
            {isEdit
              ? 'Update anything that\'s changed. Only your name is required. Your approval status is unaffected.'
              : 'All fields are optional except your name. The more you share, the easier it is for Chef to vet and approve you.'}
          </p>

          <label style={labelCss}>First name *</label>
          <input required value={form.first_name} onChange={setField('first_name')} style={inputCss} />

          <label style={labelCss}>Last name *</label>
          <input required value={form.last_name} onChange={setField('last_name')} style={inputCss} />

          <label style={labelCss}>Vendor logo (optional)</label>
          <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '8px' }}>
            Square or round image works best. Shows next to your name on the public Vendors page.
          </div>
          <LogoPicker
            file={logoFile}
            onSelect={(f) => { setLogoFile(f); setRemoveExistingLogo(false); }}
            onClear={() => setLogoFile(null)}
            existingUrl={removeExistingLogo ? null : (existingVendor?.avatar_url || null)}
            onRemoveExisting={isEdit ? () => setRemoveExistingLogo(true) : null}
          />

          <label style={labelCss}>Phone</label>
          <input type="tel" value={form.phone} onChange={setField('phone')} placeholder="(714) 555-1234" style={inputCss} />

          <div style={{ height: '8px' }} />
          <label style={labelCss}>Instagram handle</label>
          <input value={form.ig_handle} onChange={setField('ig_handle')} placeholder="@yourhandle" style={inputCss} />

          <label style={labelCss}>TikTok handle</label>
          <input value={form.tiktok_handle} onChange={setField('tiktok_handle')} placeholder="@yourhandle" style={inputCss} />

          <label style={labelCss}>Facebook page</label>
          <input value={form.fb_handle} onChange={setField('fb_handle')} placeholder="Your page name or handle" style={inputCss} />

          <div style={{ height: '8px' }} />
          <label style={labelCss}>What you specialize in</label>
          <select value={form.specialty} onChange={setField('specialty')} style={{ ...inputCss, cursor: 'pointer' }}>
            <option value="">Pick one</option>
            <option value="Singles">Singles</option>
            <option value="Sealed">Sealed product</option>
            <option value="Slabs">Slabs / graded</option>
            <option value="Vintage">Vintage (Base–Neo)</option>
            <option value="Japanese">Japanese imports</option>
            <option value="Modern">Modern chase cards</option>
            <option value="Mixed">Mixed inventory</option>
          </select>

          <label style={labelCss}>Short bio (shows next to your posts)</label>
          <textarea value={form.bio} onChange={setField('bio')} rows={3} placeholder="A sentence or two about your shop or what you bring to Vendor Day" style={{ ...inputCss, fontFamily: 'inherit', resize: 'vertical' }} />

          {!isEdit && (
            <>
              <div style={{ height: '8px' }} />
              <label style={labelCss}>How did you hear about Vendor Day?</label>
              <select value={form.heard_from} onChange={setField('heard_from')} style={{ ...inputCss, cursor: 'pointer' }}>
                <option value="">Pick one</option>
                <option value="trainer_center_customer">I shop at Trainer Center HB</option>
                <option value="word_of_mouth">Word of mouth</option>
                <option value="social_media">Social media</option>
                <option value="vendor_referral">Another vendor referred me</option>
                <option value="event">Saw it at an event</option>
                <option value="other">Other</option>
              </select>

              {form.heard_from === 'vendor_referral' && (
                <div style={{
                  backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
                  borderRadius: '10px', padding: '16px 18px', marginBottom: '14px'
                }}>
                  <p style={{ fontSize: '0.85rem', color: '#15803d', fontWeight: '700', margin: '0 0 12px 0' }}>
                    Who referred you? We want to thank them.
                  </p>
                  <label style={labelCss}>Their name</label>
                  <input value={form.referred_by_name} onChange={setField('referred_by_name')} style={inputCss} />
                  <label style={labelCss}>Their phone or email</label>
                  <input value={form.referred_by_contact} onChange={setField('referred_by_contact')} style={inputCss} />
                  <label style={labelCss}>Their social handle</label>
                  <input value={form.referred_by_handle} onChange={setField('referred_by_handle')} placeholder="@theirhandle" style={{ ...inputCss, marginBottom: 0 }} />
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{
              backgroundColor: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '8px', padding: '10px 12px', marginBottom: '16px',
              fontSize: '0.85rem', color: '#dc2626',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '14px',
            backgroundColor: submitting ? '#999' : '#C8102E', color: '#fff',
            border: 'none', borderRadius: '10px',
            fontSize: '1rem', fontWeight: '700',
            cursor: submitting ? 'wait' : 'pointer',
          }}>
            {submitting
              ? (isEdit ? 'Saving...' : 'Submitting...')
              : (isEdit ? 'Save changes' : 'Submit application')}
          </button>
          {!isEdit && (
            <p style={{ fontSize: '0.8rem', color: '#999', textAlign: 'center', margin: '12px 0 0 0' }}>
              Chef and the team will review and email you back. From there, applying for each Vendor Day takes two clicks.
            </p>
          )}
        </form>
      </div>
    </PageWrapper>
  );
}

// Friendly bypass screen for admin/staff who land on a vendor or member
// page they don't belong on. Skips the onboarding ask and points them at
// the admin panel instead.
function StaffBypassScreen({ isMobile, title, body, linkTo, linkLabel }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <SectionHeader title={title || "You're staff"} subtitle={body || ""} />
        <Link to={linkTo} style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          backgroundColor: '#1a1a1a', color: '#fff',
          padding: '12px 24px', borderRadius: '10px',
          fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
        }}>
          {linkLabel}
        </Link>
      </div>
    </PageWrapper>
  );
}

// Strips a leading @ from a handle, returns null if blank.
function cleanHandle(s) {
  if (!s) return null;
  const trimmed = s.trim().replace(/^@+/, '');
  return trimmed || null;
}

// Square logo file picker with circular preview + clear button.
function LogoPicker({ file, onSelect, onClear, existingUrl, onRemoveExisting }) {
  const previewUrl = file ? URL.createObjectURL(file) : null;
  // Three modes: new file picked, existing URL with no new file, or empty.
  const showFile = !!file;
  const showExisting = !file && !!existingUrl;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
      <div style={{
        width: '72px', height: '72px', borderRadius: '50%',
        backgroundColor: (showFile || showExisting) ? '#000' : '#fafafa',
        border: (showFile || showExisting) ? 'none' : '2px dashed #ddd',
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {showFile && (
          <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {showExisting && (
          <img src={existingUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!showFile && !showExisting && (
          <ImageIcon size={22} color="#aaa" />
        )}
      </div>
      <div style={{ flex: 1 }}>
        {showFile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: '#444', fontWeight: '600' }}>
              {file.name.length > 28 ? file.name.slice(0, 25) + '…' : file.name}
            </span>
            <button type="button" onClick={onClear} style={{
              background: 'none', border: 'none', color: '#999',
              cursor: 'pointer', fontSize: '0.85rem', padding: '4px 8px'
            }}>Remove</button>
          </div>
        ) : showExisting ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', backgroundColor: '#fff',
              border: '1px solid #ddd', borderRadius: '8px',
              fontSize: '0.85rem', fontWeight: '700', color: '#444',
              cursor: 'pointer'
            }}>
              <ImageIcon size={14} /> Replace
              <input
                type="file"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); }}
                style={{ display: 'none' }}
              />
            </label>
            {onRemoveExisting && (
              <button type="button" onClick={onRemoveExisting} style={{
                background: 'none', border: '1px solid #fecaca', color: '#dc2626',
                cursor: 'pointer', fontSize: '0.85rem', padding: '7px 12px',
                borderRadius: '8px', fontWeight: '700'
              }}>Remove</button>
            )}
          </div>
        ) : (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px', backgroundColor: '#fff',
            border: '1px solid #ddd', borderRadius: '8px',
            fontSize: '0.85rem', fontWeight: '700', color: '#444',
            cursor: 'pointer'
          }}>
            <ImageIcon size={14} /> Choose image
            <input
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); }}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

// Fire-and-forget call to the send-vendor-email Edge Function. Failures are
// logged to console but never block the UI flow — emails are best-effort.
async function sendVendorEmail(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-vendor-email`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[sendVendorEmail] failed', res.status, await res.text());
    }
  } catch (err) {
    console.error('[sendVendorEmail] error', err);
  }
}

// ─── Geo helpers ──────────────────────────────────────────
// Trainer Center HB: 4911 Warner Ave #210, Huntington Beach, CA 92649
const TRAINER_CENTER_COORDS = { lat: 33.7191, lng: -117.9836 };
// Distance in meters within which we consider a check-in geo-verified.
// 200m covers the building + parking lot + a generous sidewalk margin.
const GEO_VERIFY_RADIUS_M = 200;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Trainer Center HB is in Huntington Beach, CA. event_date is stored as a
// calendar date with no timezone, and the store cares about the LOCAL date.
// Using toISOString() returns UTC, which flips forward several hours early
// for PST evenings — that's why "Check in" lit up the night before an event.
function todayISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // 'en-CA' yields YYYY-MM-DD
}

// ─── Apply-for-event modal ────────────────────────────────
// Shown when a logged-in approved vendor clicks "Apply for this date" on
// their dashboard. Collects:
//   - Requested time slot (defaulted to the event's full window)
//   - Optional vendor_note explaining the slot or anything else for chef
// Both fields are persisted on vendor_applications so the public showcase
// can render the time and the chef can see context when approving.
function ApplyForEventModal({ event, onClose, onSubmit }) {
  const [startTime, setStartTime] = useState((event.start_time || '12:00:00').slice(0, 5));
  const [endTime, setEndTime] = useState((event.end_time || '20:00:00').slice(0, 5));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const eventStartLabel = formatTime12h(event.start_time) || '12 PM';
  const eventEndLabel = formatTime12h(event.end_time) || '8 PM';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (endTime <= startTime) {
      setError('End time must be after start time.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        requested_start_time: startTime,
        requested_end_time: endTime,
        vendor_note: note.trim() || null,
      });
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(err.message || 'Something went wrong.');
    }
  };

  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', zIndex: 1000,
    }} onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff', borderRadius: '14px',
          padding: '24px', maxWidth: '440px', width: '100%',
          maxHeight: '90vh', overflow: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 6px', fontSize: '1.15rem', fontWeight: '800', color: '#1a1a1a' }}>
          Apply for {event.title || 'Vendor Day'}
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: '#666' }}>
          Event runs {eventStartLabel} – {eventEndLabel}. Pick the window you want to be there.
        </p>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelCss}>Arrive at</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              style={inputCss}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelCss}>Leave at</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              style={inputCss}
            />
          </div>
        </div>

        <label style={labelCss}>Notes for chef (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Anything chef should know? Setup needs, what you'll bring, why these hours, etc."
          style={{ ...inputCss, resize: 'vertical', marginBottom: '16px' }}
        />

        {error && (
          <div style={{
            backgroundColor: '#fef2f2', border: '1px solid #fecaca',
            color: '#dc2626', borderRadius: '8px', padding: '10px 12px',
            fontSize: '0.85rem', marginBottom: '14px',
            display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onClose} disabled={submitting} style={{
            flex: 1, padding: '12px',
            backgroundColor: '#fff', color: '#666',
            border: '1px solid #ddd', borderRadius: '10px',
            fontSize: '0.95rem', fontWeight: '700',
            cursor: submitting ? 'wait' : 'pointer',
          }}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} style={{
            flex: 2, padding: '12px',
            backgroundColor: submitting ? '#999' : '#C8102E', color: '#fff',
            border: 'none', borderRadius: '10px',
            fontSize: '0.95rem', fontWeight: '700',
            cursor: submitting ? 'wait' : 'pointer',
          }}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Vendor check-in modal ────────────────────────────────
// Three-stage flow:
//   1. Priming — checkbox + explanatory copy, button to trigger geo prompt
//   2. Permission ask — fires getCurrentPosition, browser shows native prompt
//   3a. Granted → save attendance, show success
//   3b. Denied → show recovery instructions + honor-system fallback
function VendorCheckInModal({ vendorId, eventId, onClose, onCheckedIn }) {
  const [stage, setStage] = useState('priming'); // priming | requesting | recovery | done
  const [confirmedHere, setConfirmedHere] = useState(false);
  const [error, setError] = useState('');

  // On open, check current permission state. If already granted, we can run the
  // capture immediately without re-priming.
  useEffect(() => {
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'geolocation' }).then(res => {
      if (res.state === 'granted' && confirmedHere) {
        runCapture();
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAttendance = async ({ lat, lng, distance, geoVerified }) => {
    const { data, error: insertError } = await supabase
      .from('vendor_attendance')
      .insert({
        vendor_id: vendorId,
        event_id: eventId,
        lat,
        lng,
        distance_m: distance,
        geo_verified: geoVerified,
      })
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      setStage('priming');
      return;
    }
    setStage('done');
    onCheckedIn(data);
  };

  const runCapture = () => {
    setStage('requesting');
    setError('');
    if (!navigator.geolocation) {
      setStage('recovery');
      setError('Your browser does not support geolocation.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dist = haversineMeters(latitude, longitude, TRAINER_CENTER_COORDS.lat, TRAINER_CENTER_COORDS.lng);
        const verified = dist <= GEO_VERIFY_RADIUS_M;
        saveAttendance({ lat: latitude, lng: longitude, distance: dist, geoVerified: verified });
      },
      (err) => {
        setError(err.message);
        setStage('recovery');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const checkInHonor = async () => {
    setStage('requesting');
    await saveAttendance({ lat: null, lng: null, distance: null, geoVerified: false });
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
        {stage === 'priming' && (
          <>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: '0 0 8px 0' }}>Check in for today</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 16px 0' }}>
              We use your location once to confirm you are actually at Trainer Center HB. Your device will ask permission. We don't track you after — just a single point at check-in.
            </p>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '12px 14px', backgroundColor: '#f9fafb', borderRadius: '8px',
              cursor: 'pointer', marginBottom: '16px'
            }}>
              <input
                type="checkbox"
                checked={confirmedHere}
                onChange={e => setConfirmedHere(e.target.checked)}
                style={{ marginTop: '3px' }}
              />
              <span style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.5' }}>
                I am at Trainer Center HB right now
              </span>
            </label>
            {error && (
              <div style={errorStyle}><AlertCircle size={16} />{error}</div>
            )}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={runCapture}
                disabled={!confirmedHere}
                style={{
                  flex: 1,
                  backgroundColor: confirmedHere ? '#C8102E' : '#ccc',
                  color: '#fff', padding: '12px', border: 'none', borderRadius: '8px',
                  fontWeight: '700', fontSize: '0.95rem',
                  cursor: confirmedHere ? 'pointer' : 'not-allowed'
                }}
              >
                Verify location
              </button>
              <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            </div>
          </>
        )}

        {stage === 'requesting' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Loader2 size={28} className="spin" color="#C8102E" />
            <p style={{ fontSize: '0.95rem', color: '#666', margin: '12px 0 0 0' }}>
              Capturing location...
            </p>
          </div>
        )}

        {stage === 'recovery' && (
          <>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: '0 0 8px 0' }}>Location is blocked</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 12px 0' }}>
              Your browser is blocking location access. To fix:
            </p>
            <ol style={{ fontSize: '0.85rem', color: '#444', lineHeight: '1.7', paddingLeft: '20px', marginBottom: '16px' }}>
              <li>Tap the lock icon next to the website URL</li>
              <li>Find <strong>Location</strong> and set it to <strong>Allow</strong></li>
              <li>Refresh this page and try check-in again</li>
            </ol>
            <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 16px 0' }}>
              Or check in without location — Chef will see it as unverified.
            </p>
            {error && <div style={errorStyle}><AlertCircle size={16} />{error}</div>}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={checkInHonor} style={{
                flex: 1,
                backgroundColor: '#fff', color: '#666',
                padding: '12px', border: '1px solid #ddd', borderRadius: '8px',
                fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer'
              }}>
                Check in without location
              </button>
              <button onClick={onClose} style={cancelBtnStyle}>Close</button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <div style={{ textAlign: 'center', padding: '12px 0 0 0' }}>
            <CheckCircle2 size={40} color="#16a34a" style={{ marginBottom: '12px' }} />
            <h3 style={{ fontSize: '1.2rem', fontWeight: '800', margin: '0 0 8px 0' }}>You are checked in!</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 16px 0' }}>
              Have a great Vendor Day. After the event, come back here to upload photos and a clip from your table.
            </p>
            <button onClick={onClose} style={{
              backgroundColor: '#C8102E', color: '#fff', padding: '12px 24px',
              border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '0.95rem', cursor: 'pointer'
            }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const modalBackdropStyle = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '20px', zIndex: 9999
};
const modalCardStyle = {
  backgroundColor: '#fff', borderRadius: '16px', padding: '24px',
  maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
};
const errorStyle = {
  backgroundColor: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
  fontSize: '0.85rem', color: '#dc2626',
  display: 'flex', alignItems: 'center', gap: '8px'
};
const cancelBtnStyle = {
  backgroundColor: '#fff', color: '#666',
  padding: '12px 16px', border: '1px solid #ddd', borderRadius: '8px',
  fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer'
};

// ─── Vendor Review Page (member voting) ──────────────────
// /vendors/review — single-page state machine:
//   1. Not logged in → magic link form
//   2. Logged in but no member row → first-name capture
//   3. No Vendor Day today → "come back later" info screen
//   4. Event today but no check-in yet → geo priming flow
//   5. Checked in but not voted → vote form (3 categories + attribution + comment)
//   6. Voted → confirmation with option to edit
const VOTE_CATEGORIES = [
  { key: 'favorite', label: 'Favorite Vendor', help: 'Your overall best pick of the night' },
  { key: 'friendliest', label: 'Friendliest', help: 'Most engaging, helpful, and fun' },
  { key: 'best_collection', label: 'Best Collection', help: 'Lots to look at, lots of options' },
];

function VendorReviewPage({ isMobile }) {
  // Single source of truth for auth + roles via AuthContext (no per-page
  // session listener -- navigating between routes stays instant).
  const { user, member, isAdmin, isLoading: authRolesLoading, refresh: refreshAuth } = useAuth();
  const session = user ? { user } : null;
  const authReady = !authRolesLoading;
  const memberLoading = authRolesLoading;
  const [todayEvent, setTodayEvent] = useState(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [visit, setVisit] = useState(null);
  const [vendorsForEvent, setVendorsForEvent] = useState([]);
  const [existingVotes, setExistingVotes] = useState({}); // keyed by category

  // Fetch today's vendor-bearing event (if any). The legacy query referenced
  // a `category` column that was renamed to `categories` (text[]) and then
  // replaced with `has_vendors` — both prior versions were silently broken.
  useEffect(() => {
    setEventLoading(true);
    supabase.from('events')
      .select('*')
      .eq('has_vendors', true)
      .eq('event_date', todayISO())
      .maybeSingle()
      .then(({ data }) => {
        setTodayEvent(data);
        setEventLoading(false);
      });
  }, []);

  // When we have member + today's event, fetch visit + vendors + votes
  useEffect(() => {
    if (!member?.id || !todayEvent?.id) return;
    Promise.all([
      supabase.from('member_event_visits').select('*').eq('member_id', member.id).eq('event_id', todayEvent.id).maybeSingle(),
      supabase.from('vendor_applications')
        .select('vendor:vendors(id, name, specialty, ig_handle)')
        .eq('event_id', todayEvent.id)
        .eq('status', 'approved'),
      supabase.from('member_votes').select('*').eq('member_id', member.id).eq('event_id', todayEvent.id),
    ]).then(([vRes, aRes, mvRes]) => {
      setVisit(vRes.data || null);
      const list = (aRes.data || [])
        .map(r => r.vendor)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      setVendorsForEvent(list);
      const votesByCategory = {};
      (mvRes.data || []).forEach(v => { votesByCategory[v.category] = v; });
      setExistingVotes(votesByCategory);
    });
  }, [member?.id, todayEvent?.id]);

  // ─── Stage 1: not logged in ───────────────────
  if (authReady && !session) {
    return <ReviewSignupGate isMobile={isMobile} />;
  }

  // ─── Staff bypass: admins skip member onboarding ─
  if (authReady && session && isAdmin && !memberLoading && !member) {
    return <StaffBypassScreen isMobile={isMobile} title="You're staff, not a member" body="Voting is for customers attending Vendor Day. As staff you don't need a member profile to see results — they live in the admin panel." linkTo="/staff/vendors" linkLabel="Open Vendor Admin" />;
  }

  // ─── Stage 2: logged in but no member row ────
  if (authReady && session && !memberLoading && !member) {
    return <MemberOnboardingForm isMobile={isMobile} session={session} onComplete={() => refreshAuth()} />;
  }

  // ─── Loading state ───────────────────────────
  if (memberLoading || eventLoading || !member) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <Loader2 size={20} className="spin" />
        </div>
      </PageWrapper>
    );
  }

  // ─── Stage 3: no Vendor Day today ────────────
  if (!todayEvent) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
          <SectionHeader title="No Vendor Day today" subtitle="Voting is only open during a live Vendor Day at Trainer Center HB" />
          <div style={{
            backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
            padding: '28px 24px'
          }}>
            <p style={{ fontSize: '0.95rem', color: '#666', lineHeight: '1.7', margin: '0 0 16px 0' }}>
              Vendor Days happen the last Friday of every month. Come hang out, meet vendors, and you can vote here on event day.
            </p>
            <p style={{ fontSize: '0.85rem', color: '#888', margin: 0 }}>
              Hi {member.first_name}, glad you joined! We will email you when the next Vendor Day is coming up.
            </p>
          </div>
          <Link to="/calendar" style={{
            display: 'inline-block', marginTop: '20px', color: '#C8102E',
            fontWeight: '700', textDecoration: 'none', fontSize: '0.95rem'
          }}>
            See full calendar →
          </Link>
        </div>
      </PageWrapper>
    );
  }

  // ─── Stage 4: event today, no check-in yet ───
  if (!visit) {
    return (
      <ReviewGeoCheckIn
        memberId={member.id}
        eventId={todayEvent.id}
        eventTitle={todayEvent.title || 'Vendor Day'}
        memberName={member.first_name || 'there'}
        isMobile={isMobile}
        onCheckedIn={(v) => setVisit(v)}
      />
    );
  }

  // ─── Stage 5/6: vote form (handles both first-time + edit) ───
  return (
    <ReviewVoteForm
      isMobile={isMobile}
      member={member}
      event={todayEvent}
      visit={visit}
      vendors={vendorsForEvent}
      existingVotes={existingVotes}
      onSaved={({ votes, updatedVisit }) => {
        setExistingVotes(votes);
        if (updatedVisit) setVisit(updatedVisit);
      }}
    />
  );
}

// Stage 1: password signup gate for guests (members in DB).
// "Guest" is the public-facing term for someone signing up to attend a
// Vendor Day and review the vendors. The DB still uses `members`.
function ReviewSignupGate({ isMobile }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto' }}>
        <SectionHeader title="Sign in as a Guest" subtitle="Create a quick account so you can review vendors at today's Vendor Day" />
        <div style={{
          backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '32px',
        }}>
          <PasswordAuthCard
            accent="green"
            signupCopy="New here? Make a quick guest account so we can record your votes. Voting opens at the shop during today's Vendor Day."
            loginCopy="Coming back to vote? Log in with the email and password you used before."
            onSuccess={() => { /* parent VendorReviewPage detects new session and advances */ }}
          />
        </div>
      </div>
    </PageWrapper>
  );
}

// Stage 2: minimal member onboarding (first name, last name, email is implicit)
function MemberOnboardingForm({ isMobile, session, onComplete }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name both required.');
      return;
    }
    setSubmitting(true);
    setError('');
    const { data, error: insertError } = await supabase
      .from('members')
      .insert({
        user_id: session.user.id,
        email: session.user.email,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      .select()
      .single();
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onComplete(data);
    // Welcome email (fire-and-forget)
    sendVendorEmail({ type: 'member_welcome', member_id: data.id });
    // Add to marketing list (fire-and-forget). RPC handles dedupe + linking.
    supabase.rpc('upsert_marketing_contact_from_app', {
      p_email: data.email,
      p_first_name: data.first_name || null,
      p_last_name: data.last_name || null,
      p_phone: null,
      p_source: 'app_member',
      p_member_id: data.id,
      p_vendor_id: null,
    }).then(({ error: mcErr }) => {
      if (mcErr) console.warn('[marketing] member upsert failed', mcErr);
    });
  };

  const inputCss = {
    width: '100%', padding: '12px 14px', fontSize: '1rem',
    border: '1px solid #ddd', borderRadius: '10px',
    marginBottom: '12px', boxSizing: 'border-box'
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '480px', margin: '0 auto' }}>
        <SectionHeader title="One quick thing" subtitle="Set up your Trainer Center HB guest account" />
        <form onSubmit={handleSubmit} style={{
          backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '32px',
        }}>
          <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: '1.6', margin: '0 0 16px 0' }}>
            Signed in as <strong>{session.user.email}</strong>. We just need your name to finish setting up your guest profile.
          </p>
          <label style={labelCss}>First name</label>
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="First name"
            autoFocus
            style={{ ...inputCss, marginTop: '6px' }}
          />
          <label style={labelCss}>Last name</label>
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Last name"
            style={{ ...inputCss, marginTop: '6px', marginBottom: '16px' }}
          />
          {error && <div style={{ ...errorStyle, marginBottom: '12px' }}><AlertCircle size={16} />{error}</div>}
          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '14px',
            backgroundColor: submitting ? '#999' : '#16a34a', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700',
            cursor: submitting ? 'wait' : 'pointer'
          }}>
            {submitting ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </div>
    </PageWrapper>
  );
}

// Stage 4: geo check-in (priming → permission → visit row insert)
function ReviewGeoCheckIn({ memberId, eventId, eventTitle, memberName, isMobile, onCheckedIn }) {
  const [stage, setStage] = useState('priming');
  const [confirmedHere, setConfirmedHere] = useState(false);
  const [error, setError] = useState('');

  const saveVisit = async ({ lat, lng, distance, geoVerified }) => {
    const { data, error: insertError } = await supabase
      .from('member_event_visits')
      .insert({
        member_id: memberId,
        event_id: eventId,
        lat, lng,
        distance_m: distance,
        geo_verified: geoVerified,
      })
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      setStage('priming');
      return;
    }
    onCheckedIn(data);
  };

  const runCapture = () => {
    setStage('requesting');
    setError('');
    if (!navigator.geolocation) {
      setError('Browser does not support geolocation.');
      setStage('recovery');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dist = haversineMeters(latitude, longitude, TRAINER_CENTER_COORDS.lat, TRAINER_CENTER_COORDS.lng);
        if (dist > GEO_VERIFY_RADIUS_M) {
          setError('You appear to be away from Trainer Center HB. Voting is only open at the shop during Vendor Day.');
          setStage('not_here');
          return;
        }
        saveVisit({ lat: latitude, lng: longitude, distance: dist, geoVerified: true });
      },
      (err) => { setError(err.message); setStage('recovery'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto' }}>
        <SectionHeader title={`Welcome, ${memberName}!`} subtitle={`${eventTitle} is happening now`} />
        <div style={{
          backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '32px',
        }}>
          {stage === 'priming' && (
            <>
              <p style={{ fontSize: '0.95rem', color: '#444', lineHeight: '1.7', margin: '0 0 16px 0' }}>
                We use your location once to confirm you are at Trainer Center HB, then unlock the voting screen. Quick prompt — your device will ask permission.
              </p>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '12px 14px', backgroundColor: '#f9fafb', borderRadius: '8px',
                cursor: 'pointer', marginBottom: '16px'
              }}>
                <input type="checkbox" checked={confirmedHere} onChange={e => setConfirmedHere(e.target.checked)} style={{ marginTop: '3px' }} />
                <span style={{ fontSize: '0.9rem', color: '#333', lineHeight: '1.5' }}>
                  I am at Trainer Center HB right now
                </span>
              </label>
              {error && <div style={{ ...errorStyle, marginBottom: '14px' }}><AlertCircle size={16} />{error}</div>}
              <button onClick={runCapture} disabled={!confirmedHere} style={{
                width: '100%', padding: '14px',
                backgroundColor: confirmedHere ? '#16a34a' : '#ccc', color: '#fff',
                border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700',
                cursor: confirmedHere ? 'pointer' : 'not-allowed'
              }}>
                Verify location
              </button>
            </>
          )}
          {stage === 'requesting' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Loader2 size={28} className="spin" color="#16a34a" />
              <p style={{ fontSize: '0.95rem', color: '#666', margin: '12px 0 0 0' }}>Capturing location...</p>
            </div>
          )}
          {stage === 'recovery' && (
            <>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800', margin: '0 0 8px 0' }}>Location is blocked</h3>
              <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 12px 0' }}>
                Your browser is blocking location access. Tap the lock icon next to the URL → Permissions → Location → Allow → refresh this page.
              </p>
              {error && <div style={errorStyle}><AlertCircle size={16} />{error}</div>}
              <p style={{ fontSize: '0.8rem', color: '#888', margin: '12px 0 0 0' }}>
                Voting requires verified location. You can ask a Trainer Center HB staff member to add your vote manually if needed.
              </p>
            </>
          )}
          {stage === 'not_here' && (
            <>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800', margin: '0 0 8px 0' }}>You're not at Trainer Center HB</h3>
              <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: 0 }}>
                {error}
              </p>
            </>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

// Stage 5/6: vote form
function ReviewVoteForm({ isMobile, member, event, visit, vendors, existingVotes, onSaved }) {
  const [picks, setPicks] = useState(() => {
    const init = {};
    VOTE_CATEGORIES.forEach(c => { init[c.key] = existingVotes[c.key]?.vendor_id || ''; });
    return init;
  });
  const [attribution, setAttribution] = useState({
    source: visit?.attribution_source || '',
    vendorId: visit?.attributed_vendor_id || '',
  });
  const [privateComment, setPrivateComment] = useState(visit?.private_comment || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  const allPicked = VOTE_CATEGORIES.every(c => picks[c.key]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!allPicked) {
      setError('Please pick a vendor for each of the 3 categories.');
      return;
    }
    setSubmitting(true);
    setError('');
    setDoneMessage('');

    try {
      // Upsert the 3 votes
      const rows = VOTE_CATEGORIES.map(c => ({
        member_id: member.id,
        event_id: event.id,
        category: c.key,
        vendor_id: picks[c.key],
      }));
      const { error: voteErr } = await supabase
        .from('member_votes')
        .upsert(rows, { onConflict: 'member_id,event_id,category' });
      if (voteErr) throw new Error(voteErr.message);

      // Update visit with attribution + comment
      const { data: updatedVisit, error: visitErr } = await supabase
        .from('member_event_visits')
        .update({
          attributed_vendor_id: attribution.source === 'vendor' ? (attribution.vendorId || null) : null,
          attribution_source: attribution.source || null,
          private_comment: privateComment.trim() || null,
        })
        .eq('id', visit.id)
        .select()
        .single();
      if (visitErr) throw new Error(visitErr.message);

      // Refetch own votes (so we have IDs for the next render)
      const { data: votesAfter } = await supabase
        .from('member_votes')
        .select('*')
        .eq('member_id', member.id)
        .eq('event_id', event.id);
      const votesByCategory = {};
      (votesAfter || []).forEach(v => { votesByCategory[v.category] = v; });

      onSaved({ votes: votesByCategory, updatedVisit });
      setDoneMessage('Your votes are in. Thanks for showing love!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box', cursor: 'pointer'
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };

  if (vendors.length === 0) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center', padding: '40px 20px' }}>
          <SectionHeader title="No vendors yet" subtitle="Approved vendors for today's event will appear here" />
          <p style={{ fontSize: '0.9rem', color: '#666' }}>
            No vendors have been approved for today's Vendor Day yet. Check back once tables are set up.
          </p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '600px', margin: '0 auto' }}>
        <SectionHeader title="Vote for Your Favorites" subtitle={`${event.title || 'Vendor Day'} · One vote per category`} />
        <form onSubmit={handleSubmit} style={{
          backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '32px',
        }}>
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.7', margin: '0 0 24px 0' }}>
            You have 3 points to give out — one for each category. Same vendor can win multiple. You can change your picks until the event ends tonight.
          </p>

          {VOTE_CATEGORIES.map(c => (
            <div key={c.key}>
              <label style={labelCss}>{c.label}</label>
              <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '4px' }}>{c.help}</div>
              <select
                value={picks[c.key]}
                onChange={e => setPicks(p => ({ ...p, [c.key]: e.target.value }))}
                required
                style={inputCss}
              >
                <option value="">— Pick a vendor —</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}{v.specialty ? ` · ${v.specialty}` : ''}</option>
                ))}
              </select>
            </div>
          ))}

          <div style={{ height: '8px' }} />
          <label style={labelCss}>Did a vendor tell you about us?</label>
          <select
            value={attribution.source}
            onChange={e => setAttribution(a => ({ ...a, source: e.target.value, vendorId: e.target.value === 'vendor' ? a.vendorId : '' }))}
            style={inputCss}
          >
            <option value="">— Choose one —</option>
            <option value="vendor">Yes, a vendor referred me</option>
            <option value="social">Saw it on social media</option>
            <option value="walk_in">Walked in / found it today</option>
            <option value="regular">I'm a regular at Trainer Center HB</option>
          </select>

          {attribution.source === 'vendor' && (
            <div style={{
              backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '10px', padding: '14px 16px', marginBottom: '14px'
            }}>
              <p style={{ fontSize: '0.82rem', color: '#15803d', fontWeight: '700', margin: '0 0 8px 0' }}>
                Show them love — pick the vendor who told you
              </p>
              <select
                value={attribution.vendorId}
                onChange={e => setAttribution(a => ({ ...a, vendorId: e.target.value }))}
                style={{ ...inputCss, marginBottom: 0 }}
              >
                <option value="">— Pick a vendor —</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}

          <label style={labelCss}>Anything for Chef privately? (optional)</label>
          <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '4px' }}>
            Only Chef and the Trainer Center HB team will see this. Vendors will not.
          </div>
          <textarea
            value={privateComment}
            onChange={e => setPrivateComment(e.target.value)}
            rows={3}
            placeholder="Honest feedback, anything Chef should know"
            style={{ ...inputCss, fontFamily: 'inherit', resize: 'vertical', cursor: 'text' }}
          />

          {error && <div style={{ ...errorStyle, marginBottom: '12px' }}><AlertCircle size={16} />{error}</div>}
          {doneMessage && (
            <div style={{
              backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
              fontSize: '0.85rem', color: '#15803d',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <CheckCircle2 size={16} />
              {doneMessage}
            </div>
          )}

          <button type="submit" disabled={submitting} style={{
            width: '100%', padding: '14px',
            backgroundColor: submitting ? '#999' : '#16a34a', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: '700',
            cursor: submitting ? 'wait' : 'pointer'
          }}>
            {submitting ? 'Saving...' : (Object.keys(existingVotes).length > 0 ? 'Update votes' : 'Submit votes')}
          </button>
        </form>
      </div>
    </PageWrapper>
  );
}

// ─── Vendor Upload Page ───────────────────────────────────
// /vendors/upload/:eventId — vendor uploads up to 3 photos (Supabase Storage)
// + 1 video (Bunny Stream via direct TUS upload signed by our Edge Function).
// If a submission already exists for this (vendor, event), new media is
// appended to it instead of creating a duplicate.
function VendorUploadPage({ isMobile }) {
  const { eventId } = useParams();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [vendor, setVendor] = useState(null);
  const [event, setEvent] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [existingMedia, setExistingMedia] = useState([]);
  const [loading, setLoading] = useState(true);

  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState([null, null, null]);
  // Per-slot IG (or other) link URL. Captured at upload time, persisted to
  // vendor_media.link_url, locked once saved. Tap-through on the public
  // /vendors feed sends collectors directly to the vendor's IG post.
  const [photoLinks, setPhotoLinks] = useState(['', '', '']);
  const [video, setVideo] = useState(null);
  const [videoLink, setVideoLink] = useState('');
  const [photoProgress, setPhotoProgress] = useState([0, 0, 0]);
  const [videoProgress, setVideoProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !eventId) return;
    setLoading(true);
    Promise.all([
      supabase.from('vendors').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('events').select('*').eq('id', eventId).single(),
    ]).then(async ([vRes, eRes]) => {
      if (vRes.error) console.error('[Upload] vendor', vRes.error);
      if (eRes.error) console.error('[Upload] event', eRes.error);
      const v = vRes.data;
      setVendor(v);
      setEvent(eRes.data);
      if (v) {
        const subRes = await supabase
          .from('vendor_submissions')
          .select('*, media:vendor_media(*)')
          .eq('vendor_id', v.id)
          .eq('event_id', eventId)
          .maybeSingle();
        if (subRes.data) {
          setSubmission(subRes.data);
          setExistingMedia(subRes.data.media || []);
          setCaption(subRes.data.caption || '');
        }
      }
      setLoading(false);
    });
  }, [session?.user?.id, eventId]);

  const setPhotoSlot = (i) => (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotos(prev => prev.map((p, idx) => idx === i ? f : p));
  };

  const clearPhotoSlot = (i) => () => {
    setPhotos(prev => prev.map((p, idx) => idx === i ? null : p));
  };

  const uploadPhoto = async (file, slotIndex) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `${vendor.id}/${eventId}/${Date.now()}_${slotIndex}_${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('vendor-media')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(`Photo ${slotIndex + 1} failed: ${upErr.message}`);
    setPhotoProgress(prev => prev.map((p, idx) => idx === slotIndex ? 100 : p));
    return path;
  };

  const uploadVideoToBunny = async (file) => {
    // 1. Ask edge function for signed Bunny TUS auth
    const { data: { session: s } } = await supabase.auth.getSession();
    const fnUrl = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/bunny-create-video`;
    const tokenRes = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.access_token}`,
        'Content-Type': 'application/json',
        'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        event_id: eventId,
        title: `${vendor.name} - ${event.title || 'Vendor Day'}`,
      }),
    });
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Video auth failed: ${errBody}`);
    }
    const { videoGuid, signature, expire, libraryId } = await tokenRes.json();

    // 2. Direct TUS upload to Bunny
    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        retryDelays: [0, 3000, 5000, 10000, 20000],
        chunkSize: 5 * 1024 * 1024,
        headers: {
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expire),
          VideoId: videoGuid,
          LibraryId: String(libraryId),
        },
        metadata: {
          filetype: file.type,
          title: `${vendor.name} - vendor day`,
        },
        onError: (err) => reject(err),
        onProgress: (bytesUploaded, bytesTotal) => {
          setVideoProgress(Math.round((bytesUploaded / bytesTotal) * 100));
        },
        onSuccess: () => {
          const playbackUrl = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoGuid}`;
          resolve({ videoGuid, playbackUrl });
        },
      });
      upload.start();
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDoneMessage('');
    const selectedPhotos = photos.filter(p => p !== null);
    if (selectedPhotos.length === 0 && !video && !caption.trim() && submission) {
      setError('Add at least one photo, video, or caption update before submitting.');
      return;
    }
    setUploading(true);
    setPhotoProgress([0, 0, 0]);
    setVideoProgress(0);

    try {
      // Ensure a vendor_submissions row exists.
      let submissionId = submission?.id;
      if (!submissionId) {
        const { data: newSub, error: subErr } = await supabase
          .from('vendor_submissions')
          .insert({
            vendor_id: vendor.id,
            event_id: eventId,
            caption: caption.trim() || null,
          })
          .select()
          .single();
        if (subErr) throw new Error(subErr.message);
        submissionId = newSub.id;
        setSubmission(newSub);
      } else if (caption !== (submission.caption || '')) {
        // Update caption on existing submission
        await supabase
          .from('vendor_submissions')
          .update({ caption: caption.trim() || null })
          .eq('id', submissionId);
      }

      // Upload photos sequentially so progress doesn't race
      const newMediaRows = [];
      const baseSortOrder = (existingMedia[existingMedia.length - 1]?.sort_order || 0) + 1;
      for (let i = 0; i < photos.length; i++) {
        if (!photos[i]) continue;
        const path = await uploadPhoto(photos[i], i);
        newMediaRows.push({
          submission_id: submissionId,
          kind: 'photo',
          supabase_path: path,
          link_url: (photoLinks[i] || '').trim() || null,
          sort_order: baseSortOrder + i,
        });
      }

      // Upload video to Bunny (if selected)
      if (video) {
        const { videoGuid, playbackUrl } = await uploadVideoToBunny(video);
        newMediaRows.push({
          submission_id: submissionId,
          kind: 'video',
          bunny_video_id: videoGuid,
          bunny_playback_url: playbackUrl,
          link_url: (videoLink || '').trim() || null,
          sort_order: baseSortOrder + photos.length,
        });
      }

      // Insert media rows
      if (newMediaRows.length > 0) {
        const { error: mErr } = await supabase.from('vendor_media').insert(newMediaRows);
        if (mErr) throw new Error(`Media insert failed: ${mErr.message}`);
      }

      // Refetch submission with media
      const refresh = await supabase
        .from('vendor_submissions')
        .select('*, media:vendor_media(*)')
        .eq('id', submissionId)
        .single();
      if (refresh.data) {
        setSubmission(refresh.data);
        setExistingMedia(refresh.data.media || []);
      }

      // Reset selection
      setPhotos([null, null, null]);
      setPhotoLinks(['', '', '']);
      setVideo(null);
      setVideoLink('');
      setDoneMessage('Uploaded! Your post is now on the public Vendors page.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
    }
  };

  if (authReady && !session) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center', padding: '40px 20px' }}>
          <SectionHeader title="Upload Content" subtitle="Log in to upload your Vendor Day photos and video" />
          <Link to="/vendors/apply" style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            backgroundColor: '#C8102E', color: '#fff',
            padding: '12px 24px', borderRadius: '10px',
            fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none'
          }}>
            Log in / Apply
          </Link>
        </div>
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <Loader2 size={24} className="spin" /> Loading...
        </div>
      </PageWrapper>
    );
  }

  if (!vendor) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
          <SectionHeader title="No vendor profile" subtitle="Complete your application first" />
          <Link to="/vendors/dashboard" style={{ color: '#C8102E', fontWeight: '700' }}>Go to dashboard</Link>
        </div>
      </PageWrapper>
    );
  }

  if (!event) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 20px', textAlign: 'center', color: '#666' }}>
          Event not found.
        </div>
      </PageWrapper>
    );
  }

  const eventDate = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const inputCss = {
    width: '100%', padding: '11px 13px', fontSize: '0.95rem',
    border: '1px solid #ddd', borderRadius: '8px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box'
  };

  // Slot accounting — saved photos/videos are locked, so the upload form
  // shows only the remaining slots (3 photos total, 1 video total).
  const existingPhotos = existingMedia.filter(m => m.kind === 'photo');
  const existingVideo = existingMedia.find(m => m.kind === 'video');
  const remainingPhotoSlots = Math.max(0, 3 - existingPhotos.length);
  const showVideoSlot = !existingVideo;
  const allFull = remainingPhotoSlots === 0 && !showVideoSlot;

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '720px', margin: '0 auto' }}>
        <SectionHeader title="Upload your Vendor Day content" subtitle={`${event.title || 'Vendor Day'} · ${eventDate}`} />

        {/* Why-bother banner: posting the same media you put on IG, with the
            link, drives collectors back to YOUR account. That's the play. */}
        <div style={{
          backgroundColor: '#fff7ed', border: '1px solid #fed7aa',
          borderRadius: '12px', padding: '16px 18px', marginBottom: '20px',
        }}>
          <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: '800', color: '#9a3412', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Highly recommended
          </p>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.55 }}>
            Upload the same photo or video you posted on Instagram. Paste your IG post link below each upload — when collectors tap your tile on the public Vendors page, it sends them straight to your post to follow you. <strong>That is the point of this — boost your traffic.</strong>
          </p>
        </div>

        {existingMedia.length > 0 && (
          <div style={{
            backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
            padding: '20px', marginBottom: '20px'
          }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '800', margin: '0 0 12px 0' }}>
              Already uploaded · locked
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
              {existingMedia.map(m => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{
                    position: 'relative', aspectRatio: '1 / 1', borderRadius: '8px',
                    overflow: 'hidden', backgroundColor: '#000',
                    ...(m.kind === 'photo' ? {
                      backgroundImage: `url(${photoUrl(m.supabase_path)})`,
                      backgroundSize: 'cover', backgroundPosition: 'center'
                    } : {})
                  }}>
                    {m.kind === 'video' && (
                      <div style={{
                        width: '100%', height: '100%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: '#fff', backgroundColor: '#000', flexDirection: 'column', gap: '4px'
                      }}>
                        <Film size={24} />
                        <span style={{ fontSize: '0.7rem' }}>Video</span>
                      </div>
                    )}
                    <div title="Locked — contact Trainer Center to edit" style={{
                      position: 'absolute', top: '6px', right: '6px',
                      backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff',
                      borderRadius: '50%', width: '26px', height: '26px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Lock size={12} />
                    </div>
                  </div>
                  {m.link_url ? (
                    <a href={m.link_url} target="_blank" rel="noopener noreferrer" style={{
                      fontSize: '0.72rem', color: '#C8102E', fontWeight: '700',
                      textDecoration: 'none', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {m.link_url.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af', fontStyle: 'italic' }}>
                      No IG link
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {allFull ? (
          <div style={{
            backgroundColor: '#fafafa', border: '1px dashed #ddd',
            borderRadius: '12px', padding: '24px 20px', textAlign: 'center',
            color: '#666', fontSize: '0.9rem'
          }}>
            All slots used (3 photos + 1 video). Contact Trainer Center if you need to edit anything.
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{
          backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #eee',
          padding: isMobile ? '20px 16px' : '32px',
        }}>
          <label style={{ fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Caption</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={3}
            placeholder="What did you bring? Any standout pulls or trades? (optional)"
            style={{ ...inputCss, fontFamily: 'inherit', resize: 'vertical' }}
          />

          {/* Photo slots — only the remaining ones, with a per-slot IG link input. */}
          {remainingPhotoSlots > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '10px' }}>
                Photos · {remainingPhotoSlots} slot{remainingPhotoSlots === 1 ? '' : 's'} left
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {Array.from({ length: remainingPhotoSlots }).map((_, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', alignItems: 'start' }}>
                    <PhotoSlot
                      file={photos[i]}
                      progress={photoProgress[i]}
                      uploading={uploading && photos[i] !== null}
                      onSelect={setPhotoSlot(i)}
                      onClear={clearPhotoSlot(i)}
                    />
                    <input
                      type="url"
                      value={photoLinks[i]}
                      onChange={e => setPhotoLinks(prev => prev.map((p, idx) => idx === i ? e.target.value : p))}
                      placeholder="Paste your IG post link (https://instagram.com/p/...)"
                      style={{
                        ...inputCss, marginTop: 0, marginBottom: 0,
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video slot — hidden once a video is already saved. */}
          {showVideoSlot && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '10px' }}>
                Video · 1 slot left
              </label>
              <VideoSlot
                file={video}
                progress={videoProgress}
                uploading={uploading && !!video}
                onSelect={(e) => setVideo(e.target.files?.[0] || null)}
                onClear={() => setVideo(null)}
              />
              {video && (
                <input
                  type="url"
                  value={videoLink}
                  onChange={e => setVideoLink(e.target.value)}
                  placeholder="Paste your IG post link (https://instagram.com/p/...)"
                  style={{ ...inputCss, marginTop: '10px', marginBottom: 0, fontSize: '0.85rem' }}
                />
              )}
            </div>
          )}

          {/* Locked-once-saved confirm copy. */}
          <div style={{
            backgroundColor: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', padding: '12px 14px', marginBottom: '16px',
            fontSize: '0.82rem', color: '#7f1d1d', lineHeight: 1.55,
            display: 'flex', alignItems: 'flex-start', gap: '8px',
          }}>
            <Lock size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span><strong>Heads up:</strong> once you tap Upload, this media (photos, video, and the IG link you paste) is locked. Contact Trainer Center if you need it removed or edited later.</span>
          </div>

          {error && (
            <div style={{
              backgroundColor: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
              fontSize: '0.85rem', color: '#dc2626',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <AlertCircle size={16} />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          )}
          {doneMessage && (
            <div style={{
              backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
              fontSize: '0.85rem', color: '#15803d',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <CheckCircle2 size={16} />
              {doneMessage}
            </div>
          )}

          <button type="submit" disabled={uploading} style={{
            width: '100%', padding: '14px',
            backgroundColor: uploading ? '#999' : '#C8102E', color: '#fff',
            border: 'none', borderRadius: '10px',
            fontSize: '1rem', fontWeight: '700',
            cursor: uploading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}>
            {uploading ? <><Loader2 size={18} className="spin" /> Uploading...</> : <><UploadIcon size={18} /> Upload</>}
          </button>
        </form>
        )}
      </div>
    </PageWrapper>
  );
}

// Single photo slot (with file picker, preview, progress, clear button)
function PhotoSlot({ file, progress, uploading, onSelect, onClear }) {
  const previewUrl = file ? URL.createObjectURL(file) : null;
  return (
    <div style={{
      position: 'relative',
      aspectRatio: '1 / 1',
      backgroundColor: file ? '#000' : '#fafafa',
      border: file ? 'none' : '2px dashed #ddd',
      borderRadius: '10px',
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {file ? (
        <>
          <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {!uploading && (
            <button
              type="button"
              onClick={onClear}
              style={{
                position: 'absolute', top: '6px', right: '6px',
                backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                border: 'none', borderRadius: '50%', width: '26px', height: '26px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <X size={13} />
            </button>
          )}
          {uploading && progress > 0 && progress < 100 && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '4px', backgroundColor: 'rgba(255,255,255,0.3)'
            }}>
              <div style={{ height: '100%', backgroundColor: '#16a34a', width: `${progress}%` }} />
            </div>
          )}
        </>
      ) : (
        <label style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '6px',
          cursor: 'pointer', color: '#999', fontSize: '0.75rem', fontWeight: '600'
        }}>
          <ImageIcon size={20} />
          <span>Add photo</span>
          <input type="file" accept="image/*" onChange={onSelect} style={{ display: 'none' }} />
        </label>
      )}
    </div>
  );
}

// Video slot with file picker, file size info, progress bar
function VideoSlot({ file, progress, uploading, onSelect, onClear }) {
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '2px dashed #ddd',
      borderRadius: '10px',
      padding: '20px',
      textAlign: 'center'
    }}>
      {file ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '8px' }}>
            <Film size={20} color="#16a34a" />
            <span style={{ fontSize: '0.9rem', fontWeight: '700' }}>{file.name}</span>
            {!uploading && (
              <button
                type="button"
                onClick={onClear}
                style={{
                  background: 'none', border: 'none', color: '#999',
                  cursor: 'pointer', display: 'flex', alignItems: 'center'
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>
            {(file.size / (1024 * 1024)).toFixed(1)} MB
          </div>
          {uploading && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', backgroundColor: '#16a34a', width: `${progress}%`, transition: 'width 0.2s' }} />
              </div>
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '4px' }}>{progress}%</div>
            </div>
          )}
        </div>
      ) : (
        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '10px', cursor: 'pointer', color: '#666',
          fontSize: '0.9rem', fontWeight: '700'
        }}>
          <Film size={20} />
          <span>Add a short video</span>
          <input type="file" accept="video/*" onChange={onSelect} style={{ display: 'none' }} />
        </label>
      )}
    </div>
  );
}

// ─── Staff Vendor Admin Page ──────────────────────────────
// Gated by staff?.isAdmin. Two tabs: Pending Applications (approve/decline)
// and Roster (per-event view of who applied + status + attendance).
function StaffVendorsPage({ isMobile, staff }) {
  const [tab, setTab] = useState('new');
  const [pending, setPending] = useState([]);
  const [allVendors, setAllVendors] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendance, setAttendance] = useState({}); // { event_id: { vendor_id: row } }
  const [memberVisits, setMemberVisits] = useState([]); // raw rows joined with member + vendor
  const [voteCounts, setVoteCounts] = useState({}); // { event_id: [{category, vendor_id, vendor_name, vote_count}] }
  const [profilesById, setProfilesById] = useState({}); // staff lookup for approver-name display
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = !!staff?.isAdmin;

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);

    Promise.all([
      // Pending applications joined with vendor + event
      supabase.from('vendor_applications')
        .select('*, vendor:vendors(*), event:events(*)')
        .eq('status', 'pending')
        .order('applied_at', { ascending: true }),
      // All vendors for the vendor list tab
      supabase.from('vendors').select('*').order('created_at', { ascending: false }),
      // Upcoming Vendor Day events with their applications
      supabase.from('events')
        .select('*, vendor_applications(*, vendor:vendors(*))')
        .eq('has_vendors', true)
        .order('event_date', { ascending: true })
        .limit(6),
      supabase.from('vendor_attendance').select('*'),
      // Member visits joined with member + attributed vendor
      supabase.from('member_event_visits')
        .select('*, member:members(id, first_name, last_name, email), attributed_vendor:vendors(id, name), event:events(id, title, event_date)')
        .order('checked_in_at', { ascending: false })
        .limit(200),
      // Staff profiles, used to display approver names alongside the
      // approved_by / decided_by uuids on vendors and applications.
      supabase.from('profiles').select('id, name, email'),
    ]).then(async ([pendRes, vendRes, evRes, attRes, visitsRes, profRes]) => {
      if (pendRes.error) console.error('[StaffVendors] pending', pendRes.error);
      if (vendRes.error) console.error('[StaffVendors] vendors', vendRes.error);
      if (evRes.error)   console.error('[StaffVendors] events', evRes.error);
      if (attRes.error)  console.error('[StaffVendors] attendance', attRes.error);
      if (visitsRes.error) console.error('[StaffVendors] visits', visitsRes.error);
      if (profRes.error) console.error('[StaffVendors] profiles', profRes.error);
      setPending(pendRes.data || []);
      setAllVendors(vendRes.data || []);
      setEvents(evRes.data || []);
      const profMap = {};
      (profRes.data || []).forEach(p => { profMap[p.id] = p; });
      setProfilesById(profMap);
      const att = {};
      (attRes.data || []).forEach(a => {
        if (!att[a.event_id]) att[a.event_id] = {};
        att[a.event_id][a.vendor_id] = a;
      });
      setAttendance(att);
      setMemberVisits(visitsRes.data || []);

      // For each event in the events list, fetch winners (vote counts).
      const events = evRes.data || [];
      const counts = {};
      await Promise.all(events.map(async (ev) => {
        const { data: w } = await supabase.rpc('get_event_winners', { p_event_id: ev.id });
        if (w && w.length > 0) counts[ev.id] = w;
      }));
      setVoteCounts(counts);

      setLoading(false);
    });
  }, [isAdmin, refreshKey]);

  const refresh = () => setRefreshKey(k => k + 1);

  const decideApplication = async (appId, status, note) => {
    // Per-event decision only. Profile approval lives in the All Vendors tab
    // and is the prerequisite — admin UI prevents approving an event app for
    // a non-approved vendor.
    const { error } = await supabase
      .from('vendor_applications')
      .update({ status, decision_note: note || null, decided_at: new Date().toISOString(), decided_by: staff.id })
      .eq('id', appId);
    if (error) {
      alert('Error: ' + error.message);
      return;
    }
    sendVendorEmail({ type: 'application_decided', application_id: appId });
    refresh();
  };

  const setVendorStatus = async (vendorId, status) => {
    // Capture the previous status so we only fire the partnership-approved
    // email on a real pending → approved transition.
    const prev = allVendors.find(v => v.id === vendorId)?.status;
    // Stamp who approved when status flips to approved — same pattern as
    // vendor_applications.decided_by/decided_at. Don't overwrite when the
    // status was already approved (a no-op admin click shouldn't shift the
    // historical approver).
    const updates = { status };
    if (status === 'approved' && prev !== 'approved') {
      updates.approved_by = staff.id;
      updates.approved_at = new Date().toISOString();
    }
    const { error } = await supabase.from('vendors').update(updates).eq('id', vendorId);
    if (error) {
      alert('Error: ' + error.message);
      return;
    }
    if (status === 'approved' && prev !== 'approved') {
      sendVendorEmail({ type: 'vendor_profile_approved', vendor_id: vendorId });
    }
    // Suspending cascades — cancel this vendor's approved applications on
    // any FUTURE events. Past attendance records are left alone.
    if (status === 'suspended') {
      const today = todayISO();
      const { data: futureEvents } = await supabase
        .from('events').select('id').gte('event_date', today);
      const futureIds = (futureEvents || []).map(e => e.id);
      if (futureIds.length > 0) {
        await supabase
          .from('vendor_applications')
          .update({
            status: 'cancelled',
            decision_note: 'Vendor profile suspended',
            decided_at: new Date().toISOString(),
            decided_by: staff.id,
          })
          .eq('vendor_id', vendorId)
          .eq('status', 'approved')
          .in('event_id', futureIds);
      }
    }
    refresh();
  };

  if (!isAdmin) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
          <SectionHeader title="Staff only" subtitle="You need to be logged in as staff to manage vendors" />
        </div>
      </PageWrapper>
    );
  }

  const tabBtnStyle = (active) => ({
    padding: '10px 16px', border: 'none',
    backgroundColor: active ? '#C8102E' : '#fff',
    color: active ? '#fff' : '#666',
    borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700',
    cursor: 'pointer', border: active ? 'none' : '1px solid #ddd'
  });

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Vendor Admin" subtitle="Approve vendor profiles, then schedule them per Vendor Day" />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', maxWidth: '1100px', margin: '0 auto 24px', flexWrap: 'wrap' }}>
          <button onClick={() => setTab('new')} style={tabBtnStyle(tab === 'new')}>
            Newly applying ({allVendors.filter(v => v.status === 'pending').length})
          </button>
          <button onClick={() => setTab('pending')} style={tabBtnStyle(tab === 'pending')}>
            Pending requests ({pending.length})
          </button>
          <button onClick={() => setTab('roster')} style={tabBtnStyle(tab === 'roster')}>
            Event roster
          </button>
          <button onClick={() => setTab('vendors')} style={tabBtnStyle(tab === 'vendors')}>
            All vendors ({allVendors.length})
          </button>
          <button onClick={() => setTab('members')} style={tabBtnStyle(tab === 'members')}>
            Members &amp; feedback
          </button>
        </div>

        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
              <Loader2 size={20} className="spin" /> Loading...
            </div>
          )}

          {!loading && tab === 'new' && (
            <NewlyApplyingVendorsList
              vendors={allVendors.filter(v => v.status === 'pending')}
              onStatusChange={setVendorStatus}
              isMobile={isMobile}
            />
          )}

          {!loading && tab === 'pending' && (
            <PendingApplicationsList items={pending} onDecide={decideApplication} isMobile={isMobile} />
          )}

          {!loading && tab === 'roster' && (
            <EventRosterList events={events} attendance={attendance} allVendors={allVendors} profilesById={profilesById} onDecide={decideApplication} onChange={refresh} staff={staff} isMobile={isMobile} />
          )}

          {!loading && tab === 'vendors' && (
            <AllVendorsList vendors={allVendors} profilesById={profilesById} onStatusChange={setVendorStatus} isMobile={isMobile} />
          )}

          {!loading && tab === 'members' && (
            <MembersAndFeedbackTab visits={memberVisits} voteCounts={voteCounts} events={events} isMobile={isMobile} />
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Members + feedback tab on staff admin ────────────────
function MembersAndFeedbackTab({ visits, voteCounts, events, isMobile }) {
  // Group visits by event_id
  const visitsByEvent = {};
  visits.forEach(v => {
    if (!visitsByEvent[v.event_id]) visitsByEvent[v.event_id] = [];
    visitsByEvent[v.event_id].push(v);
  });

  // Show events that have either visits or vote counts, sorted by event date desc
  const relevantEventIds = new Set([...Object.keys(visitsByEvent), ...Object.keys(voteCounts)]);
  const eventsToShow = events
    .filter(e => relevantEventIds.has(e.id))
    .sort((a, b) => b.event_date.localeCompare(a.event_date));

  if (eventsToShow.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
        padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
      }}>
        No member activity yet. Once members check in and vote, you will see attribution and private feedback here.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {eventsToShow.map(ev => {
        const evVisits = visitsByEvent[ev.id] || [];
        const evCounts = voteCounts[ev.id] || [];
        const dateStr = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        // Aggregate vote counts per vendor across all 3 categories
        const vendorTotals = {};
        evCounts.forEach(c => {
          if (!vendorTotals[c.vendor_id]) {
            vendorTotals[c.vendor_id] = { name: c.vendor_name, total: 0, byCategory: {} };
          }
          vendorTotals[c.vendor_id].total += Number(c.vote_count);
          vendorTotals[c.vendor_id].byCategory[c.category] = Number(c.vote_count);
        });
        const sortedVendors = Object.values(vendorTotals).sort((a, b) => b.total - a.total);

        return (
          <div key={ev.id} style={{
            backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
            padding: isMobile ? '16px' : '20px 24px'
          }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a' }}>{ev.title || 'Vendor Day'}</div>
              <div style={{ fontSize: '0.85rem', color: '#666' }}>{dateStr} · {evVisits.length} member check-in{evVisits.length === 1 ? '' : 's'}</div>
            </div>

            {/* Vote totals */}
            {sortedVendors.length > 0 && (
              <div style={{ marginBottom: '18px' }}>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '800', color: '#16a34a', margin: '0 0 8px 0' }}>
                  Vote totals
                </h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={voteTH}>Vendor</th>
                      <th style={voteTH}>Favorite</th>
                      <th style={voteTH}>Friendliest</th>
                      <th style={voteTH}>Best Collection</th>
                      <th style={voteTH}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVendors.map((v, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={voteTD}><strong>{v.name}</strong></td>
                        <td style={voteTD}>{v.byCategory.favorite || 0}</td>
                        <td style={voteTD}>{v.byCategory.friendliest || 0}</td>
                        <td style={voteTD}>{v.byCategory.best_collection || 0}</td>
                        <td style={{ ...voteTD, fontWeight: '800', color: '#16a34a' }}>{v.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Member check-ins + attribution + feedback */}
            {evVisits.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '800', color: '#666', margin: '0 0 8px 0' }}>
                  Member check-ins
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {evVisits.map(v => {
                    const attrLabel = ({
                      vendor: 'Referred by vendor',
                      social: 'Social media',
                      walk_in: 'Walked in',
                      regular: 'Regular customer',
                    })[v.attribution_source] || '—';
                    return (
                      <div key={v.id} style={{
                        padding: '10px 14px', backgroundColor: '#fafafa', borderRadius: '8px',
                        fontSize: '0.85rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <strong>{[v.member?.first_name, v.member?.last_name].filter(Boolean).join(' ') || 'Member'}</strong>
                            {v.member?.email && <span style={{ color: '#888' }}> · {v.member.email}</span>}
                            {!v.geo_verified && (
                              <span style={{
                                marginLeft: '8px', fontSize: '0.7rem', backgroundColor: '#fef2f2',
                                color: '#dc2626', padding: '2px 6px', borderRadius: '10px', fontWeight: '700'
                              }}>
                                geo unverified
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#888' }}>
                            {attrLabel}
                            {v.attributed_vendor?.name && ` · ${v.attributed_vendor.name}`}
                          </div>
                        </div>
                        {v.private_comment && (
                          <div style={{
                            marginTop: '6px', fontSize: '0.85rem', color: '#444',
                            backgroundColor: '#fff7ed', borderLeft: '3px solid #c2410c',
                            padding: '8px 12px', borderRadius: '6px', fontStyle: 'italic'
                          }}>
                            "{v.private_comment}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const voteTH = { textAlign: 'left', padding: '6px 8px', fontSize: '0.75rem', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' };
const voteTD = { padding: '8px', verticalAlign: 'top' };

// ─── Pending applications tab ─────────────────────────────
function PendingApplicationsList({ items, onDecide, isMobile }) {
  if (items.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
        padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
      }}>
        No pending applications. You are all caught up.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map(app => (
        <PendingApplicationCard key={app.id} app={app} onDecide={onDecide} isMobile={isMobile} />
      ))}
    </div>
  );
}

function PendingApplicationCard({ app, onDecide, isMobile }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const v = app.vendor || {};
  const ev = app.event || {};
  const eventDate = ev.event_date ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const profilePending = v.status !== 'approved';

  const handle = async (status) => {
    setBusy(true);
    await onDecide(app.id, status, note);
    setBusy(false);
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
      padding: isMobile ? '16px' : '20px 24px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
          {v.avatar_url && (
            <img
              src={v.avatar_url}
              alt=""
              style={{
                width: '48px', height: '48px', borderRadius: '50%',
                objectFit: 'cover', border: '1px solid #eee', flexShrink: 0
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a' }}>
              {v.name || '(no name)'}
              {profilePending && (
                <span style={{
                  marginLeft: '8px', fontSize: '0.7rem', backgroundColor: '#fef2f2', color: '#dc2626',
                  padding: '3px 8px', borderRadius: '20px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.4px'
                }}>
                  Profile pending
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '2px' }}>
              {v.email}{v.phone ? ` · ${v.phone}` : ''}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
              For: <strong>{ev.title || 'Vendor Day'}</strong> · {eventDate}
            </div>
            {(app.requested_start_time || app.requested_end_time) && (
              <div style={{
                marginTop: '6px',
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '0.78rem', fontWeight: '700',
                color: '#15803d', backgroundColor: '#f0fdf4',
                padding: '4px 10px', borderRadius: '999px',
              }}>
                <Clock size={11} />
                Requested: {formatTime12h(app.requested_start_time) || '?'} – {formatTime12h(app.requested_end_time) || '?'}
              </div>
            )}
          </div>
        </div>
      </div>

      {profilePending && (
        <div style={{
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '10px 12px', marginBottom: '10px',
          fontSize: '0.82rem', color: '#991b1b', lineHeight: '1.5'
        }}>
          Approve this vendor's profile in the <strong>All vendors</strong> tab first. You can't add a vendor to a Vendor Day until they're a recognized Trainer Center HB vendor.
        </div>
      )}

      {/* Vendor profile preview (when first-time) */}
      {profilePending && (
        <div style={{
          backgroundColor: '#f9fafb', borderRadius: '8px', padding: '12px 14px',
          marginBottom: '12px', fontSize: '0.85rem', color: '#444', lineHeight: '1.6'
        }}>
          {v.specialty && <div><strong>Specialty:</strong> {v.specialty}</div>}
          {v.bio && <div style={{ marginTop: '4px' }}>{v.bio}</div>}
          <div style={{ marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {v.ig_handle && <span>IG: @{v.ig_handle}</span>}
            {v.tiktok_handle && <span>TikTok: @{v.tiktok_handle}</span>}
            {v.fb_handle && <span>FB: {v.fb_handle}</span>}
          </div>
          {v.heard_from && <div style={{ marginTop: '6px' }}><strong>Heard from:</strong> {v.heard_from.replace(/_/g, ' ')}</div>}
          {v.referred_by_name && (
            <div style={{ marginTop: '6px' }}>
              <strong>Referred by:</strong> {v.referred_by_name}
              {v.referred_by_handle && ` (@${v.referred_by_handle})`}
              {v.referred_by_contact && ` · ${v.referred_by_contact}`}
            </div>
          )}
        </div>
      )}

      {app.vendor_note && (
        <div style={{ fontSize: '0.85rem', color: '#444', marginBottom: '10px', fontStyle: 'italic' }}>
          "{app.vendor_note}"
        </div>
      )}

      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional note to vendor (saved with decision)"
        style={{
          width: '100%', padding: '8px 12px', fontSize: '0.85rem',
          border: '1px solid #ddd', borderRadius: '8px',
          marginBottom: '10px', boxSizing: 'border-box'
        }}
      />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => handle('approved')} disabled={busy || profilePending} title={profilePending ? "Approve their profile first" : ''} style={{
          backgroundColor: profilePending ? '#ccc' : '#16a34a', color: '#fff', padding: '8px 16px',
          border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem',
          cursor: profilePending ? 'not-allowed' : (busy ? 'wait' : 'pointer')
        }}>
          Approve for this date
        </button>
        <button onClick={() => handle('declined')} disabled={busy} style={{
          backgroundColor: '#fff', color: '#dc2626', padding: '8px 16px',
          border: '1px solid #fecaca', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem',
          cursor: busy ? 'wait' : 'pointer'
        }}>
          Decline
        </button>
      </div>
    </div>
  );
}

// ─── Event roster tab ─────────────────────────────────────
function EventRosterList({ events, attendance, allVendors, profilesById, onDecide, onChange, staff, isMobile }) {
  const [addingTo, setAddingTo] = useState(null); // event row when adding
  const [cancelling, setCancelling] = useState(null); // event row when cancelling

  if (events.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
        padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
      }}>
        No upcoming Vendor Day events. Add one in the calendar with category "Vendor Day".
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {events.map(ev => {
        const apps = ev.vendor_applications || [];
        const evAttend = attendance[ev.id] || {};
        const dateStr = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const approved = apps.filter(a => a.status === 'approved');
        const pending = apps.filter(a => a.status === 'pending');
        return (
          <div key={ev.id} style={{
            backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
            padding: isMobile ? '16px' : '20px 24px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a' }}>{ev.title || 'Vendor Day'}</div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>{dateStr}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  {approved.length} approved · {pending.length} pending
                </div>
                {ev.cancelled ? (
                  <span style={{
                    backgroundColor: '#fef2f2', color: '#dc2626',
                    padding: '4px 10px', borderRadius: '20px',
                    fontWeight: '800', fontSize: '0.7rem',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    border: '1px solid #fecaca'
                  }}>
                    Cancelled
                  </span>
                ) : (
                  <>
                    <button onClick={() => setAddingTo(ev)} style={{
                      backgroundColor: '#16a34a', color: '#fff', border: 'none',
                      padding: '6px 12px', borderRadius: '6px', fontWeight: '700',
                      fontSize: '0.78rem', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '4px'
                    }}>
                      <Plus size={13} /> Add vendor
                    </button>
                    <button onClick={() => setCancelling(ev)} style={{
                      backgroundColor: '#fff', color: '#dc2626',
                      padding: '6px 12px', borderRadius: '6px', fontWeight: '700',
                      fontSize: '0.78rem', cursor: 'pointer',
                      border: '1px solid #fecaca'
                    }}>
                      Cancel event
                    </button>
                  </>
                )}
              </div>
            </div>
            {apps.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: '#999', fontStyle: 'italic' }}>No applications yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {apps.map(a => {
                  const checkedIn = evAttend[a.vendor_id];
                  const v = a.vendor || {};
                  // Per-event approver — only when approved + decided_by recorded
                  let apprLabel = null;
                  if (a.status === 'approved' && a.decided_by) {
                    const p = (profilesById || {})[a.decided_by];
                    const who = p?.name || p?.email || 'staff';
                    const when = a.decided_at
                      ? new Date(a.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : null;
                    apprLabel = when ? `Approved by ${who} · ${when}` : `Approved by ${who}`;
                  }
                  return (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', backgroundColor: '#fafafa', borderRadius: '8px',
                      fontSize: '0.85rem', flexWrap: 'wrap', gap: '8px'
                    }}>
                      <div>
                        <strong>{v.name}</strong>
                        {v.ig_handle && <span style={{ color: '#888' }}> · @{v.ig_handle}</span>}
                        {(a.requested_start_time || a.requested_end_time) && (
                          <span style={{
                            marginLeft: '8px',
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            fontSize: '0.7rem', fontWeight: '700',
                            color: '#15803d', backgroundColor: '#f0fdf4',
                            padding: '2px 8px', borderRadius: '999px',
                          }}>
                            <Clock size={10} />
                            {formatTime12h(a.requested_start_time) || '?'}–{formatTime12h(a.requested_end_time) || '?'}
                          </span>
                        )}
                        {a.vendor_note && (
                          <div style={{
                            fontSize: '0.78rem', color: '#444', marginTop: '4px',
                            fontStyle: 'italic', maxWidth: '480px',
                          }}>
                            "{a.vendor_note}"
                          </div>
                        )}
                        {apprLabel && (
                          <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: '700', marginTop: '2px' }}>
                            {apprLabel}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ApplicationStatusBadge status={a.status} />
                        {a.status === 'approved' && (
                          checkedIn ? (
                            <span style={{
                              fontSize: '0.7rem', backgroundColor: '#f0fdf4', color: '#15803d',
                              padding: '2px 8px', borderRadius: '20px', fontWeight: '700'
                            }}>
                              {checkedIn.geo_verified ? 'Checked in (geo)' : 'Checked in (honor)'}
                            </span>
                          ) : (
                            <span style={{
                              fontSize: '0.7rem', backgroundColor: '#f3f4f6', color: '#6b7280',
                              padding: '2px 8px', borderRadius: '20px', fontWeight: '700'
                            }}>
                              Not checked in
                            </span>
                          )
                        )}
                        {a.status === 'pending' && (
                          <button onClick={() => onDecide(a.id, 'approved', null)} style={{
                            fontSize: '0.75rem', backgroundColor: '#16a34a', color: '#fff',
                            border: 'none', padding: '4px 10px', borderRadius: '6px',
                            fontWeight: '700', cursor: 'pointer'
                          }}>Approve</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {addingTo && (
        <AddVendorToEventModal
          event={addingTo}
          allVendors={allVendors}
          existingApps={addingTo.vendor_applications || []}
          staff={staff}
          onClose={() => setAddingTo(null)}
          onSaved={() => { setAddingTo(null); onChange(); }}
        />
      )}
      {cancelling && (
        <CancelEventModal
          event={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => { setCancelling(null); onChange(); }}
        />
      )}
    </div>
  );
}

// Modal for soft-cancelling an event. Marks events.cancelled=true with reason
// and fires the event_cancelled email to every applicant (approved + pending).
function CancelEventModal({ event, onClose, onCancelled }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dateStr = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Count emails that will go out so the warning is concrete
  const pending = (event.vendor_applications || []).filter(a => a.status === 'pending').length;
  const approved = (event.vendor_applications || []).filter(a => a.status === 'approved').length;
  const total = pending + approved;

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    const { error: upErr } = await supabase
      .from('events')
      .update({
        cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason.trim() || null,
      })
      .eq('id', event.id);
    if (upErr) {
      setBusy(false);
      setError(upErr.message);
      return;
    }
    // Fire emails (async, don't block the UI on email status)
    sendVendorEmail({ type: 'event_cancelled', event_id: event.id, reason: reason.trim() || null });
    setBusy(false);
    onCancelled();
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 4px 0', color: '#dc2626' }}>
          Cancel {event.title || 'Vendor Day'}?
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 14px 0' }}>{dateStr}</p>

        <div style={{
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '12px 14px', marginBottom: '14px',
          fontSize: '0.85rem', color: '#991b1b', lineHeight: '1.6'
        }}>
          {total > 0
            ? <>This sends a cancellation email to <strong>{total}</strong> {total === 1 ? 'applicant' : 'applicants'} ({approved} approved · {pending} pending). Reminder emails to general members for this event will also stop.</>
            : <>No vendor applications on this event yet — no emails will be sent. Reminder emails to general members will stop.</>
          }
        </div>

        <label style={{ fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Reason (optional, included in the email)
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Power outage at the shop · Rescheduled to next week"
          style={{
            width: '100%', padding: '11px 13px', fontSize: '0.95rem',
            border: '1px solid #ddd', borderRadius: '8px',
            marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box',
            fontFamily: 'inherit', resize: 'vertical'
          }}
        />

        {error && <div style={{ ...errorStyle, marginBottom: '12px' }}><AlertCircle size={16} />{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleConfirm} disabled={busy} style={{
            flex: 1, padding: '12px',
            backgroundColor: busy ? '#999' : '#dc2626', color: '#fff',
            border: 'none', borderRadius: '8px',
            fontWeight: '700', fontSize: '0.95rem',
            cursor: busy ? 'wait' : 'pointer'
          }}>
            {busy ? 'Cancelling...' : `Cancel event${total > 0 ? ` + email ${total}` : ''}`}
          </button>
          <button onClick={onClose} style={cancelBtnStyle}>Keep event</button>
        </div>
      </div>
    </div>
  );
}

// Modal for adding approved vendors directly to an event roster.
// Inserts vendor_applications rows with status='approved' for picked vendors
// (skipping any that already have a row on this event).
function AddVendorToEventModal({ event, allVendors, existingApps, staff, onClose, onSaved }) {
  const existingIds = new Set((existingApps || []).map(a => a.vendor_id));
  const candidates = (allVendors || [])
    .filter(v => v.status === 'approved' && !existingIds.has(v.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (vid) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(vid) ? next.delete(vid) : next.add(vid);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    const rows = [...selected].map(vid => ({
      vendor_id: vid,
      event_id: event.id,
      status: 'approved',
      decision_note: 'Added directly by staff',
      decided_at: new Date().toISOString(),
      decided_by: staff?.id || null,
    }));
    const { error: insertErr } = await supabase
      .from('vendor_applications')
      .upsert(rows, { onConflict: 'vendor_id,event_id' });
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    onSaved();
  };

  const dateStr = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={{ ...modalCardStyle, maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 4px 0' }}>
          Add vendors to {event.title || 'Vendor Day'}
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 16px 0' }}>{dateStr}</p>

        {candidates.length === 0 ? (
          <div style={{
            backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '8px',
            padding: '20px', textAlign: 'center', color: '#888', fontSize: '0.85rem'
          }}>
            All approved vendors are already on this event's roster. Approve more vendors in the All vendors tab to expand the pool.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto', marginBottom: '14px' }}>
            {candidates.map(v => {
              const checked = selected.has(v.id);
              return (
                <label key={v.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px',
                  backgroundColor: checked ? '#f0fdf4' : '#fafafa',
                  border: `1px solid ${checked ? '#bbf7d0' : '#eee'}`,
                  borderRadius: '8px', cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(v.id)} />
                  {v.avatar_url && (
                    <img src={v.avatar_url} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '700', color: '#1a1a1a' }}>{v.name}</div>
                    {v.specialty && <div style={{ fontSize: '0.75rem', color: '#888' }}>{v.specialty}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {error && <div style={{ ...errorStyle, marginBottom: '12px' }}><AlertCircle size={16} />{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleSave} disabled={saving || candidates.length === 0} style={{
            flex: 1, padding: '12px',
            backgroundColor: (saving || candidates.length === 0) ? '#999' : '#16a34a',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontWeight: '700', fontSize: '0.95rem',
            cursor: (saving || candidates.length === 0) ? 'not-allowed' : 'pointer'
          }}>
            {saving ? 'Adding...' : selected.size === 0 ? 'Pick vendors' : `Add ${selected.size} to roster`}
          </button>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ApplicationStatusBadge({ status }) {
  const styles = {
    pending: { bg: '#fff7ed', text: '#c2410c' },
    approved: { bg: '#f0fdf4', text: '#15803d' },
    declined: { bg: '#fef2f2', text: '#991b1b' },
    cancelled: { bg: '#f3f4f6', text: '#6b7280' },
  }[status] || { bg: '#f3f4f6', text: '#374151' };
  return (
    <span style={{
      fontSize: '0.7rem', backgroundColor: styles.bg, color: styles.text,
      padding: '2px 8px', borderRadius: '20px', fontWeight: '700', textTransform: 'capitalize'
    }}>{status}</span>
  );
}

// ─── All vendors tab ──────────────────────────────────────
// ─── Newly applying vendors (vendors.status === 'pending') ─
// Brand-new signups awaiting partner approval. Distinct from "Pending requests"
// which are already-approved vendors applying to a specific event date.
function NewlyApplyingVendorsList({ vendors, onStatusChange, isMobile }) {
  if (vendors.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
        padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
      }}>
        No new vendor applications. When someone signs up to become a vendor, they'll show up here.
      </div>
    );
  }
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {vendors.map(v => (
        <div key={v.id} style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '10px',
          padding: '14px 16px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', fontSize: '0.85rem'
        }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.95rem' }}>{v.name}</strong>
              <span style={{ fontSize: '0.7rem', color: '#92400e', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '999px', fontWeight: '700' }}>
                Applied {fmtDate(v.created_at)}
              </span>
            </div>
            <div style={{ marginTop: '4px', color: '#555' }}>
              {v.email}
              {v.phone && <span style={{ color: '#888' }}> · {v.phone}</span>}
            </div>
            {v.specialty && (
              <div style={{ marginTop: '4px', color: '#555' }}>
                <span style={{ color: '#888' }}>Specialty: </span>{v.specialty}
              </div>
            )}
            {v.bio && (
              <div style={{ marginTop: '4px', color: '#555', whiteSpace: 'pre-wrap' }}>
                {v.bio}
              </div>
            )}
            {(v.ig_handle || v.tiktok_handle || v.fb_handle) && (
              <div style={{ marginTop: '4px', color: '#888', fontSize: '0.8rem' }}>
                {v.ig_handle && <span>IG: {v.ig_handle}</span>}
                {v.tiktok_handle && <span>{v.ig_handle ? ' · ' : ''}TikTok: {v.tiktok_handle}</span>}
                {v.fb_handle && <span>{(v.ig_handle || v.tiktok_handle) ? ' · ' : ''}FB: {v.fb_handle}</span>}
              </div>
            )}
            {(v.heard_from || v.referred_by_name) && (
              <div style={{ marginTop: '4px', color: '#888', fontSize: '0.8rem' }}>
                {v.heard_from && <span>Heard from: {v.heard_from}</span>}
                {v.referred_by_name && <span>{v.heard_from ? ' · ' : ''}Referred by: {v.referred_by_name}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button onClick={() => onStatusChange(v.id, 'approved')} style={{
              fontSize: '0.8rem', backgroundColor: '#16a34a', color: '#fff',
              border: 'none', padding: '6px 14px', borderRadius: '6px',
              fontWeight: '700', cursor: 'pointer'
            }}>Approve</button>
            <button onClick={() => {
              if (window.confirm(`Decline ${v.name} as a vendor?`)) onStatusChange(v.id, 'suspended');
            }} style={{
              fontSize: '0.8rem', backgroundColor: '#fff', color: '#991b1b',
              border: '1px solid #fecaca', padding: '6px 14px', borderRadius: '6px',
              fontWeight: '700', cursor: 'pointer'
            }}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AllVendorsList({ vendors, profilesById, onStatusChange, isMobile }) {
  if (vendors.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
        padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
      }}>
        No vendors yet.
      </div>
    );
  }
  const approverLabel = (v) => {
    if (v.status !== 'approved' || !v.approved_by) return null;
    const p = (profilesById || {})[v.approved_by];
    const who = p?.name || p?.email || 'staff';
    const when = v.approved_at
      ? new Date(v.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    return when ? `Approved by ${who} · ${when}` : `Approved by ${who}`;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {vendors.map(v => {
        const apprLabel = approverLabel(v);
        return (
          <div key={v.id} style={{
            backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '10px',
            padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '0.85rem'
          }}>
            <div>
              <strong>{v.name}</strong>
              <span style={{ color: '#888' }}> · {v.email}</span>
              {v.specialty && <span style={{ color: '#888' }}> · {v.specialty}</span>}
              {apprLabel && (
                <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: '700', marginTop: '4px' }}>
                  {apprLabel}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <VendorStatusBadge status={v.status} />
              {v.status !== 'approved' && (
                <button onClick={() => onStatusChange(v.id, 'approved')} style={{
                  fontSize: '0.75rem', backgroundColor: '#16a34a', color: '#fff',
                  border: 'none', padding: '4px 10px', borderRadius: '6px',
                  fontWeight: '700', cursor: 'pointer'
                }}>Approve</button>
              )}
              {v.status !== 'suspended' && (
                <button onClick={() => onStatusChange(v.id, 'suspended')} style={{
                  fontSize: '0.75rem', backgroundColor: '#fff', color: '#991b1b',
                  border: '1px solid #fecaca', padding: '4px 10px', borderRadius: '6px',
                  fontWeight: '700', cursor: 'pointer'
                }}>Suspend</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Nav Link Helper ──────────────────────────────────────
const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'Calendar', to: '/calendar' },
  { label: 'Vendors', to: '/vendors' },
  { label: 'Visit Us', to: '/#visit-us' },
  { label: 'Buy/Sell', to: '/buy-sell' },
  { label: 'Consultation', to: '/consultation' },
  { label: 'Grading', to: '/grading' },
  { label: 'Blog', to: '/blog' }
];

// ─── Unsubscribe page ─────────────────────────────────────
// Public, token-based. Loaded from links in marketing emails:
//   https://pokemontrainercenter.com/unsubscribe?token=<uuid>
// The unique token IS the credential -- no login needed. Page lets the
// recipient turn individual category subscriptions on/off, or unsubscribe
// from everything in one click.
// Email subscription categories. The first six mirror CATEGORIES (minus
// `consultation` which is a fixed 1:1 weekly slot — not blast-worthy).
// `vendors` is orthogonal to event category and fires whenever an event
// has has_vendors=true. store_news + blog stay as non-event subscriptions.
const MARKETING_CATEGORIES = [
  { key: 'vendors',     label: 'Vendor lineup announcements', help: 'Reminders and lineup previews for events with vendors set up.' },
  { key: 'trade_night', label: 'Trade Night reminders',       help: 'Heads-up for trade-focused nights at the shop.' },
  { key: 'tournament',  label: 'Tournament announcements',    help: 'TCG, video, and board-game tournaments.' },
  { key: 'game_day',    label: 'Game Day reminders',          help: 'Weekly games hangout and special game days.' },
  { key: 'crafts',      label: 'Crafts & Art days',           help: 'Family-friendly painting and creative events.' },
  { key: 'card_show',   label: 'Card shows + special days',   help: 'Card shows at Trainer Center and the ones we are at on the road, plus signings and special days.' },
  { key: 'store_news',  label: 'Store news and updates',      help: 'Hours, restocks, new arrivals, store happenings.' },
  { key: 'blog',        label: 'New blog posts',              help: 'Articles and guides we publish on the site.' },
];

function UnsubscribePage({ isMobile }) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // loading | invalid | manage | done_partial | done_all | error
  const [phase, setPhase] = useState('loading');
  const [contact, setContact] = useState(null);
  // Build the default subs object from MARKETING_CATEGORIES so the page
  // automatically picks up new categories without a separate edit. Default is
  // opted-in for everything; the hydrate step below pulls the actual DB state.
  const defaultSubs = MARKETING_CATEGORIES.reduce((acc, cat) => {
    acc[cat.key] = true; return acc;
  }, {});
  const [subs, setSubs] = useState(defaultSubs);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('lookup_marketing_contact_by_token', { p_token: token });
      if (cancelled) return;
      if (error || !data || data.length === 0) { setPhase('invalid'); return; }
      const row = data[0];
      setContact(row);
      // Hydrate checkbox state from current DB state — anything explicitly
      // false is off, anything else (including missing keys for a freshly-
      // added category) defaults to on.
      const current = row.subscriptions || {};
      const hydrated = MARKETING_CATEGORIES.reduce((acc, cat) => {
        acc[cat.key] = current[cat.key] !== false;
        return acc;
      }, {});
      setSubs(hydrated);
      setPhase('manage');
    })();
    return () => { cancelled = true; };
  }, [token]);

  const toggle = (key) => setSubs((s) => ({ ...s, [key]: !s[key] }));

  const handleSavePreferences = async () => {
    setSaving(true);
    setErrorMsg('');
    const { data, error } = await supabase.rpc('update_marketing_subscriptions', {
      p_token: token,
      p_subscriptions: subs,
    });
    setSaving(false);
    if (error || !data || data.length === 0) {
      setErrorMsg(error?.message || 'Could not save your preferences.');
      setPhase('error');
      return;
    }
    const anyOn = Object.values(subs).some(Boolean);
    setPhase(anyOn ? 'done_partial' : 'done_all');
  };

  const handleUnsubscribeAll = async () => {
    setSaving(true);
    setErrorMsg('');
    const { data, error } = await supabase.rpc('unsubscribe_marketing_contact', {
      p_token: token,
      p_reason: 'self_unsubscribe_all',
    });
    setSaving(false);
    if (error || !data || data.length === 0) {
      setErrorMsg(error?.message || 'Could not process unsubscribe.');
      setPhase('error');
      return;
    }
    const allOff = MARKETING_CATEGORIES.reduce((acc, cat) => { acc[cat.key] = false; return acc; }, {});
    setSubs(allOff);
    setPhase('done_all');
  };

  const cardCss = {
    backgroundColor: '#fff',
    borderRadius: '16px',
    border: '1px solid #eee',
    padding: isMobile ? '28px 22px' : '40px',
    maxWidth: '560px',
    margin: '0 auto',
  };
  const titleCss = { fontSize: isMobile ? '1.4rem' : '1.7rem', fontWeight: 700, color: '#1a1a1a', margin: '0 0 8px 0', textAlign: 'center' };
  const subtitleCss = { fontSize: '0.95rem', color: '#666', textAlign: 'center', margin: '0 0 24px 0' };
  const bodyCss = { fontSize: '0.95rem', color: '#555', lineHeight: 1.65, margin: '0 0 18px 0' };
  const emailCss = { fontWeight: 600, color: '#1a1a1a' };
  const primaryBtn = {
    background: '#C8102E', color: '#fff', border: 'none',
    padding: '13px 28px', borderRadius: '10px', fontSize: '1rem',
    fontWeight: 700, cursor: 'pointer', letterSpacing: '0.3px', width: '100%',
  };
  const secondaryBtn = {
    background: 'transparent', color: '#666', border: '1px solid #ddd',
    padding: '11px 22px', borderRadius: '10px', fontSize: '0.9rem',
    fontWeight: 600, cursor: 'pointer', width: '100%',
  };
  const linkCss = { color: '#C8102E', fontWeight: 600, textDecoration: 'none' };
  const rowCss = {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    padding: '14px 0', borderBottom: '1px solid #f0f0f0',
  };
  const checkboxCss = { marginTop: '3px', width: '18px', height: '18px', accentColor: '#C8102E', cursor: 'pointer', flexShrink: 0 };
  const labelTextCss = { fontSize: '1rem', color: '#1a1a1a', fontWeight: 600, margin: '0 0 2px 0' };
  const helpTextCss = { fontSize: '0.85rem', color: '#888', margin: 0, lineHeight: 1.5 };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginTop: '40px', marginBottom: '64px' }}>
        <div style={cardCss}>
          {phase === 'loading' && (
            <p style={{ ...bodyCss, textAlign: 'center' }}>Loading your preferences...</p>
          )}

          {phase === 'invalid' && (
            <>
              <h1 style={titleCss}>Link not found</h1>
              <p style={bodyCss}>
                This link is invalid or has expired. If you'd still like to update your Trainer Center HB email
                preferences, reply to any email we've sent you and we'll handle it manually.
              </p>
              <p style={{ textAlign: 'center', margin: 0 }}>
                <Link to="/" style={linkCss}>Back to Trainer Center HB</Link>
              </p>
            </>
          )}

          {phase === 'manage' && contact && (
            <>
              <h1 style={titleCss}>
                {contact.first_name ? `Hey ${contact.first_name},` : 'Email preferences'}
              </h1>
              <p style={subtitleCss}>
                {contact.email
                  ? <>Manage what we send to <span style={emailCss}>{contact.email}</span>.</>
                  : 'Manage what we send you.'}
              </p>
              <p style={bodyCss}>
                Check the categories you want to keep getting. Uncheck the ones you don't. Transactional emails
                (vendor application status, account stuff) aren't affected by this.
              </p>

              <div style={{ marginBottom: '24px' }}>
                {MARKETING_CATEGORIES.map((cat) => (
                  <label key={cat.key} style={{ ...rowCss, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!subs[cat.key]}
                      onChange={() => toggle(cat.key)}
                      style={checkboxCss}
                    />
                    <span style={{ flex: 1 }}>
                      <p style={labelTextCss}>{cat.label}</p>
                      <p style={helpTextCss}>{cat.help}</p>
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="button"
                style={{ ...primaryBtn, opacity: saving ? 0.6 : 1, marginBottom: '12px' }}
                onClick={handleSavePreferences}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save my preferences'}
              </button>
              <button
                type="button"
                style={{ ...secondaryBtn, opacity: saving ? 0.6 : 1 }}
                onClick={handleUnsubscribeAll}
                disabled={saving}
              >
                Unsubscribe from everything
              </button>
            </>
          )}

          {phase === 'done_partial' && contact && (
            <>
              <h1 style={titleCss}>Preferences saved</h1>
              <p style={{ ...bodyCss, textAlign: 'center' }}>
                We updated what we'll send to <span style={emailCss}>{contact.email}</span>.
                Changes take a couple of days to fully clear our queue.
              </p>
              <p style={{ textAlign: 'center', margin: 0 }}>
                <Link to="/" style={linkCss}>Back to Trainer Center HB</Link>
              </p>
            </>
          )}

          {phase === 'done_all' && (
            <>
              <h1 style={titleCss}>You're unsubscribed</h1>
              <p style={{ ...bodyCss, textAlign: 'center' }}>
                We won't send you any more Trainer Center HB marketing emails. Sorry to see you go.
              </p>
              <p style={{ ...bodyCss, textAlign: 'center' }}>
                You're always welcome at the shop, and the website is here whenever you want to come back.
              </p>
              <p style={{ textAlign: 'center', margin: 0 }}>
                <Link to="/" style={linkCss}>Back to Trainer Center HB</Link>
              </p>
            </>
          )}

          {phase === 'error' && (
            <>
              <h1 style={titleCss}>Something went wrong</h1>
              <p style={bodyCss}>
                {errorMsg || 'We could not save your preferences right now.'}
              </p>
              <p style={bodyCss}>
                Please try again, or reply to any email we've sent you and we'll handle it manually.
              </p>
              <p style={{ textAlign: 'center', margin: 0 }}>
                <Link to="/" style={linkCss}>Back to Trainer Center HB</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Main App ─────────────────────────────────────────────
function App() {
  const [navVisible, setNavVisible] = useState(false);
  const [staffUser, setStaffUser] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [member, setMember] = useState(null);
  const [authRolesLoading, setAuthRolesLoading] = useState(true);
  const profileFetchRef = useRef(null);
  const isAdmin = !!staffProfile?.is_admin;
  const isVendor = !!vendor;
  const isGuest = !!member;
  // Compact "current staff" object passed down to the calendar so the
  // EventModal can stamp created_by / updated_by on saves.
  const staff = staffUser?.id && staffProfile
    ? { id: staffUser.id, name: staffProfile.name, isAdmin }
    : null;
  const [showLogin, setShowLogin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const location = useLocation();

  // Site settings + special hours (editable Visit Us section + holiday overrides)
  const [siteSettings, setSiteSettings] = useState(null);
  const [specialHours, setSpecialHours] = useState([]);
  const fetchSiteData = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [ssRes, shRes] = await Promise.all([
      supabase.from('site_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('special_hours').select('*').gte('end_date', today).order('start_date', { ascending: true }).limit(20),
    ]);
    if (ssRes.data) setSiteSettings(ssRes.data);
    setSpecialHours(shRes.data || []);
  }, []);
  useEffect(() => { fetchSiteData(); }, [fetchSiteData]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Show nav immediately on non-home pages, use scroll behavior on home page
  useEffect(() => {
    if (location.pathname !== '/') {
      setNavVisible(true);
      return;
    }
    const handleScroll = () => setNavVisible(window.scrollY > 100);
    // Reset on home page
    setNavVisible(window.scrollY > 100);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  // Handle hash scrolling for /#visit-us
  useEffect(() => {
    if (location.hash === '#visit-us') {
      setTimeout(() => {
        const el = document.getElementById('visit-us');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [location]);

  // Check for existing staff session
  // Per AUTH_PLAYBOOK: only set state in here, NO database calls.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStaffUser(session?.user || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setStaffUser(session?.user || null);
      if (!session) setStaffProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile + vendor + member rows in a SEPARATE effect, watching
  // staffUser?.id. Runs in parallel so a single login surfaces all three
  // role rows at once. Source of truth for is_admin lives in public.profiles,
  // not the JWT, so admin changes take effect on next fetch with no re-login.
  const refreshAuthRoles = useCallback(async () => {
    if (!staffUser?.id) {
      setStaffProfile(null);
      setVendor(null);
      setMember(null);
      setAuthRolesLoading(false);
      return;
    }
    setAuthRolesLoading(true);
    const [pRes, vRes, mRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', staffUser.id).maybeSingle(),
      supabase.from('vendors').select('*').eq('user_id', staffUser.id).maybeSingle(),
      supabase.from('members').select('*').eq('user_id', staffUser.id).maybeSingle(),
    ]);
    if (pRes.error) console.error('Profile fetch error:', pRes.error.message);
    if (vRes.error) console.error('Vendor fetch error:', vRes.error.message);
    if (mRes.error) console.error('Member fetch error:', mRes.error.message);
    setStaffProfile(pRes.data || null);
    setVendor(vRes.data || null);
    setMember(mRes.data || null);
    setAuthRolesLoading(false);
  }, [staffUser?.id]);

  useEffect(() => {
    if (!staffUser?.id) {
      setStaffProfile(null);
      setVendor(null);
      setMember(null);
      setAuthRolesLoading(false);
      return;
    }
    if (profileFetchRef.current) profileFetchRef.current.cancelled = true;
    const fetchState = { cancelled: false };
    profileFetchRef.current = fetchState;
    setAuthRolesLoading(true);
    Promise.all([
      supabase.from('profiles').select('*').eq('id', staffUser.id).maybeSingle(),
      supabase.from('vendors').select('*').eq('user_id', staffUser.id).maybeSingle(),
      supabase.from('members').select('*').eq('user_id', staffUser.id).maybeSingle(),
    ]).then(([pRes, vRes, mRes]) => {
      if (fetchState.cancelled) return;
      if (pRes.error) console.error('Profile fetch error:', pRes.error.message);
      if (vRes.error) console.error('Vendor fetch error:', vRes.error.message);
      if (mRes.error) console.error('Member fetch error:', mRes.error.message);
      setStaffProfile(pRes.data || null);
      setVendor(vRes.data || null);
      setMember(mRes.data || null);
      setAuthRolesLoading(false);
    }).catch((err) => {
      if (!fetchState.cancelled) {
        console.error('Auth role fetch failed:', err.message);
        setAuthRolesLoading(false);
      }
    });
    return () => { fetchState.cancelled = true; };
  }, [staffUser?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setStaffUser(null);
    setStaffProfile(null);
    setVendor(null);
    setMember(null);
  };

  const authValue = {
    session: staffUser ? { user: staffUser } : null,
    user: staffUser,
    profile: staffProfile,
    vendor,
    member,
    isAdmin,
    isVendor,
    isGuest,
    isLoading: authRolesLoading,
    signOut: handleLogout,
    refresh: refreshAuthRoles,
  };

  return (
    <SiteContext.Provider value={{ siteSettings, specialHours, isAdmin, refresh: fetchSiteData }}>
    <AuthContext.Provider value={authValue}>
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8f8f8',
      color: '#1a1a1a',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    }}>
      <ScrollToTop />

      {/* Nav - hidden until scroll on home, always visible on other pages */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #eee',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '64px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        transform: navVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.35s ease-in-out'
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
          <img src="/logo-circle-transparent.png" alt="TrainerCenter" style={{ width: '38px', height: '38px', objectFit: 'contain' }} />
          <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', letterSpacing: '-0.02em' }}>
            Trainer <span style={{ color: '#C8102E' }}>Center HB</span>
          </span>
        </Link>
        <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
          {/* Desktop nav links */}
          {!isMobile && NAV_ITEMS.map(item => (
            item.label === 'Visit Us' ? (
              <Link
                key={item.label}
                to={item.to}
                style={{
                  color: '#555',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={e => e.target.style.color = '#C8102E'}
                onMouseLeave={e => e.target.style.color = '#555'}
              >
                {item.label}
              </Link>
            ) : (
              <Link
                key={item.label}
                to={item.to}
                style={{
                  color: location.pathname === item.to ? '#C8102E' : '#555',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={e => e.target.style.color = '#C8102E'}
                onMouseLeave={e => { if (location.pathname !== item.to) e.target.style.color = '#555'; }}
              >
                {item.label}
              </Link>
            )
          ))}
          {/* Staff lock icon - always visible */}
          <button
            onClick={() => staffUser ? handleLogout() : setShowLogin(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
              color: staffUser ? '#C8102E' : '#1a1a1a',
              padding: '4px',
              transition: 'color 0.2s'
            }}
            title={staffUser ? 'Staff: Logged in (click to logout)' : 'Staff Login'}
          >
            {staffUser ? <Unlock size={20} /> : <Lock size={20} />}
          </button>
          {/* Hamburger menu button - mobile only */}
          {isMobile && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#1a1a1a',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {menuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          )}
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {isMobile && menuOpen && navVisible && (
        <div style={{
          position: 'fixed',
          top: '64px',
          left: 0,
          right: 0,
          zIndex: 999,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #eee',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 0'
        }}>
          {NAV_ITEMS.map(item => (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              style={{
                color: location.pathname === item.to ? '#C8102E' : '#555',
                textDecoration: 'none',
                fontSize: '0.95rem',
                fontWeight: '600',
                padding: '14px 24px',
                borderBottom: '1px solid #f0f0f0',
                transition: 'background-color 0.2s, color 0.2s'
              }}
              onMouseEnter={e => { e.target.style.backgroundColor = '#fff0f0'; e.target.style.color = '#C8102E'; }}
              onMouseLeave={e => { e.target.style.backgroundColor = 'transparent'; if (location.pathname !== item.to) e.target.style.color = '#555'; }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}

      {/* Routes */}
      <Routes>
        <Route path="/" element={<HomePage isMobile={isMobile} />} />
        <Route path="/unsubscribe" element={<UnsubscribePage isMobile={isMobile} />} />
        <Route path="/consultation" element={<ConsultationPage isMobile={isMobile} />} />
        <Route path="/grading" element={<GradingPage isMobile={isMobile} />} />
        <Route path="/buy-sell" element={<BuySellPage isMobile={isMobile} />} />
        <Route path="/calendar" element={<CalendarPage isMobile={isMobile} isAdmin={isAdmin} staff={staff} />} />
        <Route path="/blog" element={<BlogListPage isMobile={isMobile} />} />
        <Route path="/blog/:slug" element={<BlogPostPage isMobile={isMobile} />} />
        <Route path="/vendor-day" element={<VendorDayPage isMobile={isMobile} />} />
        <Route path="/vendor-day/about" element={<VendorDayAboutPage isMobile={isMobile} />} />
        <Route path="/vendors" element={<VendorsPage isMobile={isMobile} staff={staff} />} />
        <Route path="/vendors/apply" element={<VendorApplyPage isMobile={isMobile} />} />
        <Route path="/vendors/dashboard" element={<VendorDashboardPage isMobile={isMobile} />} />
        <Route path="/vendors/edit" element={<VendorEditProfilePage isMobile={isMobile} />} />
        <Route path="/vendors/upload/:eventId" element={<VendorUploadPage isMobile={isMobile} />} />
        <Route path="/vendors/review" element={<VendorReviewPage isMobile={isMobile} />} />
        {/* Guest-facing alias for the same review/voting flow. DB still uses members. */}
        <Route path="/guest/dashboard" element={<VendorReviewPage isMobile={isMobile} />} />
        <Route path="/guest/review" element={<VendorReviewPage isMobile={isMobile} />} />
        <Route path="/staff/vendors" element={<StaffVendorsPage isMobile={isMobile} staff={staff} />} />
      </Routes>

      {/* Staff Login Modal */}
      {showLogin && (
        <StaffLogin
          onClose={() => setShowLogin(false)}
          onLogin={() => { /* auth listener handles setStaffUser */ }}
        />
      )}

      {/* Staff banner */}
      {isAdmin && (
        <div style={{
          position: 'fixed', bottom: '16px', right: '16px', zIndex: 999,
          backgroundColor: '#C8102E', color: '#fff', padding: '8px 16px',
          borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          Staff Mode - Click calendar days to add events
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Russo+One&display=swap');
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-25%); }
        }
        html { scroll-behavior: smooth; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        @media (max-width: 768px) {
          body { -webkit-text-size-adjust: 100%; }
        }
      `}</style>
    </div>
    </AuthContext.Provider>
    </SiteContext.Provider>
  );
}

export default App;
