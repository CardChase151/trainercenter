import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from 'react';
import { Link, Routes, Route, Navigate, useLocation, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import BLOG_DATA from './blogData';
import { supabase } from './supabaseClient';
import { usePageViewTracker } from './lib/usePageViewTracker';
import { Lock, Unlock, Menu, X, Phone, MapPin, Clock, Award, ShoppingBag, GraduationCap, Mail, Users, Calendar as CalendarIcon, CheckCircle2, AlertCircle, ArrowRight, LogOut, Loader2, Image as ImageIcon, Film, Trash2, Upload as UploadIcon, Edit2, Plus, Facebook, ChevronDown, List, Grid3x3, LogIn, FileEdit, Eye, Settings, HelpCircle, Briefcase, Bold as BoldIcon, Italic as ItalicIcon, Strikethrough, ListOrdered, Link2, Bell, BarChart3, Search, ExternalLink } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import DOMPurify from 'dompurify';
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
// True on devices with a real mouse (desktop). On touch-only devices iOS
// fires mouseenter on tap and never fires mouseleave, leaving inline hover
// transforms stuck. Components that use onMouseEnter/Leave for lift effects
// gate them on this so taps on iOS don't leave residue.
const HAS_HOVER = typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches;

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

// ─── HTML sanitization ───────────────────────────────────
// Calendar event descriptions are now stored as HTML produced by the
// TipTap editor in EventModal. Every render path runs the stored HTML
// through DOMPurify with a tight allowlist before handing it to
// dangerouslySetInnerHTML so a compromised admin or pasted-in content
// can't inject scripts/iframes.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 's', 'u',
                 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4',
                 'blockquote', 'code', 'pre', 'hr'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
};
const sanitizeRichText = (html) => {
  if (!html) return '';
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG);
  // Force every link to open in a new tab and not pass referrer/opener.
  return clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
};
const isRichTextEmpty = (html) => {
  if (!html) return true;
  const stripped = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
  return stripped.length === 0;
};

// ─── Rich Text Editor (TipTap) ──────────────────────────
// Used in the staff EventModal for event descriptions. Outputs HTML, not
// markdown — what staff see in the editor is exactly what visitors see on
// the calendar. Keep the toolbar narrow on purpose: bold/italic/strike,
// bullet + numbered lists, link. Headings stay out — these are inline
// card descriptions, not articles.
function RichTextEditor({ value, onChange, placeholder, isMobile }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      onChange(isRichTextEmpty(html) ? '' : html);
    },
  });

  // When the parent changes `value` externally (loading an event into the
  // edit form, or resetting the form), push it into the editor without
  // triggering an onUpdate loop.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || '';
    if (incoming !== current && !(isRichTextEmpty(incoming) && isRichTextEmpty(current))) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  const btn = (active, onClick, label, Icon) => (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={label}
      style={{
        background: active ? '#1a1a1a' : '#fff',
        color: active ? '#fff' : '#444',
        border: '1px solid #ddd',
        borderRadius: '6px',
        padding: '6px 9px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '0.85rem',
        fontWeight: '700',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '32px',
        height: '32px',
      }}
    >
      <Icon size={15} />
    </button>
  );

  const promptForLink = () => {
    const previous = editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL', previous);
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const safeUrl = url.startsWith('http') ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run();
  };

  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundColor: '#fff',
      marginBottom: '12px',
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '4px',
        padding: '6px 8px',
        borderBottom: '1px solid #eee',
        backgroundColor: '#fafafa',
      }}>
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold (Ctrl/Cmd+B)', BoldIcon)}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic (Ctrl/Cmd+I)', ItalicIcon)}
        {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'Strikethrough', Strikethrough)}
        <span style={{ width: '1px', backgroundColor: '#e5e7eb', margin: '0 4px' }} />
        {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bullet list', List)}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list', ListOrdered)}
        <span style={{ width: '1px', backgroundColor: '#e5e7eb', margin: '0 4px' }} />
        {btn(editor.isActive('link'), promptForLink, 'Add or edit link', Link2)}
      </div>
      <div
        onClick={() => editor.chain().focus().run()}
        style={{
          padding: '12px 14px',
          fontSize: '16px',
          lineHeight: '1.5',
          minHeight: isMobile ? '120px' : '140px',
          cursor: 'text',
        }}
      >
        <EditorContent editor={editor} />
        {isRichTextEmpty(editor.getHTML()) && placeholder && (
          <div style={{
            position: 'absolute',
            color: '#aaa',
            pointerEvents: 'none',
            transform: 'translateY(-1.5em)',
            fontSize: '16px',
          }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

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
// ─── Login Modal (staff + vendor) ─────────────────────────
// Single sign-in surface for both staff and vendors. After auth succeeds,
// the modal flips to a "where to next?" picker keyed off the user's roles
// so a fresh login lands them on the surface they actually came to manage.
// ─── AuthModal ────────────────────────────────────────────
// The single, reusable auth surface. Powers every "Log in" button in the
// nav, every per-page "create account to continue" gate, and any future
// entry point (vendor apply CTA, notification bell, QR vote flow, etc).
//
// Props:
//   defaultMode  'login' | 'signup'   — start in this mode
//   intent       'vendor' | 'member'  — when provided, signup skips the
//                                        "what are you signing up for?"
//                                        fork and adapts copy
//   allowSignup  boolean              — false hides the signup toggle
//                                        (staff login is admin-only)
//   onSuccess    ({ user, isNew, role, intent }) => void
//                                      Caller decides where to send the
//                                      user after auth (e.g. apply flow,
//                                      reminder prefs, redirect).
//   onClose      () => void
//
// Internal state machine:
//   phase = 'fork'         — signup chose no intent yet, ask which one
//          'form'          — render the email/password form
//          'staff-picker'  — staff just logged in, show the tile grid
function AuthModal({ defaultMode = 'login', intent: initialIntent = null, allowSignup = true, onClose, onSuccess }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(defaultMode);              // 'login' | 'signup'
  const [intent, setIntent] = useState(initialIntent);        // 'vendor' | 'member' | null
  const [phase, setPhase] = useState(() =>
    defaultMode === 'signup' && !initialIntent && allowSignup ? 'fork' : 'form'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (next) => {
    setMode(next);
    setError('');
    // Toggling into signup with no intent yet → show the fork. Toggling
    // back to login → bypass the fork entirely.
    if (next === 'signup' && !intent && allowSignup) {
      setPhase('fork');
    } else {
      setPhase('form');
    }
  };

  const pickIntent = (chosen) => {
    setIntent(chosen);
    setPhase('form');
  };

  // Per-intent copy for the signup form — sets context without making the
  // user read a separate page.
  const intentCopy = intent === 'vendor'
    ? {
        signupTitle: 'Create your vendor account',
        signupSub:   "First step in applying to partner with Trainer Center HB. Quick — email and password.",
      }
    : intent === 'member'
    ? {
        signupTitle: 'Create your account',
        signupSub:   "Set up notifications and lock in your favorites at events. Takes 10 seconds.",
      }
    : {
        signupTitle: 'Create your account',
        signupSub:   "Trainer Center HB",
      };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email: cleanEmail, password })
      : await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    if (!result.data.session) {
      // signUp returns no session when the email is already registered.
      setError('That email already has an account. Try logging in instead.');
      setMode('login');
      setPhase('form');
      setLoading(false);
      return;
    }
    const user = result.data.user;

    // Role detection — same as before, just shared between login + signup.
    const [profileRes, vendorRes] = await Promise.all([
      supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle(),
      supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle(),
    ]);
    const isStaff  = !!profileRes.data?.is_admin;
    const isVendor = !!vendorRes.data?.id;
    const role = isStaff ? 'staff' : isVendor ? 'vendor' : 'member';

    setLoading(false);
    // Staff post-login: show the tile picker BEFORE closing so they can
    // jump straight to whatever they came to do.
    if (mode === 'login' && isStaff) {
      setPhase('staff-picker');
      // Let App refresh its auth state so the nav / role-based UI updates
      // even while the picker is still showing.
      onSuccess && onSuccess({ user, isNew: false, role, intent, deferClose: true });
      return;
    }
    onSuccess && onSuccess({ user, isNew: mode === 'signup', role, intent });
  };

  const goTo = (path) => {
    navigate(path);
    onClose();
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  };
  const cardStyle = {
    backgroundColor: '#fff', borderRadius: '16px', padding: '28px',
    // Wider on desktop so the 2-column tile grid fits comfortably
    width: '100%', maxWidth: '560px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    maxHeight: '90vh', overflowY: 'auto',
  };
  const pickerBtn = (color) => ({
    width: '100%', padding: '14px 18px',
    border: `1px solid ${color}33`,
    borderRadius: '10px',
    backgroundColor: '#fff',
    color: color,
    fontSize: '0.95rem', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    transition: 'background-color 0.15s, border-color 0.15s',
  });

  // Bigger icon-tile button for the staff "mini dashboard" picker.
  // Each tile shows an icon, label, and a one-line description so staff can
  // pick the right area at a glance without reading every label.
  const staffTileStyle = (accent) => ({
    display: 'flex', alignItems: 'flex-start', gap: '14px',
    width: '100%', padding: '18px',
    border: `1px solid ${accent}26`,
    borderRadius: '12px',
    backgroundColor: '#fff',
    color: '#1a1a1a',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    transition: 'background-color 0.15s, border-color 0.15s, transform 0.15s',
  });
  const staffTileHover = (accent) => (e, on) => {
    e.currentTarget.style.backgroundColor = on ? `${accent}0d` : '#fff';
    e.currentTarget.style.borderColor = on ? accent : `${accent}26`;
    e.currentTarget.style.transform = on ? 'translateY(-1px)' : 'translateY(0)';
  };
  const staffTileIconWrap = (accent) => ({
    width: 40, height: 40, flexShrink: 0,
    borderRadius: 10, backgroundColor: `${accent}14`,
    color: accent,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  // All staff dashboard areas — same order as the staff-badge dropdown menu
  // up in the header, so the two surfaces stay in sync. Each tile renders
  // an icon + label + one-line description.
  const STAFF_TILES = [
    { key: 'calendar', label: 'Calendar', desc: 'Edit events and Vendor Days', icon: <CalendarIcon size={20} />, to: '/calendar', accent: '#C8102E' },
    { key: 'vendors',  label: 'Vendors',  desc: 'Approve, manage, review applications', icon: <Briefcase size={20} />, to: '/staff/vendors', accent: '#C8102E' },
    { key: 'members',  label: 'Members',  desc: 'Customer list and vote history', icon: <Users size={20} />, to: '/staff/members', accent: '#C8102E' },
    { key: 'comms',    label: 'Communication', desc: 'Compose a vendor or customer blast', icon: <Mail size={20} />, to: '/staff/comms', accent: '#C8102E' },
    { key: 'instagram', label: 'Instagram Contacts', desc: 'Tag followers as member, vendor, or influencer', icon: <IgIcon size={20} />, to: '/staff/instagram', accent: '#C8102E' },
    { key: 'printables', label: 'Printables', desc: 'Staff sheets + QR codes — print or download', icon: <FileEdit size={20} />, to: '/staff/printables', accent: '#C8102E' },
    { key: 'analytics', label: 'Analytics', desc: 'Daily SEO + traffic dashboard', icon: <BarChart3 size={20} />, to: '/staff/analytics', accent: '#C8102E' },
    { key: 'hours',    label: 'Business Hours', desc: 'See shop hours block', icon: <Clock size={20} />, to: '/#visit-us', accent: '#C8102E' },
  ];

  // ─── Phase: staff post-login picker ─────────────────────
  if (phase === 'staff-picker') {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={cardStyle} onClick={e => e.stopPropagation()}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>You&apos;re in</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', margin: '0 0 22px 0' }}>What would you like to manage?</p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px',
          }}>
            {STAFF_TILES.map(tile => (
              <button
                key={tile.key}
                onClick={() => goTo(tile.to)}
                style={staffTileStyle(tile.accent)}
                onMouseEnter={e => staffTileHover(tile.accent)(e, true)}
                onMouseLeave={e => staffTileHover(tile.accent)(e, false)}
              >
                <div style={staffTileIconWrap(tile.accent)}>{tile.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1a1a1a' }}>{tile.label}</div>
                    <ArrowRight size={16} style={{ color: tile.accent, flexShrink: 0 }} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 3, lineHeight: 1.35 }}>{tile.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Phase: intent fork (signup with no preset intent) ──
  if (phase === 'fork') {
    const forkOpt = (color, icon, title, desc, onClick) => (
      <button onClick={onClick} style={staffTileStyle(color)}
        onMouseEnter={e => staffTileHover(color)(e, true)}
        onMouseLeave={e => staffTileHover(color)(e, false)}
      >
        <div style={staffTileIconWrap(color)}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1a1a1a' }}>{title}</div>
            <ArrowRight size={16} style={{ color: color, flexShrink: 0 }} />
          </div>
          <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 3, lineHeight: 1.35 }}>{desc}</div>
        </div>
      </button>
    );
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={cardStyle} onClick={e => e.stopPropagation()}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>What brings you in?</h2>
          <p style={{ fontSize: '0.9rem', color: '#666', margin: '0 0 18px 0' }}>Pick the path that fits — we'll set you up from there.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {forkOpt(
              '#16a34a',
              <Briefcase size={20} />,
              'Apply to partner with Trainer Center',
              'For Vendors, sellers, and collectors who want a table.',
              () => pickIntent('vendor')
            )}
            {forkOpt(
              '#ea580c',
              <Bell size={20} />,
              'Notifications & reminders',
              'Be a member — get event alerts, lock in favorites at trade nights.',
              () => pickIntent('member')
            )}
          </div>
          {/* Already have an account? Switch to login. */}
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#666', margin: '20px 0 0 0' }}>
            Already have an account?{' '}
            <button type="button" onClick={() => switchMode('login')} style={{
              background: 'none', border: 'none', padding: 0,
              color: '#C8102E', fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.85rem',
            }}>Log in</button>
          </p>
        </div>
      </div>
    );
  }

  // ─── Phase: email + password form (login OR signup) ─────
  const isSignup = mode === 'signup';
  const accent = '#C8102E';
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        {/* Mode toggle — only shown when signup is allowed */}
        {allowSignup && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button type="button" onClick={() => switchMode('login')} style={{
              flex: 1, padding: '10px', borderRadius: 8,
              backgroundColor: !isSignup ? accent : '#fff',
              color: !isSignup ? '#fff' : '#666',
              border: !isSignup ? 'none' : '1px solid #ddd',
              fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Log in</button>
            <button type="button" onClick={() => switchMode('signup')} style={{
              flex: 1, padding: '10px', borderRadius: 8,
              backgroundColor: isSignup ? accent : '#fff',
              color: isSignup ? '#fff' : '#666',
              border: isSignup ? 'none' : '1px solid #ddd',
              fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Create account</button>
          </div>
        )}

        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1a1a1a', margin: '0 0 4px 0' }}>
          {isSignup ? intentCopy.signupTitle : 'Log in'}
        </h2>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 18px 0' }}>
          {isSignup ? intentCopy.signupSub : 'Trainer Center HB'}
        </p>

        <form onSubmit={handleSubmit}>
          <input type="email" required placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            style={{
              width: '100%', padding: '12px 14px', fontSize: '0.95rem',
              border: '1px solid #ddd', borderRadius: 10,
              marginBottom: 10, boxSizing: 'border-box', outline: 'none',
            }}
          />
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <input type={showPw ? 'text' : 'password'} required
              placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
              minLength={6}
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              style={{
                width: '100%', padding: '12px 14px', fontSize: '0.95rem',
                border: '1px solid #ddd', borderRadius: 10,
                boxSizing: 'border-box', outline: 'none', paddingRight: 68,
              }}
            />
            <button type="button" onClick={() => setShowPw(s => !s)} style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 700, color: '#666',
              padding: '6px 10px', borderRadius: 6, fontFamily: 'inherit',
            }}>{showPw ? 'Hide' : 'Show'}</button>
          </div>

          {error && (
            <p style={{ color: '#C8102E', fontSize: '0.85rem', margin: '0 0 12px 0' }}>{error}</p>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: 14, backgroundColor: accent, color: '#fff',
            border: 'none', borderRadius: 10, fontWeight: 800, fontSize: '0.95rem',
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
            fontFamily: 'inherit',
          }}>
            {loading
              ? (isSignup ? 'Creating account…' : 'Logging in…')
              : (isSignup ? 'Create account' : 'Log in')}
          </button>
        </form>

        {/* Signup mode with an explicit intent: show a back link to swap. */}
        {isSignup && intent && allowSignup && (
          <p style={{ textAlign: 'center', fontSize: '0.78rem', color: '#888', margin: '14px 0 0 0' }}>
            <button type="button" onClick={() => { setIntent(null); setPhase('fork'); }} style={{
              background: 'none', border: 'none', padding: 0,
              color: '#888', cursor: 'pointer', textDecoration: 'underline',
              fontFamily: 'inherit', fontSize: '0.78rem',
            }}>Wrong path? Pick again</button>
          </p>
        )}
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
  // Reminder subscriptions (the user's marketing_contacts.subscriptions JSONB).
  // null when the user has never signed up for reminders, otherwise a map
  // like { trade_night: true, tournament: false, ... }.
  reminderSubs: null,
  hasReminders: false,
  refreshReminders: async () => {},
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
  tc_trade_night: { label: "TC's Beach City Trade Night!", color: '#7c3aed', description: "Trainer Center's biggest event. Last Friday of the month, local vendors set up in the shop, full lineup of trades and finds." },
  trade_night:  { label: 'Trade Night',  color: '#C8102E', description: 'Bring cards. Trade with the community. Walk out with the binder you have been chasing.' },
  tournament:   { label: 'Tournament',   color: '#2563eb', description: 'Compete in TCG, video games, or board games. Prizes for top finishers.' },
  game_day:     { label: 'Game Day',     color: '#0891b2', description: 'Video games, board games, TCG. Bring your stuff or play what is at the shop.' },
  crafts:       { label: 'Crafts & Art', color: '#ec4899', description: 'Family-friendly. Paint Pokemon, do crafts, hang out.' },
  consultation: { label: 'Consultations',color: '#059669', description: 'Book 1-on-1 with Chef for appraisals, strategy, or learn the TCG.' },
  on_the_road:  { label: 'On the Road',  color: '#d97706', description: 'Off-site shows where you can find us — Front Row, conventions, regional trade days.' },
  other:        { label: 'Other',        color: '#ea580c', description: 'Everything else on the schedule.' },
};

// ─── Event Modal (Add/Edit) ───────────────────────────────
function EventModal({ date, existingEvents, seriesSizes = {}, initialEdit = null, onClose, onSave, onDelete, onCancelEvent, isMobile, staff }) {
  const dateToISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const initialDateISO = dateToISO(date);

  const newId = (() => { let n = 0; return () => ++n; })();
  const entryIdRef = useRef(newId);
  const makeEntry = (d, s = '18:00', e = '20:00') => ({
    _id: entryIdRef.current(),
    date: d,
    startTime: s,
    endTime: e,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // startTime/endTime back the Repeating-mode time pickers and the
  // editing-existing-event flow. The Specific-dates list keeps its own
  // per-row times in `dateEntries`.
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('20:00');
  // editEventDate holds the date for the row being edited. Populated from
  // editingEvent.event_date on load; user can change it via the date picker
  // and the new value is what we save. Empty when not in edit mode.
  const [editEventDate, setEditEventDate] = useState('');
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
  // When editing a row that's part of a multi-day series, this toggle pushes
  // the shared fields (title/desc/categories/location/vendor settings) to
  // every day in the series. Per-day fields (date/start/end) always stay
  // bound to the row being edited.
  const [applyToSeries, setApplyToSeries] = useState(false);
  // New-event scheduling: 'specific' = hand-picked list of dates that may
  // have different times each (camps, multi-day events). 'repeating' = the
  // legacy weekly/biweekly/monthly recurrence with one shared time window.
  const [scheduleMode, setScheduleMode] = useState('specific');
  const [dateEntries, setDateEntries] = useState(() => [makeEntry(initialDateISO)]);

  const dateStr = `${date.toLocaleString('default', { month: 'long' })} ${date.getDate()}, ${date.getFullYear()}`;

  const resetForm = () => {
    setTitle(''); setDescription(''); setStartTime('18:00'); setEndTime('20:00');
    setLocation(''); setCategories(['other']); setRecurrence('none'); setRecurrenceEndDate('');
    setHasVendors(false); setVendorStartTime(''); setVendorEndTime(''); setVendorNote('');
    setEditingEvent(null);
    setEditEventDate('');
    setScheduleMode('specific');
    setDateEntries([makeEntry(initialDateISO)]);
    setApplyToSeries(false);
  };

  const loadEvent = (event) => {
    setEditingEvent(event);
    setApplyToSeries(false);
    setTitle(event.title);
    setDescription(event.description || '');
    setStartTime(event.start_time?.slice(0, 5) || '18:00');
    setEndTime(event.end_time?.slice(0, 5) || '20:00');
    setEditEventDate(event.event_date || initialDateISO);
    setLocation(event.location || '');
    setCategories(event.categories?.length ? event.categories : ['other']);
    setRecurrence(event.recurrence || 'none');
    setRecurrenceEndDate(event.recurrence_end_date || '');
    setHasVendors(!!event.has_vendors);
    setVendorStartTime(event.vendor_start_time?.slice(0, 5) || '');
    setVendorEndTime(event.vendor_end_time?.slice(0, 5) || '');
    setVendorNote(event.vendor_note || '');
  };

  // When the modal is opened from a day-detail Edit button, jump straight
  // into edit mode for that specific row instead of landing the user on the
  // create form.
  useEffect(() => {
    if (initialEdit) loadEvent(initialEdit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEdit?.id]);

  // ─── Specific-dates list helpers ────────────────────────
  const addDateEntry = () => {
    // Default the new entry's date to the day after the last entry so a
    // multi-day camp is one tap per consecutive day.
    const last = dateEntries[dateEntries.length - 1];
    const seed = last ? new Date(last.date + 'T12:00:00') : new Date(initialDateISO + 'T12:00:00');
    seed.setDate(seed.getDate() + 1);
    setDateEntries(prev => [
      ...prev,
      makeEntry(dateToISO(seed), last?.startTime || '18:00', last?.endTime || '20:00'),
    ]);
  };
  const removeDateEntry = (id) => {
    setDateEntries(prev => prev.length > 1 ? prev.filter(e => e._id !== id) : prev);
  };
  const updateDateEntry = (id, patch) => {
    setDateEntries(prev => prev.map(e => e._id === id ? { ...e, ...patch } : e));
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
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim() || null;
    const trimmedLocation = location.trim() || null;
    const safeCategories = categories.length > 0 ? categories : ['other'];
    const trimmedVendorNote = hasVendors ? (vendorNote.trim() || null) : null;

    // ─── Edit existing single row ─────────────────────────
    if (editingEvent?.id) {
      const editStartTime = startTime;
      const editEndTime = endTime;
      const eventData = {
        id: editingEvent.id,
        title: trimmedTitle,
        description: trimmedDescription,
        event_date: editEventDate || editingEvent.event_date,
        start_time: editStartTime,
        end_time: editEndTime,
        location: trimmedLocation,
        categories: safeCategories,
        recurrence,
        recurrence_end_date: recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null,
        has_vendors: hasVendors,
        vendor_start_time: hasVendors ? (vendorStartTime || editStartTime) : null,
        vendor_end_time: hasVendors ? (vendorEndTime || editEndTime) : null,
        vendor_note: trimmedVendorNote,
        updated_by: staff?.id || null,
        updated_by_name: staff?.name || null,
      };
      // Series-wide patch: also push shared fields to every other row in the
      // series. Per-day fields (date/start/end/recurrence) only update this row.
      if (applyToSeries && editingEvent.series_id) {
        const sharedFields = {
          title: trimmedTitle,
          description: trimmedDescription,
          location: trimmedLocation,
          categories: safeCategories,
          has_vendors: hasVendors,
          vendor_note: trimmedVendorNote,
          updated_by: staff?.id || null,
          updated_by_name: staff?.name || null,
        };
        onSave({
          ...eventData,
          _series: { sharedFields, series_id: editingEvent.series_id },
        });
      } else {
        onSave(eventData);
      }
      resetForm();
      return;
    }

    // ─── New event: branch on schedule mode ───────────────
    const baseFields = {
      title: trimmedTitle,
      description: trimmedDescription,
      location: trimmedLocation,
      categories: safeCategories,
      has_vendors: hasVendors,
      vendor_note: trimmedVendorNote,
      created_by: staff?.id || null,
      created_by_name: staff?.name || null,
    };

    if (scheduleMode === 'repeating') {
      // Single row with recurrence, anchored to the day the modal was opened on.
      const dateFormatted = dateToISO(date);
      const eventData = {
        ...baseFields,
        event_date: dateFormatted,
        start_time: startTime,
        end_time: endTime,
        recurrence,
        recurrence_end_date: recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null,
        vendor_start_time: hasVendors ? (vendorStartTime || startTime) : null,
        vendor_end_time: hasVendors ? (vendorEndTime || endTime) : null,
      };
      onSave(eventData);
      resetForm();
      return;
    }

    // Specific dates: one row per entry. Multiple entries share a series_id
    // so we can render "Day X of Y" badges and offer series-wide edits later.
    const sortedEntries = [...dateEntries].sort((a, b) => a.date.localeCompare(b.date));
    const seriesId = sortedEntries.length > 1
      ? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `series-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      : null;
    const rows = sortedEntries.map((entry, idx) => ({
      ...baseFields,
      event_date: entry.date,
      start_time: entry.startTime,
      end_time: entry.endTime,
      recurrence: 'none',
      recurrence_end_date: null,
      vendor_start_time: hasVendors ? (vendorStartTime || entry.startTime) : null,
      vendor_end_time: hasVendors ? (vendorEndTime || entry.endTime) : null,
      series_id: seriesId,
      series_position: seriesId ? idx + 1 : null,
    }));
    onSave(rows);
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
        width: '100%', maxWidth: '960px',
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
                    {(() => {
                      const d = editEventDate ? new Date(editEventDate + 'T12:00:00') : null;
                      return d
                        ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                        : dateStr;
                    })()}
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
            <button onClick={onClose} className="icon-tap" style={{
              background: '#f0f0f0', border: 'none', borderRadius: '50%',
              cursor: 'pointer',
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

        {/* Series banner — visible while editing a row that's part of a
            multi-day series. Toggle pushes shared fields to every day. */}
        {editingEvent?.series_id && seriesSizes[editingEvent.series_id] > 1 && (
          <div style={{
            backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe',
            borderRadius: '10px', padding: '12px 14px', marginBottom: '14px',
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#5b21b6', marginBottom: '4px' }}>
              Day {editingEvent.series_position} of {seriesSizes[editingEvent.series_id]} in a series
            </div>
            <div style={{ fontSize: '0.78rem', color: '#5b21b6', lineHeight: '1.5', marginBottom: '8px' }}>
              By default, edits here only update this day. Toggle below to push title, description, categories, location, and vendor settings to every day in the series.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={applyToSeries}
                onChange={e => setApplyToSeries(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#7c3aed' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#1a1a1a' }}>
                Apply shared fields to all {seriesSizes[editingEvent.series_id]} days
              </span>
            </label>
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
                      {ev.series_id && seriesSizes[ev.series_id] > 1 && ev.series_position && (
                        <span style={{ color: '#7c3aed', marginLeft: '8px', fontWeight: '700' }}>
                          Day {ev.series_position} of {seriesSizes[ev.series_id]}
                        </span>
                      )}
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
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Type a description. Use the toolbar for bold, italic, lists, and links."
          isMobile={isMobile}
        />

        {/* ─── Schedule ────────────────────────────────────
            New events: pick between a hand-picked list of dates (camps,
            multi-day events) and a recurrence pattern (weekly/biweekly/
            monthly). Each row in Specific dates can have its own time
            window. Editing an existing event keeps the simple single-row
            form; series-wide edits live in a separate flow. */}
        {!editingEvent ? (
          <>
            <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Schedule</label>
            <div role="radiogroup" style={{
              display: 'flex', gap: '6px', marginBottom: '12px',
              padding: '4px', backgroundColor: '#f3f4f6', borderRadius: '10px',
            }}>
              {[
                { key: 'specific', label: 'Specific dates' },
                { key: 'repeating', label: 'Repeating' },
              ].map(opt => {
                const active = scheduleMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScheduleMode(opt.key)}
                    style={{
                      flex: 1,
                      background: active ? '#fff' : 'transparent',
                      border: active ? '1px solid #e5e7eb' : '1px solid transparent',
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      fontSize: '0.85rem', fontWeight: '700',
                      color: active ? '#1a1a1a' : '#6b7280',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {scheduleMode === 'specific' ? (
              <div style={{ marginBottom: '12px' }}>
                {dateEntries.map((entry, idx) => (
                  <div key={entry._id} style={{
                    display: isMobile ? 'block' : 'flex',
                    gap: '8px',
                    alignItems: 'flex-end',
                    marginBottom: '8px',
                    padding: isMobile ? '10px' : '0',
                    backgroundColor: isMobile ? '#fafafa' : 'transparent',
                    borderRadius: isMobile ? '10px' : '0',
                    border: isMobile ? '1px solid #eee' : 'none',
                  }}>
                    <div style={{ flex: 2, marginBottom: isMobile ? '6px' : 0 }}>
                      <label style={{ fontSize: '0.65rem', color: '#999', fontWeight: '600' }}>
                        Day {idx + 1} date
                      </label>
                      <input
                        type="date"
                        value={entry.date}
                        onChange={e => updateDateEntry(entry._id, { date: e.target.value })}
                        style={{ ...inputStyle, marginBottom: 0 }}
                      />
                    </div>
                    <div style={{ flex: 1, marginBottom: isMobile ? '6px' : 0 }}>
                      <label style={{ fontSize: '0.65rem', color: '#999', fontWeight: '600' }}>Start</label>
                      <input
                        type="time"
                        value={entry.startTime}
                        onChange={e => updateDateEntry(entry._id, { startTime: e.target.value })}
                        style={{ ...inputStyle, marginBottom: 0 }}
                      />
                    </div>
                    <div style={{ flex: 1, marginBottom: isMobile ? '6px' : 0 }}>
                      <label style={{ fontSize: '0.65rem', color: '#999', fontWeight: '600' }}>End</label>
                      <input
                        type="time"
                        value={entry.endTime}
                        onChange={e => updateDateEntry(entry._id, { endTime: e.target.value })}
                        style={{ ...inputStyle, marginBottom: 0 }}
                      />
                    </div>
                    {dateEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDateEntry(entry._id)}
                        title="Remove this date"
                        style={{
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          color: '#C8102E',
                          borderRadius: '8px',
                          padding: isMobile ? '8px 12px' : '10px 12px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '700',
                          flexShrink: 0,
                          width: isMobile ? '100%' : 'auto',
                          fontFamily: 'inherit',
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDateEntry}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px dashed #C8102E',
                    backgroundColor: '#fff5f6',
                    color: '#C8102E',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    marginTop: '4px',
                  }}
                >
                  + Add another date
                </button>
                {dateEntries.length > 1 && (
                  <p style={{ fontSize: '0.72rem', color: '#888', margin: '8px 2px 0' }}>
                    These {dateEntries.length} dates will be saved as one series so you can edit or cancel them together later.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p style={{ fontSize: '0.78rem', color: '#666', margin: '-4px 0 10px 2px' }}>
                  Repeats starting <strong>{dateStr}</strong>. Pick the times below and (optional) an end date.
                </p>
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
                <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Repeat</label>
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
              </>
            )}
          </>
        ) : (
          // Editing an existing single row — keep the original simple form.
          <>
            <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Date</label>
            <input
              type="date"
              value={editEventDate}
              onChange={e => setEditEventDate(e.target.value)}
              style={inputStyle}
            />
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
          </>
        )}

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
          seriesSize={eventToDelete.series_id ? (seriesSizes[eventToDelete.series_id] || 1) : 1}
          onClose={() => setEventToDelete(null)}
          onCancelWithEmail={async (reason, scope) => {
            await onCancelEvent(eventToDelete.id, reason, scope);
            setEventToDelete(null);
            onClose();
          }}
          onPermanentDelete={async (scope) => {
            await onDelete(eventToDelete.id, scope);
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
function DeleteEventConfirmModal({ event, seriesSize = 1, onClose, onCancelWithEmail, onPermanentDelete }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmHard, setConfirmHard] = useState(false);
  // For series events, default scope to the whole series — that's what staff
  // usually mean when they hit Delete on a multi-day event. They can flip
  // back to "Just this day" if they only want to skip one date.
  const [scope, setScope] = useState(seriesSize > 1 ? 'series' : 'one');

  const handleSoftCancel = async () => {
    setBusy(true);
    await onCancelWithEmail(reason.trim() || null, scope);
    setBusy(false);
  };
  const handleHardDelete = async () => {
    setBusy(true);
    await onPermanentDelete(scope);
    setBusy(false);
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div className="modal-safe-bottom smooth-scroll" style={{...modalCardStyle, maxHeight: "calc(100vh - 40px)", overflowY: "auto"}} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: '0 0 4px 0', color: '#dc2626' }}>
          Delete "{event.title}"?
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 16px 0' }}>
          Pick how to handle this event below. The default option notifies applicants — use the permanent delete only for events you created by mistake.
        </p>

        {seriesSize > 1 && (
          <div style={{
            backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe',
            borderRadius: '10px', padding: '12px 14px', marginBottom: '14px',
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '800', color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Multi-day series · {seriesSize} days
            </div>
            <div role="radiogroup" style={{ display: 'flex', gap: '6px' }}>
              {[
                { key: 'series', label: `All ${seriesSize} days` },
                { key: 'one', label: 'Just this day' },
              ].map(opt => {
                const active = scope === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScope(opt.key)}
                    style={{
                      flex: 1,
                      background: active ? '#7c3aed' : '#fff',
                      color: active ? '#fff' : '#5b21b6',
                      border: `1px solid ${active ? '#7c3aed' : '#ddd6fe'}`,
                      borderRadius: '8px',
                      padding: '9px 10px',
                      fontSize: '0.85rem', fontWeight: '700',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{
          backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '12px 14px', marginBottom: '14px',
          fontSize: '0.85rem', color: '#991b1b', lineHeight: '1.6'
        }}>
          <strong>Cancel event (recommended):</strong> sends a cancellation email to every approved + pending applicant {scope === 'series' && seriesSize > 1 ? `on each of the ${seriesSize} days` : ''} and tells future reminder emails to skip {scope === 'series' && seriesSize > 1 ? 'these dates' : 'this date'}. Applications, attendance, and votes are preserved.
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
function Calendar({ isStaff, isMobile, staff, activeCategory, calendarRef, events, fetchEvents, initialDate }) {
  // initialDate (a 'YYYY-MM-DD' string) deep-links into a specific day so a
  // CTA elsewhere on the site (e.g. /vendor-day/about) can land users on a
  // pre-selected day exactly as if they had clicked that grid cell.
  const initialDateObj = (() => {
    if (!initialDate || !/^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return null;
    return new Date(initialDate + 'T12:00:00');
  })();
  const [currentDate, setCurrentDate] = useState(initialDateObj || new Date());
  const [selectedDay, setSelectedDay] = useState(initialDateObj ? initialDateObj.getDate() : null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  // When the staff Edit button on a day-detail card opens the modal, this
  // holds the specific event to pre-load so the modal lands in edit mode
  // for that row instead of dumping users at the day-level "add" screen.
  const [editEventTarget, setEditEventTarget] = useState(null);
  // Day-detail Delete button now routes through the same confirm dialog
  // the existing-events list inside the modal uses, so series scope and
  // soft-cancel-with-email are available everywhere.
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState(null);
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
    }).filter(ev => !activeCategory || (ev.categories || []).includes(activeCategory));
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

  const handleSaveEvent = async (eventDataOrRows) => {
    // Multi-day series creation passes an array of rows (each row a single
    // day in the series). Single-event create/update still passes one object.
    const isMulti = Array.isArray(eventDataOrRows);
    // Series-wide edit: caller passed { ...eventData, _series: { sharedFields, series_id } }.
    // First update the row's per-row fields; then push shared fields to every
    // row carrying the same series_id so the camp stays in sync.
    const seriesPatch = !isMulti && eventDataOrRows._series;
    if (seriesPatch) {
      const { sharedFields, series_id } = seriesPatch;
      const eventDataCopy = { ...eventDataOrRows };
      delete eventDataCopy._series;
      const [r1, r2] = await Promise.all([
        supabase.from('events').update(eventDataCopy).eq('id', eventDataCopy.id).select(),
        supabase.from('events').update(sharedFields).eq('series_id', series_id).select(),
      ]);
      if (r1.error || r2.error) {
        console.error('[Calendar] series save failed', r1.error || r2.error);
        alert(`Could not save event: ${(r1.error || r2.error).message}`);
        return;
      }
      fetchEvents();
      return;
    }
    const op = isMulti
      ? supabase.from('events').insert(eventDataOrRows).select()
      : eventDataOrRows.id
        ? supabase.from('events').update(eventDataOrRows).eq('id', eventDataOrRows.id).select()
        : supabase.from('events').insert([eventDataOrRows]).select();
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

  // Series-aware delete. scope='one' deletes a single row (legacy); scope='series'
  // deletes every row sharing the series_id (cascade clears vendor_applications,
  // attendance, votes, media on all of them).
  const handleDeleteEvent = async (eventId, scope = 'one') => {
    let q;
    if (scope === 'series') {
      const target = events.find(e => e.id === eventId);
      if (target?.series_id) {
        q = supabase.from('events').delete().eq('series_id', target.series_id);
      } else {
        q = supabase.from('events').delete().eq('id', eventId);
      }
    } else {
      q = supabase.from('events').delete().eq('id', eventId);
    }
    const { error } = await q;
    if (error) {
      console.error('[Calendar] delete failed', error);
      alert(`Could not delete event: ${error.message}`);
      return;
    }
    fetchEvents();
  };

  // Soft-cancel: marks events.cancelled=true and fires email to applicants.
  // Preserves all related data (applications, attendance, votes, media).
  // scope='series' cancels every row in the series and fires a notification
  // for each so applicants on each individual day get the heads-up.
  const handleCancelEvent = async (eventId, reason, scope = 'one') => {
    const target = events.find(e => e.id === eventId);
    const isSeries = scope === 'series' && target?.series_id;
    const filterCol = isSeries ? 'series_id' : 'id';
    const filterVal = isSeries ? target.series_id : eventId;
    const { error } = await supabase
      .from('events')
      .update({
        cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      })
      .eq(filterCol, filterVal);
    if (error) {
      alert(`Could not cancel event: ${error.message}`);
      return;
    }
    if (isSeries) {
      const seriesEvents = events.filter(e => e.series_id === target.series_id);
      for (const ev of seriesEvents) {
        sendVendorEmail({ type: 'event_cancelled', event_id: ev.id, reason: reason || null });
      }
    } else {
      sendVendorEmail({ type: 'event_cancelled', event_id: eventId, reason: reason || null });
    }
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

    // Get unique category colors for dots. When a filter is active, only
    // surface dots from that category — that's the whole point of a filter,
    // otherwise a Tournament-filtered Friday still shows the Trade Night
    // dot from a dual-tagged event.
    const dotColors = [...new Set(
      dayEvents.flatMap(e => (e.categories || [])
        .filter(c => !activeCategory || c === activeCategory)
        .map(c => CATEGORIES[c]?.color || '#ea580c')
      )
    )];

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
  // Map series_id → total days in that series, so day-detail cards can
  // render "Day X of Y" for multi-day events.
  const seriesSizes = events.reduce((acc, ev) => {
    if (ev.series_id) acc[ev.series_id] = (acc[ev.series_id] || 0) + 1;
    return acc;
  }, {});

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
                  // When a filter is active and this event carries it, color the
                  // card with the filter's color so dual-tagged events read as
                  // whichever lens the user picked. Falls back to first category
                  // when no filter is active.
                  const cats = event.categories || [];
                  const primaryCat = (activeCategory && cats.includes(activeCategory))
                    ? activeCategory
                    : cats[0];
                  const catColor = CATEGORIES[primaryCat]?.color || '#ea580c';
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
                        {event.series_id && seriesSizes[event.series_id] > 1 && event.series_position && (
                          <span style={{
                            fontSize: '0.6rem', fontWeight: '800', color: '#1a1a1a',
                            backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
                            padding: '2px 8px', borderRadius: '4px',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            Day {event.series_position} of {seriesSizes[event.series_id]}
                          </span>
                        )}
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
                      {event.description && !isRichTextEmpty(event.description) && (
                        <div
                          className="event-md"
                          style={{ fontSize: '0.8rem', color: '#666', marginTop: '6px', lineHeight: '1.4' }}
                          dangerouslySetInnerHTML={{ __html: sanitizeRichText(event.description) }}
                        />
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
                            setEditEventTarget(event);
                            setModalDate(new Date(year, month, selectedDay));
                            setShowEventModal(true);
                          }} style={{
                            background: '#f0f0f0', border: 'none', borderRadius: '6px',
                            padding: '5px 12px', fontSize: '0.7rem', fontWeight: '600',
                            cursor: 'pointer', color: '#333'
                          }}>Edit</button>
                          <button onClick={() => setConfirmDeleteEvent(event)} style={{
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
          seriesSizes={seriesSizes}
          initialEdit={editEventTarget}
          onClose={() => { setShowEventModal(false); setEditEventTarget(null); }}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onCancelEvent={handleCancelEvent}
          isMobile={isMobile}
          staff={staff}
        />
      )}
      {/* Day-detail Delete button funnels through the same confirm dialog
          so series scope and soft-cancel-with-email apply everywhere. */}
      {confirmDeleteEvent && (
        <DeleteEventConfirmModal
          event={confirmDeleteEvent}
          seriesSize={confirmDeleteEvent.series_id ? (seriesSizes[confirmDeleteEvent.series_id] || 1) : 1}
          onClose={() => setConfirmDeleteEvent(null)}
          onCancelWithEmail={async (reason, scope) => {
            await handleCancelEvent(confirmDeleteEvent.id, reason, scope);
            setConfirmDeleteEvent(null);
          }}
          onPermanentDelete={async (scope) => {
            await handleDeleteEvent(confirmDeleteEvent.id, scope);
            setConfirmDeleteEvent(null);
          }}
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
      <div className="modal-safe-bottom smooth-scroll" style={{...modalCardStyle, maxHeight: "calc(100vh - 40px)", overflowY: "auto"}} onClick={e => e.stopPropagation()}>
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
// Reads the calendar live and renders today's actual lineup as category
// pills (Trade Night, Tournament, etc.). Open-state shows closing time +
// today's pills (or a generic "come hang out" if today is empty). Closed-
// state respects Monday-closed + special-hour block dates and falls forward
// to the next open day with events.
function OpenNowBanner({ isMobile }) {
  const { siteSettings, specialHours } = useSite();
  const [events, setEvents] = useState([]);
  useEffect(() => {
    supabase.from('events').select('*').then(({ data }) => setEvents(data || []));
  }, []);

  if (!siteSettings) return null;

  const hoursMap = siteSettings.hours || {};
  const { isOpen, effectiveRange } = computeOpenNowState(siteSettings, specialHours);
  const today = new Date();
  const todayDow = today.getDay();
  const todayStr = todayISO();
  const todaySpecial = specialHoursForDate(specialHours, todayStr);
  const todayClosed = todaySpecial?.closed === true || (!hoursMap[todayDow] && !todaySpecial);

  // Compute the events firing on a given date (one-off + recurring).
  const eventsOnDate = (date) => {
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return events.filter(ev => {
      if (ev.cancelled) return false;
      if (ev.event_date === iso) return true;
      if (ev.recurrence === 'none') return false;
      const evDate = new Date(ev.event_date + 'T00:00:00');
      if (date < evDate) return false;
      if (ev.recurrence_end_date && date > new Date(ev.recurrence_end_date + 'T00:00:00')) return false;
      const diffDays = Math.floor((date - evDate) / 86400000);
      if (ev.recurrence === 'weekly') return diffDays % 7 === 0;
      if (ev.recurrence === 'biweekly') return diffDays % 14 === 0;
      if (ev.recurrence === 'monthly') return evDate.getDate() === date.getDate();
      return false;
    });
  };

  // Unique category keys across a list of events, ordered by their position
  // in the CATEGORIES dict so the visual reads consistently.
  const uniqueCategoryKeys = (evList) => {
    const seen = new Set();
    evList.forEach(ev => (ev.categories || []).forEach(c => seen.add(c)));
    return Object.keys(CATEGORIES).filter(k => seen.has(k));
  };

  const todayEvents = eventsOnDate(today);
  const todayCats = uniqueCategoryKeys(todayEvents);

  // Look forward to the next OPEN day (skipping Mondays, block dates).
  // Only used when today is fully done — either Monday/block or after close.
  let futureDayLabel = '';
  let futureEvents = [];
  for (let offset = 1; offset <= 14; offset++) {
    const d = new Date(today.getTime() + offset * 86400000);
    const dDow = d.getDay();
    const dISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dSpecial = specialHoursForDate(specialHours, dISO);
    if (dSpecial?.closed) continue;
    if (!hoursMap[dDow] && !dSpecial) continue;
    const evs = eventsOnDate(d);
    futureDayLabel = offset === 1 ? 'Tomorrow' : DAY_LABELS[dDow];
    futureEvents = evs;
    break;
  }
  const futureCats = uniqueCategoryKeys(futureEvents);

  // Render a row of category pills.
  const CatPills = ({ keys, dark }) => (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      {keys.map(k => {
        const cat = CATEGORIES[k];
        if (!cat) return null;
        return (
          <span key={k} style={{
            fontSize: '0.7rem', fontWeight: '800',
            color: dark ? '#fff' : cat.color,
            backgroundColor: dark ? `${cat.color}40` : `${cat.color}1a`,
            border: `1px solid ${dark ? `${cat.color}80` : `${cat.color}33`}`,
            padding: '3px 9px', borderRadius: '999px',
            letterSpacing: '0.02em',
          }}>{cat.label}</span>
        );
      })}
    </div>
  );

  const formatHr = (h) => {
    if (h == null) return '';
    const whole = Math.floor(h);
    const min = Math.round((h - whole) * 60);
    const ampm = whole >= 12 ? 'PM' : 'AM';
    const h12 = whole === 0 ? 12 : whole > 12 ? whole - 12 : whole;
    return min === 0 ? `${h12} ${ampm}` : `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
  };

  // ─── OPEN ────────────────────────────────────────────────
  if (isOpen) {
    return (
      <Link to="/calendar" style={{ textDecoration: 'none' }}>
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '12px',
          padding: '14px 20px',
          margin: isMobile ? '24px 16px 32px' : '40px auto 48px',
          maxWidth: '1100px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
              <span style={{ fontSize: '0.9rem', fontWeight: '800', color: '#166534' }}>
                We're open
              </span>
              {effectiveRange && (
                <span style={{ fontSize: '0.78rem', color: '#15803d' }}>
                  until {formatHr(effectiveRange[1])}
                </span>
              )}
            </div>
            {todayCats.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#15803d' }}>Today:</span>
                <CatPills keys={todayCats} />
              </div>
            ) : (
              <span style={{ fontSize: '0.78rem', color: '#15803d' }}>
                Come hang out at the shop today
              </span>
            )}
          </div>
          <span style={{ fontSize: '1.1rem', color: '#22c55e', fontWeight: '700', flexShrink: 0 }}>&#8250;</span>
        </div>
      </Link>
    );
  }

  // ─── CLOSED ──────────────────────────────────────────────
  // Decide which day's lineup to surface — never look ahead past today
  // unless today is genuinely done (Monday/block) or shop already closed.
  //   1. Today is fully closed (Monday or special-closed) → tomorrow
  //   2. Opens later today (early AM) → today
  //   3. After-hours of an open day → tomorrow
  const opensLaterToday = !todayClosed && effectiveRange && (today.getHours() + today.getMinutes() / 60) < effectiveRange[0];
  const headline = todayClosed
    ? 'Closed today'
    : opensLaterToday
      ? `Opens at ${formatHr(effectiveRange[0])}`
      : 'Closed for the night';

  // Pills surface today's events when shop will still open today, otherwise
  // the next open day's events. Single row, no "Up next + Today" stack.
  const showFuture = todayClosed || !opensLaterToday;
  const dayLabel = showFuture ? futureDayLabel : 'Today';
  const dayCats = showFuture ? futureCats : todayCats;
  const fallbackCopy = showFuture ? "shop's open" : "come hang out at the shop";

  return (
    <Link to="/calendar" style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
        borderRadius: '16px',
        padding: isMobile ? '18px 18px' : '22px 28px',
        margin: isMobile ? '24px 16px 32px' : '40px auto 48px',
        maxWidth: '1100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        gap: '14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
            <span style={{ fontSize: '0.78rem', fontWeight: '800', color: '#fbbfbf', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {headline}
            </span>
          </div>
          {dayLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#fff' }}>{dayLabel}:</span>
              {dayCats.length > 0 ? (
                <CatPills keys={dayCats} dark />
              ) : (
                <span style={{ fontSize: '0.78rem', color: '#bbb', fontStyle: 'italic' }}>{fallbackCopy}</span>
              )}
            </div>
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

// ─── Site-wide event preview hook ──────────────────────────────────
// Polls site_settings every 30s for an active preview. 30-min auto-expire
// enforced server-side. When active, the home takeover shows for ALL
// visitors and /checkin bypasses the token check.
function useActivePreview() {
  const [preview, setPreview] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    async function fetchPreview() {
      const { data } = await supabase.rpc('active_event_preview');
      if (cancelled) return;
      setPreview((data && data[0]) || null);
    }
    fetchPreview();
    const interval = setInterval(fetchPreview, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  return preview;
}

// ─── Today's event lookup ──────────────────────────────────────────
// Returns the first non-cancelled has_vendors=true event whose event_date
// matches today, or null. Used by HomePage to swap the brand hero for the
// LIVE-NOW takeover. The ?preview=tradenight URL flag and the site-wide
// preview both force the takeover regardless of today's date.
function useTodayEvent({ forcePreview, previewEvent }) {
  const [event, setEvent] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Site-wide preview wins
      if (previewEvent) {
        setEvent({
          id: previewEvent.event_id,
          title: previewEvent.title,
          event_date: previewEvent.event_date,
          start_time: previewEvent.start_time,
          end_time: previewEvent.end_time,
          cancelled: false,
        });
        setLoading(false);
        return;
      }
      const today = todayISO();
      const query = supabase
        .from('events')
        .select('id, title, event_date, cancelled, start_time, end_time')
        .eq('has_vendors', true)
        .order('event_date', { ascending: true })
        .limit(1);
      const { data } = forcePreview
        ? await query.gte('event_date', today)
        : await query.eq('event_date', today);
      if (cancelled) return;
      const ev = (data || []).find(e => !e.cancelled);
      setEvent(ev || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [forcePreview, previewEvent?.event_id]);

  return { event, loading };
}

// ─── App-level wrapper: pulls the preview state + wires the stop handler
function GlobalPreviewBanner({ isAdmin }) {
  const preview = useActivePreview();
  const [stopping, setStopping] = React.useState(false);
  async function onStop() {
    setStopping(true);
    await supabase.rpc('stop_event_preview');
    // Force a refresh so the banner disappears immediately
    window.location.reload();
  }
  if (!preview) return null;
  return <PreviewModeBanner preview={preview} isAdmin={isAdmin} onStop={onStop} stopping={stopping} />;
}

// ─── Preview maintenance banner — shown to everyone when global preview active
function PreviewModeBanner({ preview, isAdmin, onStop, stopping }) {
  if (!preview) return null;
  const minsLeft = Math.max(0, Math.round(
    (new Date(preview.expires_at).getTime() - Date.now()) / 60000
  ));
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 1000,
      background: '#fbbf24', color: '#1a1a1a',
      padding: '8px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px',
      fontSize: '13px', fontWeight: 700,
      borderBottom: '2px solid #d97706',
      flexWrap: 'wrap',
    }}>
      <div>
        <span style={{ fontSize: '15px' }}>🧪</span>{' '}
        <strong>Trade Night experience test in progress.</strong>{' '}
        <span style={{ fontWeight: 500 }}>
          The site looks different than usual. Real next event coming soon.
        </span>
      </div>
      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, opacity: 0.8 }}>
            Auto-exits in {minsLeft} min
          </span>
          <button
            onClick={onStop}
            style={{
              background: '#1a1a1a', color: '#fff',
              border: 'none', borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '12px', fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >Exit preview</button>
        </div>
      )}
    </div>
  );
}

// ─── Address modal — opens from "Come down now" CTA ─────────────────
function AddressModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '18px', maxWidth: '380px', width: '100%',
          padding: '26px 24px', position: 'relative',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '12px', right: '14px', background: 'transparent', border: 'none', fontSize: '22px', color: '#888', cursor: 'pointer', lineHeight: 1 }}
        >×</button>
        <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#C8102E', marginBottom: '8px' }}>
          We're open right now
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 900, letterSpacing: '-0.01em' }}>
          Come on down.
        </h3>
        <p style={{ fontSize: '16px', color: '#525252', lineHeight: 1.5, margin: '0 0 18px' }}>
          <strong style={{ color: '#1a1a1a' }}>4911 Warner Ave #210</strong><br />
          Huntington Beach, CA 92647
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <a
            href="https://maps.apple.com/?q=4911+Warner+Ave+%23210,+Huntington+Beach,+CA+92647"
            target="_blank" rel="noopener noreferrer"
            style={{ background: '#C8102E', color: '#fff', textDecoration: 'none', textAlign: 'center', padding: '12px 10px', borderRadius: '10px', fontSize: '13px', fontWeight: 800 }}
          >Apple Maps</a>
          <a
            href="https://www.google.com/maps/dir/?api=1&destination=4911+Warner+Ave+%23210,+Huntington+Beach,+CA+92647"
            target="_blank" rel="noopener noreferrer"
            style={{ background: '#f3f4f6', color: '#1a1a1a', textDecoration: 'none', textAlign: 'center', padding: '12px 10px', borderRadius: '10px', fontSize: '13px', fontWeight: 800 }}
          >Google Maps</a>
        </div>
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#888', textAlign: 'center' }}>
          Free for guests
        </div>
      </div>
    </div>
  );
}

// ─── Event-day takeover hero ────────────────────────────────────────
// Replaces the brand hero on event days. Bold red/pink gradient with
// pokeball-ring motif. "Come down now" opens AddressModal; "More info on
// IG" jumps to @trainercenter.pokemon.
function EventDayHero({ event, isMobile, isPreview }) {
  const [addrOpen, setAddrOpen] = React.useState(false);
  const dateStr = React.useMemo(() => {
    const d = new Date(event.event_date + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  }, [event.event_date]);
  const title = event.title || 'Trade Night';
  const titleParts = title.toUpperCase().split(' ');
  // For 2-3-word titles, stack last word on its own line for impact.
  const stackTop = titleParts.slice(0, -1).join(' ');
  const stackBottom = titleParts.slice(-1).join(' ');

  return (
    <>
      {isPreview && (
        <div style={{
          background: '#fbbf24', color: '#1a1a1a',
          padding: '6px 12px', textAlign: 'center',
          fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          🧪 Preview Mode · Not Live
        </div>
      )}
      <header style={{
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
        padding: isMobile ? '24px 22px 32px' : '56px 56px 64px',
        background:
          'radial-gradient(ellipse at top right, rgba(200,16,46,0.92), transparent 55%),' +
          'radial-gradient(ellipse at bottom left, rgba(255,26,140,0.85), transparent 60%),' +
          'linear-gradient(135deg, #1a1a1a 0%, #2a0a0a 40%, #C8102E 100%)',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: isMobile ? 0 : '40px',
      }}>
        {/* Decorative pokeball-ring corner motif */}
        <div style={{
          position: 'absolute', top: '-60px', right: '-60px',
          width: '280px', height: '280px', borderRadius: '50%',
          background: 'radial-gradient(circle, transparent 35%, rgba(255,255,255,0.18) 36%, rgba(255,255,255,0.22) 38%, transparent 40%)',
          pointerEvents: 'none',
        }} />

        <div style={{ flex: 1, maxWidth: isMobile ? '100%' : '640px', position: 'relative' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(255,255,255,0.18)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: '#fff',
            padding: '6px 14px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 800,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{
              width: '7px', height: '7px', borderRadius: '50%',
              background: '#fff',
              animation: 'pulseDot 1.5s ease-in-out infinite',
              boxShadow: '0 0 8px #fff',
            }} />
            LIVE NOW · {dateStr}
          </div>

          <h1 style={{
            fontWeight: 900,
            letterSpacing: '-0.02em',
            lineHeight: 0.98,
            margin: '14px 0 12px',
            color: '#fff',
            fontSize: isMobile ? '36px' : '64px',
          }}>
            <span style={{ display: 'block' }}>{stackTop || stackBottom}</span>
            {stackTop && (
              <span style={{
                display: 'block',
                color: '#ffd13f',
                textShadow: '0 2px 16px rgba(0,0,0,0.3)',
              }}>{stackBottom}</span>
            )}
          </h1>

          <div style={{
            fontSize: isMobile ? '14px' : '16px',
            color: 'rgba(255,255,255,0.95)',
            lineHeight: 1.5,
            marginBottom: '16px',
          }}>
            <strong style={{ color: '#fff' }}>
              {event.start_time && event.end_time ? `${event.start_time.slice(0,5)} - ${event.end_time.slice(0,5)}` : 'Open now'}
            </strong>
            {' · 4911 Warner Ave #210, HB'}
            <br />
            Free for guests. Vintage, modern, slabs &amp; sealed.
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setAddrOpen(true)}
              style={{
                background: '#fff', color: '#C8102E',
                border: 'none', borderRadius: '12px',
                padding: '14px 22px',
                fontSize: '14px', fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
              }}
            >Come down now →</button>
            <a
              href="https://www.instagram.com/trainercenter.pokemon/"
              target="_blank" rel="noopener noreferrer"
              style={{
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                border: '1.5px solid rgba(255,255,255,0.6)', borderRadius: '12px',
                padding: '14px 22px',
                fontSize: '14px', fontWeight: 800,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >More info on IG</a>
          </div>
        </div>

        {!isMobile && (
          <div style={{
            flex: '0 0 340px',
            background: 'rgba(255,255,255,0.97)',
            color: '#1a1a1a',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            position: 'relative',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#FF1A8C', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Happening right now
            </div>
            <h3 style={{ fontSize: '22px', fontWeight: 900, margin: '0 0 10px', letterSpacing: '-0.01em' }}>
              {title}.
            </h3>
            <p style={{ fontSize: '14px', color: '#525252', lineHeight: 1.5, margin: '0 0 14px' }}>
              <strong style={{ color: '#1a1a1a' }}>Open until {event.end_time ? event.end_time.slice(0,5) : '10:00 PM'} tonight.</strong>{' '}
              Free for guests. Vintage, modern, slabs &amp; sealed all under one roof.
            </p>
            <button
              onClick={() => setAddrOpen(true)}
              style={{
                width: '100%', justifyContent: 'center',
                background: '#C8102E', color: '#fff',
                border: 'none', borderRadius: '12px',
                padding: '14px 22px',
                fontSize: '14px', fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                marginBottom: '8px',
                boxShadow: '0 8px 20px rgba(200,16,46,0.3)',
              }}
            >Come down now →</button>
            <a
              href="https://www.instagram.com/trainercenter.pokemon/"
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#C8102E', textDecoration: 'none' }}
            >More info on IG →</a>
            <div style={{ fontSize: '13px', color: '#525252', borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px' }}>
              <strong style={{ color: '#1a1a1a', display: 'block' }}>4911 Warner Ave #210</strong>
              Huntington Beach, CA
            </div>
          </div>
        )}
      </header>

      <AddressModal open={addrOpen} onClose={() => setAddrOpen(false)} />

      <style>{`@keyframes pulseDot { 50% { opacity: 0.4; } }`}</style>
    </>
  );
}

function HomePage({ isMobile }) {
  const [searchParams] = useSearchParams();
  const isLocalPreview = searchParams.get('preview') === 'tradenight';
  const activePreview = useActivePreview();
  const { event: todayEvent, loading: eventLoading } = useTodayEvent({
    forcePreview: isLocalPreview,
    previewEvent: activePreview,
  });
  const isPreview = isLocalPreview || !!activePreview;
  const showTakeover = !eventLoading && todayEvent;

  return (
    <>
      {showTakeover ? (
        <EventDayHero event={todayEvent} isMobile={isMobile} isPreview={isPreview} />
      ) : (
      <>
      {/* Hero - Full Viewport. Class drives iOS-aware 100dvh height so the
          hero doesn't push past Safari's URL bar on first paint. */}
      <header className="hero-fullscreen" style={{
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
      </>
      )}

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
    { num: '1', title: 'We Evaluate', desc: 'Bring your cards in and we assess condition, help you decide which ones are worth grading and which grader makes sense.' },
    { num: '2', title: 'We Submit', desc: 'We handle the entire submission to PSA, CGC, Beckett, or TAG. No account needed, no shipping headaches.' },
    { num: '3', title: 'You Profit', desc: 'A graded card is worth significantly more. Grading protects and increases your collection value.' },
  ];

  // Companies we send to. Each gets a tab in the "Where do you send them?"
  // section. Pricing links go to the company's own site so we never have
  // to chase their fee schedule when they update it.
  const GRADERS = [
    {
      key: 'PSA',
      name: 'PSA',
      fullName: 'Professional Sports Authenticator',
      blurb: 'The most recognized grader in the Pokemon market. PSA-graded cards command premium resale prices and are the default choice for high-end English vintage and modern chase cards. Strict on centering and surface, which is why a PSA 10 is the gold standard.',
      bestFor: 'High-end Pokemon, vintage holos, modern alt arts where resale matters most.',
      pricingUrl: 'https://www.psacard.com',
      pricingLabel: 'View PSA pricing on psacard.com',
    },
    {
      key: 'CGC',
      name: 'CGC',
      fullName: 'Certified Guaranty Company',
      blurb: 'Trusted grader with transparent sub-grades on every label and a popular slab design. Faster turnaround than PSA in most tiers and a strong following among modern collectors. Their Perfect 10 grade is harder to earn but valued.',
      bestFor: 'Collectors who want detailed sub-grades and a clean modern slab look.',
      pricingUrl: 'https://www.cgccards.com',
      pricingLabel: 'View CGC pricing on cgccards.com',
    },
    {
      key: 'Beckett',
      name: 'Beckett',
      fullName: 'Beckett Grading Services (BGS)',
      blurb: 'The legacy sports grader with deep credibility and the iconic gold and black labels. Beckett shows sub-grades on every slab and the Black Label (a 10 across all four sub-grades) is one of the rarest grades in the hobby.',
      bestFor: 'Cards expected to grade pristine where a Black Label premium matters.',
      pricingUrl: 'https://www.beckett.com',
      pricingLabel: 'View Beckett pricing on beckett.com',
    },
    {
      key: 'TAG',
      name: 'TAG',
      fullName: 'Technical Authentication & Grading',
      blurb: 'AI-powered grading with full HD scans and the most granular sub-grade reports in the industry. Newest of the four, fastest-growing, and the digital report on every graded card is a strong differentiator for modern collectors.',
      bestFor: 'Collectors who want the most detailed condition data on every card.',
      pricingUrl: 'https://taggrading.com',
      pricingLabel: 'View TAG pricing on taggrading.com',
    },
  ];
  const [activeGrader, setActiveGrader] = useState('PSA');
  const grader = GRADERS.find(g => g.key === activeGrader) || GRADERS[0];

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Grading" subtitle="PSA · CGC · Beckett · TAG" />

        {/* YES hero */}
        <div style={{
          backgroundColor: '#1a1a1a',
          borderRadius: '16px',
          padding: isMobile ? '32px 20px' : '48px 40px',
          textAlign: 'center',
          marginBottom: '24px',
          maxWidth: '900px',
          margin: '0 auto 24px'
        }}>
          <p style={{ fontSize: isMobile ? '0.9rem' : '1.1rem', color: '#999', fontWeight: '600', margin: '0 0 8px 0' }}>
            Do you guys help grade cards?
          </p>
          <h2 style={{ fontSize: isMobile ? '3rem' : '4.5rem', fontWeight: '900', color: '#C8102E', margin: '0 0 12px 0', letterSpacing: '-0.03em' }}>
            YES
          </h2>
          <p style={{ fontSize: isMobile ? '0.85rem' : '1rem', color: '#ccc', margin: 0, maxWidth: '560px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.6' }}>
            We evaluate your cards, submit to PSA, CGC, Beckett, or TAG, and get them back to you graded and protected.
          </p>
        </div>

        {/* Service charge banner — top of page so the per-card fee is visible
            before anyone reads through the rest. Plain language, framed as a
            cost-coverage line not a markup. */}
        <div style={{
          backgroundColor: '#fff7ed',
          border: '1px solid #fed7aa',
          borderRadius: '14px',
          padding: isMobile ? '18px 20px' : '22px 28px',
          maxWidth: '900px',
          margin: '0 auto 32px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '14px',
        }}>
          <div style={{
            flexShrink: 0,
            width: '40px', height: '40px', borderRadius: '10px',
            backgroundColor: '#fed7aa', color: '#9a3412',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem', fontWeight: '900',
          }}>
            $
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.78rem', fontWeight: '800', color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px 0' }}>
              Submission service fee
            </p>
            <p style={{ fontSize: '0.95rem', color: '#7c2d12', margin: '0 0 6px 0', lineHeight: '1.55', fontWeight: '700' }}>
              $3 to $5 per card on top of the grader's fee.
            </p>
            <p style={{ fontSize: '0.85rem', color: '#9a3412', margin: 0, lineHeight: '1.6' }}>
              The exact rate depends on how many cards you send in a single shipment. This covers packaging, insured tracked shipping both ways, and the time we spend prepping the order. It's a cost-coverage charge, not a markup on the grader's pricing.
            </p>
          </div>
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

        {/* Where do you send them? — tabbed view of every grader we submit to.
            Pricing always lives on the grader's own site so we never have to
            chase their fee schedule when they update it. */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '40px',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              backgroundColor: '#fff0f0', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Award size={24} color="#C8102E" />
            </div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>
              Where do you send them?
            </h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
            We submit to all four major Pokemon graders. Pick a tab to see what each one is best for, then jump to their site for current pricing.
          </p>

          {/* Tab strip */}
          <div role="tablist" style={{
            display: 'flex',
            gap: '6px',
            padding: '4px',
            backgroundColor: '#f3f4f6',
            borderRadius: '12px',
            marginBottom: '20px',
            overflowX: 'auto',
          }}>
            {GRADERS.map(g => {
              const active = g.key === activeGrader;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveGrader(g.key)}
                  style={{
                    flex: 1,
                    minWidth: '80px',
                    background: active ? '#1a1a1a' : 'transparent',
                    border: '1px solid transparent',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    color: active ? '#fff' : '#444',
                    fontSize: '0.95rem',
                    fontWeight: '800',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background-color 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {g.name}
                </button>
              );
            })}
          </div>

          {/* Active grader panel */}
          <div role="tabpanel" style={{
            backgroundColor: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: '12px',
            padding: isMobile ? '18px' : '24px 28px',
          }}>
            <p style={{ fontSize: '0.7rem', fontWeight: '800', color: '#C8102E', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px 0' }}>
              {grader.fullName}
            </p>
            <h4 style={{ fontSize: '1.4rem', fontWeight: '900', color: '#1a1a1a', margin: '0 0 12px 0' }}>
              {grader.name}
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#333', lineHeight: '1.65', margin: '0 0 12px 0' }}>
              {grader.blurb}
            </p>
            <p style={{ fontSize: '0.85rem', color: '#555', lineHeight: '1.55', margin: '0 0 18px 0' }}>
              <strong style={{ color: '#1a1a1a' }}>Best for:</strong> {grader.bestFor}
            </p>
            <a
              href={grader.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#1a1a1a',
                color: '#fff',
                padding: '12px 20px',
                borderRadius: '10px',
                textDecoration: 'none',
                fontSize: '0.9rem',
                fontWeight: '700',
              }}
            >
              {grader.pricingLabel} <ArrowRight size={16} />
            </a>
            <p style={{ fontSize: '0.78rem', color: '#888', lineHeight: '1.55', margin: '14px 0 0 0' }}>
              We link directly to {grader.name}'s site because graders update tiers, turnaround estimates, and fees regularly. Their pricing page is always the current source of truth.
            </p>
          </div>
        </div>

        {/* Card-handling disclaimer — sets expectations both for what we
            cover (in-shop tracking, prep, insured shipping) and what we
            cannot (carrier handling, grader processing). */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eee',
          padding: isMobile ? '24px 16px' : '36px 40px',
          maxWidth: '900px',
          margin: '32px auto 0',
        }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 8px 0' }}>
            How we handle your cards
          </h3>
          <p style={{ fontSize: '0.95rem', color: '#444', lineHeight: '1.7', margin: '0 0 14px 0' }}>
            From the moment you drop your cards off to the moment we hand them back, Trainer Center tracks every card in your submission. We sleeve, semi-rigid, and pack each card in front of you at the counter, log every line on the order form, and use insured tracked shipping for both legs of the journey. We treat your cards like our own and use the most careful service available.
          </p>
          <div style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            padding: isMobile ? '16px 18px' : '18px 22px',
            marginTop: '6px',
          }}>
            <p style={{ fontSize: '0.78rem', fontWeight: '800', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px 0' }}>
              Once a package leaves Trainer Center
            </p>
            <p style={{ fontSize: '0.92rem', color: '#7f1d1d', lineHeight: '1.65', margin: 0 }}>
              Once your submission ships out, your cards are no longer in our possession. That includes both the time the package is in transit with the carrier and the time it spends at the grading company. We pick reputable carriers and graders, but the in-transit and at-grader phases are theirs to manage. We pass along every tracking and milestone update we receive.
            </p>
          </div>
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
            The honest answer is: not most of them. Grading a card costs from the bulk tier on any of the four graders up through several hundred dollars on express, and those fees do not include shipping or the time the card spends out of your hands. If the raw ungraded card is worth ten dollars, a 9 might bring it to twenty-five and a 10 to seventy. That math works on a few cards. It does not work on a binder full of bulk.
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
            All four graders score on a 1 to 10 scale and look at the same four things: centering, corners, edges, and surface. Your final grade is capped by the weakest of those four. A perfect surface cannot save a card with off-center borders, and sharp corners cannot save a card with a print line on the holo. Here is a plain-English breakdown of where each grade lands — the labels below use PSA's terms, but CGC, Beckett, and TAG land in the same neighborhood at each tier.
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
              q: 'Do I need an account with the grader to submit through you?',
              a: 'No. We submit on our shop accounts at PSA, CGC, Beckett, and TAG, so you skip the signup, the bulk requirements, the shipping supplies, and the hassle of insuring your own package. You hand the cards to us over the counter, we track everything, and you get them back graded and encapsulated.'
            },
            {
              q: 'How do I pick which grader to use?',
              a: 'For most high-value English Pokemon cards, PSA is still the resale gold standard. CGC is great when you want detailed sub-grades and faster turnaround. Beckett is the right call for cards expected to grade pristine where the Black Label premium matters. TAG is best when you want the deepest condition data and full HD scans of every card. We walk you through the right pick during the in-store evaluation.'
            },
            {
              q: 'How long does the whole process take?',
              a: 'It depends on the grader and the tier. Bulk tiers across all four can run 60 to 90+ business days. Mid tiers usually land in the 20 to 45 day range. Express tiers come back in 5 to 15. Every grader publishes current turnaround on their own site, and we pass along milestone updates as we get them.'
            },
            {
              q: 'Can I watch you sleeve and package the submission?',
              a: 'Yes. We prep every submission in front of you at the counter if you want. Each card gets a penny sleeve, a semi-rigid holder, and its own line on the order form. Nothing gets mixed up and you see exactly what goes in the box.'
            },
            {
              q: 'What if the card comes back a lower grade than expected?',
              a: 'We tell you what we think before we submit. If we say we think a card is borderline 9, we will tell you honestly. Graders score strictly and small flaws matter. The only way to guarantee a grade is to never submit, so we only recommend sending in cards where we believe the expected grade outweighs the fee.'
            },
            {
              q: 'Can you grade Japanese Pokemon cards?',
              a: 'Yes. PSA, CGC, Beckett, and TAG all grade Japanese cards on the same scale as English. Japanese vintage and modern alt arts are a growing segment of the hobby, and we submit them regularly. Bring them in and we will evaluate them the same way.'
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

// ─── Calendar Reminder Banner ───────────────────────────
// CTA pinned to the top of the calendar that opens the reminder signup
// modal. The banner itself stays visible forever — users may want to
// circle back to it later — but the wiggle animation stops after the
// first interaction (either clicking through to the modal or hitting
// the calm-down X). The localStorage flag persists that calmed state
// per device.
const REMINDER_BANNER_FLAG = 'tc_reminders_banner_seen';
function CalendarReminderBanner({ isMobile }) {
  const [calmed, setCalmed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(REMINDER_BANNER_FLAG) === '1'; }
    catch { return false; }
  });
  const [showModal, setShowModal] = useState(false);

  const calmDown = () => {
    if (calmed) return;
    try { localStorage.setItem(REMINDER_BANNER_FLAG, '1'); } catch { /* private mode */ }
    setCalmed(true);
  };

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '8px',
        marginBottom: '20px',
      }}>
        <button
          type="button"
          className={calmed ? '' : 'tc-pulse'}
          onClick={() => { calmDown(); setShowModal(true); }}
          style={{
            flex: 1,
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2a0a0a 50%, #C8102E 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '14px',
            padding: isMobile ? '14px 16px' : '16px 22px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: isMobile ? '0.92rem' : '1rem',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 8px 28px rgba(200,16,46,0.25)',
            textAlign: 'left',
          }}
        >
          <div style={{
            flexShrink: 0,
            width: '38px', height: '38px', borderRadius: '10px',
            backgroundColor: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bell size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85, marginBottom: '2px' }}>
              Trainer Center reminders
            </div>
            <div style={{ lineHeight: 1.25 }}>
              Want to be reminded of these events?
            </div>
          </div>
          <ArrowRight size={18} style={{ flexShrink: 0 }} />
        </button>
        {!calmed && (
          <button
            type="button"
            onClick={calmDown}
            aria-label="Stop the wiggle"
            title="Stop the wiggle"
            style={{
              flexShrink: 0,
              width: '38px',
              background: '#f3f4f6',
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              cursor: 'pointer',
              color: '#666',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {showModal && (
        <ReminderSignupModal
          isMobile={isMobile}
          onClose={() => setShowModal(false)}
          onComplete={() => { /* flag already set when user opened the modal */ }}
        />
      )}
    </>
  );
}

// ─── Reminders Page ─────────────────────────────────────
// Dedicated /reminders landing page that walks visitors through what TC
// membership is and why to sign up. The CTA opens the same
// ReminderSignupModal the calendar wiggle uses, so the actual signup
// surface is never duplicated.
function RemindersPage({ isMobile }) {
  const { user, reminderSubs, hasReminders, refreshReminders } = useAuth();
  const [showModal, setShowModal] = useState(false);

  // ─── Manage existing prefs (logged-in returning visitors) ──
  // Local copy of the picks so the user can toggle without writing on every
  // click. Resets whenever the upstream subs change (e.g. after a successful
  // save the parent context refresh fires and resync occurs here).
  const buildPrefsFromSubs = (subs) => {
    const next = new Set();
    REMINDER_CATEGORY_KEYS.forEach(key => {
      if (subs && subs[key]) next.add(key);
    });
    return next;
  };
  const [editPrefs, setEditPrefs] = useState(() => buildPrefsFromSubs(reminderSubs));
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsSavedAt, setPrefsSavedAt] = useState(0);
  // Resync when the upstream subs change (login, refresh, save complete).
  useEffect(() => {
    setEditPrefs(buildPrefsFromSubs(reminderSubs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderSubs]);

  const togglePref = (key) => {
    setEditPrefs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const dirty = (() => {
    const current = buildPrefsFromSubs(reminderSubs);
    if (current.size !== editPrefs.size) return true;
    for (const k of editPrefs) if (!current.has(k)) return true;
    return false;
  })();
  const savePrefs = async () => {
    setSavingPrefs(true);
    setPrefsError('');
    const subs = REMINDER_CATEGORY_KEYS.reduce((acc, key) => {
      acc[key] = editPrefs.has(key);
      return acc;
    }, {});
    const { error } = await supabase.rpc('subscribe_to_reminders', { p_subscriptions: subs });
    setSavingPrefs(false);
    if (error) {
      setPrefsError(error.message);
      return;
    }
    setPrefsSavedAt(Date.now());
    if (refreshReminders) refreshReminders();
  };

  const benefits = [
    { title: 'Pick what you want to hear about', desc: 'Choose any combination of Trade Night, Tournament, Game Day, Crafts, TC Beach City Trade Night, and more. We only email about events on your list.' },
    { title: 'No spam, ever', desc: 'You only get a heads-up when something on your list is coming up. Every email has a one-click unsubscribe.' },
    { title: 'Update any time', desc: 'Change your reminder list whenever you want. Your account is the source of truth.' },
    { title: 'Free TC member account', desc: 'Just an email and a password. No fees, no card required, no other commitment.' },
  ];

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader
          title={hasReminders ? 'My Reminders' : 'Reminders'}
          subtitle={hasReminders ? 'Manage what you get a heads-up about' : 'Never miss a Trainer Center event'}
        />

        {/* Logged-in preferences card — shown only for users who already
            have a reminder record. Lets them toggle categories and save
            without re-running the signup flow. */}
        {user && hasReminders && (
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #eee',
            borderRadius: '16px',
            padding: isMobile ? '20px 18px' : '28px 32px',
            maxWidth: '900px',
            margin: '0 auto 28px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px',
                backgroundColor: '#fff0f0', color: '#C8102E',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bell size={20} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: '0.65rem', fontWeight: '800', color: '#C8102E', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                  Signed in as
                </p>
                <p style={{ fontSize: '0.9rem', fontWeight: '800', color: '#1a1a1a', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </p>
              </div>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6', margin: '0 0 16px 0' }}>
              Toggle the categories you want reminders for. Changes don't save until you click Save.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px', marginBottom: '16px' }}>
              {REMINDER_CATEGORY_KEYS.map(key => {
                const cat = CATEGORIES[key];
                if (!cat) return null;
                const checked = editPrefs.has(key);
                return (
                  <label key={key} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '12px 14px',
                    backgroundColor: '#fff',
                    color: checked ? '#1a1a1a' : '#888',
                    borderRadius: '10px',
                    border: `1px solid ${checked ? '#e5e7eb' : '#f0f0f0'}`,
                    borderLeft: `3px solid ${cat.color}`,
                    cursor: 'pointer',
                    fontSize: '0.9rem', fontWeight: '700',
                    userSelect: 'none',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePref(key)}
                      style={{ width: '18px', height: '18px', accentColor: cat.color, cursor: 'pointer', flexShrink: 0 }}
                    />
                    {cat.label}
                  </label>
                );
              })}
            </div>
            {prefsError && (
              <p style={{ color: '#C8102E', fontSize: '0.85rem', margin: '0 0 10px 0' }}>{prefsError}</p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={savePrefs}
                disabled={!dirty || savingPrefs}
                style={{
                  padding: '12px 22px',
                  backgroundColor: (!dirty || savingPrefs) ? '#ccc' : '#C8102E',
                  color: '#fff', border: 'none', borderRadius: '10px',
                  fontWeight: '800', fontSize: '0.9rem',
                  cursor: (!dirty || savingPrefs) ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {savingPrefs ? 'Saving...' : dirty ? 'Save changes' : 'No changes'}
              </button>
              {prefsSavedAt > 0 && !dirty && (
                <span style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: '700' }}>
                  Saved.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Hero */}
        <div style={{
          backgroundColor: '#1a1a1a',
          borderRadius: '16px',
          padding: isMobile ? '32px 22px' : '48px 40px',
          textAlign: 'center',
          marginBottom: '32px',
          maxWidth: '900px',
          margin: '0 auto 32px',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px',
            borderRadius: '14px',
            backgroundColor: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#C8102E',
            marginBottom: '18px',
          }}>
            <Bell size={28} />
          </div>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : '2.2rem',
            fontWeight: '900',
            color: '#fff',
            margin: '0 0 10px 0',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}>
            Become a TC member.<br />Never miss an event.
          </h2>
          <p style={{
            fontSize: isMobile ? '0.92rem' : '1.05rem',
            color: '#ccc',
            margin: '0 auto 24px',
            maxWidth: '560px',
            lineHeight: '1.6',
          }}>
            Trainer Center hosts Trade Nights, Tournaments, Game Days, Crafts, and Beach City Trade Nights every month. Sign up for free and we'll email you a reminder for the ones you actually care about.
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            style={{
              backgroundColor: '#C8102E',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              padding: '14px 26px',
              fontSize: '0.95rem',
              fontWeight: '800',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 8px 24px rgba(200,16,46,0.35)',
            }}
          >
            Sign me up <ArrowRight size={18} />
          </button>
        </div>

        {/* Benefits grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
          gap: '14px',
          maxWidth: '900px',
          margin: '0 auto 32px',
        }}>
          {benefits.map((b, i) => (
            <div key={i} style={{
              backgroundColor: '#fff',
              border: '1px solid #eee',
              borderRadius: '14px',
              padding: '22px 24px',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '36px', height: '36px',
                borderRadius: '10px',
                backgroundColor: '#fff0f0',
                color: '#C8102E',
                marginBottom: '12px',
              }}>
                <CheckCircle2 size={18} />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 6px 0' }}>{b.title}</h3>
              <p style={{ fontSize: '0.88rem', color: '#666', lineHeight: '1.6', margin: 0 }}>{b.desc}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div style={{
          backgroundColor: '#fff',
          border: '1px solid #eee',
          borderRadius: '16px',
          padding: isMobile ? '24px 18px' : '36px 40px',
          maxWidth: '900px',
          margin: '0 auto',
        }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 18px 0' }}>
            How it works
          </h3>
          <ol style={{ paddingLeft: '20px', margin: 0, color: '#444', lineHeight: '1.8', fontSize: '0.95rem' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#1a1a1a' }}>Click "Sign me up."</strong> Pick which event categories you want reminders for — leave the ones you don't care about unchecked.
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#1a1a1a' }}>Make a free TC account</strong> with your email and a password. That's it. No phone, no payment, no other info.
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong style={{ color: '#1a1a1a' }}>Get reminders only when you want them.</strong> We send a heads-up before events on your list. Update or unsubscribe any time from any email we send.
            </li>
          </ol>
          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              style={{
                backgroundColor: '#1a1a1a',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 26px',
                fontSize: '0.95rem',
                fontWeight: '800',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              Sign me up <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
      {showModal && (
        <ReminderSignupModal
          isMobile={isMobile}
          onClose={() => setShowModal(false)}
          onComplete={() => { /* page CTA needs no localStorage flag — visitors come here on purpose */ }}
        />
      )}
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
  // Filter must match a real CATEGORIES key. Anything else is ignored.
  const [activeFilter, setActiveFilter] = useState(
    initialFilter && CATEGORIES[initialFilter] ? initialFilter : null
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

  // When a filter or specific date was passed via the URL, smooth-scroll to
  // the calendar grid once the events are in. View Transitions on the source
  // page handles the morph; this finishes the journey by landing the user on
  // the grid (with the deep-linked day already selected).
  const initialDateParam = searchParams.get('date');
  useEffect(() => {
    if ((initialFilter || initialDateParam) && events.length > 0 && calendarRef.current) {
      const id = requestAnimationFrame(() => {
        calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [initialFilter, initialDateParam, events.length]);

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

  // Count actual occurrences of each category over the next 90 days so the
  // chip badges reflect upcoming events, not just master rows. A weekly
  // event hitting ~13 Fridays in the window counts as 13, not 1.
  // Cancelled events are skipped. Chips with 0 upcoming occurrences dim.
  const categoryCounts = (() => {
    const counts = {};
    const dayMs = 1000 * 60 * 60 * 24;
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const windowDays = 90;
    for (let i = 0; i < windowDays; i++) {
      const dateObj = new Date(today0.getTime() + i * dayMs);
      const y = dateObj.getFullYear();
      const m = dateObj.getMonth();
      const d = dateObj.getDate();
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      for (const ev of events) {
        if (ev.cancelled) continue;
        let matches = false;
        if (ev.event_date === dateStr) {
          matches = true;
        } else if (ev.recurrence !== 'none') {
          const evDate = new Date(ev.event_date + 'T00:00:00');
          if (dateObj >= evDate &&
              (!ev.recurrence_end_date || dateObj <= new Date(ev.recurrence_end_date + 'T00:00:00'))) {
            const diffDays = Math.floor((dateObj - evDate) / dayMs);
            if (ev.recurrence === 'weekly') matches = diffDays % 7 === 0;
            else if (ev.recurrence === 'biweekly') matches = diffDays % 14 === 0;
            else if (ev.recurrence === 'monthly') matches = evDate.getDate() === d;
          }
        }
        if (matches) {
          (ev.categories || []).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
        }
      }
    }
    return counts;
  })();

  // Derive special events (vendor-bearing TC Beach City Trade Nights).
  // Pull non-recurring "headline" events for the top-of-calendar callout.
  // Anything with `has_vendors=true` or tagged `tc_trade_night` qualifies,
  // sorted by soonest first so the upcoming lineup surfaces ahead of older
  // callouts.
  const specialEvents = events
    .filter(ev => !ev.cancelled && ev.recurrence === 'none' && (ev.has_vendors || (ev.categories || []).includes('tc_trade_night')))
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
        .event-title.tc_trade_night { border-left: 3px solid #7c3aed; }
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

        <CalendarReminderBanner isMobile={isMobile} />

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
            <Calendar isStaff={isAdmin} isMobile={isMobile} staff={staff} activeCategory={activeFilter} calendarRef={calendarRef} events={events} fetchEvents={fetchEvents} initialDate={searchParams.get('date')} />
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
// ─── Staff preview launcher (/staff/preview) ─────────────────────────
// Lets admins flip the whole site into event-day mode for end-to-end testing.
// Auto-expires after 30 min, but staff can also exit early via the banner.
function StaffPreviewPage({ isMobile }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const activePreview = useActivePreview();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = todayISO();
      const { data } = await supabase
        .from('events')
        .select('id, title, event_date, start_time, end_time, has_vendors, cancelled')
        .eq('has_vendors', true)
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(10);
      if (cancelled) return;
      const upcoming = (data || []).filter(e => !e.cancelled);
      setEvents(upcoming);
      if (upcoming.length > 0) setSelectedId(upcoming[0].id);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function startPreview() {
    if (!selectedId) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc('start_event_preview', { p_event_id: selectedId });
    if (err) { setError(err.message); setBusy(false); return; }
    // Hop to home so they can see the takeover
    navigate('/');
  }

  async function stopPreview() {
    setBusy(true);
    await supabase.rpc('stop_event_preview');
    window.location.reload();
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 900, margin: '0 0 8px' }}>🧪 Trade Night Preview</h1>
      <p style={{ color: '#525252', fontSize: '14px', lineHeight: 1.5, margin: '0 0 24px' }}>
        Flips the site into event-day mode for everyone (visitors see a yellow notice banner). Auto-exits after 30 min. Real check-ins and votes recorded during preview are tagged <strong>preview=true</strong> and filtered out of leaderboards.
      </p>

      {activePreview && (
        <div style={{ background: '#fef3c7', border: '1.5px solid #d97706', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#92400e', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>
            Preview is active
          </div>
          <p style={{ margin: '0 0 12px', color: '#1a1a1a' }}>
            <strong>{activePreview.title}</strong> ({activePreview.event_date})
          </p>
          <button
            onClick={stopPreview}
            disabled={busy}
            style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 800, fontSize: '13px', cursor: busy ? 'wait' : 'pointer' }}
          >Exit preview now</button>
        </div>
      )}

      <h2 style={{ fontSize: '16px', fontWeight: 800, margin: '0 0 12px' }}>Pick an event to preview</h2>
      {loading ? (
        <p style={{ color: '#888' }}>Loading upcoming events…</p>
      ) : events.length === 0 ? (
        <p style={{ color: '#888' }}>No upcoming has_vendors events to preview. Add one on the calendar first.</p>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{ width: '100%', padding: '12px', fontSize: '14px', border: '1.5px solid #e5e7eb', borderRadius: '10px', marginBottom: '16px', background: '#fff' }}
          >
            {events.map(e => (
              <option key={e.id} value={e.id}>
                {e.title} — {e.event_date} ({e.start_time?.slice(0,5)} - {e.end_time?.slice(0,5)})
              </option>
            ))}
          </select>
          {error && <p style={{ color: '#C8102E', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <button
            onClick={startPreview}
            disabled={busy || !selectedId}
            style={{
              background: busy ? '#9ca3af' : 'linear-gradient(135deg, #C8102E 0%, #FF1A8C 100%)',
              color: '#fff', border: 'none', borderRadius: '12px',
              padding: '14px 24px', fontWeight: 800, fontSize: '15px',
              cursor: busy ? 'wait' : 'pointer',
              boxShadow: busy ? 'none' : '0 8px 20px rgba(200,16,46,0.3)',
            }}
          >🧪 Start preview now</button>
        </>
      )}

      <div style={{ marginTop: '40px', padding: '16px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 800, margin: '0 0 8px', color: '#525252' }}>What happens when you start a preview</h3>
        <ul style={{ margin: 0, paddingLeft: '20px', color: '#525252', fontSize: '13px', lineHeight: 1.6 }}>
          <li>The home page (<code>/</code>) shows the event-day takeover for everyone.</li>
          <li>The door check-in (<code>/checkin</code>) works without a token.</li>
          <li>A yellow notice banner appears at the top of every page.</li>
          <li>All check-ins and votes are saved with <code>preview=true</code>.</li>
          <li>Preview auto-exits in 30 minutes (or click "Exit preview").</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Guest check-in page (/checkin) ─────────────────────────────────
// Three-step cascade meant to be opened from the door QR code at events.
// Each step auto-advances to feel like one continuous tap.
//   Step 1: pick the vendor who invited you (or quick None button)
//   Step 2: "Select your favorites" — login/signup gate framed as the unlock
//   Step 3: cast/update your 3 vendor votes, persisted, locks at event end
//
// URL params:
//   ?event=<event_id>  — which event this check-in is for (required)
//   ?door=<token>      — proof of being physically at the door (mocked for now)
//   ?preview=1         — staff preview, writes are flagged preview=true
function GuestCheckinPage({ isMobile }) {
  const [searchParams] = useSearchParams();
  const eventIdParam = searchParams.get('event');
  const tokenParam = searchParams.get('token');
  const isLocalPreview = searchParams.get('preview') === '1';
  const activePreview = useActivePreview();
  // Site-wide global preview also lets the door QR work without a token,
  // tagged with preview=true so writes don't pollute real analytics.
  const isPreview = isLocalPreview || !!activePreview;

  const [event, setEvent] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tokenValid, setTokenValid] = useState(null); // null=unknown, true/false after check
  const [step, setStep] = useState(1);
  const [pickedInviter, setPickedInviter] = useState(null); // vendor object OR { id: null } for None
  const [authError, setAuthError] = useState(null);
  const [session, setSession] = useState(null);
  const [votes, setVotes] = useState(new Set()); // set of vendor_id

  // Load event + vendors + existing session/votes on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = todayISO();
      let ev = null;
      // Preview mode: bypass token. Priority order:
      //   1. Site-wide preview's selected event (most authoritative — staff picked it)
      //   2. Explicit ?event=<id> URL param (local preview rehearsals)
      //   3. Next upcoming has_vendors event (fallback)
      if (isPreview) {
        let targetEventId = activePreview?.event_id || eventIdParam || null;
        let evQuery = supabase
          .from('events')
          .select('id, title, event_date, start_time, end_time, has_vendors, cancelled');
        if (targetEventId) {
          evQuery = evQuery.eq('id', targetEventId).limit(1);
        } else {
          evQuery = evQuery.eq('has_vendors', true).gte('event_date', today)
            .order('event_date', { ascending: true }).limit(1);
        }
        const { data } = await evQuery;
        ev = (data || []).find(e => !e.cancelled) || null;
        setTokenValid(true);
      } else if (eventIdParam && tokenParam) {
        // Real check-in: validate event_id + token via SECURITY DEFINER RPC.
        // The RPC only returns rows when both match — bypasses RLS so the
        // anon role can verify before auth.
        const { data, error } = await supabase
          .rpc('event_by_door_token', { p_event_id: eventIdParam, p_token: tokenParam });
        if (!error && data && data.length > 0) {
          ev = data[0];
          setTokenValid(true);
        } else {
          setTokenValid(false);
        }
      } else {
        setTokenValid(false);
      }
      if (cancelled) return;
      setEvent(ev || null);

      // Pull approved vendors for the event
      if (ev) {
        const { data: apps } = await supabase
          .from('vendor_applications')
          .select('vendor_id, vendors(id, name, ig_handle)')
          .eq('event_id', ev.id)
          .eq('status', 'approved');
        if (!cancelled) {
          const vs = (apps || [])
            .map(a => a.vendors)
            .filter(Boolean)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          setVendors(vs);
        }
      }

      // Existing session
      const { data: { session: s } } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(s);

      // If logged in + checked in already, jump to vote step
      if (s && ev) {
        const { data: ci } = await supabase
          .from('guest_checkins')
          .select('id, invited_by_vendor_id')
          .eq('event_id', ev.id)
          .eq('profile_id', s.user.id)
          .maybeSingle();
        if (ci) {
          setStep(3);
        }
        const { data: vv } = await supabase
          .from('vendor_votes')
          .select('vendor_id')
          .eq('event_id', ev.id)
          .eq('profile_id', s.user.id);
        if (!cancelled && vv) setVotes(new Set(vv.map(r => r.vendor_id)));
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventIdParam, tokenParam, isPreview, activePreview?.event_id]);

  // Auto-advance from step 1 once an inviter is picked
  const advanceFromStep1 = (inviter) => {
    setPickedInviter(inviter);
    setTimeout(() => setStep(2), 350);
  };

  // Step 2 — create account / sign in, then write check-in
  async function handleCreateAccount(email, password) {
    setAuthError(null);
    try {
      // Try sign-in first; if it fails (no account), sign up.
      let { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.session) {
        const signup = await supabase.auth.signUp({
          email, password,
          options: { data: { source: 'door_checkin' } },
        });
        if (signup.error) throw signup.error;
        // signUp returns a session when email confirmation is disabled.
        data = signup.data;
      }
      const s = data.session;
      if (!s) { setAuthError("We couldn't sign you in. Try a different password."); return; }
      setSession(s);

      // Record the check-in
      const { error: ciErr } = await supabase.from('guest_checkins').upsert({
        event_id: event.id,
        profile_id: s.user.id,
        invited_by_vendor_id: pickedInviter?.id || null,
        preview: isPreview,
      }, { onConflict: 'event_id,profile_id' });
      if (ciErr) console.warn('check-in upsert error', ciErr);

      setStep(3);
    } catch (e) {
      setAuthError(e.message || 'Could not create account. Try again.');
    }
  }

  // Step 3 — toggle a vote (add or remove)
  async function toggleVote(vendorId) {
    if (!session) return;
    if (votes.has(vendorId)) {
      const next = new Set(votes); next.delete(vendorId); setVotes(next);
      await supabase.from('vendor_votes')
        .delete()
        .eq('event_id', event.id)
        .eq('profile_id', session.user.id)
        .eq('vendor_id', vendorId);
    } else if (votes.size < 3) {
      const next = new Set(votes); next.add(vendorId); setVotes(next);
      const { error } = await supabase.from('vendor_votes').insert({
        event_id: event.id,
        profile_id: session.user.id,
        vendor_id: vendorId,
        preview: isPreview,
      });
      if (error) {
        // rollback local state if DB rejected (e.g. max 3 trigger)
        const rolled = new Set(votes); setVotes(rolled);
      }
    }
  }

  if (loading) return <CheckinShell><p style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Loading…</p></CheckinShell>;
  if (tokenValid === false) {
    return (
      <CheckinShell>
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 12px' }}>This QR is no longer valid.</h2>
          <p style={{ color: '#666', margin: '0 0 16px', lineHeight: 1.5 }}>
            Each event has its own QR. This one might be from a past event or scanned with a missing code. Try the QR at the front door of tonight's event.
          </p>
          <a href="/" style={{ color: '#C8102E', fontWeight: 800, textDecoration: 'none' }}>← Back to home</a>
        </div>
      </CheckinShell>
    );
  }
  if (!event) {
    return (
      <CheckinShell>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 12px' }}>No event happening right now.</h2>
          <p style={{ color: '#666', margin: 0 }}>This QR is for live events. Come back during a Trade Night.</p>
        </div>
      </CheckinShell>
    );
  }

  return (
    <CheckinShell isPreview={isPreview}>
      <CheckinHeader step={step} event={event} />
      {step === 1 && (
        <CheckinStep1
          vendors={vendors}
          onPickVendor={advanceFromStep1}
          onPickNone={() => advanceFromStep1({ id: null })}
        />
      )}
      {step === 2 && (
        <CheckinStep2
          pickedInviter={pickedInviter}
          onCreate={handleCreateAccount}
          authError={authError}
        />
      )}
      {step === 3 && (
        <CheckinStep3
          vendors={vendors}
          votes={votes}
          onToggleVote={toggleVote}
          event={event}
        />
      )}
    </CheckinShell>
  );
}

function CheckinShell({ children, isPreview }) {
  return (
    <div style={{ background: '#fafafa', minHeight: '100vh' }}>
      {isPreview && (
        <div style={{
          background: '#fbbf24', color: '#1a1a1a',
          padding: '6px 12px', textAlign: 'center',
          fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          🧪 Preview Mode · Not Live
        </div>
      )}
      <div style={{ maxWidth: '420px', margin: '0 auto', background: '#fafafa' }}>
        {children}
      </div>
      <style>{`
        @keyframes pulseDot { 50% { opacity: 0.4; } }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function CheckinHeader({ step, event }) {
  const subs = {
    1: "Tap the vendor who invited you. That's it for now.",
    2: "Select your favorites tonight. Quick account so your picks save.",
    3: "You're in. Award your 3 points any time before close.",
  };
  return (
    <div style={{
      background:
        'radial-gradient(ellipse at top right, rgba(255,26,140,0.85), transparent 60%),' +
        'linear-gradient(135deg, #1a1a1a 0%, #C8102E 100%)',
      padding: '36px 24px 28px',
      textAlign: 'center',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', fontWeight: 800, marginBottom: '8px' }}>
        Welcome in
      </div>
      <h1 style={{ fontSize: '28px', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
        You're at {event.title || 'Trade Night'}.
      </h1>
      <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.9)' }}>
        {subs[step]}
      </p>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '5px', background: 'linear-gradient(90deg, #FF1A8C, #fff, #ffd13f)' }} />
    </div>
  );
}

function CheckinStep1({ vendors, onPickVendor, onPickNone }) {
  const [query, setQuery] = useState('');
  const filtered = vendors.filter(v =>
    (v.name || '').toLowerCase().includes(query.toLowerCase()) ||
    (v.ig_handle || '').toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div style={{ animation: 'fadeSlide 0.35s ease-out' }}>
      <div style={{ padding: '24px 24px 0' }}>
        <button
          onClick={onPickNone}
          style={{
            width: '100%', background: '#fff', border: '1.5px solid #d1d5db',
            borderRadius: '12px', padding: '14px 16px',
            fontSize: '14px', fontWeight: 700, color: '#1a1a1a',
            cursor: 'pointer', marginBottom: '14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>No vendor invited me — I'm just walking in</span>
          <span style={{ color: '#888', fontSize: '18px' }}>→</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.14em', margin: '0 0 12px' }}>
          <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
          <span style={{ padding: '0 12px' }}>or — find your vendor</span>
          <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
        </div>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#888' }}>🔎</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor name or handle..."
            style={{
              width: '100%', background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '12px', padding: '14px 16px 14px 42px',
              fontSize: '14px', color: '#1a1a1a',
            }}
          />
        </div>
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', maxHeight: '230px', overflowY: 'auto', marginTop: '6px' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '14px 16px', color: '#888', fontSize: '13px', fontStyle: 'italic' }}>
              No matches. Use the "No vendor invited me" button above if you don't see them.
            </div>
          )}
          {filtered.map(v => (
            <div
              key={v.id}
              onClick={() => onPickVendor(v)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #f3f4f6',
                fontSize: '14px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{v.name}</span>
              <span style={{ fontSize: '11px', color: '#888' }}>{v.ig_handle || ''}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '12px', color: '#888', margin: '12px 0 24px', lineHeight: 1.5 }}>
          Picking your inviter <strong style={{ color: '#525252' }}>boosts their guest count</strong>. Vendor with the most invites wins incentives.
        </p>
      </div>
    </div>
  );
}

function CheckinStep2({ pickedInviter, onCreate, authError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const chipLabel = pickedInviter?.id
    ? `✓ Invited by ${pickedInviter.name}`
    : '✓ Walked in on my own';
  return (
    <div style={{ animation: 'fadeSlide 0.35s ease-out' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        background: '#fef3c7', color: '#92400e',
        border: '1px solid #d97706',
        padding: '5px 12px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 800,
        margin: '18px 24px 0',
      }}>{chipLabel}</div>

      <div style={{ padding: '22px 24px 0' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#1a1a1a', margin: '6px 0 6px' }}>
          Select your favorites tonight.
        </h2>
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 12px', lineHeight: 1.5 }}>
          Three vendors. You'll award them points toward <strong style={{ color: '#525252' }}>Favorite Vendor of the Night</strong>. Quick account first so your picks save to your name and you can come back to change them any time before close.
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: '#ecfdf5', color: '#047857',
          border: '1px solid #a7f3d0',
          padding: '5px 12px', borderRadius: '999px',
          fontSize: '11px', fontWeight: 800,
          marginBottom: '14px',
        }}>🔒 No spam, ever. Promise.</div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            style={{ width: '100%', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', color: '#1a1a1a' }}
          />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            style={{ width: '100%', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', color: '#1a1a1a' }}
          />
        </div>

        {authError && (
          <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', margin: '0 0 8px' }}>
            {authError}
          </div>
        )}
      </div>

      <button
        onClick={() => onCreate(email, password)}
        disabled={!email || password.length < 6}
        style={{
          width: 'calc(100% - 48px)', margin: '18px 24px 0',
          background: !email || password.length < 6
            ? '#f3f4f6'
            : 'linear-gradient(135deg, #C8102E 0%, #FF1A8C 100%)',
          color: !email || password.length < 6 ? '#9ca3af' : '#fff',
          fontSize: '16px', fontWeight: 800,
          border: 'none', borderRadius: '14px',
          padding: '16px',
          cursor: !email || password.length < 6 ? 'not-allowed' : 'pointer',
          boxShadow: !email || password.length < 6 ? 'none' : '0 12px 28px rgba(200,16,46,0.3)',
          letterSpacing: '0.04em',
        }}
      >Unlock my 3 votes →</button>
      <p style={{ fontSize: '11px', color: '#888', textAlign: 'center', margin: '8px 24px 60px', fontStyle: 'italic' }}>
        Password must be 6+ characters.
      </p>
    </div>
  );
}

function CheckinStep3({ vendors, votes, onToggleVote, event }) {
  const endTime = event.end_time ? event.end_time.slice(0, 5) : '10:00 PM';
  return (
    <div style={{ animation: 'fadeSlide 0.35s ease-out' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        background: '#ecfdf5', color: '#16a34a',
        border: '1px solid #bbf7d0',
        padding: '5px 12px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 800,
        margin: '18px 24px 0',
      }}>★ You're in · saved to your account</div>

      <div style={{ padding: '22px 24px 0' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#1a1a1a', margin: '6px 0 6px' }}>
          Award your 3 points.
        </h2>
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px', lineHeight: 1.5 }}>
          Tap up to 3 vendors. Tap again to remove. Each tap = 1 point toward their <strong style={{ color: '#525252' }}>Favorite Vendor of the Night</strong> total. <strong style={{ color: '#1a1a1a' }}>Your picks save automatically.</strong> Come back any time. <strong style={{ color: '#C8102E' }}>Locks at {endTime}.</strong>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', padding: '0 24px 100px' }}>
        {vendors.map(v => {
          const isVoted = votes.has(v.id);
          return (
            <div
              key={v.id}
              onClick={() => onToggleVote(v.id)}
              style={{
                background: isVoted ? '#fef3c7' : '#fff',
                border: isVoted ? '1.5px solid #d97706' : '1.5px solid #e5e7eb',
                borderRadius: '14px',
                padding: '14px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isVoted ? '0 4px 16px rgba(217,119,6,0.18)' : '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{
                position: 'absolute', top: '10px', right: '10px',
                width: '24px', height: '24px', borderRadius: '50%',
                background: isVoted ? '#d97706' : '#f3f4f6',
                color: isVoted ? '#fff' : '#999',
                fontSize: '13px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{isVoted ? '★' : ''}</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#1a1a1a', margin: '0 0 4px' }}>
                {v.name}
              </div>
              <div style={{ fontSize: '11px', color: '#888' }}>{v.ig_handle || ''}</div>
            </div>
          );
        })}
      </div>

      <div style={{
        position: 'sticky', bottom: 0,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid #e5e7eb',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>
          <span style={{ color: '#d97706', fontSize: '20px' }}>{votes.size}</span> / 3 chosen
        </div>
        <div style={{ fontSize: '12px', color: '#888' }}>
          Saves as you go · Locks at <strong style={{ color: '#C8102E' }}>{endTime}</strong>
        </div>
      </div>
    </div>
  );
}

// ─── Vendor Day "About" / educational page ───────────────
// /vendor-day/about — what these events ARE, why they exist, how vendors
// get involved. Linked from the home banner during cold periods (more than
// a week out, fewer than 15 confirmed) so first-time visitors learn the
// program before they see counts that are still building.
function VendorDayAboutPage({ isMobile }) {
  const navigate = useNavigate();
  const [nextEvent, setNextEvent] = useState(null);
  // Most recent past event WITH vendors — drives the 'See last event'
  // deep-link near the gallery so logged-in vendors (who get redirected
  // off /vendors) still have a path to recent lineups.
  const [lastEvent, setLastEvent] = useState(null);
  // Recent submissions feed reuses the same data shape as /vendors so
  // VendorSubmissionCard renders unchanged. Gated: hidden entirely until
  // we have 10+ visible submissions on file (don't want a sparse gallery
  // making the program look quiet). Once the threshold's hit, we slice
  // down to 6 for the on-page teaser.
  const SUBMISSIONS_REVEAL_AT = 10;
  const SUBMISSIONS_DISPLAY_LIMIT = 6;
  const [submissions, setSubmissions] = useState([]);
  const [submissionCount, setSubmissionCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = todayISO();
      const [nextRes, lastRes, subsRes] = await Promise.all([
        supabase.from('events')
          .select('id, title, event_date, cancelled')
          .eq('has_vendors', true)
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .limit(1),
        supabase.from('events')
          .select('id, title, event_date, cancelled')
          .eq('has_vendors', true)
          .lt('event_date', today)
          .order('event_date', { ascending: false })
          .limit(1),
        supabase.from('vendor_submissions')
          .select('*, vendor:vendors(id, name, avatar_url, ig_handle, tiktok_handle, fb_handle, specialty), event:events(id, title, event_date), media:vendor_media(*)',
                  { count: 'exact' })
          .eq('visible', true)
          .order('submitted_at', { ascending: false })
          .limit(SUBMISSIONS_DISPLAY_LIMIT),
      ]);
      if (cancelled) return;
      setNextEvent((nextRes.data || []).find(e => !e.cancelled) || null);
      setLastEvent((lastRes.data || []).find(e => !e.cancelled) || null);
      setSubmissions(subsRes.data || []);
      setSubmissionCount(subsRes.count || 0);
    })();
    return () => { cancelled = true; };
  }, []);

  const para = { fontSize: '1rem', color: '#333', lineHeight: 1.7, margin: '0 0 14px 0' };
  const h2 = { fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: '800', color: '#1a1a1a', margin: '28px 0 10px 0', letterSpacing: '-0.01em' };
  const nextDateStr = nextEvent
    ? new Date(nextEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  // Hero CTA at the top of the page. Click sends the visitor to the calendar
  // with the next vendor-bearing event's exact date pre-selected — like they
  // landed on /calendar and clicked that day to expand the details panel.
  // View Transitions API gives a cross-fade morph on Chrome/Edge/Safari.
  const goToCalendar = () => {
    const target = nextEvent
      ? `/calendar?date=${nextEvent.event_date}`
      : '/calendar';
    const go = () => navigate(target);
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => go());
    } else {
      go();
    }
  };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '760px', margin: '0 auto' }}>
        <SectionHeader
          title="What are TC's Beach City Trade Nights?"
          subtitle="A platform for vendors. A community for collectors."
        />

        {/* TOP CTA: jumps to the actual next event on the calendar */}
        <button
          type="button"
          onClick={goToCalendar}
          style={{
            width: '100%', marginBottom: '24px',
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2a0a0a 50%, #C8102E 100%)',
            color: '#fff',
            padding: isMobile ? '20px 22px' : '24px 28px',
            border: 'none', borderRadius: '14px',
            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
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
              width: '44px', height: '44px', borderRadius: '10px',
              backgroundColor: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <CalendarIcon size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85, marginBottom: '4px' }}>
                {nextEvent ? 'Next event' : 'Calendar'}
              </div>
              <div style={{ fontSize: isMobile ? '1rem' : '1.1rem', fontWeight: '900', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                {nextEvent
                  ? `${nextEvent.title || 'Vendor Day'} · ${nextDateStr}`
                  : 'See every event on the calendar'}
              </div>
            </div>
          </div>
          <ArrowRight size={20} style={{ flexShrink: 0 }} />
        </button>

        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '16px',
          padding: isMobile ? '22px 18px' : '32px 36px',
        }}>
          <p style={{ ...para, fontSize: '1.05rem' }}>
            Once a month, Trainer Center HB hosts a Vendor Day. Pokemon vendors set up tables across the shop. Collectors come through, swap cards, talk shop, and walk out with the binder they have been chasing. New to trading? Even better — regulars are happy to walk you through fair values.
          </p>

          <h2 style={h2}>What makes it different</h2>
          <p style={para}>
            <strong>About 90% of our Vendor Days are completely free for vendors.</strong> No table fees, no gatekeeping. We provide the room, the foot traffic, and the platform.
          </p>

          <h2 style={h2}>How vending here works</h2>
          <ol style={{ ...para, paddingLeft: '18px', margin: '0 0 14px 0' }}>
            <li style={{ marginBottom: '10px' }}>
              <strong>Apply once to partner.</strong> A short application — we review profiles to keep the room healthy.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Pick your dates.</strong> Approved partners apply for any Vendor Day in two taps from their dashboard.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Show up. Sell. Trade.</strong> Bring what you specialize in — singles, sealed, slabs, vintage, Japanese.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Boost your IG.</strong> Post on your account after. DM-share TC posts to friends — the IG algorithm rewards DM-shares more than likes, and that is how a low-volume page like ours grows.
            </li>
          </ol>

          <h2 style={h2}>Beyond Vendor Day</h2>
          <p style={para}>
            Vendor Day is one night a month. The rest of the time we are still working with the same community:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px 0' }}>
            {[
              { t: 'Consignment', d: 'Drop off inventory any time. We move it for you.', to: '/consultation' },
              { t: 'Buy & sell', d: 'We buy collections and singles, and we keep stock on hand.', to: '/buy-sell' },
              { t: 'Grading', d: 'We run submissions out and walk you through what to send.', to: '/grading' },
              { t: '1-on-1 consultations', d: 'Appraisals, collecting strategy, learning the TCG.', to: '/consultation' },
            ].map(item => (
              <li key={item.t} style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: '12px', padding: '10px 0', borderBottom: '1px solid #f3f4f6',
                fontSize: '0.95rem', lineHeight: 1.5, color: '#444',
                flexWrap: 'wrap',
              }}>
                <span><strong style={{ color: '#1a1a1a' }}>{item.t}</strong> — {item.d}</span>
                <Link to={item.to} style={{ color: '#C8102E', fontWeight: '700', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                  Learn more →
                </Link>
              </li>
            ))}
          </ul>

          {/* Last event deep-link — surfaces the most recent past vendor
              event so visitors (especially logged-in vendors who get
              redirected off /vendors) can see the previous lineup. */}
          {lastEvent && (
            <Link
              to={`/vendor-day?event=${lastEvent.id}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: '24px',
                padding: isMobile ? '14px 16px' : '16px 20px',
                backgroundColor: '#f9fafb', border: '1px solid #eee',
                borderRadius: '12px', textDecoration: 'none', color: '#1a1a1a',
                gap: '12px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: '800', color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Last event
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: '800' }}>
                  {lastEvent.title} · {new Date(lastEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '2px' }}>
                  See the full lineup that set up
                </div>
              </div>
              <ArrowRight size={18} color="#999" style={{ flexShrink: 0 }} />
            </Link>
          )}

          <div style={{ marginTop: '28px', marginBottom: '8px', textAlign: 'center' }}>
            <Link to="/vendors/dashboard" style={{
              backgroundColor: '#1a1a1a', color: '#fff',
              padding: '14px 28px', borderRadius: '10px',
              fontSize: '0.95rem', fontWeight: '700', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '8px',
            }}>
              Open Vendor Dashboard <ArrowRight size={16} />
            </Link>
          </div>

          {/* Recent vendor uploads gallery — same shape as /vendors used to
              run, just lives here now since /vendors is a promo page.
              Hidden until at least SUBMISSIONS_REVEAL_AT visible submissions
              exist site-wide; one or two stray photos look weaker than no
              gallery at all. */}
          {submissionCount >= SUBMISSIONS_REVEAL_AT && submissions.length > 0 && (
            <>
              <h2 style={h2}>Recent posts from our vendors</h2>
              <p style={{ ...para, marginBottom: '20px' }}>
                What our vendors brought + posted from past Vendor Days.
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                gap: '14px',
                marginBottom: '8px',
              }}>
                {submissions.map(sub => (
                  <VendorSubmissionCard key={sub.id} submission={sub} />
                ))}
              </div>
            </>
          )}
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

// ─── /vendors → redirect to /vendor-day/about ────────────
// The old marketing landing was duplicating /vendor-day/about. We collapsed
// them: /vendors now just bounces to the about page so anyone hitting the
// short URL still lands on the canonical explainer + CTA into the dashboard.
function VendorsPage() {
  return <Navigate to="/vendor-day/about" replace />;
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
// ─── Reminder Signup Modal ──────────────────────────────
// Two-step signup that doubles as TC member registration:
//   1. Pick which event categories to be reminded about (checkbox grid
//      driven by CATEGORIES so the picker stays in sync if categories
//      change — "consultation" is excluded since it's a 1:1 booking, not
//      a blast-worthy event).
//   2. Email + password account — opened via the unified AuthModal
//      (intent='member') after the user clicks Save on the category step.
// On signup success, calls the subscribe_to_reminders RPC which creates the
// members row and upserts the marketing_contacts row with the picked
// subscriptions object. The localStorage flag that hides the wiggle banner
// is set by the parent on either close or success.
const REMINDER_CATEGORY_KEYS = Object.keys(CATEGORIES).filter(k => k !== 'consultation');

function ReminderSignupModal({ onClose, onComplete, onHideBell, isMobile }) {
  const { user, reminderSubs, refreshReminders, openAuthModal, isAuthModalOpen } = useAuth();
  const isLoggedIn = !!user;
  const [step, setStep] = useState('categories'); // 'categories' | 'saving' | 'success' | 'error'
  // Pre-fill from the user's saved subs when re-engaging, otherwise default
  // all categories on so first-time users don't have to tick every one.
  const [selectedCats, setSelectedCats] = useState(() => {
    if (reminderSubs && Object.keys(reminderSubs).length > 0) {
      return new Set(REMINDER_CATEGORY_KEYS.filter(k => !!reminderSubs[k]));
    }
    return new Set(REMINDER_CATEGORY_KEYS);
  });
  const [errorMsg, setErrorMsg] = useState('');
  // Surface a "welcome back" notice when a returning visitor logs in via the
  // modal and we discover they already had reminder prefs saved. We pre-fill
  // the picker from their existing subs instead of silently overwriting.
  const [returningExisting, setReturningExisting] = useState(false);

  const toggleCat = (key) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Persist the picks to the DB. Used by both the post-signup path
  // (handleAuthSuccess) and the already-logged-in shortcut (saveAndFinish)
  // so the RPC call lives in one place.
  const persistSubscriptions = async () => {
    setStep('saving');
    setErrorMsg('');
    const subs = REMINDER_CATEGORY_KEYS.reduce((acc, key) => {
      acc[key] = selectedCats.has(key);
      return acc;
    }, {});
    const { error } = await supabase.rpc('subscribe_to_reminders', { p_subscriptions: subs });
    if (error) {
      setErrorMsg(error.message);
      setStep('error');
      return;
    }
    setStep('success');
    // Refresh AuthContext so the nav label flips to "My Reminders" and the
    // /reminders preferences card stays in sync without a page reload.
    if (refreshReminders) refreshReminders();
    if (onComplete) onComplete();
  };

  // Post-auth: if the user already has reminder prefs on file (signed up
  // before, switched browsers, etc.), don't blow them away. Pre-fill the
  // picker from existing subs and show a "welcome back" prompt so they can
  // adjust deliberately before saving.
  const handleAuthSuccess = async () => {
    setStep('saving');
    setErrorMsg('');
    const { data, error } = await supabase.rpc('get_my_reminders');
    if (error) {
      setErrorMsg(error.message);
      setStep('error');
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const existing = row && row.has_record ? (row.subscriptions || {}) : null;
    if (existing && Object.keys(existing).length > 0) {
      const prior = REMINDER_CATEGORY_KEYS.filter(k => !!existing[k]);
      setSelectedCats(new Set(prior));
      setReturningExisting(true);
      setStep('categories');
      if (refreshReminders) refreshReminders();
      return;
    }
    // No existing record — save the picks the user just made.
    persistSubscriptions();
  };
  const handleContinueFromCategories = () => {
    if (selectedCats.size === 0) return;
    if (isLoggedIn) {
      persistSubscriptions();
      return;
    }
    // Logged out: open the unified AuthModal layered above this modal.
    // After successful signup/login, handleAuthSuccess either pre-fills
    // the picker from existing subs (returning user) or saves what they
    // just picked (new account). ReminderSignupModal stays open behind
    // so closing AuthModal returns the user to the categories step.
    openAuthModal({
      defaultMode: 'signup',
      intent: 'member',
      onSuccess: handleAuthSuccess,
    });
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    justifyContent: 'center',
    padding: isMobile ? '0' : '24px',
  };
  const cardStyle = isMobile ? {
    backgroundColor: '#fff', width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'auto',
  } : {
    backgroundColor: '#fff', borderRadius: '16px',
    width: '100%', maxWidth: '480px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  // While AuthModal is layered above us, render nothing. Component stays
  // mounted so selectedCats + returningExisting + step survive — when the
  // user closes/finishes AuthModal, this modal pops back to the categories
  // step with their picks intact.
  if (isAuthModalOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: isMobile ? '16px 20px 12px' : '22px 28px 14px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.7rem', color: '#C8102E', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px 0' }}>
              Trainer Center reminders
            </p>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>
              {step === 'categories' && 'Which events do you want reminders for?'}
              {step === 'auth' && 'Create your account'}
              {step === 'saving' && 'Saving your picks...'}
              {step === 'success' && "You're all set!"}
              {step === 'error' && 'Something went wrong'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: '#f0f0f0', border: 'none', borderRadius: '50%',
            width: '32px', height: '32px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: isMobile ? '14px 20px 20px' : '18px 28px 24px', overflowY: 'auto', flex: 1 }}>
          {step === 'categories' && (
            <>
              <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                Pick the events you'd like a heads-up for. We'll only email you when something on your list is coming up.
              </p>
              {isLoggedIn && (
                <div style={{
                  backgroundColor: returningExisting ? '#eff6ff' : '#f0fdf4',
                  border: returningExisting ? '1px solid #bfdbfe' : '1px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  fontSize: '0.82rem',
                  color: returningExisting ? '#1e3a8a' : '#166534',
                  fontWeight: '700',
                }}>
                  {returningExisting
                    ? <>Welcome back, {user.email}. We loaded your existing reminders below — adjust if you'd like, then save.</>
                    : <>Signed in as {user.email} — we'll save these picks straight to your account.</>}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '20px' }}>
                {REMINDER_CATEGORY_KEYS.map(key => {
                  const cat = CATEGORIES[key];
                  if (!cat) return null;
                  const checked = selectedCats.has(key);
                  return (
                    <label key={key} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 14px',
                      backgroundColor: '#fff',
                      color: checked ? '#1a1a1a' : '#888',
                      borderRadius: '10px',
                      border: `1px solid ${checked ? '#e5e7eb' : '#f0f0f0'}`,
                      borderLeft: `3px solid ${cat.color}`,
                      cursor: 'pointer',
                      fontSize: '0.9rem', fontWeight: '700',
                      userSelect: 'none',
                      transition: 'color 0.15s, border-color 0.15s',
                      boxShadow: checked ? `0 1px 2px rgba(0,0,0,0.04)` : 'none',
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCat(key)}
                        style={{ width: '18px', height: '18px', accentColor: cat.color, cursor: 'pointer', flexShrink: 0 }}
                      />
                      {cat.label}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleContinueFromCategories}
                disabled={selectedCats.size === 0}
                style={{
                  width: '100%', padding: '14px',
                  backgroundColor: selectedCats.size === 0 ? '#ccc' : '#C8102E',
                  color: '#fff',
                  border: 'none', borderRadius: '10px',
                  fontWeight: '800', fontSize: '0.95rem',
                  cursor: selectedCats.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {selectedCats.size === 0
                  ? 'Pick at least one'
                  : isLoggedIn
                    ? `Save ${selectedCats.size} ${selectedCats.size === 1 ? 'reminder' : 'reminders'}`
                    : `Continue with ${selectedCats.size} selected`}
              </button>
              {onHideBell && (
                <button
                  type="button"
                  onClick={onHideBell}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    fontSize: '0.78rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: '12px 8px 0',
                    width: '100%',
                    textAlign: 'center',
                    textDecoration: 'underline',
                  }}
                  title="Hide the bell on this device"
                >
                  Don't show this bell anymore
                </button>
              )}
            </>
          )}

          {step === 'saving' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <Loader2 size={32} color="#C8102E" className="spin" />
              <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '14px' }}>Saving your reminder preferences...</p>
            </div>
          )}

          {step === 'success' && (
            <>
              <div style={{
                backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: '12px', padding: '18px 20px', marginBottom: '18px',
                display: 'flex', alignItems: 'flex-start', gap: '12px',
              }}>
                <CheckCircle2 size={24} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '0.95rem', fontWeight: '800', color: '#15803d', margin: '0 0 4px 0' }}>
                    {isLoggedIn ? 'Reminder preferences saved' : 'Welcome to Trainer Center!'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: '#166534', lineHeight: '1.6', margin: 0 }}>
                    We'll email you about the {selectedCats.size} {selectedCats.size === 1 ? 'category' : 'categories'} you picked. Update or unsubscribe any time from any email we send.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%', padding: '14px',
                  backgroundColor: '#1a1a1a', color: '#fff',
                  border: 'none', borderRadius: '10px',
                  fontWeight: '800', fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </>
          )}

          {step === 'error' && (
            <>
              <div style={{
                backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '12px', padding: '18px 20px', marginBottom: '18px',
              }}>
                <p style={{ fontSize: '0.9rem', fontWeight: '700', color: '#991b1b', margin: '0 0 6px 0' }}>
                  We couldn't save your preferences.
                </p>
                <p style={{ fontSize: '0.85rem', color: '#7f1d1d', lineHeight: '1.5', margin: 0 }}>
                  {errorMsg || 'Please try again.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('categories')}
                style={{
                  width: '100%', padding: '14px',
                  backgroundColor: '#C8102E', color: '#fff',
                  border: 'none', borderRadius: '10px',
                  fontWeight: '800', fontSize: '0.95rem',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Vendor Apply Page ────────────────────────────────────
// Email + password login or signup. After auth, user lands on /vendors/dashboard
// where the onboarding form fires for first-time vendors.
// Defaults to login mode (returning vendors are the majority). Pass
// ?mode=signup to open in signup mode (used by the Apply / Sign Up card).
// /vendors/apply is a gate. Logged-in vendors / staff bounce straight to
// the dashboard. Logged-out visitors get the unified AuthModal opened
// automatically with intent='vendor' (and signup mode if ?mode=signup),
// so signup or login both happen inside the same component as every
// other "Log in" surface — no more inline PasswordAuthCard duplication.
function VendorApplyPage({ isMobile }) {
  const navigate = useNavigateInternal();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  const isSignupMode = initialMode === 'signup';
  const openedRef = useRef(false);

  useEffect(() => {
    if (auth.isLoading) return;
    // Already logged in → go straight to the dashboard. The dashboard
    // routes the user to the right next step (onboarding form for new
    // vendors, full dashboard for approved ones).
    if (auth.session) {
      navigate('/vendors/dashboard');
      return;
    }
    // Logged out — pop the AuthModal once. The ref guard keeps StrictMode's
    // double effect from opening it twice.
    if (openedRef.current) return;
    openedRef.current = true;
    auth.openAuthModal({
      defaultMode: initialMode,
      intent: 'vendor',
      onSuccess: () => navigate('/vendors/dashboard'),
    });
  }, [auth, auth.isLoading, auth.session, initialMode, navigate]);

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto' }}>
        <SectionHeader
          title={isSignupMode ? 'Apply to partner with Trainer Center' : 'Vendor Login'}
          subtitle={isSignupMode ? "Quick signup — Chef will review and approve you." : 'Log back in or create an account'}
        />

        {/* Anti-duplicate-account banner. Returning vendors who forget which
            email they used will sometimes try to sign up again instead of
            logging in. Nudge them to switch tabs inside the modal. */}
        {isSignupMode && (
          <div style={{
            backgroundColor: '#fef9e6',
            borderLeft: '3px solid #d97706',
            borderRadius: '6px',
            padding: '14px 18px',
            marginBottom: '18px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: '20px', lineHeight: 1, paddingTop: '1px' }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 800,
                color: '#92400e',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>Already a partner?</div>
              <div style={{ fontSize: '13px', lineHeight: 1.55, color: '#1a1a1a' }}>
                Don't create a new account. Tap <strong>Log in</strong> at the top of the popup instead. Multiple accounts confuse approvals and we can't merge them. Forgot which email you used? Text Chef at (714) 951-9100.
              </div>
            </div>
          </div>
        )}

        {/* Fallback CTA if the user closed the modal without signing in.
            One tap re-opens it with the same config. */}
        {!auth.session && !auth.isLoading && (
          <div style={{
            backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #eee',
            padding: isMobile ? '24px 20px' : '36px', textAlign: 'center',
          }}>
            <p style={{ fontSize: '0.95rem', color: '#444', margin: '0 0 18px 0', lineHeight: 1.6 }}>
              Continue the vendor signup — we'll get you set up and Chef will review.
            </p>
            <button
              onClick={() => auth.openAuthModal({
                defaultMode: initialMode,
                intent: 'vendor',
                onSuccess: () => navigate('/vendors/dashboard'),
              })}
              style={{
                backgroundColor: '#C8102E', color: '#fff', border: 'none',
                padding: '14px 28px', borderRadius: 10,
                fontSize: '0.95rem', fontWeight: 800, cursor: 'pointer',
              }}
            >
              {isSignupMode ? 'Continue signup' : 'Log in'}
            </button>
          </div>
        )}
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

// ─── Themed dashboard card primitives ─────────────────────
// Reusable card grid for the role-aware /vendors/dashboard hub. Each card
// is a Link with an icon, title, subtitle, and optional badge. Brand-aware
// (Trainer Center red as the default accent) but accepts overrides per card.
function DashboardCardGrid({ children, isMobile }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
      gap: '16px',
      maxWidth: '900px',
      margin: '0 auto',
    }}>
      {children}
    </div>
  );
}

function DashboardCard({ icon, title, subtitle, to, accent = '#C8102E', accentBg = '#fff0f0', badge }) {
  return (
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: '16px',
      backgroundColor: '#ffffff', border: '1px solid #eee',
      borderRadius: '14px',
      padding: '20px',
      textDecoration: 'none', color: '#1a1a1a',
      transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = '#eee'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: '52px', height: '52px', borderRadius: '14px',
        backgroundColor: accentBg, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '1rem', fontWeight: '800', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {title}
          {badge && (
            <span style={{
              fontSize: '0.65rem', fontWeight: '700',
              color: accent, backgroundColor: '#fff', border: `1px solid ${accent}33`,
              padding: '2px 8px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>{badge}</span>
          )}
        </div>
        <div style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
          {subtitle}
        </div>
      </div>
      <ArrowRight size={20} color="#999" style={{ flexShrink: 0 }} />
    </Link>
  );
}

// ─── Vendor Dashboard Page ────────────────────────────────
// Role-aware hub. Five states:
//   1. Not logged in → themed card grid (Log In / Apply / Guest Review / About)
//   2. Staff (admin), no vendor row → staff hub (Manage Vendors / About)
//   3. Logged in, no vendor row → onboarding form (collect full profile)
//   4. Vendor (with admin) → vendor dashboard + Manage Vendors banner
//   5. Vendor (no admin) → normal vendor dashboard
function VendorDashboardPage({ isMobile }) {
  // Single source of truth for auth + roles. No local session/vendor
  // listeners -- they live at App root via AuthContext now, so navigating
  // away and back is instant (no per-page session refetch).
  const { user, vendor, isAdmin, isLoading: authRolesLoading, signOut, refresh: refreshAuth } = useAuth();
  const session = user ? { user } : null; // shape compatibility with downstream forms
  const authReady = !authRolesLoading;
  const vendorLoading = authRolesLoading;
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [applications, setApplications] = useState({}); // keyed by event_id
  // When set, renders the VendorCheckInModal for that event id.
  const [checkingInEventId, setCheckingInEventId] = useState(null);

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

  // ─── State 1: not logged in — themed card hub ─────────────
  if (authReady && !session) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '900px', margin: '0 auto' }}>
          <SectionHeader title="Vendor Dashboard" subtitle="Last-Friday Vendor Day at Trainer Center HB" />

          {/* How it works — explicit two-step flow so first-timers know what
              the path is before they click anything. Also doubles as
              anti-confusion for returning vendors who land here unsure
              whether they already have an account. */}
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: '14px',
            padding: isMobile ? '20px' : '24px 28px',
            marginBottom: '20px',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 800,
              color: '#666',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '14px',
            }}>
              How vending works
            </div>
            {[
              { n: 1, title: 'Apply to become a partner', sub: 'One-time signup. Chef reviews and approves you as a Trainer Center HB vendor partner.' },
              { n: 2, title: 'Apply for each Vendor Day', sub: 'After approval, pick the dates you want from your dashboard. Two clicks per event.' },
              { n: 3, title: 'Show up and vend', sub: 'Chef confirms each event within a day or two. Then the date is yours.' },
            ].map(step => (
              <div key={step.n} style={{
                display: 'flex',
                gap: '14px',
                alignItems: 'flex-start',
                marginBottom: step.n === 3 ? '0' : '14px',
              }}>
                <div style={{
                  width: '32px', height: '32px', flexShrink: 0,
                  borderRadius: '16px',
                  backgroundColor: '#C8102E',
                  color: '#fff',
                  fontSize: '15px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: '32px',
                }}>{step.n}</div>
                <div style={{ flex: 1, paddingTop: '4px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '2px' }}>{step.title}</div>
                  <div style={{ fontSize: '13px', color: '#525252', lineHeight: 1.5 }}>{step.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Anti-duplicate-account warning. We had vendors create 2-3 logins
              with different email addresses, which then created duplicate
              vendor rows that can't be merged cleanly. Loud-but-friendly so
              returning users always pick Log In, never Sign Up. */}
          <div style={{
            backgroundColor: '#fef9e6',
            borderLeft: '3px solid #d97706',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '24px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: '18px', lineHeight: 1, paddingTop: '1px' }}>⚠️</div>
            <div style={{ fontSize: '13px', lineHeight: 1.5, color: '#1a1a1a' }}>
              <strong>Already a partner?</strong> Use <strong>Log In</strong> below — don't create a new account. Multiple accounts confuse approvals and we can't merge them later. If you forgot which email you used, reply to any of our emails or text Chef at (714) 951-9100.
            </div>
          </div>

          <DashboardCardGrid isMobile={isMobile}>
            <DashboardCard
              icon={<LogIn size={22} />}
              title="Log In"
              subtitle="Already a partner? Sign in to your dashboard."
              to="/vendors/apply"
              accent="#C8102E"
              accentBg="#fff0f0"
            />
            <DashboardCard
              icon={<FileEdit size={22} />}
              title="Apply to become a partner"
              subtitle="New here? Start your one-time vendor application."
              to="/vendors/apply?mode=signup"
              accent="#1a1a1a"
              accentBg="#f4f4f5"
            />
            <DashboardCard
              icon={<Eye size={22} />}
              title="Guest Review"
              subtitle="Just want to vote on vendors? Sign in as guest."
              to="/vendors/review"
              accent="#16a34a"
              accentBg="#f0fdf4"
            />
            <DashboardCard
              icon={<HelpCircle size={22} />}
              title="What is Vendor Day?"
              subtitle="Read what these events are and how they work."
              to="/vendor-day/about"
              accent="#0369a1"
              accentBg="#f0f9ff"
            />
          </DashboardCardGrid>
        </div>
      </PageWrapper>
    );
  }

  // ─── Staff (admin) WITHOUT a vendor row — staff hub ───────
  // Chase is here. Show admin actions + the about page link, no vendor flow.
  if (authReady && session && isAdmin && !vendorLoading && !vendor) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ marginBottom: '64px', maxWidth: '900px', margin: '0 auto' }}>
          <SectionHeader title="Vendor Dashboard" subtitle="Staff view — manage vendors and review applications" />
          <DashboardCardGrid isMobile={isMobile}>
            <DashboardCard
              icon={<Settings size={22} />}
              title="Manage Vendors"
              subtitle="Review applications, approve, edit, and check attendance."
              to="/staff/vendors"
              accent="#C8102E"
              accentBg="#fff0f0"
              badge="Staff"
            />
            <DashboardCard
              icon={<HelpCircle size={22} />}
              title="What is Vendor Day?"
              subtitle="Read what these events are and how they work."
              to="/vendor-day/about"
              accent="#0369a1"
              accentBg="#f0f9ff"
            />
          </DashboardCardGrid>
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
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
      </PageWrapper>
    );
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

        {/* Staff who are also vendors (Chef, Seth) get a Manage Vendors
            shortcut at the top of their own vendor dashboard so they can
            jump back into admin without bouncing through another page. */}
        {isAdmin && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <Link to="/staff/vendors" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#fff0f0', border: '1px solid #fecdd3',
              borderRadius: '12px',
              padding: isMobile ? '14px 16px' : '16px 20px',
              textDecoration: 'none', color: '#1a1a1a',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  backgroundColor: '#C8102E', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Settings size={18} />
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '2px' }}>
                    Manage Vendors <span style={{ fontSize: '0.7rem', color: '#C8102E', fontWeight: '700', marginLeft: '6px', padding: '2px 8px', backgroundColor: '#fff', borderRadius: '999px', border: '1px solid #fecdd3' }}>Staff</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>
                    Review applications, approve, edit, check attendance
                  </div>
                </div>
              </div>
              <ArrowRight size={18} color="#C8102E" />
            </Link>
          </div>
        )}

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

        {/* Check in to today's event — opens the check-in modal directly. */}
        {isApproved && todayEvent && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <DashboardActionRow
              accentBg="#16a34a"
              accentFg="#fff"
              title={`Check in to today's event`}
              subtitle={`${todayEvent.title || 'Vendor Day'} · ${new Date(todayEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
              icon={<CheckCircle2 size={18} />}
              onClick={() => setCheckingInEventId(todayEvent.id)}
              isMobile={isMobile}
            />
          </div>
        )}

        {/* View events & apply — opens the events sub-page with apply flow. */}
        {isApproved && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <DashboardActionRow
              accentBg="#fff0f0"
              accentFg="#C8102E"
              title="View events & apply"
              subtitle="See upcoming Vendor Days, apply, manage your applications"
              icon={<CalendarIcon size={18} />}
              onClick={() => navigate('/vendors/events')}
              isMobile={isMobile}
            />
          </div>
        )}

        {/* Upload event content — opens the upload event-picker. Surfaces
            only when the vendor has at least one past attended event. */}
        {isApproved && recentAttended && (
          <div style={{ maxWidth: '900px', margin: '0 auto 16px' }}>
            <DashboardActionRow
              accentBg="#1a1a1a"
              accentFg="#fff"
              title="Upload event content"
              subtitle="Pick a past event and add your photos, video, and IG links"
              icon={<UploadIcon size={18} />}
              onClick={() => navigate('/vendors/upload')}
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
      </div>
      {checkingInEventId && (
        <VendorCheckInModal
          vendorId={vendor.id}
          eventId={checkingInEventId}
          onClose={() => setCheckingInEventId(null)}
          onCheckedIn={(att) => {
            setAttendance(prev => ({ ...prev, [checkingInEventId]: att }));
            setCheckingInEventId(null);
          }}
        />
      )}
    </PageWrapper>
  );
}

// ─── Vendor Events List page (sub-route of dashboard) ────
// /vendors/events — extracts the events list out of the dashboard. Each
// event row keeps its existing apply / approved / check-in / cancelled
// behaviors via VendorEventCard. Top of page has a Back to dashboard link.
function VendorEventsListPage({ isMobile }) {
  const { vendor, isLoading: authRolesLoading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [applications, setApplications] = useState({});
  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authRolesLoading) return;
    if (!vendor) { navigate('/vendors/dashboard'); return; }
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    Promise.all([
      supabase.from('events').select('*')
        .eq('has_vendors', true)
        .gte('event_date', fourteenDaysAgo)
        .order('event_date', { ascending: true })
        .limit(20),
      supabase.from('vendor_applications').select('*').eq('vendor_id', vendor.id),
      supabase.from('vendor_attendance').select('*').eq('vendor_id', vendor.id),
    ]).then(([evRes, appsRes, attRes]) => {
      setEvents(evRes.data || []);
      const apps = {};
      (appsRes.data || []).forEach(a => { apps[a.event_id] = a; });
      setApplications(apps);
      const att = {};
      (attRes.data || []).forEach(a => { att[a.event_id] = a; });
      setAttendance(att);
      setLoading(false);
    });
  }, [vendor, authRolesLoading, navigate]);

  if (authRolesLoading || loading) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <Loader2 size={20} className="spin" /> Loading...
        </div>
      </PageWrapper>
    );
  }
  if (!vendor) return null;

  const visibleEvents = events.filter(ev => !(ev.event_date < todayISO() && !applications[ev.id]));

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '900px', margin: '0 auto' }}>
        <Link to="/vendors/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '0.85rem', fontWeight: '700', color: '#666',
          textDecoration: 'none', marginBottom: '14px',
        }}>
          ← Back to dashboard
        </Link>
        <SectionHeader title="Events & applications" subtitle="Vendor Days you can apply to or are approved for" />
        {visibleEvents.length === 0 ? (
          <div style={{
            backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
            padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
          }}>
            No Vendor Days scheduled yet. Check back soon — they happen the last Friday of every month.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {visibleEvents.map(ev => (
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
    </PageWrapper>
  );
}

// ─── Vendor Upload event picker (sub-route of dashboard) ──
// /vendors/upload (no eventId) — shows every event the vendor has either
// checked into OR has an approved application for (whether checked in
// or not), so they can pick which one to upload content for.
function VendorUploadPickerPage({ isMobile }) {
  const { vendor, isLoading: authRolesLoading } = useAuth();
  const navigate = useNavigate();
  const [pastEvents, setPastEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authRolesLoading) return;
    if (!vendor) { navigate('/vendors/dashboard'); return; }
    Promise.all([
      supabase.from('vendor_attendance').select('event_id, checked_in_at').eq('vendor_id', vendor.id),
      supabase.from('vendor_applications').select('event_id').eq('vendor_id', vendor.id).eq('status', 'approved'),
    ]).then(async ([attRes, appsRes]) => {
      const ids = new Set();
      (attRes.data || []).forEach(a => ids.add(a.event_id));
      (appsRes.data || []).forEach(a => ids.add(a.event_id));
      if (ids.size === 0) { setPastEvents([]); setLoading(false); return; }
      const { data: evs } = await supabase
        .from('events').select('*')
        .in('id', Array.from(ids))
        .lt('event_date', todayISO())
        .order('event_date', { ascending: false });
      setPastEvents(evs || []);
      setLoading(false);
    });
  }, [vendor, authRolesLoading, navigate]);

  if (authRolesLoading || loading) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <Loader2 size={20} className="spin" /> Loading...
        </div>
      </PageWrapper>
    );
  }
  if (!vendor) return null;

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '720px', margin: '0 auto' }}>
        <Link to="/vendors/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '0.85rem', fontWeight: '700', color: '#666',
          textDecoration: 'none', marginBottom: '14px',
        }}>
          ← Back to dashboard
        </Link>
        <SectionHeader title="Upload event content" subtitle="Pick a past event to upload photos, video, and IG links to" />
        {pastEvents.length === 0 ? (
          <div style={{
            backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
            padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
          }}>
            No past events to upload to yet. Once you check in (or are approved for a past event), it will show up here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pastEvents.map(ev => {
              const dateStr = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
              return (
                <Link
                  key={ev.id}
                  to={`/vendors/upload/${ev.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
                    padding: isMobile ? '14px 16px' : '16px 20px',
                    textDecoration: 'none', color: '#1a1a1a',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '50%',
                      backgroundColor: '#1a1a1a', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <UploadIcon size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: '800', marginBottom: '2px' }}>
                        {ev.title || 'Vendor Day'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>
                        {dateStr}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={18} color="#999" />
                </Link>
              );
            })}
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
    { num: 3, label: 'Promote before', desc: 'DM the next event in line to 3-10 people each cycle, plus 1 IG post tagging Trainer Center HB.' },
    { num: 4, label: 'Capture during', desc: 'Take photos and a short clip from your table.' },
    { num: 5, label: 'Upload after', desc: 'Post freely on your IG and tag Trainer Center HB as often as you like. Then upload here so it shows on our public Vendors page.' },
  ];
  const isApproved = vendorStatus === 'approved';
  const isPending = vendorStatus === 'pending';
  const isSuspended = vendorStatus === 'suspended';
  const [showWhy, setShowWhy] = useState(false);

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
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '12px', flexWrap: 'wrap', marginBottom: '14px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontSize: isMobile ? '1.3rem' : '1.6rem',
            fontWeight: '900',
            color: '#1a1a1a',
            margin: '0 0 4px 0',
            letterSpacing: '-0.02em',
          }}>
            Partnership: Want more followers?
          </h2>
          <p style={{
            fontSize: isMobile ? '0.95rem' : '1rem',
            fontWeight: '700',
            color: '#C8102E',
            margin: 0,
          }}>
            Follow the steps exactly.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowWhy(s => !s)}
          aria-label="Why this matters"
          className="icon-tap"
          style={{
            borderRadius: '50%',
            backgroundColor: showWhy ? '#1a1a1a' : '#fff',
            color: showWhy ? '#fff' : '#666',
            border: '1px solid #ddd',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.05rem', fontWeight: '900',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
          title="Why this matters"
        >
          i
        </button>
      </div>

      {showWhy && (
        <div style={{
          backgroundColor: '#fafafa', border: '1px solid #eee', borderRadius: '12px',
          padding: isMobile ? '14px 16px' : '16px 20px',
          marginBottom: '14px',
          fontSize: '0.88rem', color: '#333', lineHeight: 1.7,
        }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Why this matters.</strong> As part of our relationship, all the traffic from our site can be funneled to promote you over time as well.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>The IG algo rewards behind-the-scenes DMs</strong> more than public likes. Don't spam — genuine shares can be daily and by the dozens — but at minimum we ask for <strong>3-10 DMs per month</strong> for the next upcoming event.
          </p>
          <p style={{ margin: 0 }}>
            Tagging us and uploading after places you on our site at{' '}
            <Link to="/vendors" style={{ color: '#C8102E', fontWeight: '700' }}>pokemontrainercenter.com/vendors</Link>{' '}
            to drive traffic to you too. Make the posts great.
          </p>
        </div>
      )}
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
  // tap-row class makes the CSS gate the hover-lift on touch devices and
  // adds an :active scale press for iOS feedback. JS hover handlers are
  // also gated via HAS_HOVER so they don't fire on iOS taps.
  const handleEnter = HAS_HOVER ? e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; } : undefined;
  const handleLeave = HAS_HOVER ? e => { e.currentTarget.style.borderColor = '#eee'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; } : undefined;
  return (
    <button onClick={onClick} className="tap-row" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
      padding: isMobile ? '14px 16px' : '16px 20px',
      width: '100%', textAlign: 'left', cursor: 'pointer',
      fontFamily: 'inherit', minHeight: '64px',
      transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
    }}
    onMouseEnter={handleEnter}
    onMouseLeave={handleLeave}
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
    // The apply modal enforces non-null times; if we somehow get here
    // without them, fail loudly instead of writing null. The DB also
    // has a NOT NULL constraint on these columns now (see migration
    // 20260516_vendor_apps_time_not_null.sql).
    if (!requested_start_time || !requested_end_time) {
      throw new Error('Pick both an arrival time and a leave time before submitting.');
    }
    const { data, error: insertError } = await supabase
      .from('vendor_applications')
      .insert({
        vendor_id: vendorId,
        event_id: event.id,
        requested_start_time,
        requested_end_time,
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

  // Shared button base style for the primary action buttons so they read
  // as clearly clickable, with consistent padding, weight, and icon size.
  const primaryBtnStyle = (bg) => ({
    backgroundColor: bg, color: '#fff',
    padding: '12px 22px', borderRadius: '10px',
    fontSize: '0.95rem', fontWeight: '800',
    border: 'none', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    letterSpacing: '0.01em',
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    minWidth: '160px', justifyContent: 'center',
  });
  // Status pills for non-actionable states. Color-coded but visually
  // distinct from the buttons (smaller, no shadow, pill shape).
  const statusPill = (bg, fg, icon, label) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      backgroundColor: bg, color: fg,
      padding: '6px 12px', borderRadius: '999px',
      fontSize: '0.82rem', fontWeight: '700',
    }}>
      {icon}{label}
    </span>
  );

  // Determine the action area content for this event card based on status,
  // attendance, and whether the event is today / past / future.
  let actionEl = null;
  if (event.cancelled) {
    actionEl = statusPill('#fef2f2', '#dc2626', <AlertCircle size={14} />, 'Event cancelled');
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
        <button onClick={() => setShowApply(true)} style={primaryBtnStyle('#C8102E')}>
          <Plus size={16} /> Apply for this date
        </button>
      );
    }
  } else if (application.status === 'pending') {
    actionEl = statusPill('#fef3c7', '#92400e', <Clock size={14} />, "Pending Chef's approval");
  } else if (application.status === 'declined') {
    actionEl = statusPill('#fee2e2', '#991b1b', <AlertCircle size={14} />, 'Not approved this time');
  } else if (application.status === 'cancelled') {
    actionEl = statusPill('#f3f4f6', '#6b7280', <X size={14} />, 'Cancelled');
  } else if (application.status === 'approved') {
    if (isToday && !attendance) {
      // Event day with no check-in yet
      actionEl = (
        <button onClick={() => setShowCheckIn(true)} style={primaryBtnStyle('#16a34a')}>
          <MapPin size={16} /> Check in
        </button>
      );
    } else if (attendance) {
      // Already checked in (today or past)
      actionEl = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          {statusPill(
            '#f0fdf4', '#15803d',
            <CheckCircle2 size={14} />,
            attendance.geo_verified ? 'Checked in (verified)' : 'Checked in'
          )}
          <Link to={`/vendors/upload/${event.id}`} style={{
            backgroundColor: '#1a1a1a', color: '#fff',
            padding: '10px 18px', borderRadius: '8px',
            fontSize: '0.85rem', fontWeight: '800',
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          }}>
            <UploadIcon size={14} /> Upload content
          </Link>
        </div>
      );
    } else if (isPast) {
      // Approved but didn't check in
      actionEl = statusPill('#f3f4f6', '#6b7280', <AlertCircle size={14} />, 'Did not check in');
    } else {
      // Future approved — surface the start time so the vendor knows when
      // to show up. Falls back to a generic message if no start_time set.
      const startStr = formatTime12h(event.start_time);
      actionEl = statusPill(
        '#f0fdf4', '#15803d',
        <CheckCircle2 size={14} />,
        startStr ? `Approved — starts ${startStr}` : 'Approved — see you there'
      );
    }
  }

  return (
    <>
      <div style={{
        backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
        padding: isMobile ? '18px' : '22px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? '20px' : '32px', flexDirection: isMobile ? 'column' : 'row'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '10px',
            backgroundColor: '#f0fdf4', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <CalendarIcon size={22} color="#16a34a" />
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
        <div style={{
          display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
          flexShrink: 0,
          // Mobile: action sits below event info, left-aligned for thumb reach.
          // Desktop: action sits to the right with a subtle separator gap.
          width: isMobile ? '100%' : 'auto',
        }}>
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
    experience_level: existingVendor?.experience_level || '',
    applicant_questions: existingVendor?.applicant_questions || '',
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
    // Logo is REQUIRED on signup so Chef can ID the partner at a glance.
    // On edit, an existing logo on the vendor row counts.
    if (!isEdit && !logoFile) {
      setError('A logo is required to apply. You can use the image from your Instagram or other social media as your logo.');
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
      experience_level: form.experience_level || null,
      applicant_questions: form.applicant_questions.trim() || null,
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

          <label style={labelCss}>Vendor logo {isEdit ? '(optional)' : '*'}</label>
          <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '8px' }}>
            Square or round image works best. Shows next to your name on the public Vendors page.{!isEdit && ' You can use the image from your Instagram or other social media.'}
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
              <label style={labelCss}>Vendor experience</label>
              <select value={form.experience_level} onChange={setField('experience_level')} style={{ ...inputCss, cursor: 'pointer' }}>
                <option value="">Pick one</option>
                <option value="first_show">This is my first show</option>
                <option value="1_to_5">1–5 shows</option>
                <option value="5_to_10">5–10 shows</option>
                <option value="10_to_50">10–50 shows</option>
                <option value="50_plus">50+ shows</option>
              </select>

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

              <div style={{ height: '8px' }} />
              <label style={labelCss}>Do you have any questions?</label>
              <textarea
                value={form.applicant_questions}
                onChange={setField('applicant_questions')}
                rows={3}
                placeholder="Anything you'd like Chef to address during your review (optional)"
                style={{ ...inputCss, fontFamily: 'inherit', resize: 'vertical' }}
              />
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

// ─── vendorMatchesQuery ───────────────────────────────────
// Shared free-text search used by every vendor-list surface on the
// staff page (Newly applying, Pending, Event roster, All vendors).
// Matches against every field a vendor fills out on the application
// so Chef can find someone by social handle, specialty, referrer,
// etc. — not just name + email. Phone is normalized to digits so
// "714 458 1163" and "7144581163" both hit.
const VENDOR_HEARD_FROM_LABELS = {
  trainer_center_customer: 'shop at trainer center',
  word_of_mouth: 'word of mouth',
  social_media: 'social media',
  vendor_referral: 'another vendor referred',
  event: 'saw it at an event',
  other: 'other',
};
const VENDOR_EXPERIENCE_LABELS = {
  first_show: 'first show',
  '1_to_5':   '1 to 5 shows',
  '5_to_10':  '5 to 10 shows',
  '10_to_50': '10 to 50 shows',
  '50_plus':  '50 plus shows',
};
function vendorMatchesQuery(vendor, query) {
  if (!query) return true;
  if (!vendor) return false;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  const v = vendor;
  const candidates = [
    v.name, v.first_name, v.last_name,
    v.email,
    v.specialty, v.bio,
    v.ig_handle, v.tiktok_handle, v.fb_handle,
    v.applicant_questions,
    v.heard_from, VENDOR_HEARD_FROM_LABELS[v.heard_from],
    v.experience_level, VENDOR_EXPERIENCE_LABELS[v.experience_level],
    v.referred_by_name, v.referred_by_handle, v.referred_by_contact,
  ];
  for (const c of candidates) {
    if (c && String(c).toLowerCase().includes(q)) return true;
  }
  // Phone: digits-only substring match so 714-458-1163, (714)4581163,
  // and 7144581163 all match the same search.
  if (qDigits.length >= 3) {
    const phoneDigits = String(v.phone || '').replace(/\D/g, '');
    if (phoneDigits && phoneDigits.includes(qDigits)) return true;
  }
  return false;
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
    // Defense in depth: HTML `required` blocks empty submits in most
    // browsers, but iOS Safari has historically been loose with native
    // time inputs. Re-validate here so the DB never sees a null slot.
    if (!startTime || !endTime) {
      setError('Pick both an arrival time and a leave time.');
      return;
    }
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
        className="modal-safe-bottom smooth-scroll"
        style={{
          backgroundColor: '#fff', borderRadius: '14px',
          padding: '24px 24px 24px 24px', maxWidth: '440px', width: '100%',
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
      <div className="modal-safe-bottom smooth-scroll" style={{...modalCardStyle, maxHeight: "calc(100vh - 40px)", overflowY: "auto"}} onClick={e => e.stopPropagation()}>
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

// Stage 1: guest auth gate. Pops the unified AuthModal with intent='member'
// so signup/login happens in the same component every other surface uses.
// "Guest" is the public-facing term for someone reviewing vendors at a
// Vendor Day. The DB still calls them `members`.
function ReviewSignupGate({ isMobile }) {
  const auth = useAuth();
  const openedRef = useRef(false);

  useEffect(() => {
    if (auth.isLoading || auth.session) return;
    if (openedRef.current) return;
    openedRef.current = true;
    auth.openAuthModal({
      defaultMode: 'signup',
      intent: 'member',
      onSuccess: () => { /* parent VendorReviewPage detects new session and advances */ },
    });
  }, [auth, auth.isLoading, auth.session]);

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px', maxWidth: '560px', margin: '0 auto' }}>
        <SectionHeader
          title="Sign in as a Guest"
          subtitle="Create a quick account so you can review vendors at today's Vendor Day"
        />
        {/* Fallback CTA if the user dismissed the modal. One tap reopens. */}
        <div style={{
          backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #eee',
          padding: isMobile ? '24px 20px' : '32px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.95rem', color: '#444', margin: '0 0 18px 0', lineHeight: 1.6 }}>
            Quick signup so we can record your votes. Voting opens at the shop during today's Vendor Day.
          </p>
          <button
            onClick={() => auth.openAuthModal({
              defaultMode: 'signup',
              intent: 'member',
            })}
            style={{
              backgroundColor: '#16a34a', color: '#fff', border: 'none',
              padding: '14px 28px', borderRadius: 10,
              fontSize: '0.95rem', fontWeight: 800, cursor: 'pointer',
            }}
          >
            Continue
          </button>
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
        <Link to="/vendors/upload" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '0.85rem', fontWeight: '700', color: '#666',
          textDecoration: 'none', marginBottom: '14px',
        }}>
          ← Pick a different event
        </Link>
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
// ─── Shared rich card + detail modal for staff vendor lists ─────
// One layout used across "Newly applying", "All vendors", etc. Click a card
// → opens VendorDetailModal with everything the vendor submitted.

// ─── NextEventBadge ───────────────────────────────────────
// Pill showing a vendor's next upcoming approved event, color-coded by
// where that event sits in the chronological list of all upcoming events.
// position 0 = next event (hot red), higher positions cool toward blue/gray.
// nextEvent = null  →  renders "No upcoming events" in neutral gray.
const NEXT_EVENT_PALETTE = [
  { bg: '#fee2e2', fg: '#991b1b' }, // 0 — next event, urgent
  { bg: '#ffedd5', fg: '#9a3412' }, // 1
  { bg: '#fef3c7', fg: '#92400e' }, // 2
  { bg: '#dcfce7', fg: '#15803d' }, // 3
  { bg: '#dbeafe', fg: '#1d4ed8' }, // 4
  { bg: '#ede9fe', fg: '#5b21b6' }, // 5+
];
function NextEventBadge({ nextEvent }) {
  if (!nextEvent) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: '999px',
        backgroundColor: '#f4f4f5', color: '#71717a',
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em',
      }}>
        <CalendarIcon size={10} /> No upcoming events
      </span>
    );
  }
  const { event, position } = nextEvent;
  const palette = NEXT_EVENT_PALETTE[Math.min(position, NEXT_EVENT_PALETTE.length - 1)];
  const dateLabel = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const positionLabel = position === 0 ? 'Next' : `#${position + 1}`;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: '999px',
      backgroundColor: palette.bg, color: palette.fg,
      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em',
    }}>
      <CalendarIcon size={10} />
      {positionLabel} · {event.title || 'Vendor Day'} · {dateLabel}
    </span>
  );
}

// ─── EmailProgressDots ────────────────────────────────────
// Tiny visual bar showing which drip emails this vendor has received for a
// given event. Seven stages (T-21, T-14, T-7, T-3, T-2, T-1, T-0) lit up
// red as they fire. Both Track A (signup) and Track B (lineup) collapse
// into the same dot — if either fired for a stage, it counts as sent.
// Track label below tells the operator which track the vendor is on now
// (signup = not-yet-applied, lineup = applied).
const DRIP_STAGES = [
  { key: 't21', label: 'T-21' },
  { key: 't14', label: 'T-14' },
  { key: 't7',  label: 'T-7'  },
  { key: 't3',  label: 'T-3'  },
  { key: 't2',  label: 'T-2'  },
  { key: 't1',  label: 'T-1'  },
  { key: 't0',  label: 'T-0'  },
];
function EmailProgressDots({ emails = [], eventId, eventLabel }) {
  // Filter to the event we care about. If no eventId, use everything.
  const rows = eventId ? emails.filter(e => e.event_id === eventId) : emails;
  const hits = new Set(); // stage keys that have at least one log row
  const tracks = new Set(); // 'signup' or 'lineup' seen for this event
  for (const r of rows) {
    const [track, stage] = (r.step_key || '').split('.');
    if (stage) hits.add(stage);
    if (track) tracks.add(track);
  }
  const filledCount = hits.size;
  const currentTrack = tracks.has('lineup')
    ? 'Track B · Lineup'
    : tracks.has('signup')
      ? 'Track A · Signup'
      : null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: '#666', marginBottom: 4,
      }}>
        Drip {eventLabel ? `· ${eventLabel}` : ''} · {filledCount} of {DRIP_STAGES.length}
        {currentTrack && <span style={{ marginLeft: 6, color: filledCount > 0 ? '#C8102E' : '#9ca3af' }}>{currentTrack}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        {DRIP_STAGES.map(s => {
          const on = hits.has(s.key);
          return (
            <div key={s.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                backgroundColor: on ? '#C8102E' : '#e5e7eb',
                border: on ? '1px solid #991b1b' : '1px solid #d1d5db',
              }} />
              <span style={{ fontSize: '0.55rem', color: on ? '#C8102E' : '#9ca3af', fontWeight: 700 }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VendorRichCard({ vendor, statusBadge, decisionLine, actions, onClick, isMobile, emails, eventId, eventLabel, nextEvent }) {
  const v = vendor;
  // Desktop: split the body in half (identity left, campaign right). Mobile
  // collapses to a single column so nothing gets squeezed.
  const bodyGridCols = isMobile ? '1fr' : '1fr 1fr';
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '10px',
        padding: '14px 16px', display: 'flex', flexDirection: 'column',
        gap: '10px', fontSize: '0.85rem',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => {
        if (!onClick) return;
        e.currentTarget.style.borderColor = '#1a1a1a';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
      }}
      onMouseLeave={e => {
        if (!onClick) return;
        e.currentTarget.style.borderColor = '#eee';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* ── Header row: logo + name/status + actions ─────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        gap: '12px', flexWrap: 'wrap',
      }}>
        {/* Circular logo. "N/A" placeholder for legacy vendors. */}
        <div style={{
          width: '52px', height: '52px', flexShrink: 0,
          borderRadius: '50%', overflow: 'hidden',
          backgroundColor: v.avatar_url ? '#fff' : '#f4f4f5',
          border: '1px solid #e4e4e7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {v.avatar_url ? (
            <img
              src={v.avatar_url}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af',
              letterSpacing: '0.5px',
            }}>N/A</span>
          )}
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.95rem' }}>{v.name || '(no name)'}</strong>
            {statusBadge}
          </div>
        </div>

        {actions && (
          <div
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
          >
            {actions}
          </div>
        )}
      </div>

      {/* ── Body grid: identity LEFT · campaign RIGHT (desktop) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: bodyGridCols,
        gap: isMobile ? '10px' : '20px',
        paddingLeft: isMobile ? 0 : '64px',  // align under name on desktop (skip past the avatar)
      }}>
        {/* LEFT — identity / contact / socials */}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#555' }}>
            {v.email}
            {v.phone && <span style={{ color: '#888' }}> · {v.phone}</span>}
          </div>
          {v.specialty && (
            <div style={{ marginTop: '4px', color: '#555' }}>
              <span style={{ color: '#888' }}>Specialty: </span>{v.specialty}
            </div>
          )}
          {v.bio && (
            <div style={{ marginTop: '6px', color: '#555', whiteSpace: 'pre-wrap' }}>
              {v.bio}
            </div>
          )}
          {(v.ig_handle || v.tiktok_handle || v.fb_handle) && (
            <div style={{ marginTop: '6px', color: '#888', fontSize: '0.8rem' }}>
              {v.ig_handle && <span>IG: {v.ig_handle}</span>}
              {v.tiktok_handle && <span>{v.ig_handle ? ' · ' : ''}TikTok: {v.tiktok_handle}</span>}
              {v.fb_handle && <span>{(v.ig_handle || v.tiktok_handle) ? ' · ' : ''}FB: {v.fb_handle}</span>}
            </div>
          )}
          {(v.heard_from || v.referred_by_name) && (
            <div style={{ marginTop: '4px', color: '#888', fontSize: '0.8rem' }}>
              {v.heard_from && <span>Heard from: {String(v.heard_from).replace(/_/g, ' ')}</span>}
              {v.referred_by_name && <span>{v.heard_from ? ' · ' : ''}Referred by: {v.referred_by_name}</span>}
            </div>
          )}
        </div>

        {/* RIGHT — next-event badge, decision line, drip dots */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nextEvent !== undefined && <NextEventBadge nextEvent={nextEvent} />}
          {decisionLine && (
            <div style={{ fontSize: '0.78rem', fontWeight: '700' }}>
              {decisionLine}
            </div>
          )}
          {emails && emails.length > 0 && (
            <EmailProgressDots emails={emails} eventId={eventId} eventLabel={eventLabel} />
          )}
        </div>
      </div>
    </div>
  );
}

function VendorDetailModal({ vendor, profilesById, onClose }) {
  // Pull every vendor_application this vendor has on file so staff can see
  // attendance history + upcoming commitments inline. Hooks must run before
  // the early-return below to keep React happy.
  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);

  useEffect(() => {
    if (!vendor?.id) {
      setApps([]);
      setAppsLoading(false);
      return;
    }
    let cancelled = false;
    setAppsLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('vendor_applications')
        .select('id, status, applied_at, decided_at, requested_start_time, requested_end_time, event:events(id, title, event_date, cancelled)')
        .eq('vendor_id', vendor.id);
      if (cancelled) return;
      if (error) {
        console.warn('[VendorDetailModal] applications fetch failed', error);
        setApps([]);
      } else {
        setApps(data || []);
      }
      setAppsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [vendor?.id]);

  if (!vendor) return null;
  const v = vendor;
  // DATE columns (event_date) come back as 'YYYY-MM-DD' with no timezone.
  // new Date('2026-05-15') parses as UTC midnight, which rolls back a day
  // in any Western timezone. Append local noon so the displayed day matches
  // the actual event date.
  const fmtDate = (iso) => {
    if (!iso) return '';
    const safe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso;
    return new Date(safe).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const approver = v.approved_by ? (profilesById || {})[v.approved_by] : null;

  // Split applications into upcoming vs past. Cancelled events count as
  // neither (they're noise). "Past attended" = approved + event already passed.
  const todayISO = new Date().toISOString().slice(0, 10);
  const liveApps = apps.filter(a => a.event && !a.event.cancelled);
  const upcoming = liveApps
    .filter(a => a.event.event_date >= todayISO)
    .sort((a, b) => (a.event.event_date || '').localeCompare(b.event.event_date || ''));
  const past = liveApps
    .filter(a => a.event.event_date < todayISO)
    .sort((a, b) => (b.event.event_date || '').localeCompare(a.event.event_date || ''));
  const pastAttended = past.filter(a => a.status === 'approved');

  const appStatusBadge = (status) => {
    const map = {
      approved: { bg: '#dcfce7', fg: '#15803d', label: 'Approved' },
      pending:  { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
      rejected: { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected' },
      withdrawn:{ bg: '#f4f4f5', fg: '#3f3f46', label: 'Withdrawn' },
    };
    const m = map[status] || { bg: '#f4f4f5', fg: '#3f3f46', label: status || 'Unknown' };
    return (
      <span style={{
        fontSize: '0.65rem', fontWeight: 700,
        color: m.fg, backgroundColor: m.bg,
        padding: '2px 8px', borderRadius: '999px',
        textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>{m.label}</span>
    );
  };

  const statusColor = {
    approved: { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0' },
    pending:  { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
    suspended:{ bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' },
  }[v.status] || { bg: '#f4f4f5', fg: '#3f3f46', border: '#e4e4e7' };

  const socialLink = (kind, handle) => {
    if (!handle) return null;
    const clean = handle.replace(/^@/, '');
    const url = kind === 'ig' ? `https://instagram.com/${clean}`
              : kind === 'tt' ? `https://tiktok.com/@${clean}`
              : kind === 'fb' ? `https://facebook.com/${clean}`
              : null;
    const label = kind === 'ig' ? 'Instagram' : kind === 'tt' ? 'TikTok' : 'Facebook';
    return (
      <a key={kind} href={url} target="_blank" rel="noopener noreferrer"
         onClick={e => e.stopPropagation()}
         style={{
           display: 'inline-flex', alignItems: 'center', gap: '6px',
           padding: '6px 12px', borderRadius: '999px',
           backgroundColor: '#f4f4f5', color: '#1a1a1a',
           fontSize: '0.8rem', fontWeight: '600',
           textDecoration: 'none', border: '1px solid #e4e4e7'
         }}>
        {label}: @{clean}
      </a>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', overflow: 'auto'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#fff', borderRadius: '16px',
          maxWidth: '640px', width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '14px', right: '14px',
            background: '#f4f4f5', border: 'none', borderRadius: '50%',
            width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '16px' }}>
          {v.avatar_url && (
            <img src={v.avatar_url} alt="" style={{
              width: '64px', height: '64px', borderRadius: '50%',
              objectFit: 'cover', border: '1px solid #eee', flexShrink: 0
            }} />
          )}
          <div style={{ minWidth: 0, paddingRight: '40px' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#1a1a1a' }}>{v.name || '(no name)'}</div>
            <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{
                fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.4px',
                backgroundColor: statusColor.bg, color: statusColor.fg,
                border: `1px solid ${statusColor.border}`,
                padding: '3px 10px', borderRadius: '999px'
              }}>
                {v.status}
              </span>
              {v.created_at && (
                <span style={{ fontSize: '0.75rem', color: '#888' }}>
                  Joined {fmtDate(v.created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        <DetailSection label="Contact">
          <div>{v.email}</div>
          {v.phone && <div>{v.phone}</div>}
        </DetailSection>

        {v.specialty && (
          <DetailSection label="Specialty">
            <div>{v.specialty}</div>
          </DetailSection>
        )}

        {v.bio && (
          <DetailSection label="Bio">
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{v.bio}</div>
          </DetailSection>
        )}

        {(v.ig_handle || v.tiktok_handle || v.fb_handle) && (
          <DetailSection label="Social">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {socialLink('ig', v.ig_handle)}
              {socialLink('tt', v.tiktok_handle)}
              {socialLink('fb', v.fb_handle)}
            </div>
          </DetailSection>
        )}

        {v.experience_level && (
          <DetailSection label="Vendor experience">
            <div>{({
              first_show: 'This is my first show',
              '1_to_5':   '1–5 shows',
              '5_to_10':  '5–10 shows',
              '10_to_50': '10–50 shows',
              '50_plus':  '50+ shows',
            })[v.experience_level] || v.experience_level}</div>
          </DetailSection>
        )}

        {v.applicant_questions && (
          <DetailSection label="Questions for Chef">
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{v.applicant_questions}</div>
          </DetailSection>
        )}

        {/* Vendor-referral callout. Pulled out of the generic "heard from"
            section because Chef wants to see at a glance when a partner sent
            someone our way -- that's the most actionable referral signal. */}
        {v.heard_from === 'vendor_referral' && (
          <DetailSection label="Referred by another vendor">
            {v.referred_by_name ? (
              <div style={{
                backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: '8px', padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: '2px',
              }}>
                <div><strong>{v.referred_by_name}</strong>
                  {v.referred_by_handle && ` · @${v.referred_by_handle}`}
                </div>
                {v.referred_by_contact && (
                  <div style={{ fontSize: '0.82rem', color: '#15803d' }}>{v.referred_by_contact}</div>
                )}
              </div>
            ) : (
              <div style={{ color: '#92400e' }}>Vendor referral, but no referrer name on file.</div>
            )}
          </DetailSection>
        )}

        {v.heard_from && v.heard_from !== 'vendor_referral' && (
          <DetailSection label="How they heard about us">
            <div>{String(v.heard_from).replace(/_/g, ' ')}</div>
          </DetailSection>
        )}

        {v.status === 'approved' && approver && (
          <DetailSection label="Approval">
            <div>
              Approved by <strong>{approver.name || approver.email || 'staff'}</strong>
              {v.approved_at && ` · ${fmtDate(v.approved_at)}`}
            </div>
          </DetailSection>
        )}

        <DetailSection label="Event history">
          {appsLoading ? (
            <div style={{ color: '#888' }}>Loading…</div>
          ) : (
            <>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '14px',
                marginBottom: (upcoming.length || past.length) ? '12px' : '0',
                fontSize: '0.85rem'
              }}>
                <div>
                  <span style={{ color: '#888' }}>Past attended: </span>
                  <strong>{pastAttended.length}</strong>
                </div>
                <div>
                  <span style={{ color: '#888' }}>Upcoming: </span>
                  <strong>{upcoming.length}</strong>
                </div>
              </div>

              {upcoming.length > 0 && (
                <div style={{ marginBottom: past.length ? '12px' : '0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Upcoming</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {upcoming.map(a => (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                        padding: '8px 10px', backgroundColor: '#fafafa', borderRadius: '8px',
                        fontSize: '0.85rem',
                      }}>
                        <span style={{ fontWeight: 600 }}>{a.event.title || 'Vendor Day'}</span>
                        <span style={{ color: '#666' }}>· {fmtDate(a.event.event_date)}</span>
                        {appStatusBadge(a.status)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {past.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Past</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {past.map(a => (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                        padding: '8px 10px', backgroundColor: '#fafafa', borderRadius: '8px',
                        fontSize: '0.85rem',
                      }}>
                        <span style={{ fontWeight: 600 }}>{a.event.title || 'Vendor Day'}</span>
                        <span style={{ color: '#666' }}>· {fmtDate(a.event.event_date)}</span>
                        {appStatusBadge(a.status)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {upcoming.length === 0 && past.length === 0 && (
                <div style={{ color: '#888', fontSize: '0.85rem' }}>No event history yet.</div>
              )}
            </>
          )}
        </DetailSection>
      </div>
    </div>
  );
}

function DetailSection({ label, children }) {
  return (
    <div style={{ marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid #f4f4f5' }}>
      <div style={{
        fontSize: '0.7rem', fontWeight: '700', color: '#888',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginBottom: '6px'
      }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: '#1a1a1a' }}>{children}</div>
    </div>
  );
}

// ─── Staff Members Page (/staff/members) ────────────────
// Admin-only directory of every marketing_contact + role join. Lets staff
// search, paginate, promote to staff/vendor, remove individual subscription
// categories, and unsubscribe contacts entirely.
//
// Anti-spam guardrail: there is intentionally no UI for *adding* a contact
// to a subscription category. Staff can only remove subs, not enroll
// people. Adding a manual contact creates the row with subscriptions={}
// so no campaigns fire until the contact opts in themselves via the site.
function StaffMembersPage({ isMobile, staff }) {
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [expandedId, setExpandedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [actionBusy, setActionBusy] = useState(null); // contact_id while busy

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('staff_list_members', {
      p_search: search || null,
      p_role_filter: roleFilter,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    setLoading(false);
    if (error) {
      console.error('[staff/members] fetch failed', error);
      alert(`Could not load members: ${error.message}`);
      return;
    }
    setRows(data || []);
    setTotalCount(data && data.length > 0 ? Number(data[0].total_count || 0) : 0);
  }, [search, roleFilter, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const submitSearch = (e) => {
    e?.preventDefault?.();
    setPage(0);
    setSearch(searchInput.trim());
  };
  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(0);
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const refreshAfterMutation = async () => {
    await fetchPage();
  };

  const handleRemoveSubscription = async (row, key) => {
    if (!window.confirm(`Remove "${key}" from ${row.email}? They will stop receiving emails for that category.`)) return;
    setActionBusy(row.contact_id);
    const { error } = await supabase.rpc('staff_remove_subscription', { p_email: row.email, p_category: key });
    setActionBusy(null);
    if (error) { alert(error.message); return; }
    refreshAfterMutation();
  };
  const handleUnsubscribeAll = async (row) => {
    if (!window.confirm(`Unsubscribe ${row.email} from ALL email campaigns? This stops every drip and reminder.`)) return;
    setActionBusy(row.contact_id);
    const { error } = await supabase.rpc('staff_unsubscribe_all', { p_email: row.email });
    setActionBusy(null);
    if (error) { alert(error.message); return; }
    refreshAfterMutation();
  };
  const handlePromoteAdmin = async (row) => {
    if (!row.user_id) { alert('This contact has no auth account yet — they need to sign up first.'); return; }
    if (!window.confirm(`Promote ${row.email} to STAFF (admin)? They will be able to manage events, vendors, and the member list.`)) return;
    setActionBusy(row.contact_id);
    const { error } = await supabase.rpc('staff_promote_to_admin', { p_user_id: row.user_id });
    setActionBusy(null);
    if (error) { alert(error.message); return; }
    refreshAfterMutation();
  };
  const handlePromoteVendor = async (row) => {
    if (!row.user_id) { alert('This contact has no auth account yet — they need to sign up first.'); return; }
    if (!window.confirm(`Promote ${row.email} to VENDOR? An approved vendor row will be created (status: approved). They can fill in their profile via the vendor dashboard.`)) return;
    setActionBusy(row.contact_id);
    const proposedName = [row.first_name, row.last_name].filter(Boolean).join(' ') || null;
    const { error } = await supabase.rpc('staff_promote_to_vendor', { p_user_id: row.user_id, p_name: proposedName });
    setActionBusy(null);
    if (error) { alert(error.message); return; }
    refreshAfterMutation();
  };

  const activeSubKeys = (subs) => Object.entries(subs || {}).filter(([_, v]) => v === true).map(([k]) => k);

  const roleBadge = (label, color) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '0.65rem', fontWeight: '800',
      color: '#fff', backgroundColor: color,
      padding: '2px 8px', borderRadius: '12px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {label}
    </span>
  );

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '1100px', margin: '0 auto 64px' }}>
        <Link to="/staff/vendors" style={{
          color: '#666', fontSize: '0.78rem', fontWeight: '700',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
        }}>
          ← Back to staff dashboard
        </Link>
        <SectionHeader title="Member List" subtitle="Everyone in the directory — search, filter, manage" />

        {/* Filter + add bar */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '14px' : '18px 22px', marginBottom: '18px',
        }}>
          <form onSubmit={submitSearch} style={{
            display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center',
          }}>
            <input
              type="search"
              placeholder="Search email or name"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              style={{
                flex: '1 1 220px',
                padding: '10px 12px', fontSize: '0.9rem',
                border: '1px solid #ddd', borderRadius: '8px',
                fontFamily: 'inherit',
              }}
            />
            <select
              value={roleFilter}
              onChange={e => { setPage(0); setRoleFilter(e.target.value); }}
              style={{
                padding: '10px 12px', fontSize: '0.9rem', cursor: 'pointer',
                border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <option value="all">All roles</option>
              <option value="staff">Staff (admin)</option>
              <option value="vendor">Vendors</option>
              <option value="member">Members only</option>
              <option value="unattached">No account yet</option>
            </select>
            <button type="submit" style={{
              padding: '10px 16px', fontSize: '0.9rem', fontWeight: '700',
              backgroundColor: '#1a1a1a', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Search
            </button>
            {(search || searchInput) && (
              <button type="button" onClick={clearSearch} style={{
                padding: '10px 14px', fontSize: '0.85rem', fontWeight: '700',
                backgroundColor: '#f3f4f6', color: '#666',
                border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Clear
              </button>
            )}
            <div style={{ flex: '0 0 auto' }}>
              <button type="button" onClick={() => setShowAdd(true)} style={{
                padding: '10px 16px', fontSize: '0.9rem', fontWeight: '700',
                backgroundColor: '#C8102E', color: '#fff',
                border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                + Add contact
              </button>
            </div>
          </form>
          <p style={{ fontSize: '0.78rem', color: '#888', margin: '10px 2px 0' }}>
            {loading ? 'Loading...' : `${totalCount.toLocaleString()} contact${totalCount === 1 ? '' : 's'} matching · page ${page + 1} of ${totalPages}`}
          </p>
        </div>

        {/* Rows */}
        {!loading && rows.length === 0 && (
          <div style={{
            backgroundColor: '#fff', border: '1px dashed #ddd',
            borderRadius: '14px', padding: '40px 20px', textAlign: 'center',
            color: '#888', fontSize: '0.9rem',
          }}>
            No contacts match the current filter.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map(row => {
            const isExpanded = expandedId === row.contact_id;
            const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || (row.vendor_name || null);
            const activeKeys = activeSubKeys(row.subscriptions);
            const busy = actionBusy === row.contact_id;
            const isAdmin = !!row.is_staff_admin;
            const isVend = !!row.vendor_id;
            const isMember = !!row.member_id;
            const hasUser = !!row.user_id;
            return (
              <div key={row.contact_id} style={{
                backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
                overflow: 'hidden',
              }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : row.contact_id)}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: isMobile ? '12px 14px' : '14px 18px',
                    fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                      fontSize: '0.92rem', fontWeight: '700', color: '#1a1a1a', marginBottom: '2px',
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.email || '(no email)'}
                      </span>
                      {isAdmin && roleBadge('Staff', '#C8102E')}
                      {isVend && roleBadge('Vendor', '#16a34a')}
                      {isMember && !isVend && !isAdmin && roleBadge('Member', '#0891b2')}
                      {!hasUser && roleBadge('No account', '#6b7280')}
                      {!row.is_subscribed && roleBadge('Unsubscribed', '#9a3412')}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#666' }}>
                      {fullName || '(no name)'}
                      {row.source && <span style={{ marginLeft: '8px', color: '#999' }}>· {row.source}</span>}
                      {activeKeys.length > 0 && (
                        <span style={{ marginLeft: '8px', color: '#15803d' }}>
                          · {activeKeys.length} active sub{activeKeys.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown size={18} style={{
                    color: '#888',
                    flexShrink: 0,
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                  }} />
                </button>
                {isExpanded && (
                  <div style={{
                    borderTop: '1px solid #f3f4f6',
                    padding: isMobile ? '14px' : '16px 18px',
                    backgroundColor: '#fafafa',
                  }}>
                    {/* Subscriptions list */}
                    <p style={{ fontSize: '0.7rem', fontWeight: '800', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
                      Email subscriptions
                    </p>
                    {!row.is_subscribed && (
                      <p style={{ fontSize: '0.85rem', color: '#9a3412', margin: '0 0 10px' }}>
                        This contact is fully unsubscribed. Active categories below are paused until they re-subscribe themselves.
                      </p>
                    )}
                    {activeKeys.length === 0 ? (
                      <p style={{ fontSize: '0.85rem', color: '#888', margin: '0 0 14px' }}>
                        No active subscriptions.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                        {activeKeys.map(k => (
                          <span key={k} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            backgroundColor: '#fff', border: '1px solid #ddd',
                            borderRadius: '999px', padding: '4px 6px 4px 12px',
                            fontSize: '0.8rem', fontWeight: '700', color: '#1a1a1a',
                          }}>
                            {k}
                            <button
                              type="button"
                              onClick={() => handleRemoveSubscription(row, k)}
                              disabled={busy}
                              title={`Remove "${k}"`}
                              style={{
                                background: '#fef2f2', border: '1px solid #fecaca',
                                color: '#C8102E', borderRadius: '999px',
                                width: '22px', height: '22px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: busy ? 'wait' : 'pointer',
                                padding: 0, fontFamily: 'inherit',
                              }}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p style={{ fontSize: '0.7rem', color: '#9a3412', margin: '0 0 14px', lineHeight: '1.5' }}>
                      Anti-spam: staff can remove categories but cannot enroll a contact in new ones. Subscriptions only turn on when the contact opts in themselves.
                    </p>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {row.is_subscribed && (
                        <button
                          type="button"
                          onClick={() => handleUnsubscribeAll(row)}
                          disabled={busy}
                          style={{
                            padding: '9px 14px', fontSize: '0.82rem', fontWeight: '700',
                            backgroundColor: '#fef2f2', color: '#991b1b',
                            border: '1px solid #fecaca', borderRadius: '8px',
                            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Unsubscribe from all
                        </button>
                      )}
                      {hasUser && !isAdmin && (
                        <button
                          type="button"
                          onClick={() => handlePromoteAdmin(row)}
                          disabled={busy}
                          style={{
                            padding: '9px 14px', fontSize: '0.82rem', fontWeight: '700',
                            backgroundColor: '#fff', color: '#C8102E',
                            border: '1px solid #fecaca', borderRadius: '8px',
                            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Promote to Staff
                        </button>
                      )}
                      {hasUser && !isVend && (
                        <button
                          type="button"
                          onClick={() => handlePromoteVendor(row)}
                          disabled={busy}
                          style={{
                            padding: '9px 14px', fontSize: '0.82rem', fontWeight: '700',
                            backgroundColor: '#fff', color: '#16a34a',
                            border: '1px solid #bbf7d0', borderRadius: '8px',
                            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Promote to Vendor
                        </button>
                      )}
                      {!hasUser && (
                        <p style={{ fontSize: '0.78rem', color: '#888', margin: 0, alignSelf: 'center' }}>
                          No auth account — sign-up needed before promotion.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              style={{
                padding: '10px 16px', fontSize: '0.9rem', fontWeight: '700',
                backgroundColor: page === 0 ? '#f3f4f6' : '#fff',
                color: page === 0 ? '#aaa' : '#1a1a1a',
                border: '1px solid #ddd', borderRadius: '8px',
                cursor: page === 0 || loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ← Previous
            </button>
            <span style={{ fontSize: '0.85rem', color: '#666', fontWeight: '700' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              style={{
                padding: '10px 16px', fontSize: '0.9rem', fontWeight: '700',
                backgroundColor: page >= totalPages - 1 ? '#f3f4f6' : '#fff',
                color: page >= totalPages - 1 ? '#aaa' : '#1a1a1a',
                border: '1px solid #ddd', borderRadius: '8px',
                cursor: page >= totalPages - 1 || loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Next →
            </button>
          </div>
        )}

        {showAdd && (
          <StaffAddContactModal
            isMobile={isMobile}
            onClose={() => setShowAdd(false)}
            onAdded={() => { setShowAdd(false); setPage(0); fetchPage(); }}
          />
        )}
      </div>
    </PageWrapper>
  );
}

// Add-contact modal — companion to StaffMembersPage. Creates a marketing
// contact with empty subscriptions (anti-spam: no auto-enrollment).
function StaffAddContactModal({ onClose, onAdded, isMobile }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required.'); return; }
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('staff_add_marketing_contact', {
      p_email: email.trim(),
      p_first_name: firstName.trim() || null,
      p_last_name: lastName.trim() || null,
      p_phone: phone.trim() || null,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onAdded();
  };

  const cardStyle = isMobile ? {
    backgroundColor: '#fff', width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'auto',
  } : {
    backgroundColor: '#fff', borderRadius: '16px',
    width: '100%', maxWidth: '440px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    maxHeight: '90vh', overflow: 'auto',
  };

  const inputCss = {
    width: '100%', padding: '12px 14px', fontSize: '1rem',
    border: '1px solid #ddd', borderRadius: '10px',
    marginTop: '6px', marginBottom: '14px', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const labelCss = { fontSize: '0.72rem', color: '#999', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center',
      padding: isMobile ? 0 : '24px',
    }} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={{ padding: isMobile ? '16px 20px 12px' : '24px 28px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: '800', color: '#C8102E', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
              Member List
            </p>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0 }}>Add a contact</h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: '#f0f0f0', border: 'none', borderRadius: '50%',
            width: '32px', height: '32px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: isMobile ? '14px 20px 24px' : '18px 28px 24px' }}>
          <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: '1.6', margin: '0 0 14px' }}>
            New contacts start with empty subscriptions. They have to opt in to specific categories themselves before any campaign emails go out.
          </p>
          <label style={labelCss}>Email *</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@example.com" style={inputCss} />
          <label style={labelCss}>First name</label>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputCss} />
          <label style={labelCss}>Last name</label>
          <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputCss} />
          <label style={labelCss}>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} style={inputCss} />
          {error && <p style={{ color: '#C8102E', fontSize: '0.85rem', margin: '0 0 12px' }}>{error}</p>}
          <button type="submit" disabled={busy} style={{
            width: '100%', padding: '14px', fontSize: '0.95rem', fontWeight: '800',
            backgroundColor: busy ? '#ccc' : '#C8102E', color: '#fff',
            border: 'none', borderRadius: '10px',
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>
            {busy ? 'Saving...' : 'Add contact'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Staff Communications Page (/staff/comms) ──────────
// Single broadcast surface for admins. Two tabs:
//   - To Vendors: status-based or event-scoped vendor blasts (replaces
//     the old VendorCommsModal flow on the StaffVendorsPage).
//   - To Contacts: any subset of marketing_contacts filtered by
//     subscription category, member/vendor role, and unsubscribed gate.
// Both tabs share the subject/body composer at the bottom and route
// through the send-vendor-email edge function. Audience resolution is
// admin-gated SECURITY DEFINER on the SQL side, so a malicious client
// can't smuggle in arbitrary recipient lists.
function StaffCommsPage({ isMobile, staff }) {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'contacts' ? 'contacts' : 'vendors';
  const [tab, setTab] = useState(initialTab);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Vendors tab state (mirrors the legacy VendorCommsModal)
  const [vendorAudience, setVendorAudience] = useState('approved_all');
  const [vendorEventId, setVendorEventId] = useState('');
  const [vendorAttachEvent, setVendorAttachEvent] = useState(true);
  const [events, setEvents] = useState([]);
  const [allVendors, setAllVendors] = useState([]);

  // Contacts tab state
  const [contactSubsAny, setContactSubsAny] = useState(new Set()); // empty = no category filter
  // Role buckets: empty by default so a fresh form targets nobody. Admin
  // has to deliberately pick which audience to email.
  const [contactRoles, setContactRoles] = useState(new Set());
  const [includeUnsubscribed, setIncludeUnsubscribed] = useState(false);
  const [contactCount, setContactCount] = useState(null);
  const [contactCountLoading, setContactCountLoading] = useState(false);

  // Fetch supporting data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [evRes, vRes] = await Promise.all([
        supabase.from('events')
          .select('id, title, event_date, has_vendors, vendor_applications(id, vendor_id, status)')
          .eq('has_vendors', true)
          .order('event_date', { ascending: false }),
        supabase.from('vendors').select('id, status'),
      ]);
      if (cancelled) return;
      setEvents(evRes.data || []);
      setAllVendors(vRes.data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  // Live count for vendor audience (cheap client-side derivation)
  const vendorEventScoped = ['approved_not_applied', 'applied_any', 'approved_for_event', 'pending_for_event'];
  const vendorNeedsEvent = vendorEventScoped.includes(vendorAudience);
  const vendorCount = (() => {
    if (vendorAudience === 'all') return allVendors.length;
    if (vendorAudience === 'approved_all') return allVendors.filter(v => v.status === 'approved').length;
    if (vendorAudience === 'pending_all') return allVendors.filter(v => v.status === 'pending').length;
    if (!vendorNeedsEvent || !vendorEventId) return null;
    const ev = events.find(e => e.id === vendorEventId);
    if (!ev) return null;
    const apps = ev.vendor_applications || [];
    if (vendorAudience === 'approved_not_applied') {
      const applied = new Set(apps.map(a => a.vendor_id));
      return allVendors.filter(v => v.status === 'approved' && !applied.has(v.id)).length;
    }
    if (vendorAudience === 'applied_any') return apps.length;
    if (vendorAudience === 'approved_for_event') return apps.filter(a => a.status === 'approved').length;
    if (vendorAudience === 'pending_for_event') return apps.filter(a => a.status === 'pending').length;
    return null;
  })();

  const buildContactAudienceSpec = useCallback(() => ({
    base: 'marketing_contacts',
    include_unsubscribed: includeUnsubscribed,
    roles: Array.from(contactRoles),
    subs_any: Array.from(contactSubsAny),
  }), [includeUnsubscribed, contactRoles, contactSubsAny]);

  // Refresh marketing_contacts count when filters change.
  useEffect(() => {
    if (tab !== 'contacts') return;
    let cancelled = false;
    setContactCountLoading(true);
    (async () => {
      const { data, error: e } = await supabase.rpc('staff_audience_count', {
        p_audience: buildContactAudienceSpec(),
      });
      if (cancelled) return;
      setContactCountLoading(false);
      if (e) {
        console.error('[comms/contacts] count failed', e);
        setContactCount(null);
        return;
      }
      setContactCount(Number(data || 0));
    })();
    return () => { cancelled = true; };
  }, [tab, buildContactAudienceSpec]);

  const toggleSubsKey = (key) => {
    setContactSubsAny(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleRole = (key) => {
    setContactRoles(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const ROLE_OPTIONS = [
    { key: 'staff',   label: 'Staff Members',                    color: '#C8102E', help: 'Admin accounts.' },
    { key: 'vendors', label: 'Vendors',                          color: '#16a34a', help: 'Anyone with a vendor profile.' },
    { key: 'members', label: 'Members (not vendors or staff)',   color: '#0891b2', help: 'Anyone with an account who is not a vendor or staff.' },
  ];

  const sortedEvents = (() => {
    const todayStr = todayISO();
    return events.slice().sort((a, b) => {
      const aPast = a.event_date < todayStr;
      const bPast = b.event_date < todayStr;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast
        ? b.event_date.localeCompare(a.event_date)
        : a.event_date.localeCompare(b.event_date);
    });
  })();
  const fmtEventOption = (ev) => {
    const todayStr = todayISO();
    const d = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const past = ev.event_date < todayStr;
    return `${past ? '(past) ' : ''}${ev.title || 'Vendor Day'} · ${d}`;
  };

  const send = async () => {
    setError('');
    setResult(null);
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!body.trim()) { setError('Message body is required.'); return; }

    let payload;
    let recipientCount;
    if (tab === 'vendors') {
      if (vendorNeedsEvent && !vendorEventId) { setError('Pick an event for this audience.'); return; }
      if (vendorCount === 0) { setError('No vendors match this audience.'); return; }
      recipientCount = vendorCount;
      payload = {
        type: 'vendor_broadcast',
        audience: vendorAudience,
        event_id: vendorNeedsEvent ? vendorEventId : undefined,
        subject: subject.trim(),
        body_text: body.trim(),
        attach_event: vendorNeedsEvent && vendorAttachEvent,
      };
    } else {
      if (contactCount === null || contactCount === 0) { setError('No contacts match this filter.'); return; }
      recipientCount = contactCount;
      payload = {
        type: 'marketing_contacts_broadcast',
        audience_spec: buildContactAudienceSpec(),
        subject: subject.trim(),
        body_text: body.trim(),
      };
    }

    if (!window.confirm(`Send to ${recipientCount} ${tab === 'vendors' ? 'vendor' : 'contact'}${recipientCount === 1 ? '' : 's'}? BCC will go to chef@trainercenter.com.`)) return;
    setSending(true);
    try {
      const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-vendor-email`;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || process.env.REACT_APP_SUPABASE_ANON_KEY;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Send failed');
      setResult(data);
      setSubject('');
      setBody('');
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  };

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => { setTab(key); setResult(null); setError(''); }}
      style={{
        flex: 1,
        background: tab === key ? '#fff' : 'transparent',
        border: tab === key ? '1px solid #e5e7eb' : '1px solid transparent',
        boxShadow: tab === key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '0.9rem',
        fontWeight: '800',
        color: tab === key ? '#1a1a1a' : '#6b7280',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '900px', margin: '0 auto 64px' }}>
        <Link to="/staff/vendors" style={{
          color: '#666', fontSize: '0.78rem', fontWeight: '700',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
        }}>
          ← Back to staff dashboard
        </Link>
        <SectionHeader title="Communication" subtitle="Compose a broadcast — vendors or contacts" />

        {/* Tab strip */}
        <div role="tablist" style={{
          display: 'flex',
          gap: '6px',
          padding: '4px',
          backgroundColor: '#f3f4f6',
          borderRadius: '12px',
          marginBottom: '20px',
        }}>
          {tabBtn('vendors', 'To Vendors')}
          {tabBtn('contacts', 'To Contacts')}
        </div>

        {/* Audience picker per tab */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '18px' : '22px 26px', marginBottom: '18px',
        }}>
          {tab === 'vendors' ? (
            <>
              <Field label="Audience">
                <select value={vendorAudience} onChange={e => setVendorAudience(e.target.value)} style={selectStyle}>
                  <option value="approved_all">All approved partners</option>
                  <option value="pending_all">All pending applicants</option>
                  <option value="all">Every vendor (approved + pending + suspended)</option>
                  <option value="approved_not_applied">Approved partners NOT signed up for this event</option>
                  <option value="approved_for_event">Approved for this event</option>
                  <option value="pending_for_event">Pending for this event</option>
                  <option value="applied_any">Anyone who applied for this event (any status)</option>
                </select>
              </Field>
              {vendorNeedsEvent && (
                <Field label="Event">
                  <select value={vendorEventId} onChange={e => setVendorEventId(e.target.value)} style={selectStyle}>
                    <option value="">— Pick an event —</option>
                    {sortedEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>{fmtEventOption(ev)}</option>
                    ))}
                  </select>
                </Field>
              )}
              {vendorNeedsEvent && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', marginBottom: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={vendorAttachEvent} onChange={e => setVendorAttachEvent(e.target.checked)} />
                  <span style={{ fontSize: '0.85rem', color: '#444' }}>Attach an event card at the bottom of the email</span>
                </label>
              )}
              <div style={{
                backgroundColor: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: '8px', padding: '12px 14px',
                fontSize: '0.9rem', color: '#1f2937',
              }}>
                <strong>{vendorCount === null ? '—' : vendorCount}</strong> vendor{vendorCount === 1 ? '' : 's'} will receive this email.
              </div>
            </>
          ) : (
            <>
              <Field label="Role gates">
                <p style={{ fontSize: '0.78rem', color: '#888', margin: '0 0 8px' }}>
                  Pick at least one role to start including people. Nothing is selected by default — a blank form sends to nobody.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                  {ROLE_OPTIONS.map(opt => {
                    const checked = contactRoles.has(opt.key);
                    return (
                      <label key={opt.key} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                        padding: '12px 14px',
                        backgroundColor: '#fff',
                        color: checked ? '#1a1a1a' : '#666',
                        borderRadius: '10px',
                        border: `1px solid ${checked ? '#e5e7eb' : '#f0f0f0'}`,
                        borderLeft: `3px solid ${opt.color}`,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(opt.key)}
                          style={{ width: '18px', height: '18px', accentColor: opt.color, flexShrink: 0, marginTop: '2px' }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: '800' }}>{opt.label}</span>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: '#888', marginTop: '2px', lineHeight: '1.4' }}>{opt.help}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Field label="Mark people with the following notifications">
                <p style={{ fontSize: '0.78rem', color: '#888', margin: '0 0 8px' }}>
                  Optional second filter — narrows the audience to people who have at least one of these categories on. Leave all unchecked to include everyone in the picked roles.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                  {REMINDER_CATEGORY_KEYS.map(key => {
                    const cat = CATEGORIES[key];
                    if (!cat) return null;
                    const checked = contactSubsAny.has(key);
                    return (
                      <label key={key} style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '10px 12px',
                        backgroundColor: '#fff',
                        color: checked ? '#1a1a1a' : '#888',
                        borderRadius: '8px',
                        border: `1px solid ${checked ? '#e5e7eb' : '#f0f0f0'}`,
                        borderLeft: `3px solid ${cat.color}`,
                        cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: '700',
                        userSelect: 'none',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSubsKey(key)}
                          style={{ width: '16px', height: '16px', accentColor: cat.color, flexShrink: 0 }}
                        />
                        {cat.label}
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Field label="Advanced">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeUnsubscribed} onChange={e => setIncludeUnsubscribed(e.target.checked)} />
                  <span style={{ fontSize: '0.85rem', color: '#9a3412' }}>Include unsubscribed contacts (use with care — bypasses opt-outs)</span>
                </label>
              </Field>
              <div style={{
                backgroundColor: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: '8px', padding: '12px 14px',
                fontSize: '0.9rem', color: '#1f2937',
              }}>
                {contactCountLoading
                  ? 'Counting…'
                  : <><strong>{contactCount === null ? '—' : contactCount.toLocaleString()}</strong> contact{contactCount === 1 ? '' : 's'} will receive this email.</>}
              </div>
            </>
          )}
        </div>

        {/* Composer */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '18px' : '22px 26px',
        }}>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 14px' }}>
            BCCs <code style={{ fontSize: '0.85rem' }}>chef@trainercenter.com</code> on every send. Plain text — line breaks become paragraphs in the email body.
          </p>
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Quick update on May 29 layout"
              style={inputStyle}
            />
          </Field>
          <Field label="Message">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Plain text. Line breaks become paragraphs."
              rows={isMobile ? 8 : 10}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }}
            />
          </Field>
          {error && (
            <p style={{ color: '#C8102E', fontSize: '0.85rem', margin: '0 0 12px' }}>{error}</p>
          )}
          {result && (
            <div style={{
              backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '8px', padding: '12px 14px', marginBottom: '14px',
              fontSize: '0.9rem', color: '#15803d',
            }}>
              Sent to <strong>{result.count}</strong>{result.failed && result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}.
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              style={{
                padding: '13px 26px', fontSize: '0.95rem', fontWeight: '800',
                backgroundColor: sending ? '#ccc' : '#C8102E', color: '#fff',
                border: 'none', borderRadius: '10px',
                cursor: sending ? 'wait' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {sending ? 'Sending…' : `Send to ${tab === 'vendors' ? (vendorCount ?? '?') : (contactCount ?? '?')}`}
            </button>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Staff Analytics Page (/staff/analytics) ───────────────
// Admin-only dashboard mirroring the daily SEO digest email. Pulls:
//   - GSC clicks/queries/pages via the staff-gsc-analytics Edge Function
//     (the function holds the service-account key and verifies admin)
//   - page_visits aggregations via direct client query (admin RLS policy)
// Lets staff pick any date (default: yesterday) and see hero metrics,
// where visitors came from, engagement, top queries, and top pages.
function StaffAnalyticsPage({ isMobile }) {
  const { user, isAdmin, isLoading: authLoading } = useAuth();

  const todayPT = new Date();
  const yesterdayPT = new Date(todayPT);
  yesterdayPT.setDate(yesterdayPT.getDate() - 1);
  const toISO = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const shiftDays = (iso, days) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return toISO(d);
  };
  const daysBetween = (start, end) => {
    const s = new Date(start + 'T12:00:00').getTime();
    const e = new Date(end + 'T12:00:00').getTime();
    return Math.round((e - s) / 86400000) + 1;
  };

  // Default: last 30 days ending today (so includes everything we have).
  // endDate is exclusive of the future, startDate is rangeDays-1 days before.
  const [endDate, setEndDate] = useState(toISO(todayPT));
  const [startDate, setStartDate] = useState(shiftDays(toISO(todayPT), -29));
  const [gscData, setGscData] = useState(null);
  const [gscError, setGscError] = useState(null);
  const [gscLoading, setGscLoading] = useState(false);
  const [visits, setVisits] = useState(null);
  const [visitsPrev, setVisitsPrev] = useState(null);
  const [visitsError, setVisitsError] = useState(null);
  const [visitsLoading, setVisitsLoading] = useState(false);

  // ─── Source categorization (mirrors trackVisit.js + python digest) ───
  const categorize = (host, aiBot) => {
    if (aiBot) {
      const map = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', copilot: 'Copilot', grok: 'Grok', 'other-ai': 'Other AI' };
      return map[aiBot] || aiBot;
    }
    if (!host) return 'Direct';
    const h = host.toLowerCase();
    if (h.includes('chatgpt.com') || h.includes('chat.openai') || h.includes('openai.com')) return 'ChatGPT';
    if (h.includes('claude.ai') || h.includes('anthropic.com')) return 'Claude';
    if (h.includes('perplexity.ai') || h.includes('perplexity.com')) return 'Perplexity';
    if (h.includes('gemini.google') || h.includes('bard.google') || h.includes('aistudio.google')) return 'Gemini';
    if (h.includes('copilot.microsoft') || h.includes('bing.com/chat')) return 'Copilot';
    if (h.includes('grok.com') || h.includes('x.ai')) return 'Grok';
    if (h.includes('you.com')) return 'You.com';
    if (h.includes('google.')) return 'Google Search';
    if (h.includes('bing.com') || h.includes('duckduckgo.com')) return 'Bing/DuckDuckGo';
    if (h.includes('instagram.com') || h.includes('l.instagram.com')) return 'Instagram';
    if (h.includes('tiktok.com')) return 'TikTok';
    if (h.includes('facebook.com') || h.includes('fb.com') || h.includes('m.facebook.com')) return 'Facebook';
    if (h.includes('twitter.com') || h === 't.co' || h.includes('x.com')) return 'Twitter / X';
    if (h.includes('reddit.com')) return 'Reddit';
    if (h.includes('linkedin.com') || h.includes('lnkd.in')) return 'LinkedIn';
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'YouTube';
    if (h.includes('pokemontrainercenter.com')) return null;
    return host;
  };

  const friendlyPath = (path) => {
    if (!path || path === '/') return 'Home';
    const clean = path.split('?')[0].split('#')[0];
    if (clean === '/' || clean === '') return 'Home';
    return clean.replace(/^\//, '').split('/').map(p =>
      p.split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    ).join(' › ');
  };

  const styleForSource = (label) => {
    const AI = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot', 'Grok', 'Other AI', 'You.com'];
    const SEARCH = ['Google Search', 'Bing/DuckDuckGo'];
    const SOCIAL = ['Instagram', 'TikTok', 'Facebook', 'Twitter / X', 'Reddit', 'LinkedIn', 'YouTube'];
    if (AI.includes(label)) return { tag: 'AI', tagBg: '#ede9fe', tagFg: '#6d28d9', bar: '#7c3aed' };
    if (SEARCH.includes(label)) return { tag: 'Search', tagBg: '#dbeafe', tagFg: '#1d4ed8', bar: '#2563eb' };
    if (SOCIAL.includes(label)) return { tag: 'Social', tagBg: '#fce7f3', tagFg: '#be185d', bar: '#db2777' };
    if (label === 'Direct') return { tag: 'Direct', tagBg: '#f3f4f6', tagFg: '#525252', bar: '#9ca3af' };
    return { tag: 'Other', tagBg: '#fef3c7', tagFg: '#92400e', bar: '#d97706' };
  };

  // ─── Fetch GSC for the selected range via Edge Function ───
  const fetchGsc = useCallback(async (start, end) => {
    setGscLoading(true);
    setGscError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');
      const resp = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/staff-gsc-analytics`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ startDate: start, endDate: end }),
        }
      );
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setGscData(json);
    } catch (err) {
      setGscError(err.message);
      setGscData(null);
    } finally {
      setGscLoading(false);
    }
  }, []);

  // ─── Fetch page_visits for the selected range + previous equal window ───
  const fetchVisits = useCallback(async (start, end) => {
    setVisitsLoading(true);
    setVisitsError(null);
    try {
      const startDT = new Date(start + 'T00:00:00Z');
      const endDT = new Date(end + 'T00:00:00Z');
      endDT.setDate(endDT.getDate() + 1); // inclusive of end day
      // Previous equal-length window for DoD comparison
      const rangeDays = daysBetween(start, end);
      const prevStart = new Date(startDT);
      prevStart.setDate(prevStart.getDate() - rangeDays);
      const prevEnd = new Date(startDT);

      const [cur, prev] = await Promise.all([
        supabase.from('page_visits')
          .select('path,referrer_host,ai_bot,session_id,created_at')
          .gte('created_at', startDT.toISOString())
          .lt('created_at', endDT.toISOString())
          .limit(50000),
        supabase.from('page_visits')
          .select('path,referrer_host,ai_bot,session_id,created_at')
          .gte('created_at', prevStart.toISOString())
          .lt('created_at', prevEnd.toISOString())
          .limit(50000),
      ]);
      if (cur.error) throw cur.error;
      if (prev.error) throw prev.error;
      setVisits(cur.data || []);
      setVisitsPrev(prev.data || []);
    } catch (err) {
      setVisitsError(err.message);
      setVisits(null);
      setVisitsPrev(null);
    } finally {
      setVisitsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchGsc(startDate, endDate);
    fetchVisits(startDate, endDate);
  }, [startDate, endDate, isAdmin, fetchGsc, fetchVisits]);

  // ─── Aggregations ───
  const aggregate = (rows) => {
    if (!rows) return { pageviews: 0, sessions: 0, sources: [], pages: [], multiPage: [] };
    const pageviews = rows.length;
    const sessionIds = new Set(rows.map(r => r.session_id).filter(Boolean));
    const sessions = sessionIds.size;
    // Sources
    const srcMap = {};
    for (const r of rows) {
      const label = categorize(r.referrer_host, r.ai_bot);
      if (!label) continue;
      if (!srcMap[label]) srcMap[label] = { visits: 0, sessions: new Set() };
      srcMap[label].visits++;
      if (r.session_id) srcMap[label].sessions.add(r.session_id);
    }
    const sources = Object.entries(srcMap)
      .map(([label, v]) => ({ label, visits: v.visits, sessions: v.sessions.size }))
      .sort((a, b) => b.visits - a.visits);
    // Top pages
    const pageMap = {};
    for (const r of rows) {
      const p = r.path || '/';
      if (!pageMap[p]) pageMap[p] = { views: 0, sessions: new Set() };
      pageMap[p].views++;
      if (r.session_id) pageMap[p].sessions.add(r.session_id);
    }
    const pages = Object.entries(pageMap)
      .map(([path, v]) => ({ path, views: v.views, sessions: v.sessions.size }))
      .sort((a, b) => b.views - a.views);
    // Multi-page sessions (with paths in order + duration approx)
    const sessMap = {};
    for (const r of rows) {
      if (!r.session_id) continue;
      if (!sessMap[r.session_id]) sessMap[r.session_id] = [];
      sessMap[r.session_id].push({ path: r.path, ts: new Date(r.created_at).getTime() });
    }
    const multiPage = Object.entries(sessMap)
      .filter(([_, evs]) => evs.length > 1)
      .map(([sid, evs]) => {
        evs.sort((a, b) => a.ts - b.ts);
        return {
          sessionId: sid,
          paths: evs.map(e => e.path),
          durationSec: Math.round((evs[evs.length - 1].ts - evs[0].ts) / 1000),
        };
      })
      .sort((a, b) => b.paths.length - a.paths.length);
    return { pageviews, sessions, sources, pages, multiPage };
  };

  const agg = aggregate(visits);
  const aggPrev = aggregate(visitsPrev);
  const avgPagesPerSession = agg.sessions > 0 ? agg.pageviews / agg.sessions : 0;

  const pctDelta = (cur, prev) => {
    if (prev === 0 && cur === 0) return { label: 'flat', color: '#666' };
    if (prev === 0) return { label: 'new', color: '#16a34a' };
    const p = ((cur - prev) / prev) * 100;
    if (p > 0) return { label: `Up ${p.toFixed(0)}%`, color: '#16a34a' };
    if (p < 0) return { label: `Down ${(-p).toFixed(0)}%`, color: '#dc2626' };
    return { label: 'flat', color: '#666' };
  };

  // ─── Auth gate ───
  if (authLoading) {
    return <PageWrapper isMobile={isMobile}><p style={{ textAlign: 'center', color: '#666' }}>Loading...</p></PageWrapper>;
  }
  if (!user) {
    return <PageWrapper isMobile={isMobile}><p style={{ textAlign: 'center', color: '#666' }}>Please log in.</p></PageWrapper>;
  }
  if (!isAdmin) {
    return <StaffBypassScreen isMobile={isMobile} title="Staff only" body="The analytics dashboard is admin-only." linkTo="/" linkLabel="Back to home" />;
  }

  // ─── Render helpers ───
  const Card = ({ children }) => (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: isMobile ? 20 : 24, marginBottom: 18 }}>
      {children}
    </div>
  );

  const eyebrow = (text, accent = '#C8102E') => (
    <div style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{text}</div>
  );

  const HeroStat = ({ label, value, sub, deltaInfo }) => (
    <div style={{ flex: 1, minWidth: isMobile ? '100%' : 160, padding: '14px 16px', background: '#fafafa', border: '1px solid #eee', borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#1a1a1a', marginTop: 2, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 }}>{sub}</div>}
      {deltaInfo && <div style={{ fontSize: 11, color: deltaInfo.color, marginTop: 4, fontWeight: 700 }}>{deltaInfo.label} vs day before</div>}
    </div>
  );

  // Date preset helpers — set a range ending today
  const setRange = (numDays) => {
    const end = toISO(todayPT);
    setEndDate(end);
    setStartDate(shiftDays(end, -(numDays - 1)));
  };
  const setSingleDay = (iso) => {
    setStartDate(iso);
    setEndDate(iso);
  };

  // Current range identifier (for highlighting active preset)
  const rangeDays = daysBetween(startDate, endDate);
  const isLast30 = endDate === toISO(todayPT) && rangeDays === 30;
  const isLast7 = endDate === toISO(todayPT) && rangeDays === 7;
  const isToday = startDate === toISO(todayPT) && endDate === toISO(todayPT);
  const isYesterday = startDate === toISO(yesterdayPT) && endDate === toISO(yesterdayPT);

  const presetBtnStyle = (active) => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 600,
    border: active ? 'none' : '1px solid #ddd', borderRadius: 8,
    background: active ? '#1a1a1a' : '#fff',
    color: active ? '#fff' : '#1a1a1a', cursor: 'pointer',
  });

  const rangeLabel = startDate === endDate
    ? startDate
    : `${startDate} → ${endDate} · ${rangeDays} days`;

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: 900, margin: '0 auto', marginBottom: 64 }}>
        <SectionHeader title="Analytics" subtitle="Daily SEO digest, on demand. Admin only." />

        {/* Date range selector bar */}
        <Card>
          {eyebrow('Date range', '#C8102E')}

          {/* Presets */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setRange(30)} style={presetBtnStyle(isLast30)}>Last 30 days</button>
            <button onClick={() => setRange(7)} style={presetBtnStyle(isLast7)}>Last 7 days</button>
            <button onClick={() => setSingleDay(toISO(yesterdayPT))} style={presetBtnStyle(isYesterday)}>Yesterday</button>
            <button onClick={() => setSingleDay(toISO(todayPT))} style={presetBtnStyle(isToday)}>Today (live)</button>
            <button onClick={() => { fetchGsc(startDate, endDate); fetchVisits(startDate, endDate); }} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 8, background: '#C8102E', color: '#fff', cursor: 'pointer', marginLeft: 'auto' }}>Refresh</button>
          </div>

          {/* Custom range */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: '#666' }}>
            <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10, color: '#888' }}>Custom:</span>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
            />
            <span>to</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={toISO(todayPT)}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
            />
            <span style={{ marginLeft: 8 }}>{rangeDays} day{rangeDays !== 1 ? 's' : ''}</span>
          </div>
        </Card>

        {/* ───── Hero: total traffic (all sources, leads) ───── */}
        <Card>
          {eyebrow(`Total traffic · ${rangeLabel}`)}
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
            All-source traffic to your site. Includes Google, Instagram, AI assistants, direct, everything. Comparison is vs previous equal-length window.
          </p>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10 }}>
            <HeroStat
              label="Total visitors"
              value={visitsLoading ? '...' : agg.sessions}
              sub="Unique sessions. Each one is a distinct visit."
              deltaInfo={pctDelta(agg.sessions, aggPrev.sessions)}
            />
            <HeroStat
              label="Pageviews"
              value={visitsLoading ? '...' : agg.pageviews}
              sub="Every page load (including internal navs)"
              deltaInfo={pctDelta(agg.pageviews, aggPrev.pageviews)}
            />
            <HeroStat
              label="Pages / session"
              value={visitsLoading ? '...' : avgPagesPerSession.toFixed(1)}
              sub="Higher = stickier. 1.0 means everyone bounced after one page."
            />
          </div>
          {visitsError && <p style={{ marginTop: 12, fontSize: 12, color: '#dc2626' }}>Visits: {visitsError}</p>}
        </Card>

        {/* ───── Where they came from (sources breakdown — moved up) ───── */}
        <Card>
          {eyebrow(`Where visitors came from · ${rangeLabel}`)}
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
            <strong>{agg.pageviews} pageview{agg.pageviews !== 1 ? 's' : ''}</strong> from <strong>{agg.sessions} session{agg.sessions !== 1 ? 's' : ''}</strong>. Each row is the best guess at where that visit started.
          </p>
          {agg.sources.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic', margin: 0 }}>No visits logged for this date.</p>
          ) : (
            agg.sources.map(s => {
              const style = styleForSource(s.label);
              const pct = agg.pageviews > 0 ? (s.visits / agg.pageviews * 100) : 0;
              return (
                <div key={s.label} style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                      <span style={{ display: 'inline-block', background: style.tagBg, color: style.tagFg, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4, marginRight: 8 }}>{style.tag}</span>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{s.visits} · {pct.toFixed(0)}%</div>
                  </div>
                  <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, marginTop: 8 }}>
                    <div style={{ height: 6, width: `${Math.max(pct, 2)}%`, background: style.bar, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 12, color: '#525252', marginTop: 6 }}>
                    {s.sessions} unique {s.sessions === 1 ? 'session' : 'sessions'}
                    {s.label === 'Direct' && <span style={{ fontStyle: 'italic', color: '#888' }}> — typed URLs, bookmarks, Grok citations, and other referrer-stripped tools</span>}
                  </div>
                </div>
              );
            })
          )}
        </Card>

        {/* ───── Most-viewed pages ───── */}
        <Card>
          {eyebrow(`Most-viewed pages · ${rangeLabel}`)}
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
            Counts every internal nav too — what people look at once they're on the site.
          </p>
          {agg.pages.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic', margin: 0 }}>No pages viewed this date.</p>
          ) : (
            agg.pages.slice(0, 8).map(p => {
              const max = agg.pages[0].views || 1;
              const pct = Math.max((p.views / max) * 100, 4);
              return (
                <div key={p.path} style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                      {friendlyPath(p.path)}
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 500, fontFamily: 'monospace', marginTop: 1 }}>{p.path}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{p.views} view{p.views !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ height: 5, background: '#e5e7eb', borderRadius: 3, marginTop: 8 }}>
                    <div style={{ height: 5, width: `${pct}%`, background: '#0284c7', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 12, color: '#525252', marginTop: 6 }}>{p.sessions} unique {p.sessions === 1 ? 'visitor' : 'visitors'}</div>
                </div>
              );
            })
          )}
        </Card>

        {/* ───── Google Search deep-dive (demoted — bottom of dash) ───── */}
        <Card>
          {eyebrow(`Google Search performance · ${rangeLabel}`, '#1d4ed8')}
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
            Just the Google Search portion of your traffic. Different from the "Google Search" row above — these are GSC numbers (what Google says happened), with a 2-3 day data lag.
          </p>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10 }}>
            <HeroStat
              label="Google clicks"
              value={gscLoading ? '...' : (gscData?.totals.clicks ?? '—')}
              sub="People who clicked from a Google result"
            />
            <HeroStat
              label="Impressions"
              value={gscLoading ? '...' : (gscData?.totals.impressions?.toLocaleString() ?? '—')}
              sub="Times your site appeared in results"
            />
            <HeroStat
              label="CTR"
              value={gscLoading ? '...' : (gscData ? `${gscData.totals.ctr.toFixed(2)}%` : '—')}
              sub="Clicks ÷ impressions"
            />
            <HeroStat
              label="Avg position"
              value={gscLoading ? '...' : (gscData ? gscData.totals.position.toFixed(1) : '—')}
              sub="1=top of page 1. 11+=page 2+"
            />
          </div>
          {gscError && <p style={{ marginTop: 12, fontSize: 12, color: '#dc2626' }}>GSC: {gscError}</p>}
        </Card>

        {/* GSC top queries */}
        <Card>
          {eyebrow(`What people searched on Google · ${rangeLabel}`, '#1d4ed8')}
          {gscLoading ? <p style={{ fontSize: 13, color: '#888' }}>Loading...</p> :
            !gscData?.queries?.length ? <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic', margin: 0 }}>No GSC query data for this range (2-3 day lag may still apply).</p> :
            gscData.queries.slice(0, 10).map(q => (
              <div key={q.query} style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, marginBottom: 8, borderLeft: '3px solid #1d4ed8' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>"{q.query}"</div>
                <div style={{ fontSize: 12, color: '#525252', marginTop: 3 }}>
                  {q.clicks} click{q.clicks !== 1 ? 's' : ''} · ranked <strong>#{q.position.toFixed(0)}</strong> · seen {q.impressions} times
                </div>
              </div>
            ))
          }
        </Card>

        {/* GSC top pages */}
        <Card>
          {eyebrow(`Top pages from Google · ${rangeLabel}`, '#1d4ed8')}
          {gscLoading ? <p style={{ fontSize: 13, color: '#888' }}>Loading...</p> :
            !gscData?.pages?.length ? <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic', margin: 0 }}>No GSC page data for this range.</p> :
            gscData.pages.slice(0, 8).map(p => {
              const path = p.page.replace('https://pokemontrainercenter.com', '') || '/';
              return (
                <div key={p.page} style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{friendlyPath(path)}</div>
                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', marginTop: 1 }}>{path}</div>
                  <div style={{ fontSize: 12, color: '#525252', marginTop: 5 }}>
                    {p.clicks} click{p.clicks !== 1 ? 's' : ''} · seen {p.impressions} times
                  </div>
                </div>
              );
            })
          }
        </Card>

        {/* Multi-page sessions (power user) */}
        {agg.multiPage.length > 0 && (
          <Card>
            {eyebrow(`Multi-page sessions · ${rangeLabel}`)}
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
              Visitors who clicked through more than one page. Higher = more engaged session.
            </p>
            {agg.multiPage.slice(0, 8).map(s => (
              <div key={s.sessionId} style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
                  {s.paths.length} pages · {s.durationSec >= 60 ? `${Math.round(s.durationSec / 60)}m ${s.durationSec % 60}s` : `${s.durationSec}s`} on site
                </div>
                <div style={{ fontSize: 12, color: '#525252', marginTop: 4, fontFamily: 'monospace' }}>
                  {s.paths.map(friendlyPath).join(' → ')}
                </div>
              </div>
            ))}
          </Card>
        )}

      </div>
    </PageWrapper>
  );
}

function StaffVendorsPage({ isMobile, staff }) {
  const [tab, setTab] = useState('new');
  const [pending, setPending] = useState([]);
  const [allVendors, setAllVendors] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendance, setAttendance] = useState({}); // { event_id: { vendor_id: row } }
  const [memberVisits, setMemberVisits] = useState([]); // raw rows joined with member + vendor
  const [voteCounts, setVoteCounts] = useState({}); // { event_id: [{category, vendor_id, vendor_name, vote_count}] }
  const [profilesById, setProfilesById] = useState({}); // staff lookup for approver-name display
  const [emailLog, setEmailLog] = useState({}); // { vendor_id: [{event_id, step_key, sent_at}, ...] }
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Vendor detail modal — clicking any vendor card opens this with full info.
  const [detailVendor, setDetailVendor] = useState(null);
  // Comms broadcast modal — Chef-composed email blast to vendor audiences.

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
      // Vendor Day events (past + upcoming) with their applications.
      // Ordered descending so the most-recent-or-soon events come first;
      // EventRosterList splits past vs upcoming for the staff filter.
      supabase.from('events')
        .select('*, vendor_applications(*, vendor:vendors(*))')
        .eq('has_vendors', true)
        .order('event_date', { ascending: false })
        .limit(100),
      supabase.from('vendor_attendance').select('*'),
      // Member visits joined with member + attributed vendor
      supabase.from('member_event_visits')
        .select('*, member:members(id, first_name, last_name, email), attributed_vendor:vendors(id, name), event:events(id, title, event_date)')
        .order('checked_in_at', { ascending: false })
        .limit(200),
      // Staff profiles, used to display approver names alongside the
      // approved_by / decided_by uuids on vendors and applications.
      supabase.from('profiles').select('id, name, email'),
      // Drip-email send log — every fired vendor_event_drip step lands here.
      // Indexed by vendor_id so cards can show the per-event progress dots.
      supabase.from('vendor_email_log').select('vendor_id, event_id, step_key, sent_at'),
    ]).then(async ([pendRes, vendRes, evRes, attRes, visitsRes, profRes, emailRes]) => {
      if (pendRes.error) console.error('[StaffVendors] pending', pendRes.error);
      if (vendRes.error) console.error('[StaffVendors] vendors', vendRes.error);
      if (evRes.error)   console.error('[StaffVendors] events', evRes.error);
      if (attRes.error)  console.error('[StaffVendors] attendance', attRes.error);
      if (visitsRes.error) console.error('[StaffVendors] visits', visitsRes.error);
      if (profRes.error) console.error('[StaffVendors] profiles', profRes.error);
      if (emailRes.error) console.error('[StaffVendors] email_log', emailRes.error);
      setPending(pendRes.data || []);
      setAllVendors(vendRes.data || []);
      setEvents(evRes.data || []);
      // Group email log by vendor_id so cards can grab their slice with one lookup.
      const elog = {};
      (emailRes.data || []).forEach(row => {
        if (!elog[row.vendor_id]) elog[row.vendor_id] = [];
        elog[row.vendor_id].push(row);
      });
      setEmailLog(elog);
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

  // For each vendor, figure out their NEXT upcoming approved event and the
  // position of that event in the chronological list of all upcoming non-
  // cancelled events. Used to color-code the per-card "next event" badge:
  //   position 0 = soonest event overall (hottest red)
  //   higher positions cool toward purple/gray.
  // Cards render NextEventBadge with `null` when the vendor isn't approved
  // for any upcoming event.
  const _todayStr = todayISO();
  const upcomingEvents = (events || [])
    .filter(ev => ev.event_date >= _todayStr && !ev.cancelled)
    .slice()
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const vendorNextEvent = {};
  upcomingEvents.forEach((ev, idx) => {
    (ev.vendor_applications || []).forEach(app => {
      if (app.status === 'approved' && !vendorNextEvent[app.vendor_id]) {
        vendorNextEvent[app.vendor_id] = { event: ev, position: idx };
      }
    });
  });
  // For vendors with no upcoming-event row, render the "No upcoming events"
  // pill by passing null. We mark them in the map so AllVendorsList knows.
  (allVendors || []).forEach(v => {
    if (!(v.id in vendorNextEvent)) vendorNextEvent[v.id] = null;
  });

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

        {/* Top action bar — comms broadcast lives on /staff/comms now so all
            broadcast surfaces (vendors + marketing contacts) live in one
            place. The button here just deep-links into the page on the
            Vendors tab so the muscle memory still works. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '1100px', margin: '0 auto 12px' }}>
          <Link to="/staff/comms?tab=vendors" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: '#1a1a1a', color: '#fff',
            padding: '10px 16px', borderRadius: '8px', fontWeight: '700',
            fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'none',
          }}>
            <Mail size={14} /> Comms broadcast
          </Link>
        </div>

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
              onOpenDetail={setDetailVendor}
              isMobile={isMobile}
            />
          )}

          {!loading && tab === 'pending' && (
            <PendingApplicationsList items={pending} onDecide={decideApplication} isMobile={isMobile} />
          )}

          {!loading && tab === 'roster' && (
            <EventRosterList events={events} attendance={attendance} allVendors={allVendors} profilesById={profilesById} emailLog={emailLog} vendorNextEvent={vendorNextEvent} onDecide={decideApplication} onOpenDetail={setDetailVendor} onChange={refresh} staff={staff} isMobile={isMobile} />
          )}

          {!loading && tab === 'vendors' && (
            <AllVendorsList vendors={allVendors} profilesById={profilesById} emailLog={emailLog} events={events} vendorNextEvent={vendorNextEvent} onStatusChange={setVendorStatus} onOpenDetail={setDetailVendor} isMobile={isMobile} />
          )}

          {!loading && tab === 'members' && (
            <MembersAndFeedbackTab visits={memberVisits} voteCounts={voteCounts} events={events} isMobile={isMobile} />
          )}
        </div>
      </div>

      {detailVendor && (
        <VendorDetailModal
          vendor={detailVendor}
          profilesById={profilesById}
          onClose={() => setDetailVendor(null)}
        />
      )}

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
  const [search, setSearch] = useState('');
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
  // Match the vendor across every field they submitted; also let staff
  // filter by event title in case multiple events are open at once.
  const q = search.trim().toLowerCase();
  const filtered = !q ? items : items.filter(app => {
    if (vendorMatchesQuery(app.vendor || {}, search)) return true;
    if (((app.event || {}).title || '').toLowerCase().includes(q)) return true;
    return false;
  });
  return (
    <div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search vendor name, email, phone, social, specialty, event…"
        style={{
          width: '100%', padding: '10px 14px', fontSize: '0.9rem',
          border: '1px solid #ddd', borderRadius: '8px',
          marginBottom: '12px', boxSizing: 'border-box',
        }}
      />
      {filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
          padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
        }}>No matches.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(app => (
            <PendingApplicationCard key={app.id} app={app} onDecide={onDecide} isMobile={isMobile} />
          ))}
        </div>
      )}
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
          {/* Always render a circular slot. "N/A" placeholder for legacy vendors. */}
          <div style={{
            width: '48px', height: '48px', flexShrink: 0,
            borderRadius: '50%', overflow: 'hidden',
            backgroundColor: v.avatar_url ? '#fff' : '#f4f4f5',
            border: '1px solid #e4e4e7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {v.avatar_url ? (
              <img
                src={v.avatar_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af',
                letterSpacing: '0.5px',
              }}>N/A</span>
            )}
          </div>
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
// ─── NotAppliedRoster ─────────────────────────────────────
// Inside an expanded upcoming-event card, show every approved vendor
// who hasn't applied to this event. Reuses VendorRichCard so the
// signup-track drip dots (T-21 → T-1) line up automatically — Chef
// can see who's been emailed about the open slot and who's been
// silent. Collapsed by default because the list can be long.
function NotAppliedRoster({ event, notApplied, emailLog, vendorNextEvent, onOpenDetail, isMobile }) {
  const [open, setOpen] = useState(false);
  if (notApplied.length === 0) return null;
  const sorted = notApplied.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  return (
    <div style={{
      marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed #e5e7eb',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', padding: '4px 0',
          fontSize: '0.82rem', fontWeight: '800', color: '#92400e',
          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <ChevronDown size={14} style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
          }} />
          No request · {notApplied.length} approved vendor{notApplied.length === 1 ? '' : 's'}
        </span>
        <span style={{
          fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.04em',
          color: '#92400e', backgroundColor: '#fef3c7',
          padding: '2px 8px', borderRadius: '999px',
        }}>
          Drip · Track A (signup)
        </span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          {sorted.map(v => (
            <VendorRichCard
              key={v.id}
              vendor={v}
              isMobile={isMobile}
              emails={emailLog[v.id] || []}
              eventId={event.id}
              eventLabel={null}
              nextEvent={vendorNextEvent[v.id] || null}
              onClick={() => onOpenDetail && onOpenDetail(v)}
              statusBadge={
                <span style={{
                  fontSize: '0.65rem', fontWeight: '800',
                  color: '#92400e', backgroundColor: '#fef3c7',
                  padding: '3px 10px', borderRadius: '999px',
                  textTransform: 'uppercase', letterSpacing: '0.4px',
                  border: '1px solid #fde68a',
                }}>No request</span>
              }
              decisionLine={null}
              actions={null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRosterList({ events, attendance, allVendors, profilesById, emailLog = {}, vendorNextEvent = {}, onDecide, onOpenDetail, onChange, staff, isMobile }) {
  const [cancelling, setCancelling] = useState(null); // event row when cancelling
  const [filter, setFilter] = useState('upcoming'); // 'upcoming' | 'past'
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set()); // event ids expanded

  const todayStr = todayISO();
  // Split events by date: upcoming (today + future) ascending so the next
  // event is at top; past (before today) descending so the most recent is on top.
  const upcoming = events
    .filter(ev => ev.event_date >= todayStr)
    .slice()
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const past = events
    .filter(ev => ev.event_date < todayStr)
    .slice()
    .sort((a, b) => b.event_date.localeCompare(a.event_date));

  const list = filter === 'upcoming' ? upcoming : past;

  // Search filter: match event title OR any vendor in the roster (across
  // every field they filled out — name, social, specialty, bio, etc.).
  const q = search.trim().toLowerCase();
  const filtered = !q ? list : list.filter(ev => {
    if ((ev.title || '').toLowerCase().includes(q)) return true;
    const apps = ev.vendor_applications || [];
    return apps.some(a => vendorMatchesQuery(a.vendor || {}, search));
  });

  // When the user searches, auto-expand matching events so vendor hits show.
  const effectiveExpanded = q
    ? new Set(filtered.map(ev => ev.id))
    : expanded;

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const segBtn = (active) => ({
    flex: 1,
    padding: '10px 14px',
    border: 'none',
    backgroundColor: active ? '#1a1a1a' : '#fff',
    color: active ? '#fff' : '#666',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: '700',
    cursor: 'pointer',
    border: active ? 'none' : '1px solid #ddd',
  });

  return (
    <div>
      {/* Upcoming / Past segmented control */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setFilter('upcoming')} style={segBtn(filter === 'upcoming')}>
          Upcoming Events ({upcoming.length})
        </button>
        <button onClick={() => setFilter('past')} style={segBtn(filter === 'past')}>
          Past Events ({past.length})
        </button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search event title, vendor name, social, specialty, bio…"
        style={{
          width: '100%', padding: '10px 14px', fontSize: '0.9rem',
          border: '1px solid #ddd', borderRadius: '8px',
          marginBottom: '16px', boxSizing: 'border-box',
        }}
      />

      {filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
          padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
        }}>
          {q ? 'No matches.' : (
            filter === 'upcoming'
              ? 'No upcoming Vendor Day events. Add one in the calendar with category "Vendor Day".'
              : 'No past Vendor Day events.'
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(ev => {
            const apps = ev.vendor_applications || [];
            const evAttend = attendance[ev.id] || {};
            const dateStr = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const approved = apps.filter(a => a.status === 'approved');
            const pending = apps.filter(a => a.status === 'pending');
            const isExpanded = effectiveExpanded.has(ev.id);
            const isPast = ev.event_date < todayStr;
            // Everyone who's approved as a partner but hasn't applied to THIS
            // event yet. Drives the "No request" subsection. Only meaningful
            // for upcoming, uncancelled events.
            const appliedIds = new Set(apps.map(a => a.vendor_id));
            const notApplied = (!isPast && !ev.cancelled)
              ? allVendors.filter(v => v.status === 'approved' && !appliedIds.has(v.id))
              : [];
            return (
              <div key={ev.id} style={{
                backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
                overflow: 'hidden',
              }}>
                {/* Header row — clickable to expand/collapse */}
                <div
                  onClick={() => toggle(ev.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    flexWrap: 'wrap', gap: '8px',
                    padding: isMobile ? '14px 16px' : '16px 20px',
                    cursor: 'pointer',
                    backgroundColor: isExpanded ? '#fafafa' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <ChevronDown
                      size={18}
                      color="#999"
                      style={{
                        transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 0.15s',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a' }}>{ev.title || 'Vendor Day'}</div>
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>{dateStr}</div>
                    </div>
                  </div>
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}
                  >
                    <span style={{ fontSize: '0.78rem', color: '#666' }}>
                      {approved.length} approved · {pending.length} pending
                    </span>
                    {ev.cancelled ? (
                      <span style={{
                        backgroundColor: '#fef2f2', color: '#dc2626',
                        padding: '3px 10px', borderRadius: '999px',
                        fontWeight: '800', fontSize: '0.68rem',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        border: '1px solid #fecaca'
                      }}>
                        Cancelled
                      </span>
                    ) : !isPast && (
                      <>
                        <Link
                          to={`/staff/events/${ev.id}/timemap`}
                          onClick={e => e.stopPropagation()}
                          style={{
                            backgroundColor: '#1a1a1a', color: '#fff',
                            padding: '6px 12px', borderRadius: '6px', fontWeight: '700',
                            fontSize: '0.75rem', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                          }}
                        >
                          <Clock size={12} /> Time map
                        </Link>
                        <button onClick={() => setCancelling(ev)} style={{
                          backgroundColor: '#fff', color: '#dc2626',
                          padding: '6px 12px', borderRadius: '6px', fontWeight: '700',
                          fontSize: '0.75rem', cursor: 'pointer',
                          border: '1px solid #fecaca'
                        }}>
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Roster (only when expanded) */}
                {isExpanded && (
                  <div style={{ padding: isMobile ? '0 16px 14px' : '0 20px 16px' }}>
                    {apps.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: '#999', fontStyle: 'italic', paddingTop: '8px' }}>No applications yet.</div>
                    ) : null}
                    {apps.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '6px' }}>
                        {apps.slice().sort((a, b) => (((a.vendor||{}).name||'').localeCompare(((b.vendor||{}).name||''), undefined, { sensitivity: 'base' }))).map(a => {
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
                          // Status badge (mirrors what AllVendorsList uses, scoped to applications)
                          const appBadge = <ApplicationStatusBadge status={a.status} />;
                          // Decision line: approval credit, or pending tag, or "Approved · checked in"
                          let decLine = null;
                          if (a.status === 'approved') {
                            const checkedInLabel = checkedIn
                              ? ` · ${checkedIn.geo_verified ? 'Checked in (geo)' : 'Checked in (honor)'}`
                              : ' · Not checked in';
                            decLine = (
                              <span style={{ color: '#16a34a' }}>
                                {apprLabel || 'Approved'}{checkedInLabel}
                              </span>
                            );
                          } else if (a.status === 'pending') {
                            decLine = <span style={{ color: '#c2410c' }}>Pending decision</span>;
                          }
                          // Per-application actions: approve button when pending + not past.
                          // Inline time request and vendor note shown via the card's body
                          // and an extra-info area below.
                          const actions = (a.status === 'pending' && !isPast)
                            ? (
                              <button onClick={() => onDecide(a.id, 'approved', null)} style={{
                                fontSize: '0.8rem', backgroundColor: '#16a34a', color: '#fff',
                                border: 'none', padding: '6px 14px', borderRadius: '6px',
                                fontWeight: '700', cursor: 'pointer'
                              }}>Approve</button>
                            )
                            : null;
                          // The application's time request + vendor note are application-scoped
                          // (not vendor-scoped), so we synthesize a wrapper vendor object that
                          // carries those onto the card without mutating the source.
                          const cardVendor = {
                            ...v,
                            requested_start_time: a.requested_start_time || v.requested_start_time,
                            requested_end_time: a.requested_end_time || v.requested_end_time,
                            // Use the vendor's own bio if present, otherwise fall back to the
                            // per-application note so staff can see it inline.
                            bio: v.bio || a.vendor_note || null,
                          };
                          return (
                            <VendorRichCard
                              key={a.id}
                              vendor={cardVendor}
                              isMobile={isMobile}
                              emails={emailLog[a.vendor_id] || []}
                              eventId={ev.id}
                              eventLabel={null /* event is already implied by the parent expandable section */}
                              nextEvent={vendorNextEvent[a.vendor_id] || null}
                              onClick={() => onOpenDetail && onOpenDetail(v)}
                              statusBadge={appBadge}
                              decisionLine={decLine}
                              actions={actions}
                            />
                          );
                        })}
                      </div>
                    )}
                    <NotAppliedRoster
                      event={ev}
                      notApplied={notApplied}
                      emailLog={emailLog}
                      vendorNextEvent={vendorNextEvent}
                      onOpenDetail={onOpenDetail}
                      isMobile={isMobile}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
// ─── Vendor Comms (broadcast) modal ───────────────────────
// Chef-composed email blast. Pick an audience (event-scoped or global), write
// subject + body, send. Server-side resolves the audience and BCCs
// chef@trainercenter.com so Chef has the email in his own inbox as a record.
function VendorCommsModal({ events, allVendors, onClose }) {
  const [audience, setAudience] = useState('approved_all');
  const [eventId, setEventId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachEvent, setAttachEvent] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Sort events: upcoming ascending first, then past descending. Most useful
  // ordering for picking an event to scope a comms blast against.
  const todayStr = todayISO();
  const sortedEvents = (events || []).slice().sort((a, b) => {
    const aPast = a.event_date < todayStr;
    const bPast = b.event_date < todayStr;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast
      ? b.event_date.localeCompare(a.event_date)
      : a.event_date.localeCompare(b.event_date);
  });

  const eventScoped = ['approved_not_applied', 'applied_any', 'approved_for_event', 'pending_for_event'];
  const needsEvent = eventScoped.includes(audience);

  // Live audience count preview
  const previewCount = (() => {
    if (audience === 'all') return allVendors.length;
    if (audience === 'approved_all') return allVendors.filter(v => v.status === 'approved').length;
    if (audience === 'pending_all') return allVendors.filter(v => v.status === 'pending').length;
    if (!needsEvent || !eventId) return null;
    const ev = sortedEvents.find(e => e.id === eventId);
    if (!ev) return null;
    const apps = ev.vendor_applications || [];
    if (audience === 'approved_not_applied') {
      const applied = new Set(apps.map(a => a.vendor_id));
      return allVendors.filter(v => v.status === 'approved' && !applied.has(v.id)).length;
    }
    if (audience === 'applied_any') return apps.length;
    if (audience === 'approved_for_event') return apps.filter(a => a.status === 'approved').length;
    if (audience === 'pending_for_event') return apps.filter(a => a.status === 'pending').length;
    return null;
  })();

  const audienceOptions = [
    { value: 'approved_all', label: 'All approved partners' },
    { value: 'pending_all', label: 'All pending applicants' },
    { value: 'all', label: 'Every vendor (approved + pending + suspended)' },
    { value: 'approved_not_applied', label: 'Approved partners NOT signed up for this event' },
    { value: 'approved_for_event', label: 'Approved for this event' },
    { value: 'pending_for_event', label: 'Pending for this event' },
    { value: 'applied_any', label: 'Anyone who applied for this event (any status)' },
  ];

  const send = async () => {
    setError('');
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!body.trim()) { setError('Message body is required.'); return; }
    if (needsEvent && !eventId) { setError('Pick an event for this audience.'); return; }
    if (previewCount === 0) { setError('No recipients match this audience.'); return; }
    if (!window.confirm(`Send to ${previewCount ?? '?'} vendors? BCC will go to chef@trainercenter.com.`)) return;
    setSending(true);
    try {
      const url = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-vendor-email`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          type: 'vendor_broadcast',
          audience,
          event_id: needsEvent ? eventId : undefined,
          subject: subject.trim(),
          body_text: body.trim(),
          attach_event: needsEvent && attachEvent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Send failed');
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  };

  const fmtEventOption = (ev) => {
    const d = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const past = ev.event_date < todayStr;
    return `${past ? '(past) ' : ''}${ev.title || 'Vendor Day'} · ${d}`;
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', overflow: 'auto'
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        backgroundColor: '#fff', borderRadius: '14px',
        maxWidth: '640px', width: '100%',
        maxHeight: '92vh', overflowY: 'auto',
        padding: '24px', position: 'relative',
        boxShadow: '0 12px 32px rgba(0,0,0,0.2)'
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '14px', right: '14px',
          background: '#f4f4f5', border: 'none', borderRadius: '50%',
          width: '32px', height: '32px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer'
        }}>
          <X size={16} />
        </button>

        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: '0 0 4px' }}>Send broadcast to vendors</h2>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 20px' }}>
          BCC's <code>chef@trainercenter.com</code> on every send.
        </p>

        {result ? (
          <div style={{
            backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: '8px', padding: '14px 16px', marginBottom: '16px'
          }}>
            <div style={{ fontWeight: '800', color: '#15803d', marginBottom: '4px' }}>Sent to {result.count} vendor{result.count === 1 ? '' : 's'}</div>
            {result.failed && result.failed.length > 0 && (
              <div style={{ fontSize: '0.85rem', color: '#991b1b' }}>
                Failed: {result.failed.length} ({result.failed.join(', ')})
              </div>
            )}
            <button onClick={onClose} style={{
              marginTop: '12px',
              backgroundColor: '#1a1a1a', color: '#fff', border: 'none',
              padding: '8px 18px', borderRadius: '6px', fontWeight: '700',
              cursor: 'pointer'
            }}>Done</button>
          </div>
        ) : (
          <>
            <Field label="Audience">
              <select value={audience} onChange={e => setAudience(e.target.value)} style={selectStyle}>
                {audienceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>

            {needsEvent && (
              <Field label="Event">
                <select value={eventId} onChange={e => setEventId(e.target.value)} style={selectStyle}>
                  <option value="">— Pick an event —</option>
                  {sortedEvents.map(ev => (
                    <option key={ev.id} value={ev.id}>{fmtEventOption(ev)}</option>
                  ))}
                </select>
              </Field>
            )}

            {needsEvent && (
              <Field label="">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#444', cursor: 'pointer' }}>
                  <input type="checkbox" checked={attachEvent} onChange={e => setAttachEvent(e.target.checked)} />
                  Attach event title + date to the bottom of the email
                </label>
              </Field>
            )}

            <div style={{
              backgroundColor: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
              fontSize: '0.85rem', color: '#374151'
            }}>
              {previewCount === null ? (
                <span style={{ color: '#999' }}>Pick an event to see the audience size</span>
              ) : (
                <span><strong>{previewCount}</strong> vendor{previewCount === 1 ? '' : 's'} will receive this email</span>
              )}
            </div>

            <Field label="Subject">
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Quick update on May 29 layout" style={inputStyle} />
            </Field>

            <Field label="Message">
              <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Plain text. Line breaks become paragraphs."
                rows={8}
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '4px' }}>
                Goes out wrapped in the standard Trainer Center HB email template (red header, address footer, dashboard CTA).
              </div>
            </Field>

            {error && (
              <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '14px', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={onClose} disabled={sending} style={{
                backgroundColor: '#fff', color: '#666',
                border: '1px solid #ddd', padding: '10px 18px',
                borderRadius: '8px', fontWeight: '700', cursor: 'pointer'
              }}>Cancel</button>
              <button onClick={send} disabled={sending || !subject.trim() || !body.trim() || (needsEvent && !eventId)} style={{
                backgroundColor: '#C8102E', color: '#fff', border: 'none',
                padding: '10px 22px', borderRadius: '8px', fontWeight: '700',
                cursor: sending ? 'wait' : 'pointer',
                opacity: (!subject.trim() || !body.trim() || (needsEvent && !eventId)) ? 0.5 : 1
              }}>
                {sending ? 'Sending…' : `Send${previewCount != null ? ` to ${previewCount}` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px', fontSize: '0.9rem',
  border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box',
};
const selectStyle = { ...inputStyle, backgroundColor: '#fff' };
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      {label && <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#444', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</label>}
      {children}
    </div>
  );
}

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
      <div className="modal-safe-bottom smooth-scroll" style={{...modalCardStyle, maxHeight: "calc(100vh - 40px)", overflowY: "auto"}} onClick={e => e.stopPropagation()}>
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
function NewlyApplyingVendorsList({ vendors, onStatusChange, onOpenDetail, isMobile }) {
  const [search, setSearch] = useState('');
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  // Alphabetize by name (case-insensitive). Keeps the list predictable as it grows.
  const sorted = vendors.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  const filtered = sorted.filter(v => vendorMatchesQuery(v, search));

  return (
    <div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search name, email, phone, social, specialty, bio, referrer…"
        style={{
          width: '100%', padding: '10px 14px', fontSize: '0.9rem',
          border: '1px solid #ddd', borderRadius: '8px',
          marginBottom: '12px', boxSizing: 'border-box',
        }}
      />
      {filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
          padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
        }}>
          {search.trim() ? 'No matches.' : 'No new vendor applications. When someone signs up to become a vendor, they\'ll show up here.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {filtered.map(v => (
        <VendorRichCard
          key={v.id}
          vendor={v}
          isMobile={isMobile}
          onClick={() => onOpenDetail && onOpenDetail(v)}
          statusBadge={
            <span style={{ fontSize: '0.7rem', color: '#92400e', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '999px', fontWeight: '700' }}>
              Applied {fmtDate(v.created_at)}
            </span>
          }
          decisionLine={
            <span style={{ color: '#c2410c' }}>Pending approval</span>
          }
          actions={
            <>
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
            </>
          }
        />
      ))}
        </div>
      )}
    </div>
  );
}

function AllVendorsList({ vendors, profilesById, emailLog = {}, events = [], vendorNextEvent = {}, onStatusChange, onOpenDetail, isMobile }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | approved | pending | suspended

  // Pick the soonest upcoming non-cancelled Vendor Day event. Email drip
  // progress on each card is shown for that event so staff sees "where is
  // this vendor at in the current campaign?" at a glance.
  const todayStr = todayISO();
  const nextEvent = events
    .filter(ev => ev.event_date >= todayStr && !ev.cancelled)
    .slice()
    .sort((a, b) => a.event_date.localeCompare(b.event_date))[0] || null;
  const nextEventLabel = nextEvent
    ? `${nextEvent.title || 'Vendor Day'} · ${new Date(nextEvent.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : null;

  const approverLabel = (v) => {
    if (v.status !== 'approved' || !v.approved_by) return null;
    const p = (profilesById || {})[v.approved_by];
    const who = p?.name || p?.email || 'staff';
    const when = v.approved_at
      ? new Date(v.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    return when ? `Approved by ${who} · ${when}` : `Approved by ${who}`;
  };
  // Status badge color tokens (kept inline so the rich card stays presentational).
  const badgeFor = (status) => {
    const map = {
      approved:  { bg: '#dcfce7', fg: '#15803d', label: 'Approved' },
      pending:   { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
      suspended: { bg: '#fee2e2', fg: '#991b1b', label: 'Suspended' },
    };
    const m = map[status] || { bg: '#f4f4f5', fg: '#3f3f46', label: status || 'Unknown' };
    return (
      <span style={{
        fontSize: '0.7rem', fontWeight: '700',
        color: m.fg, backgroundColor: m.bg,
        padding: '2px 8px', borderRadius: '999px',
        textTransform: 'uppercase', letterSpacing: '0.4px'
      }}>{m.label}</span>
    );
  };
  // Decision line per status: approved → green "Approved by NAME · DATE",
  // pending → orange "Pending approval", suspended → red "Suspended" (with
  // the same approver context for who took the action).
  const decisionFor = (v) => {
    if (v.status === 'approved') {
      const apprLabel = approverLabel(v);
      return apprLabel
        ? <span style={{ color: '#16a34a' }}>{apprLabel}</span>
        : <span style={{ color: '#16a34a' }}>Approved partner</span>;
    }
    if (v.status === 'pending') {
      return <span style={{ color: '#c2410c' }}>Pending approval</span>;
    }
    if (v.status === 'suspended') {
      return <span style={{ color: '#991b1b' }}>Suspended</span>;
    }
    return null;
  };

  // Alphabetize → status filter → search filter.
  const sorted = vendors.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  const byStatus = statusFilter === 'all' ? sorted : sorted.filter(v => v.status === statusFilter);
  const filtered = byStatus.filter(v => vendorMatchesQuery(v, search));

  const statusBtn = (active) => ({
    padding: '6px 12px',
    border: active ? 'none' : '1px solid #ddd',
    backgroundColor: active ? '#1a1a1a' : '#fff',
    color: active ? '#fff' : '#666',
    borderRadius: '6px',
    fontSize: '0.78rem',
    fontWeight: '700',
    cursor: 'pointer',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={statusBtn(statusFilter === 'all')}>
          All ({sorted.length})
        </button>
        <button onClick={() => setStatusFilter('approved')} style={statusBtn(statusFilter === 'approved')}>
          Approved ({sorted.filter(v => v.status === 'approved').length})
        </button>
        <button onClick={() => setStatusFilter('pending')} style={statusBtn(statusFilter === 'pending')}>
          Pending ({sorted.filter(v => v.status === 'pending').length})
        </button>
        <button onClick={() => setStatusFilter('suspended')} style={statusBtn(statusFilter === 'suspended')}>
          Suspended ({sorted.filter(v => v.status === 'suspended').length})
        </button>
      </div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search name, email, phone, social, specialty, bio, referrer…"
        style={{
          width: '100%', padding: '10px 14px', fontSize: '0.9rem',
          border: '1px solid #ddd', borderRadius: '8px',
          marginBottom: '12px', boxSizing: 'border-box',
        }}
      />
      {filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#fafafa', border: '1px dashed #ddd', borderRadius: '12px',
          padding: '32px 20px', textAlign: 'center', color: '#888', fontSize: '0.9rem'
        }}>
          {search.trim() || statusFilter !== 'all' ? 'No matches.' : 'No vendors yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {filtered.map(v => {
        return (
          <VendorRichCard
            key={v.id}
            vendor={v}
            isMobile={isMobile}
            emails={emailLog[v.id] || []}
            eventId={nextEvent?.id}
            eventLabel={nextEventLabel}
            nextEvent={vendorNextEvent[v.id] || null}
            onClick={() => onOpenDetail && onOpenDetail(v)}
            statusBadge={badgeFor(v.status)}
            decisionLine={decisionFor(v)}
            actions={
              <>
                {v.status !== 'approved' && (
                  <button onClick={() => onStatusChange(v.id, 'approved')} style={{
                    fontSize: '0.8rem', backgroundColor: '#16a34a', color: '#fff',
                    border: 'none', padding: '6px 14px', borderRadius: '6px',
                    fontWeight: '700', cursor: 'pointer'
                  }}>Approve</button>
                )}
                {v.status !== 'suspended' && (
                  <button onClick={() => onStatusChange(v.id, 'suspended')} style={{
                    fontSize: '0.8rem', backgroundColor: '#fff', color: '#991b1b',
                    border: '1px solid #fecaca', padding: '6px 14px', borderRadius: '6px',
                    fontWeight: '700', cursor: 'pointer'
                  }}>Suspend</button>
                )}
              </>
            }
          />
        );
      })}
        </div>
      )}
    </div>
  );
}

// ─── Nav Link Helper ──────────────────────────────────────
// Items with `children` render as click-to-open dropdowns (desktop) /
// accordion sections (mobile). The parent label itself never navigates —
// it only toggles its child menu. Staff users land on the staff vendor
// console; everyone else lands on the regular vendor dashboard.
// Top-level nav is Home + three role buckets. Each bucket's parent label
// recolors when the user is logged in for that role (Member = cyan,
// Vendor = green, Staff = red). Inside each bucket, the last item is
// always Log in (logged out) or Log out (logged in) — per-role auth
// surfaced where users expect it, no separate lock badge.
const buildNavItems = ({ isStaff, isVendor, isMember, isLoggedIn, hasReminders, onLogin, onLogout }) => {
  // Reminders / My Reminders lives inside the dropdown that matches the
  // user's role: Staff > Vendor > Member > (logged-out → Guests). No red
  // accent — it just reads in the normal child color until you actually
  // navigate to /reminders, at which point the active-state red kicks in.
  const reminderItem = hasReminders
    ? { label: 'My Reminders', to: '/reminders' }
    : { label: 'Reminders', to: '/reminders' };
  const remindersIn = isStaff ? 'staff' : isVendor ? 'vendor' : 'guest';

  // Per-bucket auth tail:
  //   logged out          → every bucket shows "Log in"
  //   logged in as role X → only bucket X shows "Log out"; others show
  //                          nothing (no point offering log in to an
  //                          already-signed-in user)
  const myBucket = isStaff ? 'staff' : isVendor ? 'vendor' : isLoggedIn ? 'guest' : null;
  const authTail = (bucket) => {
    if (!isLoggedIn) return [{ label: 'Log in', action: onLogin, accent: '#C8102E' }];
    if (bucket === myBucket) return [{ label: 'Log out', action: onLogout, accent: '#C8102E' }];
    return [];
  };

  const items = [
    { label: 'Home', to: '/' },
    { label: 'Calendar', to: '/calendar' },
    {
      // Guests becomes "Member" once they log in as a member — same dropdown,
      // just acknowledges who they are. Orange label when logged in.
      label: isMember ? 'Member' : 'Guests',
      parentColor: isMember ? '#ea580c' : undefined,
      children: [
        { label: 'Visit Us', to: '/#visit-us' },
        { label: 'Buy / Sell', to: '/buy-sell' },
        { label: 'Consultation', to: '/consultation' },
        { label: 'Grading', to: '/grading' },
        { label: 'Blog', to: '/blog' },
        ...(remindersIn === 'guest' ? [reminderItem] : []),
        // Check in — only relevant once you're a member (i.e. you can check
        // in to the trade nights). Points at the existing /guest/review flow
        // which is the member check-in + voting state machine.
        ...(isMember ? [{ label: 'Check in', to: '/guest/review' }] : []),
        ...authTail('guest'),
      ],
    },
    {
      label: 'Vendors',
      parentColor: isVendor ? '#16a34a' : undefined,  // green when logged in as vendor
      children: [
        { label: 'Dashboard', to: isStaff ? '/staff/vendors' : '/vendors/dashboard' },
        { label: 'Apply', to: '/vendors/apply?mode=signup' },
        { label: 'TC Beach City Trade Night', to: '/vendor-day/about' },
        { label: 'Line ups', to: '/vendor-day' },
        ...(remindersIn === 'vendor' ? [reminderItem] : []),
        ...authTail('vendor'),
      ],
    },
    {
      // Staff is invisible to the general public — only the Log in option
      // shows. Once logged in as staff, the full management surface unfolds.
      // When logged in as a non-staff role, Staff has no items to show at
      // all and gets filtered out below.
      label: 'Staff',
      parentColor: isStaff ? '#1d4ed8' : undefined,  // blue when logged in as staff
      children: isStaff
        ? [
            { label: 'Edit Calendar', to: '/calendar' },
            { label: 'Manage Vendors', to: '/staff/vendors' },
            { label: 'Manage Members', to: '/staff/members' },
            { label: 'Communication', to: '/staff/comms' },
            { label: 'Instagram Contacts', to: '/staff/instagram' },
            { label: 'Printables', to: '/staff/printables' },
            { label: 'Analytics', to: '/staff/analytics' },
            { label: 'Business Hours', to: '/#visit-us' },
            // Trade Night preview — flips the entire site into event-day
            // mode (for everyone) so staff can run a real end-to-end test.
            // Auto-expires after 30 min, all data tagged preview=true.
            { label: '🧪 Trade Night Preview', to: '/staff/preview' },
            ...(remindersIn === 'staff' ? [reminderItem] : []),
            ...authTail('staff'),
          ]
        : authTail('staff'),
    },
  ];
  // Hide any bucket whose children collapsed to empty (e.g. Staff for a
  // logged-in non-staff user has no items to offer).
  return items.filter(item => !item.children || item.children.length > 0);
};

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
  { key: 'tc_trade_night', label: "TC's Beach City Trade Night reminders", help: "Trainer Center's biggest event — last Friday of the month, local vendors set up in the shop." },
  { key: 'store_news',  label: 'Store news and updates',      help: 'Hours, restocks, new arrivals, store happenings.' },
  { key: 'blog',        label: 'New blog posts',              help: 'Articles and guides we publish on the site.' },
];

// ─── Staff Instagram Contacts Page (/staff/instagram) ──────
// Address book of every account that follows @trainercenter.pokemon.
// Seeded from the IG data export via scripts/import-ig-contacts.js.
// Staff tag each handle as member / vendor / influencer and click
// through to IG to message them directly. RLS gates everything to
// admins.
const IG_TAGS = [
  { key: 'member',     label: 'Member',     color: '#1d4ed8' },
  { key: 'vendor',     label: 'Vendor',     color: '#C8102E' },
  { key: 'influencer', label: 'Influencer', color: '#7c3aed' },
];
const IG_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

function StaffInstagramPage({ isMobile, staff }) {
  const isAdmin = !!staff?.isAdmin;

  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [counts, setCounts] = useState({ total: 0, untagged: 0, member: 0, vendor: 0, influencer: 0 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState('all');           // 'all' | '#' | 'A'..'Z'
  const [tagFilter, setTagFilter] = useState('all');     // 'all' | 'untagged' | tag key
  const [relFilter, setRelFilter] = useState('all');     // 'all' | follower | following | mutual
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Per-row pending state for notes debounce + busy indication.
  const [busyHandle, setBusyHandle] = useState(null);
  const [notesDraft, setNotesDraft] = useState({}); // handle -> string
  const notesTimer = useRef(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('ig_contacts')
      .select('handle, profile_url, relationship, followed_at, tag, notes, last_contacted_at', { count: 'exact' })
      .order('handle', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (search) q = q.ilike('handle', `%${search}%`);
    if (letter === '#') {
      // Anything not starting with a letter — numerics, underscores, etc.
      q = q.not('handle', 'ilike', 'a%')
           .not('handle', 'ilike', 'b%').not('handle', 'ilike', 'c%').not('handle', 'ilike', 'd%')
           .not('handle', 'ilike', 'e%').not('handle', 'ilike', 'f%').not('handle', 'ilike', 'g%')
           .not('handle', 'ilike', 'h%').not('handle', 'ilike', 'i%').not('handle', 'ilike', 'j%')
           .not('handle', 'ilike', 'k%').not('handle', 'ilike', 'l%').not('handle', 'ilike', 'm%')
           .not('handle', 'ilike', 'n%').not('handle', 'ilike', 'o%').not('handle', 'ilike', 'p%')
           .not('handle', 'ilike', 'q%').not('handle', 'ilike', 'r%').not('handle', 'ilike', 's%')
           .not('handle', 'ilike', 't%').not('handle', 'ilike', 'u%').not('handle', 'ilike', 'v%')
           .not('handle', 'ilike', 'w%').not('handle', 'ilike', 'x%').not('handle', 'ilike', 'y%')
           .not('handle', 'ilike', 'z%');
    } else if (letter !== 'all') {
      q = q.ilike('handle', `${letter.toLowerCase()}%`);
    }
    if (tagFilter === 'untagged') q = q.is('tag', null);
    else if (tagFilter !== 'all') q = q.eq('tag', tagFilter);
    if (relFilter !== 'all') q = q.eq('relationship', relFilter);

    const { data, error, count } = await q;
    setLoading(false);
    if (error) {
      console.error('[StaffInstagram] fetch failed', error);
      alert(`Could not load IG contacts: ${error.message}`);
      return;
    }
    setRows(data || []);
    setTotalCount(count || 0);
  }, [search, letter, tagFilter, relFilter, page]);

  const fetchCounts = useCallback(async () => {
    // Cheap aggregate so the header can show "X total · Y untagged".
    const total = await supabase.from('ig_contacts').select('*', { count: 'exact', head: true });
    const untagged = await supabase.from('ig_contacts').select('*', { count: 'exact', head: true }).is('tag', null);
    const member = await supabase.from('ig_contacts').select('*', { count: 'exact', head: true }).eq('tag', 'member');
    const vendor = await supabase.from('ig_contacts').select('*', { count: 'exact', head: true }).eq('tag', 'vendor');
    const influencer = await supabase.from('ig_contacts').select('*', { count: 'exact', head: true }).eq('tag', 'influencer');
    setCounts({
      total: total.count || 0,
      untagged: untagged.count || 0,
      member: member.count || 0,
      vendor: vendor.count || 0,
      influencer: influencer.count || 0,
    });
  }, []);

  useEffect(() => { if (isAdmin) fetchPage(); }, [fetchPage, isAdmin]);
  useEffect(() => { if (isAdmin) fetchCounts(); }, [fetchCounts, isAdmin]);

  const submitSearch = (e) => {
    e?.preventDefault?.();
    setPage(0);
    setSearch(searchInput.trim());
  };
  const clearAllFilters = () => {
    setSearchInput(''); setSearch(''); setLetter('all');
    setTagFilter('all'); setRelFilter('all'); setPage(0);
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const setTag = async (handle, nextTag) => {
    setBusyHandle(handle);
    // Optimistic update so the pill flips immediately.
    setRows(prev => prev.map(r => r.handle === handle ? { ...r, tag: nextTag } : r));
    const { error } = await supabase
      .from('ig_contacts')
      .update({ tag: nextTag })
      .eq('handle', handle);
    setBusyHandle(null);
    if (error) {
      alert(`Could not update tag: ${error.message}`);
      // Refetch to recover from the optimistic flip.
      fetchPage();
      return;
    }
    fetchCounts();
  };

  const saveNotes = async (handle, value) => {
    const { error } = await supabase
      .from('ig_contacts')
      .update({ notes: value || null })
      .eq('handle', handle);
    if (error) {
      console.error('[StaffInstagram] notes save failed', error);
    }
  };
  const onNotesChange = (handle, value) => {
    setNotesDraft(prev => ({ ...prev, [handle]: value }));
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => saveNotes(handle, value), 600);
  };

  const markContactedNow = async (handle) => {
    const { error } = await supabase
      .from('ig_contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('handle', handle);
    if (error) { alert(`Could not record contact: ${error.message}`); return; }
    fetchPage();
  };

  if (!isAdmin) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: '#666' }}>
          Staff only.
        </div>
      </PageWrapper>
    );
  }

  const fmtDate = (iso) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return null; }
  };

  const chip = (label, color, bg) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: '0.65rem', fontWeight: '800',
      color, backgroundColor: bg,
      padding: '2px 8px', borderRadius: '12px',
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>{label}</span>
  );

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '1100px', margin: '0 auto 64px' }}>
        <Link to="/staff/vendors" style={{
          color: '#666', fontSize: '0.78rem', fontWeight: '700',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
        }}>
          ← Back to staff dashboard
        </Link>
        <SectionHeader title="Instagram Contacts" subtitle="Tag every handle so staff can reach the right people fast" />

        {/* Counts strip */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px',
          marginBottom: '14px',
        }}>
          {chip(`${counts.total.toLocaleString()} total`, '#1a1a1a', '#f3f4f6')}
          {chip(`${counts.untagged.toLocaleString()} untagged`, '#92400e', '#fef3c7')}
          {chip(`${counts.member.toLocaleString()} member`, '#fff', '#1d4ed8')}
          {chip(`${counts.vendor.toLocaleString()} vendor`, '#fff', '#C8102E')}
          {chip(`${counts.influencer.toLocaleString()} influencer`, '#fff', '#7c3aed')}
        </div>

        {/* Filter bar */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '14px' : '18px 22px', marginBottom: '14px',
        }}>
          <form onSubmit={submitSearch} style={{
            display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div style={{ position: 'relative', flex: '1 1 220px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
              <input
                type="search"
                placeholder="Search handle"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 30px', fontSize: '0.9rem',
                  border: '1px solid #ddd', borderRadius: '8px',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
            <select value={tagFilter} onChange={e => { setPage(0); setTagFilter(e.target.value); }}
              style={{ padding: '10px 12px', fontSize: '0.9rem', cursor: 'pointer', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff', fontFamily: 'inherit' }}>
              <option value="all">All tags</option>
              <option value="untagged">Untagged</option>
              <option value="member">Member</option>
              <option value="vendor">Vendor</option>
              <option value="influencer">Influencer</option>
            </select>
            <select value={relFilter} onChange={e => { setPage(0); setRelFilter(e.target.value); }}
              style={{ padding: '10px 12px', fontSize: '0.9rem', cursor: 'pointer', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff', fontFamily: 'inherit' }}>
              <option value="all">All relationships</option>
              <option value="follower">Followers</option>
              <option value="following">Following</option>
              <option value="mutual">Mutuals</option>
            </select>
            <button type="submit" style={{
              padding: '10px 16px', fontSize: '0.9rem', fontWeight: '700',
              backgroundColor: '#1a1a1a', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
            }}>Search</button>
            {(search || searchInput || letter !== 'all' || tagFilter !== 'all' || relFilter !== 'all') && (
              <button type="button" onClick={clearAllFilters} style={{
                padding: '10px 14px', fontSize: '0.85rem', fontWeight: '700',
                backgroundColor: '#f3f4f6', color: '#666',
                border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>Clear</button>
            )}
          </form>

          {/* A-Z jump bar */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px',
            marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f3f4f6',
          }}>
            <button type="button" onClick={() => { setPage(0); setLetter('all'); }} style={{
              padding: '4px 10px', fontSize: '0.75rem', fontWeight: '700',
              border: letter === 'all' ? '1px solid #1a1a1a' : '1px solid #e5e7eb',
              backgroundColor: letter === 'all' ? '#1a1a1a' : '#fff',
              color: letter === 'all' ? '#fff' : '#666',
              borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', minWidth: '30px',
            }}>All</button>
            {IG_LETTERS.map(L => (
              <button key={L} type="button" onClick={() => { setPage(0); setLetter(L); }} style={{
                padding: '4px 0', width: '28px', fontSize: '0.75rem', fontWeight: '700',
                border: letter === L ? '1px solid #1a1a1a' : '1px solid #e5e7eb',
                backgroundColor: letter === L ? '#1a1a1a' : '#fff',
                color: letter === L ? '#fff' : '#666',
                borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
              }}>{L}</button>
            ))}
          </div>

          <p style={{ fontSize: '0.78rem', color: '#888', margin: '10px 2px 0' }}>
            {loading ? 'Loading...' : `${totalCount.toLocaleString()} match · page ${page + 1} of ${totalPages}`}
          </p>
        </div>

        {/* Rows */}
        {!loading && rows.length === 0 && (
          <div style={{
            backgroundColor: '#fff', border: '1px dashed #ddd',
            borderRadius: '14px', padding: '40px 20px', textAlign: 'center',
            color: '#888', fontSize: '0.9rem',
          }}>No handles match the current filter.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map(row => {
            const igUrl = row.profile_url || `https://www.instagram.com/${row.handle}`;
            const draft = notesDraft[row.handle] !== undefined ? notesDraft[row.handle] : (row.notes || '');
            const busy = busyHandle === row.handle;
            return (
              <div key={row.handle} style={{
                backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
                padding: isMobile ? '12px' : '14px 18px',
                display: 'flex', flexDirection: 'column', gap: '10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontWeight: '800', fontSize: '0.95rem', color: '#1a1a1a', wordBreak: 'break-all' }}>
                      @{row.handle}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                      {row.relationship === 'mutual'
                        ? chip('Mutual', '#065f46', '#d1fae5')
                        : row.relationship === 'following'
                          ? chip('We follow', '#1e3a8a', '#dbeafe')
                          : chip('Follower', '#374151', '#f3f4f6')}
                      {row.followed_at && (
                        <span style={{ fontSize: '0.7rem', color: '#888' }}>
                          since {fmtDate(row.followed_at)}
                        </span>
                      )}
                      {row.last_contacted_at && (
                        <span style={{ fontSize: '0.7rem', color: '#065f46' }}>
                          last contacted {fmtDate(row.last_contacted_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {IG_TAGS.map(t => {
                      const active = row.tag === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          disabled={busy}
                          onClick={() => setTag(row.handle, active ? null : t.key)}
                          style={{
                            padding: '6px 10px', fontSize: '0.75rem', fontWeight: '800',
                            border: active ? `2px solid ${t.color}` : '2px solid #e5e7eb',
                            backgroundColor: active ? t.color : '#fff',
                            color: active ? '#fff' : t.color,
                            borderRadius: '999px', cursor: busy ? 'wait' : 'pointer',
                            fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}
                        >{t.label}</button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <a
                      href={igUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => markContactedNow(row.handle)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '8px 12px', fontSize: '0.8rem', fontWeight: '700',
                        backgroundColor: '#C8102E', color: '#fff',
                        textDecoration: 'none', borderRadius: '8px',
                      }}
                    >
                      <IgIcon size={14} /> Open IG <ExternalLink size={12} />
                    </a>
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Notes (saved automatically)"
                  value={draft}
                  onChange={e => onNotesChange(row.handle, e.target.value)}
                  style={{
                    padding: '8px 10px', fontSize: '0.82rem',
                    border: '1px solid #eee', borderRadius: '8px',
                    fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
            marginTop: '20px',
          }}>
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: '8px 14px', fontSize: '0.85rem', fontWeight: '700',
                backgroundColor: page === 0 ? '#f3f4f6' : '#fff',
                color: page === 0 ? '#aaa' : '#1a1a1a',
                border: '1px solid #e5e7eb', borderRadius: '8px',
                cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >← Prev</button>
            <span style={{ fontSize: '0.85rem', color: '#666' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                padding: '8px 14px', fontSize: '0.85rem', fontWeight: '700',
                backgroundColor: page >= totalPages - 1 ? '#f3f4f6' : '#fff',
                color: page >= totalPages - 1 ? '#aaa' : '#1a1a1a',
                border: '1px solid #e5e7eb', borderRadius: '8px',
                cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >Next →</button>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

// ─── Staff Event Time Map (/staff/events/:eventId/timemap) ──
// Visual Gantt + hourly coverage for an event's approved vendor
// lineup. Chef uses this to plan the day — see how many vendors
// overlap each hour, whose slot starts when, who needs an extra
// table because they're packed in alongside others. Defaults the
// timeline to event.vendor_start_time → vendor_end_time, falling
// back to start_time/end_time, then to 12pm-10pm.
function EventTimeMapPage({ isMobile, staff }) {
  const { eventId } = useParams();
  const isAdmin = !!staff?.isAdmin;

  const [event, setEvent] = useState(null);
  const [apps, setApps] = useState([]);
  const [attendance, setAttendance] = useState({}); // vendor_id -> row
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('start'); // start | name | duration
  const [now, setNow] = useState(() => new Date());
  const [checkinBusy, setCheckinBusy] = useState(null); // vendor_id

  const refreshAttendance = useCallback(async () => {
    if (!eventId) return;
    const { data, error: attErr } = await supabase
      .from('vendor_attendance')
      .select('id, vendor_id, checked_in_at, geo_verified')
      .eq('event_id', eventId);
    if (attErr) { console.warn('[time-map] attendance fetch', attErr); return; }
    const next = {};
    (data || []).forEach(r => { next[r.vendor_id] = r; });
    setAttendance(next);
  }, [eventId]);

  useEffect(() => {
    if (!isAdmin || !eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [evRes, appsRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('vendor_applications')
          .select('id, status, requested_start_time, requested_end_time, vendor_note, vendor:vendors(*)')
          .eq('event_id', eventId)
          .eq('status', 'approved'),
      ]);
      if (cancelled) return;
      if (evRes.error) { setError(evRes.error.message); setLoading(false); return; }
      if (appsRes.error) { setError(appsRes.error.message); setLoading(false); return; }
      setEvent(evRes.data || null);
      setApps(appsRes.data || []);
      await refreshAttendance();
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId, isAdmin, refreshAttendance]);

  // Tick every minute when the event is today, so the "now" line moves
  // and the header clock stays current.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(tick);
  }, []);

  // Staff check-in: stamp the vendor as arrived right now (honor system,
  // no geo). Optimistic so the row flips instantly. RLS allows admins to
  // manage all attendance rows.
  const checkInNow = async (vendorId) => {
    if (!vendorId || checkinBusy) return;
    setCheckinBusy(vendorId);
    const stamp = new Date().toISOString();
    // Optimistic
    setAttendance(prev => ({ ...prev, [vendorId]: { vendor_id: vendorId, checked_in_at: stamp, geo_verified: false, _pending: true } }));
    const { data, error: insErr } = await supabase
      .from('vendor_attendance')
      .insert({
        vendor_id: vendorId,
        event_id: eventId,
        checked_in_at: stamp,
        geo_verified: false,
      })
      .select('id, vendor_id, checked_in_at, geo_verified')
      .single();
    setCheckinBusy(null);
    if (insErr) {
      console.error('[time-map] check-in failed', insErr);
      alert(`Could not record check-in: ${insErr.message}`);
      // Rollback by re-pulling truth.
      refreshAttendance();
      return;
    }
    setAttendance(prev => ({ ...prev, [vendorId]: data }));
  };

  const undoCheckIn = async (vendorId) => {
    const row = attendance[vendorId];
    if (!row?.id) return;
    if (!window.confirm('Undo this check-in?')) return;
    setCheckinBusy(vendorId);
    const { error: delErr } = await supabase
      .from('vendor_attendance')
      .delete()
      .eq('id', row.id);
    setCheckinBusy(null);
    if (delErr) {
      alert(`Could not undo: ${delErr.message}`);
      return;
    }
    setAttendance(prev => {
      const next = { ...prev };
      delete next[vendorId];
      return next;
    });
  };

  const handlePrintChecklist = () => {
    // Use the browser's print dialog. Print-only CSS hides the rest of
    // the page and renders the checklist block as a clean letter sheet.
    window.print();
  };

  // Generate a real PDF (text-selectable, sharp at any zoom) and trigger
  // a download. Dynamic imports keep the ~180 KB of jspdf out of the
  // bundle until Chef actually clicks Download.
  const handleDownloadChecklist = async () => {
    try {
      const jspdfMod = await import('jspdf');
      await import('jspdf-autotable');
      const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
      const doc = new JsPDF({ unit: 'pt', format: 'letter' });

      const margin = 40;
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('TRAINER CENTER HB · VENDOR DAY CHECK-IN', margin, margin);

      doc.setFontSize(18);
      doc.setTextColor(20);
      doc.text(event.title || 'Vendor Day', margin, margin + 22);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(`${dateLabel} · ${fmt12(windowStart)} – ${fmt12(windowEnd)}`, margin, margin + 40);

      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(
        `${totalSlots} approved vendor${totalSlots === 1 ? '' : 's'}. Mark each vendor's actual arrival time.`,
        margin, margin + 56
      );

      // Table rows
      const rows = sortedSlots.map(s => {
        const att = attendance[s.vendor.id];
        const prefilled = att?.checked_in_at
          ? new Date(att.checked_in_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : '';
        const slot = s.hasSlot ? `${fmt12(s.requested_start)} – ${fmt12(s.requested_end)}` : 'No slot';
        return [' ', s.name, slot, prefilled, ''];
      });

      doc.autoTable({
        startY: margin + 72,
        margin: { left: margin, right: margin },
        head: [['✓', 'Vendor', 'Requested slot', 'Actual arrival', 'Notes']],
        body: rows,
        styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, lineColor: [200, 200, 200], lineWidth: 0.5 },
        headStyles: { fillColor: [26, 26, 26], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 22, halign: 'center' },
          1: { fontStyle: 'bold' },
          2: { cellWidth: 110 },
          3: { cellWidth: 100, font: 'courier' },
          4: { cellWidth: 130 },
        },
        // Draw an empty checkbox in the first column for the manual paper flow.
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 0) {
            const x = data.cell.x + (data.cell.width - 12) / 2;
            const y = data.cell.y + (data.cell.height - 12) / 2;
            doc.setDrawColor(20);
            doc.setLineWidth(1);
            doc.rect(x, y, 12, 12);
          }
          // Draw a thin underline in the "Actual arrival" column when blank,
          // so staff has a clear write-in line on the printed page.
          if (data.section === 'body' && data.column.index === 3 && !data.cell.raw) {
            const x = data.cell.x + 6;
            const y = data.cell.y + data.cell.height - 8;
            doc.setDrawColor(150);
            doc.setLineWidth(0.5);
            doc.line(x, y, x + data.cell.width - 12, y);
          }
          if (data.section === 'body' && data.column.index === 4) {
            const x = data.cell.x + 6;
            const y = data.cell.y + data.cell.height - 8;
            doc.setDrawColor(200);
            doc.setLineWidth(0.5);
            doc.line(x, y, x + data.cell.width - 12, y);
          }
        },
      });

      // Signature footer
      const finalY = doc.lastAutoTable?.finalY || margin + 200;
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text('Staff signature:', margin, finalY + 36);
      doc.setDrawColor(20);
      doc.setLineWidth(0.5);
      doc.line(margin + 90, finalY + 38, margin + 290, finalY + 38);

      doc.text('Date:', margin + 320, finalY + 36);
      doc.line(margin + 360, finalY + 38, pageWidth - margin, finalY + 38);

      const safeTitle = (event.title || 'vendor-day').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const filename = `checkin-${event.event_date}-${safeTitle || 'vendor-day'}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error('[time-map] PDF download failed', err);
      alert(`Could not generate PDF: ${err.message}`);
    }
  };

  if (!isAdmin) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: '#666' }}>
          Staff only.
        </div>
      </PageWrapper>
    );
  }
  if (loading) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: '#999' }}>
          <Loader2 size={18} className="spin" /> Loading time map…
        </div>
      </PageWrapper>
    );
  }
  if (error || !event) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: '#991b1b' }}>
          {error || 'Event not found.'}
          <div style={{ marginTop: '14px' }}>
            <Link to="/staff/vendors" style={{ color: '#1a1a1a' }}>← Back to staff dashboard</Link>
          </div>
        </div>
      </PageWrapper>
    );
  }

  // Time helpers — work in minutes-since-midnight for arithmetic, format
  // back to 12-hour labels when rendering.
  const parseTime = (t) => {
    if (!t) return null;
    const [h, m] = String(t).slice(0, 5).split(':');
    const hh = parseInt(h, 10), mm = parseInt(m, 10);
    if (isNaN(hh) || isNaN(mm)) return null;
    return hh * 60 + mm;
  };
  const fmt12 = (mins) => {
    if (mins == null) return '';
    const hh = Math.floor(mins / 60), mm = mins % 60;
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
  };
  const fmtShort = (mins) => {
    if (mins == null) return '';
    const hh = Math.floor(mins / 60);
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return `${h12}${hh >= 12 ? 'p' : 'a'}`;
  };

  // Timeline window
  const windowStart = parseTime(event.vendor_start_time) ?? parseTime(event.start_time) ?? (12 * 60);
  const windowEnd = parseTime(event.vendor_end_time) ?? parseTime(event.end_time) ?? (22 * 60);
  const windowLen = Math.max(60, windowEnd - windowStart);

  // Per-vendor slot. Missing times → fall back to the event window.
  const slots = apps.map(a => {
    const v = a.vendor || {};
    const sRaw = parseTime(a.requested_start_time);
    const eRaw = parseTime(a.requested_end_time);
    const hasSlot = sRaw != null && eRaw != null;
    const s = hasSlot ? Math.max(windowStart, sRaw) : windowStart;
    const e = hasSlot ? Math.min(windowEnd, eRaw) : windowEnd;
    return {
      app_id: a.id,
      vendor: v,
      name: v.name || '(no name)',
      avatar_url: v.avatar_url,
      requested_start: sRaw,
      requested_end: eRaw,
      hasSlot,
      start: s,
      end: Math.max(s + 15, e),
    };
  });

  // Sort
  const sortedSlots = slots.slice().sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sort === 'duration') return (b.end - b.start) - (a.end - a.start);
    return a.start - b.start || a.name.localeCompare(b.name);
  });

  // Hourly coverage: count concurrent vendors at each hour bucket.
  const startHour = Math.floor(windowStart / 60);
  const endHour = Math.ceil(windowEnd / 60);
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  const coverage = hours.map(h => {
    const hStart = h * 60;
    const hEnd = (h + 1) * 60;
    const count = slots.filter(s => s.start < hEnd && s.end > hStart).length;
    return { hour: h, count };
  });
  const peak = coverage.reduce((acc, c) => c.count > acc.count ? c : acc, { hour: 0, count: 0 });
  const totalSlots = slots.length;
  const withoutTime = slots.filter(s => !s.hasSlot).length;
  const avgConcurrent = coverage.length > 0
    ? (coverage.reduce((sum, c) => sum + c.count, 0) / coverage.length).toFixed(1)
    : 0;

  // Bar color — 5 bins relative to peak so subtle differences still show
  // up. Use full counts (not min-baselined) so a flat-near-peak day still
  // reads as "mostly hot" while a sparse day reads as cool.
  const barColor = (count) => {
    if (count === 0) return { bar: '#e5e7eb', fg: '#9ca3af' };
    const r = peak.count > 0 ? count / peak.count : 0;
    if (r < 0.25) return { bar: '#86efac', fg: '#065f46' };
    if (r < 0.5)  return { bar: '#4ade80', fg: '#15803d' };
    if (r < 0.75) return { bar: '#fbbf24', fg: '#92400e' };
    if (r < 0.95) return { bar: '#fb923c', fg: '#9a3412' };
    return { bar: '#ef4444', fg: '#991b1b' };
  };

  // Nice axis range — picks (axisMin, axisMax, step) that frames the data
  // with a sensible step size. Spread of 1-5 steps in 1s, 6-20 in 2s, etc.
  // Pads above and below the data range by one step so peak bars don't
  // pin to the top of the chart and min bars don't disappear to a sliver.
  const niceAxis = (() => {
    const counts = coverage.map(c => c.count);
    const min = Math.min(...counts, 0);
    const max = Math.max(...counts, 0);
    if (max === 0) return { min: 0, max: 1, step: 1 };
    const range = Math.max(1, max - min);
    let step = 1;
    if (range > 5)   step = 2;
    if (range > 12)  step = 5;
    if (range > 30)  step = 10;
    if (range > 75)  step = 25;
    if (range > 200) step = 50;
    if (range > 500) step = 100;
    const axisMin = Math.max(0, Math.floor(min / step) * step - step);
    const axisMax = Math.ceil(max / step) * step + step;
    return { min: axisMin, max: axisMax, step };
  })();
  // Build the gridline ticks (axisMin, +step, +step, ..., axisMax).
  const axisTicks = [];
  for (let t = niceAxis.min; t <= niceAxis.max; t += niceAxis.step) axisTicks.push(t);
  const barHeight = (count) => {
    const pct = (count - niceAxis.min) / (niceAxis.max - niceAxis.min);
    return Math.max(0, Math.min(1, pct)) * 100; // %
  };

  // Now indicator — only meaningful when the event is today.
  const todayStr = todayISO();
  const isToday = event.event_date === todayStr;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const showNow = isToday && nowMins >= windowStart && nowMins <= windowEnd;
  const nowPct = ((nowMins - windowStart) / windowLen) * 100;

  // Position helpers as percentages of the timeline width.
  const pctLeft = (mins) => `${((mins - windowStart) / windowLen) * 100}%`;
  const pctWidth = (s, e) => `${((e - s) / windowLen) * 100}%`;

  const dateLabel = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Color a vendor lane by relative position so the chart isn't a wall of
  // red. Hash the id into a small palette of accent colors.
  const palette = ['#C8102E', '#1d4ed8', '#0d9488', '#7c3aed', '#b45309', '#be185d', '#15803d', '#475569'];
  const colorFor = (id) => {
    let h = 0;
    for (let i = 0; i < (id || '').length; i++) h = (h * 31 + (id.charCodeAt(i) || 0)) >>> 0;
    return palette[h % palette.length];
  };

  return (
    <PageWrapper isMobile={isMobile}>
      {/* Print styles: hide the whole app shell + dashboard layout during
          window.print() and reveal only the .time-map-print-only block. */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print, .no-print * { display: none !important; }
          .time-map-print-only { display: block !important; }
          .time-map-print-only .checklist-row { page-break-inside: avoid; }
        }
        .time-map-print-only { display: none; }
      `}</style>

      <div className="no-print" style={{ maxWidth: '1100px', margin: '0 auto 64px' }}>
        <Link to="/staff/vendors" style={{
          color: '#666', fontSize: '0.78rem', fontWeight: '700',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
        }}>
          ← Back to staff dashboard
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
          <SectionHeader title="Time Map" subtitle={`${event.title || 'Vendor Day'} · ${dateLabel}`} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Live clock — Chef uses this to confirm the time he's
                stamping vendors in at when he's clicking "Here". */}
            <div style={{
              backgroundColor: '#1a1a1a', color: '#fff',
              padding: '8px 14px', borderRadius: '10px',
              display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
              minWidth: '92px',
            }}>
              <div style={{ fontSize: '0.55rem', fontWeight: '800', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>Now</div>
              <div style={{ fontSize: '1.05rem', fontWeight: '900', letterSpacing: '0.02em', lineHeight: 1.1 }}>
                {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <button
              type="button"
              onClick={handlePrintChecklist}
              style={{
                backgroundColor: '#fff', color: '#1a1a1a',
                border: '1px solid #1a1a1a',
                padding: '10px 14px', borderRadius: '10px',
                fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontFamily: 'inherit',
              }}
            >
              Print
            </button>
            <button
              type="button"
              onClick={handleDownloadChecklist}
              title="Generates a real PDF file and saves it to your downloads."
              style={{
                backgroundColor: '#1a1a1a', color: '#fff',
                border: '1px solid #1a1a1a',
                padding: '10px 14px', borderRadius: '10px',
                fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontFamily: 'inherit',
              }}
            >
              Download PDF
            </button>
          </div>
        </div>

        {/* Summary stat tiles — adds a "Checked in" count so Chef can
            see roll-call progress at a glance. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: '10px',
          marginBottom: '18px',
        }}>
          <StatTile label="Vendors approved" value={totalSlots} />
          <StatTile label="Checked in" value={`${Object.keys(attendance).length} / ${totalSlots}`} accent={Object.keys(attendance).length === totalSlots && totalSlots > 0 ? '#15803d' : '#1a1a1a'} />
          <StatTile label="Peak concurrent" value={peak.count} accent="#C8102E" sub={peak.count > 0 ? `at ${fmt12(peak.hour * 60)}` : '—'} />
          <StatTile label="Avg concurrent" value={avgConcurrent} />
        </div>

        {withoutTime > 0 && (
          <div style={{
            backgroundColor: '#fef3c7', border: '1px solid #fde68a',
            borderRadius: '10px', padding: '10px 14px',
            fontSize: '0.85rem', color: '#92400e', marginBottom: '14px',
          }}>
            <strong>{withoutTime}</strong> approved vendor{withoutTime === 1 ? '' : 's'} ha{withoutTime === 1 ? 's' : 've'} no requested time on file — defaulted to the full event window.
          </div>
        )}

        {/* Sort control */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: '#888', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sort by</span>
          {[
            { key: 'start',    label: 'Start time' },
            { key: 'name',     label: 'Name' },
            { key: 'duration', label: 'Duration' },
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSort(opt.key)}
              style={{
                padding: '6px 12px', fontSize: '0.78rem', fontWeight: '700',
                border: sort === opt.key ? '1px solid #1a1a1a' : '1px solid #e5e7eb',
                backgroundColor: sort === opt.key ? '#1a1a1a' : '#fff',
                color: sort === opt.key ? '#fff' : '#666',
                borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{opt.label}</button>
          ))}
        </div>

        {/* Coverage chart card — big START → END band on top, real bar
            chart underneath with a Y-axis sized to the data range so 12
            vs 16 reads as a meaningful difference. */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '14px' : '18px 22px',
          marginBottom: '14px',
        }}>
          {/* START → END band */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            marginBottom: '18px',
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            <div style={{
              flex: '0 0 auto', textAlign: isMobile ? 'center' : 'left',
              display: 'flex', flexDirection: 'column', gap: '2px',
            }}>
              <div style={{
                fontSize: '0.62rem', fontWeight: '800', color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.12em',
              }}>Start</div>
              <div style={{ fontSize: '1.65rem', fontWeight: '900', color: '#1a1a1a', lineHeight: 1 }}>
                {fmt12(windowStart)}
              </div>
            </div>
            <div style={{
              flex: 1,
              height: isMobile ? '2px' : '4px',
              background: 'linear-gradient(90deg, #C8102E 0%, #1a1a1a 100%)',
              borderRadius: '2px',
              position: 'relative',
              minWidth: isMobile ? '120px' : '0',
            }}>
              <div style={{
                position: 'absolute',
                top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                backgroundColor: '#fff', border: '1px solid #e5e7eb',
                borderRadius: '999px',
                padding: '4px 12px',
                fontSize: '0.72rem', fontWeight: '700', color: '#666',
                whiteSpace: 'nowrap',
              }}>
                {Math.round(windowLen / 60 * 10) / 10} hour{windowLen === 60 ? '' : 's'}
              </div>
            </div>
            <div style={{
              flex: '0 0 auto', textAlign: isMobile ? 'center' : 'right',
              display: 'flex', flexDirection: 'column', gap: '2px',
            }}>
              <div style={{
                fontSize: '0.62rem', fontWeight: '800', color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.12em',
              }}>End</div>
              <div style={{ fontSize: '1.65rem', fontWeight: '900', color: '#1a1a1a', lineHeight: 1 }}>
                {fmt12(windowEnd)}
              </div>
            </div>
          </div>

          {/* Bar chart — Y axis on left, bars in the middle, peak star */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
            {/* Y axis ticks */}
            <div style={{
              display: 'flex', flexDirection: 'column-reverse',
              justifyContent: 'space-between',
              fontSize: '0.65rem', fontWeight: '700', color: '#888',
              paddingBottom: '20px', minWidth: '26px',
              textAlign: 'right',
            }}>
              {axisTicks.map(t => (
                <div key={t} style={{ lineHeight: 1 }}>{t}</div>
              ))}
            </div>

            {/* Chart area */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
              {/* Gridlines */}
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 0, bottom: '20px',
                display: 'flex', flexDirection: 'column-reverse', justifyContent: 'space-between',
                pointerEvents: 'none',
              }}>
                {axisTicks.map((t, i) => (
                  <div key={t} style={{
                    borderTop: i === 0 ? '1px solid #d1d5db' : '1px dashed #f3f4f6',
                    height: 0,
                  }} />
                ))}
              </div>

              {/* Bars */}
              <div style={{
                position: 'relative',
                display: 'flex', alignItems: 'flex-end', gap: '4px',
                height: '160px',
              }}>
                {coverage.map(({ hour, count }) => {
                  const color = barColor(count);
                  const isPeak = peak.count > 0 && count === peak.count;
                  return (
                    <div key={hour} style={{
                      flex: 1, minWidth: 0, height: '100%',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                      position: 'relative',
                    }}>
                      {/* Count label above the bar */}
                      <div style={{
                        fontSize: '0.78rem', fontWeight: '800',
                        color: color.fg, marginBottom: '3px',
                        display: 'flex', alignItems: 'center', gap: '3px',
                      }}>
                        {isPeak && (
                          <span style={{
                            backgroundColor: '#C8102E', color: '#fff',
                            width: '14px', height: '14px', borderRadius: '50%',
                            fontSize: '0.55rem', fontWeight: '900',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }} title="Peak hour">★</span>
                        )}
                        {count}
                      </div>
                      <div style={{
                        width: '100%',
                        height: `${barHeight(count)}%`,
                        minHeight: count === 0 ? '0' : '6px',
                        backgroundColor: color.bar,
                        borderRadius: '6px 6px 0 0',
                        border: isPeak ? `2px solid #C8102E` : `1px solid ${color.bar}`,
                        boxSizing: 'border-box',
                        transition: 'height 0.2s',
                      }} />
                    </div>
                  );
                })}
              </div>

              {/* X axis hour labels */}
              <div style={{
                display: 'flex', gap: '4px',
                marginTop: '6px',
              }}>
                {coverage.map(({ hour }) => (
                  <div key={hour} style={{
                    flex: 1, minWidth: 0, textAlign: 'center',
                    fontSize: '0.7rem', fontWeight: '700', color: '#666',
                  }}>{fmtShort(hour * 60)}</div>
                ))}
              </div>
            </div>
          </div>

          <div style={{
            fontSize: '0.78rem', color: '#666', marginTop: '14px', lineHeight: 1.5,
            paddingTop: '12px', borderTop: '1px solid #f3f4f6',
          }}>
            Each bar = concurrent vendors that hour.
            {peak.count > 0 && <> Plan for at least <strong style={{ color: '#C8102E' }}>{peak.count}</strong> table{peak.count === 1 ? '' : 's'} at peak (<strong>{fmt12(peak.hour * 60)}</strong>).</>}
            {' '}Axis steps by {niceAxis.step}.
          </div>
        </div>

        {/* Gantt — vendor lanes */}
        <div style={{
          backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
          padding: isMobile ? '12px' : '18px 22px',
          overflowX: 'auto',
        }}>
          {/* Hour axis above lanes — matches the Gantt's percentage-based
              positioning so labels sit over the right vertical position. */}
          <div style={{ position: 'relative', height: '20px', marginLeft: isMobile ? 0 : '190px', marginBottom: '8px' }}>
            {hours.map(h => (
              <div key={h} style={{
                position: 'absolute', left: pctLeft(h * 60), top: 0,
                fontSize: '0.7rem', fontWeight: '700', color: '#888',
                transform: 'translateX(-50%)',
              }}>{fmtShort(h * 60)}</div>
            ))}
          </div>

          {/* Lanes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedSlots.length === 0 ? (
              <div style={{ color: '#888', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
                No approved vendors for this event yet.
              </div>
            ) : sortedSlots.map(s => {
              const accent = colorFor(s.vendor.id || s.app_id);
              const att = attendance[s.vendor.id];
              const isCheckedIn = !!att;
              const isBusy = checkinBusy === s.vendor.id;
              const arriveLabel = att?.checked_in_at
                ? new Date(att.checked_in_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                : null;
              return (
                <div key={s.app_id} style={{
                  display: 'flex',
                  gap: '10px',
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  backgroundColor: isCheckedIn ? '#f0fdf4' : 'transparent',
                  borderRadius: '8px',
                  padding: isCheckedIn ? '4px' : '0',
                  transition: 'background-color 0.15s',
                }}>
                  {/* Name label */}
                  <div style={{
                    width: isMobile ? 'auto' : '180px',
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    minWidth: 0,
                  }}>
                    <div style={{
                      width: '4px', height: '24px', backgroundColor: accent, borderRadius: '2px', flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.85rem', fontWeight: '700', color: '#1a1a1a',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{s.name}</div>
                      {s.hasSlot ? (
                        <div style={{ fontSize: '0.7rem', color: '#666' }}>
                          {fmt12(s.requested_start)} – {fmt12(s.requested_end)}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.7rem', color: '#92400e' }}>No requested time</div>
                      )}
                    </div>
                  </div>

                  {/* Bar */}
                  <div style={{
                    position: 'relative',
                    flex: 1,
                    height: '28px',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #f3f4f6',
                    minWidth: isMobile ? 0 : '320px',
                  }}>
                    {/* Hour gridlines */}
                    {hours.slice(1).map(h => (
                      <div key={h} style={{
                        position: 'absolute', left: pctLeft(h * 60), top: 0, bottom: 0,
                        width: '1px', backgroundColor: '#eef2f7',
                      }} />
                    ))}
                    {/* The slot bar */}
                    <div title={`${fmt12(s.start)} – ${fmt12(s.end)}`}
                      style={{
                        position: 'absolute',
                        left: pctLeft(s.start),
                        width: pctWidth(s.start, s.end),
                        top: '3px',
                        bottom: '3px',
                        backgroundColor: accent,
                        opacity: s.hasSlot ? 0.92 : 0.45,
                        borderRadius: '4px',
                        backgroundImage: s.hasSlot ? 'none' : `repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.4) 5px, rgba(255,255,255,0.4) 10px)`,
                      }} />
                    {/* Now line */}
                    {showNow && (
                      <div style={{
                        position: 'absolute',
                        left: `${nowPct}%`,
                        top: '-4px', bottom: '-4px',
                        width: '2px',
                        backgroundColor: '#1a1a1a',
                        boxShadow: '0 0 0 1px #fff',
                        pointerEvents: 'none',
                      }} />
                    )}
                  </div>

                  {/* Check-in control. "Here" stamps the row with the
                      current time; clicking the green pill undoes it. */}
                  <div style={{
                    flexShrink: 0,
                    width: isMobile ? 'auto' : '140px',
                    display: 'flex', justifyContent: isMobile ? 'flex-end' : 'flex-start',
                  }}>
                    {isCheckedIn ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => undoCheckIn(s.vendor.id)}
                        title="Click to undo"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          backgroundColor: '#dcfce7', color: '#15803d',
                          border: '1px solid #86efac',
                          padding: '6px 10px', borderRadius: '999px',
                          fontSize: '0.78rem', fontWeight: '700',
                          cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <CheckCircle2 size={14} />
                        Here · {arriveLabel}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => checkInNow(s.vendor.id)}
                        style={{
                          backgroundColor: '#16a34a', color: '#fff',
                          border: 'none',
                          padding: '8px 16px', borderRadius: '8px',
                          fontSize: '0.85rem', fontWeight: '800',
                          cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit',
                          opacity: isBusy ? 0.7 : 1,
                          minWidth: '90px',
                        }}
                      >
                        {isBusy ? '…' : 'Here'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {showNow && (
            <div style={{
              marginTop: '10px', fontSize: '0.72rem', color: '#1a1a1a', fontWeight: '700',
            }}>
              Now: {fmt12(nowMins)}
            </div>
          )}
        </div>
      </div>

      {/* ────── Print-only check-in sheet ──────────────────────
          Hidden on screen; revealed only during window.print(). Staff who
          aren't in front of a computer at the event can print this out,
          mark arrivals by hand, and hand it back so we can backfill into
          the system later. */}
      <div className="time-map-print-only" style={{
        padding: '24px 32px', fontFamily: 'sans-serif', color: '#000',
      }}>
        <div style={{ borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Trainer Center HB · Vendor Day Check-In
          </div>
          <div style={{ fontSize: '22px', fontWeight: '900', marginTop: '4px' }}>{event.title || 'Vendor Day'}</div>
          <div style={{ fontSize: '13px', marginTop: '2px' }}>{dateLabel} · {fmt12(windowStart)} – {fmt12(windowEnd)}</div>
          <div style={{ fontSize: '11px', marginTop: '6px', color: '#444' }}>
            {totalSlots} approved vendor{totalSlots === 1 ? '' : 's'}.
            Mark each vendor's actual arrival time. Hand back to Chef for entry.
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '22px' }}>✓</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Vendor</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '120px' }}>Requested slot</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '130px' }}>Actual arrival</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '120px' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedSlots.map(s => {
              const att = attendance[s.vendor.id];
              const prefilled = att?.checked_in_at
                ? new Date(att.checked_in_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                : '';
              return (
                <tr key={s.app_id} className="checklist-row" style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '10px 4px', verticalAlign: 'top' }}>
                    <div style={{ width: '14px', height: '14px', border: '1.5px solid #000', borderRadius: '2px' }} />
                  </td>
                  <td style={{ padding: '10px 4px', fontWeight: '700', verticalAlign: 'top' }}>{s.name}</td>
                  <td style={{ padding: '10px 4px', verticalAlign: 'top' }}>
                    {s.hasSlot ? `${fmt12(s.requested_start)} – ${fmt12(s.requested_end)}` : 'No slot'}
                  </td>
                  <td style={{ padding: '10px 4px', verticalAlign: 'top', fontFamily: 'monospace' }}>
                    {prefilled || <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '110px', paddingBottom: '1px' }}>&nbsp;</span>}
                  </td>
                  <td style={{ padding: '10px 4px', verticalAlign: 'top' }}>
                    <span style={{ borderBottom: '1px solid #ccc', display: 'inline-block', minWidth: '110px' }}>&nbsp;</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: '28px', fontSize: '11px', color: '#444' }}>
          Staff signature: <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '220px' }}>&nbsp;</span>
          &nbsp;&nbsp;&nbsp;&nbsp;
          Date: <span style={{ borderBottom: '1px solid #000', display: 'inline-block', minWidth: '120px' }}>&nbsp;</span>
        </div>
      </div>
    </PageWrapper>
  );
}

// Compact metric tile used by the Time Map page.
function StatTile({ label, value, sub, accent, small }) {
  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '12px',
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: '2px',
    }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: '800', color: '#888',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{label}</div>
      <div style={{
        fontSize: small ? '0.95rem' : '1.5rem', fontWeight: '800',
        color: accent || '#1a1a1a',
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: '0.72rem', color: '#666' }}>{sub}</div>
      )}
    </div>
  );
}

// ─── Staff Printables (/staff/printables) ──────────────────
// One-stop shop for things Chef + crew need to print at the shop:
// laminated daily sheets, vendor-day promo cards, and the QR codes
// that route customers to our review/social profiles. Each item has
// a one-click Print (renders into a hidden iframe and triggers the
// browser print dialog without a page nav) and a Download button.
const PRINTABLES = [
  {
    key: 'staff-daily',
    title: 'Staff Daily Sheet',
    desc: 'Opening, mid-day, and closing routine. Print and clip to the counter.',
    file: '/printables/staff-daily.pdf',
    kind: 'pdf',
    accent: '#C8102E',
  },
  {
    key: 'vendor-card',
    title: 'Vendor Card (4×6)',
    desc: 'Tabletop card vendors keep at their station with our QR codes.',
    file: '/printables/vendor-card.pdf',
    kind: 'pdf',
    accent: '#1d4ed8',
  },
  {
    key: 'qr-google',
    title: 'Google Review QR',
    desc: 'Routes customers straight to leaving a Google review.',
    file: '/printables/qr-google.png',
    kind: 'image',
    accent: '#15803d',
  },
  {
    key: 'qr-yelp',
    title: 'Yelp QR',
    desc: 'Routes to our Yelp page for a review.',
    file: '/printables/qr-yelp.png',
    kind: 'image',
    accent: '#c2410c',
  },
  {
    key: 'qr-instagram',
    title: 'Instagram QR',
    desc: 'Routes to @trainercenter.pokemon on Instagram.',
    file: '/printables/qr-instagram.png',
    kind: 'image',
    accent: '#be185d',
  },
  {
    key: 'qr-cardchase',
    title: 'CardChase QR',
    desc: 'Routes to cardchase.org — the app for tracking and trading your collection.',
    file: '/printables/qr-cardchase.png',
    kind: 'image',
    accent: '#7c3aed',
  },
];

function StaffPrintablesPage({ isMobile, staff }) {
  const isAdmin = !!staff?.isAdmin;
  const printFrameRef = useRef(null);
  const [busy, setBusy] = useState(null); // key currently triggering print

  // Print flow: drop the file into a hidden iframe, wait for it to
  // render, then call the iframe's print() so the user gets the print
  // dialog without leaving the page. Works for PDFs and images in
  // every modern browser.
  const printItem = (item) => {
    if (!printFrameRef.current) return;
    setBusy(item.key);
    const frame = printFrameRef.current;
    const cleanup = () => setBusy(null);
    frame.onload = () => {
      try {
        // For images, swap in a tiny HTML doc so it prints centered.
        if (item.kind === 'image') {
          const doc = frame.contentDocument;
          if (doc) {
            doc.open();
            doc.write(`<!doctype html><html><head><title>${item.title}</title><style>
              @page { margin: 0.5in; }
              html,body { margin:0; padding:0; display:flex; align-items:center; justify-content:center; height:100vh; }
              img { max-width: 90vw; max-height: 90vh; }
            </style></head><body><img src="${item.file}" onload="setTimeout(()=>window.print(),100)" /></body></html>`);
            doc.close();
            setTimeout(cleanup, 1500);
            return;
          }
        }
        // For PDFs, the browser's PDF viewer inside the iframe handles
        // print natively when we trigger contentWindow.print().
        const w = frame.contentWindow;
        if (w) {
          setTimeout(() => {
            try { w.focus(); w.print(); } catch (e) { console.warn('print failed', e); }
            cleanup();
          }, 400);
        }
      } catch (e) {
        console.warn('printItem error', e);
        cleanup();
      }
    };
    frame.src = item.file;
  };

  if (!isAdmin) {
    return (
      <PageWrapper isMobile={isMobile}>
        <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: '#666' }}>
          Staff only.
        </div>
      </PageWrapper>
    );
  }

  const IconForKind = ({ kind, accent }) => {
    if (kind === 'pdf') {
      return (
        <div style={{
          width: '56px', height: '56px', borderRadius: '12px',
          backgroundColor: `${accent}15`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, position: 'relative',
        }}>
          <FileEdit size={28} />
        </div>
      );
    }
    return (
      <div style={{
        width: '56px', height: '56px', borderRadius: '12px',
        backgroundColor: `${accent}15`, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, padding: '6px',
      }}>
        <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3" />
          <path d="M21 14v3" />
          <path d="M14 21h3" />
          <path d="M21 21h-3v-3" />
        </svg>
      </div>
    );
  };

  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ maxWidth: '1100px', margin: '0 auto 64px' }}>
        <Link to="/staff/vendors" style={{
          color: '#666', fontSize: '0.78rem', fontWeight: '700',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
        }}>
          ← Back to staff dashboard
        </Link>

        <SectionHeader title="Printables" subtitle="Shop-floor documents + QR codes — print or download" />

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '14px',
          marginTop: '14px',
        }}>
          {PRINTABLES.map(item => {
            const isImage = item.kind === 'image';
            return (
              <div key={item.key} style={{
                backgroundColor: '#fff', border: '1px solid #eee', borderRadius: '14px',
                padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
              }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <IconForKind kind={item.kind} accent={item.accent} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a',
                      marginBottom: '2px',
                    }}>{item.title}</div>
                    <div style={{
                      fontSize: '0.78rem', color: '#666', lineHeight: 1.45,
                    }}>{item.desc}</div>
                    <div style={{
                      fontSize: '0.6rem', fontWeight: '800', letterSpacing: '0.08em',
                      textTransform: 'uppercase', color: item.accent, marginTop: '6px',
                    }}>
                      {item.kind === 'pdf' ? 'PDF' : 'QR · PNG'}
                    </div>
                  </div>
                </div>

                {/* Preview thumbnail for QR images so staff can verify it's
                    the right code at a glance. PDFs get a neutral block. */}
                {isImage && (
                  <div style={{
                    backgroundColor: '#f9fafb', border: '1px solid #f3f4f6',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'flex', justifyContent: 'center',
                  }}>
                    <img
                      src={item.file}
                      alt={item.title}
                      style={{
                        width: '120px', height: '120px', objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    disabled={busy === item.key}
                    onClick={() => printItem(item)}
                    style={{
                      flex: 1,
                      backgroundColor: '#1a1a1a', color: '#fff',
                      border: 'none', padding: '10px 14px',
                      borderRadius: '10px', fontSize: '0.85rem', fontWeight: '800',
                      cursor: busy === item.key ? 'wait' : 'pointer', fontFamily: 'inherit',
                      opacity: busy === item.key ? 0.7 : 1,
                    }}
                  >
                    {busy === item.key ? 'Loading…' : 'Print'}
                  </button>
                  <a
                    href={item.file}
                    download
                    style={{
                      flex: 1, textAlign: 'center',
                      backgroundColor: '#fff', color: '#1a1a1a',
                      border: '1px solid #1a1a1a', padding: '10px 14px',
                      borderRadius: '10px', fontSize: '0.85rem', fontWeight: '800',
                      textDecoration: 'none', fontFamily: 'inherit',
                    }}
                  >
                    Download
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{
          fontSize: '0.75rem', color: '#888', marginTop: '20px', lineHeight: 1.5,
        }}>
          Need a new item here? Drop the file into <code style={{ fontFamily: 'ui-monospace, monospace' }}>public/printables/</code> and add it to the <code style={{ fontFamily: 'ui-monospace, monospace' }}>PRINTABLES</code> array in <code style={{ fontFamily: 'ui-monospace, monospace' }}>src/App.js</code>.
        </p>
      </div>

      {/* Hidden iframe used by the Print buttons. Re-targeted per click. */}
      <iframe
        ref={printFrameRef}
        title="print-frame"
        style={{ position: 'fixed', width: 0, height: 0, border: 0, top: '-10000px', left: '-10000px' }}
      />
    </PageWrapper>
  );
}

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
  // Log every route change to public.page_visits so the daily SEO digest
  // can break down most-viewed pages + pages-per-session metrics.
  usePageViewTracker();
  const [navVisible, setNavVisible] = useState(false);
  const [staffUser, setStaffUser] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [member, setMember] = useState(null);
  // Reminder preferences for the logged-in user. Drives the "My Reminders"
  // nav label, the editable preferences card on /reminders, and the
  // pre-fill in ReminderSignupModal so re-engaging visitors see their
  // current picks instead of an all-checked default. Declared up here
  // because NAV_ITEMS reads `hasReminders` further down in the same render.
  const [reminderSubs, setReminderSubs] = useState(null);
  const [hasReminders, setHasReminders] = useState(false);
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
  // authConfig drives the unified AuthModal. null = closed; otherwise
  // { defaultMode, intent, allowSignup, onSuccess }. Helper openers below
  // wrap the common entry points so callers don't have to repeat shape.
  const [authConfig, setAuthConfig] = useState(null);
  const openLogin = (overrides = {}) => setAuthConfig({ defaultMode: 'login', ...overrides });
  // eslint-disable-next-line no-unused-vars
  const openSignup = (overrides = {}) => setAuthConfig({ defaultMode: 'signup', ...overrides });
  const [menuOpen, setMenuOpen] = useState(false);
  // Staff badge dropdown — exposes Edit Calendar, Manage Vendors,
  // Manage Members, Communication, Business Hours, Log out. Only renders
  // when logged in as a staff admin; vendors/members still get a plain
  // logout-on-click badge.
  const [staffMenuOpen, setStaffMenuOpen] = useState(false);
  const staffMenuRef = useRef(null);
  useEffect(() => {
    if (!staffMenuOpen) return;
    const onClick = (e) => {
      if (staffMenuRef.current && !staffMenuRef.current.contains(e.target)) {
        setStaffMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [staffMenuOpen]);
  // Header notification bell — visible by default on every device, hidden
  // permanently only when the user explicitly opts out via the modal's
  // "Don't show this bell anymore" link. The flag lives in localStorage so
  // the choice persists per browser.
  const BELL_HIDDEN_FLAG = 'tc_reminders_bell_hidden';
  const [bellHidden, setBellHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(BELL_HIDDEN_FLAG) === '1'; } catch { return false; }
  });
  const [showReminderModal, setShowReminderModal] = useState(false);
  const dismissBellForever = () => {
    try { localStorage.setItem(BELL_HIDDEN_FLAG, '1'); } catch { /* private mode */ }
    setBellHidden(true);
    setShowReminderModal(false);
  };
  // Desktop: which dropdown parent is open (label string), or null.
  // Mobile: which accordion section is expanded inside the drawer.
  const [openDropdown, setOpenDropdown] = useState(null);
  const navRef = useRef(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const location = useLocation();

  // Close any open desktop dropdown when clicking outside the nav.
  useEffect(() => {
    if (!openDropdown || isMobile) return;
    const handleClickOutside = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown, isMobile]);

  // Close dropdowns whenever the route changes (handles child clicks).
  useEffect(() => {
    setOpenDropdown(null);
  }, [location.pathname]);

  // Helper: a parent dropdown is "active" when any of its children match.
  // Strip query/hash from `to` so /vendors/apply?mode=signup still matches
  // the live /vendors/apply pathname.
  const pathOnly = (to) => (to || '').split('?')[0].split('#')[0];
  const isParentActive = (children) =>
    children.some(c => {
      if (!c.to) return false;          // skip action items (Log in / Log out)
      if (c.to.includes('#')) return false;  // skip hash anchors — they live on the home page,
                                              // not a separate route. Otherwise every dropdown
                                              // containing "Visit Us" or "Business Hours" would
                                              // light up whenever the user is on /.
      const p = pathOnly(c.to);
      return location.pathname === p || location.pathname.startsWith(p + '/');
    });

  // Auth-aware nav. Each role bucket recolors when the user is logged in
  // for that role, and a Log in / Log out item is the last entry inside
  // each dropdown — replaces the old lock-icon badge.
  const isLoggedIn = !!staffUser;
  const isMember = isLoggedIn && !isAdmin && !isVendor; // anyone logged in who isn't staff/vendor
  // handleLogout is declared further down in this component — wrap it in an
  // arrow so the reference is resolved lazily when the user actually clicks
  // (otherwise we hit the const's temporal dead zone here at render time).
  const NAV_ITEMS = buildNavItems({
    isStaff: isAdmin,
    isVendor,
    isMember,
    isLoggedIn,
    hasReminders,
    onLogin: () => openLogin(),
    onLogout: () => handleLogout(),
  });

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
    setReminderSubs(null);
  };

  const refreshReminders = useCallback(async () => {
    if (!staffUser?.id) {
      setReminderSubs(null);
      setHasReminders(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_reminders');
    if (error) {
      console.error('[reminders] fetch failed', error);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.has_record) {
      setReminderSubs(row.subscriptions || {});
      setHasReminders(!!row.is_subscribed && Object.values(row.subscriptions || {}).some(Boolean));
    } else {
      setReminderSubs(null);
      setHasReminders(false);
    }
  }, [staffUser?.id]);
  useEffect(() => { refreshReminders(); }, [refreshReminders]);

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
    reminderSubs,
    hasReminders,
    refreshReminders,
    signOut: handleLogout,
    refresh: refreshAuthRoles,
    // Lets any descendant trigger the AuthModal with the right shape.
    // Pages call e.g. openAuthModal({ defaultMode: 'signup', intent: 'vendor',
    // onSuccess: (result) => navigate('/vendors/dashboard') })
    openAuthModal: setAuthConfig,
    // True whenever the AuthModal is on screen. Layered surfaces (like
    // ReminderSignupModal) check this and hide themselves so we don't get
    // two stacked overlays fighting for the user's attention.
    isAuthModalOpen: !!authConfig,
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
      <GlobalPreviewBanner isAdmin={isAdmin} />

      {/* Nav - hidden until scroll on home, always visible on other pages */}
      <nav ref={navRef} style={{
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
          {/* Reminder bell — leftmost in the right cluster so it sits
              right before Home in the visual order. Wiggles to draw
              attention; hidden permanently after the user opts out
              via the modal. */}
          {!bellHidden && (
            <button
              type="button"
              className="tc-wiggle"
              onClick={() => setShowReminderModal(true)}
              title="Sign up for reminders"
              aria-label="Sign up for reminders"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#C8102E',
                padding: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bell size={20} />
            </button>
          )}
          {/* Desktop nav links */}
          {!isMobile && NAV_ITEMS.map((item, idx) => {
            // Dropdown parent — click toggles, child click navigates or
            // fires an action (e.g. log in / log out).
            if (item.children) {
              const isOpen = openDropdown === item.label;
              const parentActive = isParentActive(item.children);
              // Parent color: active-state red wins; otherwise the role
              // accent if one is set (Member = cyan, Vendor = green,
              // Staff = red); falls back to neutral.
              const restingParent = item.parentColor || '#555';
              // Last nav item's dropdown anchors right (left:auto, right:0)
              // so its menu never spills off the right edge of the viewport.
              // Inner items keep their centered placement.
              const isLast = idx === NAV_ITEMS.length - 1;
              return (
                <div key={item.label} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setOpenDropdown(isOpen ? null : item.label)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: parentActive || isOpen ? '#C8102E' : restingParent,
                      fontSize: '0.85rem',
                      fontWeight: item.parentColor ? '800' : '600',
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontFamily: 'inherit',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#C8102E'}
                    onMouseLeave={e => { if (!parentActive && !isOpen) e.currentTarget.style.color = restingParent; }}
                  >
                    {item.label}
                    <ChevronDown
                      size={14}
                      style={{
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}
                    />
                  </button>
                  {isOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 14px)',
                      // Anchor right for the last item so the menu doesn't
                      // overflow the viewport edge; center for inner items.
                      ...(isLast
                        ? { right: 0 }
                        : { left: '50%', transform: 'translateX(-50%)' }),
                      backgroundColor: '#ffffff',
                      border: '1px solid #eee',
                      borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      padding: '6px',
                      minWidth: '220px',
                      display: 'flex',
                      flexDirection: 'column',
                      zIndex: 1001,
                    }}>
                      {item.children.map(child => {
                        const isAction = typeof child.action === 'function';
                        const restingColor = child.accent || '#1a1a1a';
                        const childWeight = child.accent ? '800' : '600';
                        // Hash anchors (e.g. /#visit-us) shouldn't claim
                        // "active" on /. Same rule as isParentActive.
                        const childActive = !isAction
                          && !!child.to
                          && !child.to.includes('#')
                          && location.pathname === pathOnly(child.to);
                        const childStyle = {
                          color: childActive ? '#C8102E' : restingColor,
                          textDecoration: 'none',
                          fontSize: '0.85rem',
                          fontWeight: childWeight,
                          padding: '10px 14px',
                          borderRadius: '6px',
                          whiteSpace: 'nowrap',
                          transition: 'background-color 0.15s, color 0.15s',
                          display: 'block',
                        };
                        const handleHoverEnter = e => {
                          e.currentTarget.style.backgroundColor = '#fff0f0';
                          e.currentTarget.style.color = '#C8102E';
                        };
                        const handleHoverLeave = e => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          if (!childActive) e.currentTarget.style.color = restingColor;
                        };
                        if (isAction) {
                          return (
                            <button
                              key={child.label}
                              onClick={() => { setOpenDropdown(null); child.action(); }}
                              style={{
                                ...childStyle,
                                background: 'none', border: 'none',
                                width: '100%', textAlign: 'left',
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                              onMouseEnter={handleHoverEnter}
                              onMouseLeave={handleHoverLeave}
                            >
                              {child.label}
                            </button>
                          );
                        }
                        return (
                          <Link
                            key={child.label}
                            to={child.to}
                            onClick={() => setOpenDropdown(null)}
                            style={childStyle}
                            onMouseEnter={handleHoverEnter}
                            onMouseLeave={handleHoverLeave}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            // Top-level non-dropdown items (Home).
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.label}
                to={item.to}
                style={{
                  color: isActive ? '#C8102E' : '#555',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#C8102E'}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#555'; }}
              >
                {item.label}
              </Link>
            );
          })}
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
          padding: '8px 0',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
        }}>
          {NAV_ITEMS.map(item => {
            // Accordion section for parents with children.
            if (item.children) {
              const isOpen = openDropdown === item.label;
              const parentActive = isParentActive(item.children);
              const restingParent = item.parentColor || '#555';
              return (
                <div key={item.label}>
                  <button
                    onClick={() => setOpenDropdown(isOpen ? null : item.label)}
                    style={{
                      background: 'none',
                      border: 'none',
                      width: '100%',
                      cursor: 'pointer',
                      color: parentActive || isOpen ? '#C8102E' : restingParent,
                      fontSize: '0.95rem',
                      fontWeight: item.parentColor ? '800' : '600',
                      padding: '14px 24px',
                      borderBottom: '1px solid #f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                    <ChevronDown
                      size={16}
                      style={{
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}
                    />
                  </button>
                  {isOpen && (
                    <div style={{
                      backgroundColor: '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                    }}>
                      {item.children.map(child => {
                        const isAction = typeof child.action === 'function';
                        const restingColor = child.accent || '#555';
                        const childWeight = child.accent ? '800' : '600';
                        // Hash anchors (e.g. /#visit-us) shouldn't claim
                        // "active" on /. Same rule as isParentActive.
                        const childActive = !isAction
                          && !!child.to
                          && !child.to.includes('#')
                          && location.pathname === pathOnly(child.to);
                        const baseStyle = {
                          display: 'block',
                          color: childActive ? '#C8102E' : restingColor,
                          textDecoration: 'none',
                          fontSize: '0.9rem',
                          fontWeight: childWeight,
                          padding: '12px 24px 12px 40px',
                          borderTop: '1px solid #efefef',
                        };
                        if (isAction) {
                          return (
                            <button
                              key={child.label}
                              onClick={() => { setMenuOpen(false); setOpenDropdown(null); child.action(); }}
                              style={{
                                ...baseStyle,
                                background: 'none', border: 'none',
                                width: '100%', textAlign: 'left',
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              {child.label}
                            </button>
                          );
                        }
                        return (
                          <Link
                            key={child.label}
                            to={child.to}
                            onClick={() => { setMenuOpen(false); setOpenDropdown(null); }}
                            style={baseStyle}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            // Top-level non-dropdown items (Home).
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => { setMenuOpen(false); setOpenDropdown(null); }}
                style={{
                  color: isActive ? '#C8102E' : '#555',
                  textDecoration: 'none',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  padding: '14px 24px',
                  borderBottom: '1px solid #f0f0f0',
                  transition: 'background-color 0.2s, color 0.2s',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Routes */}
      <Routes>
        <Route path="/" element={<HomePage isMobile={isMobile} />} />
        <Route path="/unsubscribe" element={<UnsubscribePage isMobile={isMobile} />} />
        <Route path="/consultation" element={<ConsultationPage isMobile={isMobile} />} />
        <Route path="/grading" element={<GradingPage isMobile={isMobile} />} />
        <Route path="/reminders" element={<RemindersPage isMobile={isMobile} />} />
        <Route path="/buy-sell" element={<BuySellPage isMobile={isMobile} />} />
        <Route path="/calendar" element={<CalendarPage isMobile={isMobile} isAdmin={isAdmin} staff={staff} />} />
        <Route path="/blog" element={<BlogListPage isMobile={isMobile} />} />
        <Route path="/blog/:slug" element={<BlogPostPage isMobile={isMobile} />} />
        <Route path="/vendor-day" element={<VendorDayPage isMobile={isMobile} />} />
        <Route path="/vendor-day/about" element={<VendorDayAboutPage isMobile={isMobile} />} />
        <Route path="/checkin" element={<GuestCheckinPage isMobile={isMobile} />} />
        <Route path="/staff/preview" element={<StaffPreviewPage isMobile={isMobile} />} />
        <Route path="/vendors" element={<VendorsPage isMobile={isMobile} staff={staff} />} />
        <Route path="/vendors/apply" element={<VendorApplyPage isMobile={isMobile} />} />
        <Route path="/vendors/dashboard" element={<VendorDashboardPage isMobile={isMobile} />} />
        <Route path="/vendors/edit" element={<VendorEditProfilePage isMobile={isMobile} />} />
        <Route path="/vendors/events" element={<VendorEventsListPage isMobile={isMobile} />} />
        <Route path="/vendors/upload" element={<VendorUploadPickerPage isMobile={isMobile} />} />
        <Route path="/vendors/upload/:eventId" element={<VendorUploadPage isMobile={isMobile} />} />
        <Route path="/vendors/review" element={<VendorReviewPage isMobile={isMobile} />} />
        {/* Guest-facing alias for the same review/voting flow. DB still uses members. */}
        <Route path="/guest/dashboard" element={<VendorReviewPage isMobile={isMobile} />} />
        <Route path="/guest/review" element={<VendorReviewPage isMobile={isMobile} />} />
        <Route path="/staff/vendors" element={<StaffVendorsPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/events/:eventId/timemap" element={<EventTimeMapPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/members" element={<StaffMembersPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/comms" element={<StaffCommsPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/instagram" element={<StaffInstagramPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/printables" element={<StaffPrintablesPage isMobile={isMobile} staff={staff} />} />
        <Route path="/staff/analytics" element={<StaffAnalyticsPage isMobile={isMobile} />} />
      </Routes>

      {/* Unified auth modal — replaces the old StaffLogin. Driven by
          authConfig state so callers can request login vs signup, optional
          intent (vendor / member), and an onSuccess callback. */}
      {authConfig && (
        <AuthModal
          defaultMode={authConfig.defaultMode || 'login'}
          intent={authConfig.intent || null}
          allowSignup={authConfig.allowSignup !== false}
          onClose={() => setAuthConfig(null)}
          onSuccess={(result) => {
            // Auth listener handles setStaffUser; caller's onSuccess is
            // for redirect / next-step coordination. When deferClose is
            // true (staff picker stage) we keep the modal open so the
            // user can pick a tile; the picker itself calls onClose.
            authConfig.onSuccess && authConfig.onSuccess(result);
            if (!result?.deferClose) setAuthConfig(null);
          }}
        />
      )}

      {/* Reminder signup modal triggered by the header bell. The calendar
          banner and the /reminders page mount their own copies — this one is
          for the always-on bell. */}
      {showReminderModal && (
        <ReminderSignupModal
          isMobile={isMobile}
          onClose={() => setShowReminderModal(false)}
          onHideBell={dismissBellForever}
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
        /* TipTap editor + rendered description styling. Tight defaults so the
           editor visually matches the day-detail card content area. */
        .ProseMirror { outline: none; min-height: 100px; }
        .ProseMirror p { margin: 0 0 8px 0; }
        .ProseMirror p:last-child { margin-bottom: 0; }
        .ProseMirror ul, .ProseMirror ol { margin: 0 0 8px 0; padding-left: 22px; }
        .ProseMirror li { margin-bottom: 2px; }
        .ProseMirror a { color: #C8102E; text-decoration: underline; }
        .ProseMirror strong { font-weight: 800; color: #1a1a1a; }
        .ProseMirror em { font-style: italic; }
        .ProseMirror s { text-decoration: line-through; color: #6b7280; }
        .ProseMirror.is-editor-empty:first-child::before {
          color: #aaa; content: attr(data-placeholder); float: left;
          height: 0; pointer-events: none;
        }
        .event-md p { margin: 0 0 6px 0; }
        .event-md p:last-child { margin-bottom: 0; }
        .event-md ul, .event-md ol { margin: 0 0 6px 0; padding-left: 22px; }
        .event-md li { margin-bottom: 2px; }
        .event-md a { color: #C8102E; text-decoration: underline; }
        .event-md strong { font-weight: 800; color: #1a1a1a; }
        .event-md em { font-style: italic; }
        .event-md s { text-decoration: line-through; color: #999; }
      `}</style>
    </div>
    </AuthContext.Provider>
    </SiteContext.Provider>
  );
}

export default App;
