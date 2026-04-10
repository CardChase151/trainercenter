import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, Routes, Route, useLocation, useParams } from 'react-router-dom';
import BLOG_DATA from './blogData';
import { supabase } from './supabaseClient';
import { Lock, Unlock, Menu, X, Phone, MapPin, Clock, Award, ShoppingBag, GraduationCap, Calendar as CalendarIcon } from 'lucide-react';
import './App.css';

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
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      onLogin();
      onClose();
    }
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
        <p style={{ fontSize: '0.8rem', color: '#999', margin: '0 0 20px 0' }}>Trainer Center staff only</p>
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
          {error && <p style={{ color: '#C8102E', fontSize: '0.8rem', margin: '0 0 12px 0' }}>{error}</p>}
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

// ─── Category Colors ──────────────────────────────────────
const CATEGORIES = {
  trade_night: { label: 'Trade Night', color: '#C8102E' },
  tournament: { label: 'Tournament', color: '#2563eb' },
  big_event: { label: 'Big Event', color: '#7c3aed' },
  other: { label: 'Other', color: '#ea580c' }
};

// ─── Event Modal (Add/Edit) ───────────────────────────────
function EventModal({ date, existingEvents, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('20:00');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('other');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);

  const dateStr = `${date.toLocaleString('default', { month: 'long' })} ${date.getDate()}, ${date.getFullYear()}`;

  const resetForm = () => {
    setTitle(''); setDescription(''); setStartTime('18:00'); setEndTime('20:00');
    setLocation(''); setCategory('other'); setRecurrence('none'); setRecurrenceEndDate(''); setEditingEvent(null);
  };

  const loadEvent = (event) => {
    setEditingEvent(event);
    setTitle(event.title);
    setDescription(event.description || '');
    setStartTime(event.start_time?.slice(0, 5) || '18:00');
    setEndTime(event.end_time?.slice(0, 5) || '20:00');
    setLocation(event.location || '');
    setCategory(event.category || 'other');
    setRecurrence(event.recurrence || 'none');
    setRecurrenceEndDate(event.recurrence_end_date || '');
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
      category,
      recurrence,
      recurrence_end_date: recurrence !== 'none' && recurrenceEndDate ? recurrenceEndDate : null
    };
    if (editingEvent?.id) eventData.id = editingEvent.id;
    onSave(eventData);
    resetForm();
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: '0.85rem', border: '1px solid #ddd',
    borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box', outline: 'none'
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }} onClick={onClose}>
      <div style={{
        backgroundColor: '#fff', borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        maxHeight: '90vh', overflowY: 'auto'
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 2px 0' }}>{dateStr}</h2>
        <p style={{ fontSize: '0.75rem', color: '#999', margin: '0 0 16px 0' }}>
          {editingEvent ? 'Editing event' : 'Add a new event'}
        </p>

        {/* Existing events on this day */}
        {existingEvents.length > 0 && !editingEvent && (
          <div style={{ marginBottom: '16px' }}>
            {existingEvents.map(ev => (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', backgroundColor: '#f8f8f8', borderRadius: '8px',
                marginBottom: '6px', border: '1px solid #eee'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: CATEGORIES[ev.category]?.color || '#ea580c'
                  }} />
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#1a1a1a' }}>{ev.title}</div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>
                      {ev.start_time?.slice(0, 5)} - {ev.end_time?.slice(0, 5)}
                      {ev.recurrence !== 'none' && <span style={{ color: '#C8102E', marginLeft: '8px' }}>{ev.recurrence}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => loadEvent(ev)} style={{
                    background: '#eee', border: 'none', borderRadius: '6px', padding: '6px 10px',
                    fontSize: '0.7rem', fontWeight: '600', cursor: 'pointer'
                  }}>Edit</button>
                  <button onClick={() => onDelete(ev.id)} style={{
                    background: '#fee', border: 'none', borderRadius: '6px', padding: '6px 10px',
                    fontSize: '0.7rem', fontWeight: '600', cursor: 'pointer', color: '#C8102E'
                  }}>Delete</button>
                </div>
              </div>
            ))}
            <div style={{ borderBottom: '1px solid #eee', margin: '12px 0' }} />
          </div>
        )}

        <input placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        <input placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
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
        <input placeholder="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} />

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Category</label>
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          {Object.entries(CATEGORIES).map(([key, { label, color }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Repeat</label>
        <select value={recurrence} onChange={e => setRecurrence(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="none">Does not repeat</option>
          <option value="weekly">Every week</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Every month</option>
        </select>

        {recurrence !== 'none' && (
          <>
            <label style={{ fontSize: '0.7rem', color: '#999', fontWeight: '600' }}>Repeat until (optional)</label>
            <input type="date" value={recurrenceEndDate} onChange={e => setRecurrenceEndDate(e.target.value)} style={inputStyle} />
          </>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button onClick={handleSave} style={{
            flex: 1, padding: '12px', backgroundColor: '#C8102E', color: '#fff',
            border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer'
          }}>
            {editingEvent ? 'Update Event' : 'Add Event'}
          </button>
          {editingEvent && (
            <button onClick={resetForm} style={{
              padding: '12px 16px', backgroundColor: '#f0f0f0', color: '#666',
              border: 'none', borderRadius: '8px', fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer'
            }}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar Component ───────────────────────────────────
function Calendar({ isStaff, isMobile }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [events, setEvents] = useState([]);
  const [showEventModal, setShowEventModal] = useState(false);
  const [modalDate, setModalDate] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true });
    setEvents(data || []);
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

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
    if (eventData.id) {
      await supabase.from('events').update(eventData).eq('id', eventData.id);
    } else {
      await supabase.from('events').insert([eventData]);
    }
    fetchEvents();
  };

  const handleDeleteEvent = async (eventId) => {
    await supabase.from('events').delete().eq('id', eventId);
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
    const dotColors = [...new Set(dayEvents.map(e => CATEGORIES[e.category]?.color || '#ea580c'))];

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

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.slice(0, 5).split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${h12}:${m} ${ampm}`;
  };

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
          <div style={{
            flex: isMobile ? '1' : '0 0 42%',
            borderLeft: isMobile ? 'none' : '1px solid #eee',
            borderTop: isMobile ? '1px solid #eee' : 'none',
            backgroundColor: '#fafafa',
            padding: '0',
            display: 'flex',
            flexDirection: 'column',
            animation: isMobile ? 'none' : 'slideIn 0.25s ease-out'
          }}>
            {/* Events list */}
            <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map((event) => {
                  const catColor = CATEGORIES[event.category]?.color || '#ea580c';
                  return (
                    <div key={event.id} style={{
                      padding: '14px 16px',
                      backgroundColor: '#ffffff',
                      borderRadius: '10px',
                      border: '1px solid #eee',
                      marginBottom: '10px',
                      borderLeft: `4px solid ${catColor}`
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{
                          fontSize: '0.6rem', fontWeight: '700', color: catColor,
                          backgroundColor: catColor + '15', padding: '2px 8px',
                          borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}>
                          {CATEGORIES[event.category]?.label || 'Other'}
                        </span>
                      </div>
                      <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#1a1a1a', marginBottom: '4px' }}>
                        {event.title}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#888' }}>
                        {formatTime(event.start_time)} - {formatTime(event.end_time)}
                        {event.location && ` | ${event.location}`}
                      </div>
                      {event.description && (
                        <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '6px', lineHeight: '1.4' }}>
                          {event.description}
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
        />
      )}
    </>
  );
}

// ─── Visit Us Section ─────────────────────────────────────
function VisitUsSection({ isMobile }) {
  return (
    <div id="visit-us" style={{
      padding: isMobile ? '48px 20px' : '64px 48px',
      maxWidth: '1200px',
      margin: '0 auto'
    }}>
      <SectionHeader title="Visit Us" subtitle="Come check us out at Harbour Landing" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: '24px'
      }}>
        {/* Location & Contact */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '14px',
          border: '1px solid #eee',
          padding: '28px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <MapPin size={20} color="#C8102E" />
            <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>Location</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#444', margin: '0 0 4px 0', lineHeight: '1.6' }}>
            4911 Warner Ave #210
          </p>
          <p style={{ fontSize: '0.9rem', color: '#444', margin: '0 0 16px 0', lineHeight: '1.6' }}>
            Huntington Beach, CA 92649
          </p>
          <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 24px 0' }}>
            Located in Harbour Landing
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Phone size={20} color="#C8102E" />
            <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>Phone</h3>
          </div>
          <a
            href="tel:+17149519100"
            style={{
              display: 'inline-block',
              backgroundColor: '#C8102E',
              color: '#fff',
              padding: '12px 28px',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: '700',
              textDecoration: 'none',
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            (714) 951-9100
          </a>
        </div>

        {/* Hours */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '14px',
          border: '1px solid #eee',
          padding: '28px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Clock size={20} color="#C8102E" />
            <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#1a1a1a', margin: 0 }}>Hours</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Monday', 'Closed'],
                ['Tuesday', '12 - 8 PM'],
                ['Wednesday', '12 - 8 PM'],
                ['Thursday', '12 - 8 PM'],
                ['Friday', '12 - 10 PM'],
                ['Saturday', '10 AM - 8 PM'],
                ['Sunday', '10 AM - 5 PM']
              ].map(([day, hours]) => (
                <tr key={day}>
                  <td style={{
                    padding: '8px 0',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: hours === 'Closed' ? '#999' : '#1a1a1a',
                    borderBottom: '1px solid #f0f0f0'
                  }}>{day}</td>
                  <td style={{
                    padding: '8px 0',
                    fontSize: '0.9rem',
                    color: hours === 'Closed' ? '#ccc' : '#444',
                    textAlign: 'right',
                    fontWeight: hours === 'Closed' ? '400' : '600',
                    borderBottom: '1px solid #f0f0f0'
                  }}>{hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        Trainer <span style={{ color: '#C8102E' }}>Center</span>
      </p>
      <p style={{ fontSize: '0.75rem', margin: '0 0 20px 0' }}>
        Pokemon cards, collectibles, and community events
      </p>
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
            Trainer <span style={{ color: '#C8102E', backgroundColor: '#ffffff', padding: '0px 5px', borderRadius: '6px', marginLeft: '4px' }}>Center</span>
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

      {/* Mission section + Visit Us + Footer */}
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '40px 16px' : '60px 24px' }}>
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
              Trainer Center is a Pokemon only store. We are an education and community driven store that promotes math, reading, critical thinking, social engagement, friendship and community action through Pokemon. We host an after school social club for collectors, traders, friends and family that promotes social interaction in a clean, safe, fun, fair and supervised environment. Our goal is to become fully licensed and a part of the Pokemon Company family and have Pokemon be a positive staple in the Huntington Beach area.
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
              Free Collection Consultation
            </h3>
          </div>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '20px' }}>
            Whether you found a box of old cards in the attic or you have been collecting for years, our staff will sit down with you and walk through what you have. This is not a sales pitch. The goal is to educate you so you know what your collection is actually worth and you do not get taken advantage of.
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
            padding: '16px 20px',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '0.9rem', color: '#C8102E', fontWeight: '700', margin: '0 0 4px 0' }}>
              Call to schedule your consultation
            </p>
            <a href="tel:+17149519100" style={{
              fontSize: '1.1rem', fontWeight: '800', color: '#C8102E', textDecoration: 'none'
            }}>
              (714) 951-9100
            </a>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─── Grading Page ─────────────────────────────────────────
function GradingPage({ isMobile }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ marginBottom: '64px' }}>
        <SectionHeader title="Grading" subtitle="We help you evaluate and submit cards for professional grading" />
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
              PSA Grading Services
            </h3>
          </div>
          <p style={{ fontSize: '1rem', color: '#333', lineHeight: '1.8', marginBottom: '12px' }}>
            Grading authenticates your card, seals it in a tamper-proof case, and assigns a condition score from 1 to 10. A high grade can multiply a card's value significantly. We help you decide which cards are worth grading, evaluate their condition, and handle the submission to PSA.
          </p>
          <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6', marginBottom: '28px' }}>
            PSA (Professional Sports Authenticator) is the most recognized grading service in the hobby. Here are their current pricing tiers:
          </p>

          {/* PSA Pricing Table */}
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

          <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '24px', lineHeight: '1.5' }}>
            Prices are per card and set by PSA. Value Bulk requires a 20-card minimum. Max Value is the maximum declared value per card for that tier. Prices as of early 2026 and subject to change.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
            gap: '12px'
          }}>
            {[
              { title: 'We Evaluate', desc: 'Bring your cards in and we will assess condition and help you decide if grading is worth the cost.' },
              { title: 'We Submit', desc: 'We handle the PSA submission process for you. No need to create an account or figure out shipping.' },
              { title: 'You Profit', desc: 'A PSA 10 Charizard is worth significantly more than a raw one. Grading protects and increases value.' }
            ].map((item, i) => (
              <div key={i} style={{
                padding: '16px', borderRadius: '10px',
                backgroundColor: '#fafafa', border: '1px solid #f0f0f0', textAlign: 'center'
              }}>
                <h5 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#C8102E', margin: '0 0 6px 0' }}>{item.title}</h5>
                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0, lineHeight: '1.5' }}>{item.desc}</p>
              </div>
            ))}
          </div>
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
      </div>
    </PageWrapper>
  );
}

// ─── Calendar Page ────────────────────────────────────────
function CalendarPage({ isMobile, isAdmin }) {
  return (
    <PageWrapper isMobile={isMobile}>
      <div style={{ position: 'relative' }}>
        <SectionHeader title="Calendar" subtitle="Upcoming events and activities" />

        {/* Event type cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? (window.innerWidth < 480 ? '1fr' : 'repeat(2, 1fr)') : 'repeat(4, 1fr)',
          gap: '14px',
          marginBottom: '28px'
        }}>
          <div style={{
            padding: '20px', borderRadius: '12px', backgroundColor: '#ffffff',
            borderLeft: '4px solid #C8102E', border: '1px solid #eee',
            borderLeftWidth: '4px', borderLeftColor: '#C8102E'
          }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              backgroundColor: '#C8102E', marginBottom: '10px'
            }} />
            <h4 style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>
              Trade Night
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#888', margin: 0, lineHeight: '1.4' }}>
              Bring your binders and trade with fellow trainers. All eras welcome.
            </p>
          </div>

          <div style={{
            padding: '20px', borderRadius: '12px', backgroundColor: '#ffffff',
            borderLeft: '4px solid #2563eb', border: '1px solid #eee',
            borderLeftWidth: '4px', borderLeftColor: '#2563eb'
          }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              backgroundColor: '#2563eb', marginBottom: '10px'
            }} />
            <h4 style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>
              Tournament
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#888', margin: 0, lineHeight: '1.4' }}>
              Competitive play with prizes. Standard and expanded formats.
            </p>
          </div>

          <div style={{
            padding: '20px', borderRadius: '12px', backgroundColor: '#ffffff',
            borderLeft: '4px solid #7c3aed', border: '1px solid #eee',
            borderLeftWidth: '4px', borderLeftColor: '#7c3aed'
          }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              backgroundColor: '#7c3aed', marginBottom: '10px'
            }} />
            <h4 style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>
              Big Event
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#888', margin: 0, lineHeight: '1.4' }}>
              Release parties, community days, special celebrations, and more.
            </p>
          </div>

          <div style={{
            padding: '20px', borderRadius: '12px', backgroundColor: '#ffffff',
            borderLeft: '4px solid #ea580c', border: '1px solid #eee',
            borderLeftWidth: '4px', borderLeftColor: '#ea580c'
          }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              backgroundColor: '#ea580c', marginBottom: '10px'
            }} />
            <h4 style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1a1a1a', margin: '0 0 4px 0' }}>
              Other
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#888', margin: 0, lineHeight: '1.4' }}>
              Birthday parties, meetups, league nights, and community activities.
            </p>
          </div>
        </div>
        <div style={{
          position: 'relative',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden'
        }}>
          {/* Layer 1: white bg (handled by container) */}
          {/* Layer 2: logo watermark */}
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
          {/* Layer 3: calendar */}
          <div style={{ position: 'relative', zIndex: 2 }}>
            <Calendar isStaff={isAdmin} isMobile={isMobile} />
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

// ─── Nav Link Helper ──────────────────────────────────────
const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'Calendar', to: '/calendar' },
  { label: 'Visit Us', to: '/#visit-us' },
  { label: 'Buy/Sell', to: '/buy-sell' },
  { label: 'Consultation', to: '/consultation' },
  { label: 'Grading', to: '/grading' },
  { label: 'Blog', to: '/blog' }
];

// ─── Main App ─────────────────────────────────────────────
function App() {
  const [navVisible, setNavVisible] = useState(false);
  const [staffUser, setStaffUser] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const profileFetchRef = useRef(null);
  const isAdmin = !!staffProfile?.is_admin;
  const [showLogin, setShowLogin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const location = useLocation();

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

  // Fetch staff profile in a SEPARATE effect, watching staffUser?.id.
  // Source of truth for is_admin lives in public.profiles, not the JWT,
  // so admin changes take effect on next fetch with no re-login required.
  useEffect(() => {
    if (!staffUser?.id) {
      setStaffProfile(null);
      return;
    }

    if (profileFetchRef.current) profileFetchRef.current.cancelled = true;
    const fetchState = { cancelled: false };
    profileFetchRef.current = fetchState;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    Promise.race([
      supabase.from('profiles').select('*').eq('id', staffUser.id).single(),
      timeoutPromise
    ])
      .then(({ data, error } = {}) => {
        if (fetchState.cancelled) return;
        if (error) {
          console.error('Profile fetch error:', error.message);
          setStaffProfile(null);
        } else {
          setStaffProfile(data);
        }
      })
      .catch((err) => {
        if (!fetchState.cancelled) console.error('Profile fetch failed:', err.message);
      });

    return () => { fetchState.cancelled = true; };
  }, [staffUser?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setStaffUser(null);
    setStaffProfile(null);
  };

  return (
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
            Trainer <span style={{ color: '#C8102E' }}>Center</span>
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
        <Route path="/consultation" element={<ConsultationPage isMobile={isMobile} />} />
        <Route path="/grading" element={<GradingPage isMobile={isMobile} />} />
        <Route path="/buy-sell" element={<BuySellPage isMobile={isMobile} />} />
        <Route path="/calendar" element={<CalendarPage isMobile={isMobile} isAdmin={isAdmin} />} />
        <Route path="/blog" element={<BlogListPage isMobile={isMobile} />} />
        <Route path="/blog/:slug" element={<BlogPostPage isMobile={isMobile} />} />
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
  );
}

export default App;
