import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', color: '#E1306C', icon: '📷' },
  { id: 'facebook',  label: 'Facebook',  color: '#1877F2', icon: '📘' },
  { id: 'linkedin',  label: 'LinkedIn',  color: '#0A66C2', icon: '💼' },
  { id: 'tiktok',    label: 'TikTok',    color: '#010101', icon: '🎵' },
] as const;
type PlatformId = (typeof PLATFORMS)[number]['id'];

const POST_TYPES = [
  'Product Highlight',
  'Installation Story',
  'Promotion',
  'Educational',
  'Testimonial',
  'Company Update',
] as const;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Scheduled:     { bg: '#E3F0FF', color: '#1A62C0' },
  Published:     { bg: '#E4F3E3', color: '#1B512D' },
  Draft:         { bg: '#F3F3F3', color: '#767B77' },
  'Needs Review':{ bg: '#FFF8E1', color: '#B07D00' },
};

interface Post {
  id: number;
  platform: PlatformId;
  title: string;
  type: string;
  caption: string;
  date: string;
  time: string;
  status: keyof typeof STATUS_COLORS;
  img: string | null;
}

const INITIAL_POSTS: Post[] = [
  { id: 1, platform: 'instagram', title: 'Summer Charging Deal',          type: 'Promotion',          caption: '⚡ Summer is here and so is our best deal yet! Get your EVOne 7kW home charger installed for only RM 3,399 — charger + installation included. 🌿 #EVOneEV #HomeCharging #GreenDriving', date: '2026-05-05', time: '10:00', status: 'Scheduled',    img: null },
  { id: 2, platform: 'facebook',  title: 'What is OCPP 1.6?',             type: 'Educational',        caption: 'Did you know our chargers are OCPP 1.6 compliant? This means you can manage your charging sessions remotely, set schedules, and monitor energy use — all from your phone. Learn more at evone.com.my', date: '2026-05-06', time: '09:00', status: 'Draft',         img: null },
  { id: 3, platform: 'linkedin',  title: 'YTL Partnership Announcement',  type: 'Company Update',     caption: "EVOne is proud to partner with YTL PowerSeraya to deploy 18 commercial EV chargers across Kuala Lumpur. Together, we are accelerating Malaysia's EV infrastructure.", date: '2026-05-07', time: '08:30', status: 'Needs Review',  img: null },
  { id: 4, platform: 'instagram', title: 'Customer Spotlight: Bangsar',   type: 'Installation Story', caption: 'Meet Ahmad — one of our latest Bangsar residents to go electric! ⚡ His EVOne 7kW charger was installed in under 4 hours. Ready to wake up to a fully charged car every morning? 🚗💚', date: '2026-05-08', time: '11:00', status: 'Scheduled',    img: null },
  { id: 5, platform: 'tiktok',    title: 'Install Time-lapse',            type: 'Installation Story', caption: 'Watch our team install a 22kW commercial charger in under 4 hours ⏱️ #EVCharger #EVOne #Malaysia #ElectricVehicle #EVLife', date: '2026-05-09', time: '15:00', status: 'Draft',         img: null },
  { id: 6, platform: 'facebook',  title: '7kW vs 22kW — Which?',          type: 'Educational',        caption: "Not sure which charger is right for you? Here's a quick breakdown: 7kW is perfect for home overnight charging. 22kW is ideal for offices and commercial spaces. Both come with professional installation by our certified technicians.", date: '2026-05-10', time: '10:00', status: 'Scheduled',    img: null },
  { id: 7, platform: 'linkedin',  title: 'IP67 Waterproof Feature',       type: 'Product Highlight',  caption: "Our chargers are rated IP67 — fully waterproof and dustproof. Built for Malaysia's tropical climate, operating from -30°C to 50°C. No weather excuses. 🌧️⚡", date: '2026-05-12', time: '09:00', status: 'Scheduled',    img: null },
  { id: 8, platform: 'instagram', title: 'RM 3,399 All-in Package',        type: 'Promotion',          caption: "🔋 Everything you need. Nothing you don't. RM 3,399 gets you: ✅ 7kW EVOne Charger ✅ Professional installation ✅ MCB + RCCB + Isolator ✅ 1 year warranty. DM us to book! #EVCharger #Malaysia", date: '2026-05-14', time: '12:00', status: 'Draft',         img: null },
];

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    return dd;
  });
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function PostCard({ post, onClick }: { post: Post; onClick: (p: Post) => void }) {
  const plat = PLATFORMS.find((p) => p.id === post.platform);
  const sc = STATUS_COLORS[post.status] ?? STATUS_COLORS.Draft;
  return (
    <div
      onClick={() => onClick(post)}
      style={{
        background: C.white,
        borderRadius: 12,
        padding: '12px 14px',
        border: '1px solid #EBEBEB',
        cursor: 'pointer',
        transition: 'box-shadow .15s, transform .15s',
        marginBottom: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{plat?.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: plat?.color }}>{plat?.label}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 99,
            background: sc.bg,
            color: sc.color,
          }}
        >
          {post.status}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 4, lineHeight: 1.3 }}>{post.title}</div>
      <div
        style={{
          fontSize: 11,
          color: C.slate,
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {post.caption}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: C.slate }}>{post.time}</span>
        <span style={{ fontSize: 10, color: '#DADADA' }}>·</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: C.slate, background: '#F3F3F3', padding: '1px 6px', borderRadius: 4 }}>
          {post.type}
        </span>
      </div>
    </div>
  );
}

interface PostModalProps {
  post: Post | null;
  onClose: () => void;
  onSave: (p: Post) => void;
  onDelete: (id: number) => void;
}

function PostModal({ post, onClose, onSave, onDelete }: PostModalProps) {
  const isNew = !post;
  const [form, setForm] = useState<Post>(
    post
      ? { ...post }
      : {
          id: 0,
          platform: 'instagram',
          title: '',
          type: POST_TYPES[0],
          caption: '',
          date: formatDate(new Date()),
          time: '10:00',
          status: 'Draft',
          img: null,
        },
  );
  const plat = PLATFORMS.find((p) => p.id === form.platform);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: C.white, borderRadius: 20, width: 560, maxHeight: '88vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'New Post' : 'Edit Post'}</div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Platform */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Platform</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setForm((f) => ({ ...f, platform: p.id }))}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 10,
                  border: `2px solid ${form.platform === p.id ? p.color : '#EBEBEB'}`,
                  background: form.platform === p.id ? p.color + '15' : C.white,
                  cursor: 'pointer',
                  fontFamily: 'Figtree',
                  fontSize: 11,
                  fontWeight: 700,
                  color: form.platform === p.id ? p.color : C.slate,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 18 }}>{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Post Title</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Internal title for this post…"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a' }}
          />
        </div>

        {/* Type + Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Post Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a', background: C.white }}
            >
              {POST_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a', background: C.white }}
            >
              {Object.keys(STATUS_COLORS).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date + Time */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Time</label>
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a' }}
            />
          </div>
        </div>

        {/* Caption */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Caption</label>
          <textarea
            value={form.caption}
            onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
            rows={5}
            placeholder="Write your post caption…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a', resize: 'vertical', lineHeight: 1.5 }}
          />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 4, textAlign: 'right' }}>{form.caption.length} chars</div>
        </div>

        {/* Preview */}
        {form.caption && (
          <div style={{ background: C.seasalt, borderRadius: 12, padding: '14px 16px', border: '1px solid #EBEBEB' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Preview</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 14 }}>⚡</span>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>evone.official</div>
                <div style={{ fontSize: 10, color: C.slate }}>{plat?.label} · {form.date} {form.time}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{form.caption}</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          {!isNew && (
            <button onClick={() => onDelete(post!.id)} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: isNew ? 0 : 'auto' }}>
            Cancel
          </button>
          <button onClick={() => onSave(form)} style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {isNew ? 'Create Post' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScreenSocial() {
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [filterPlatform, setFilterPlatform] = useState<'all' | PlatformId>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [modal, setModal] = useState<Post | 'new' | null>(null);
  const [weekBase, setWeekBase] = useState<Date>(new Date('2026-05-04'));

  const weekDates = getWeekDates(weekBase);
  const weekLabel = `${weekDates[0].toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
  })} – ${weekDates[6].toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const filtered = posts.filter(
    (p) =>
      (filterPlatform === 'all' || p.platform === filterPlatform) &&
      (filterStatus === 'all' || p.status === filterStatus),
  );

  const handleSave = (form: Post) => {
    if (form.id) {
      setPosts((ps) => ps.map((p) => (p.id === form.id ? form : p)));
    } else {
      setPosts((ps) => [...ps, { ...form, id: Date.now() }]);
    }
    setModal(null);
  };

  const handleDelete = (id: number) => {
    setPosts((ps) => ps.filter((p) => p.id !== id));
    setModal(null);
  };

  const totalScheduled = posts.filter((p) => p.status === 'Scheduled').length;
  const totalDraft = posts.filter((p) => p.status === 'Draft').length;
  const totalPublished = posts.filter((p) => p.status === 'Published').length;
  const totalReview = posts.filter((p) => p.status === 'Needs Review').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Scheduled"    value={totalScheduled} sub="Posts ready to go" accent />
        <KPICard label="Drafts"       value={totalDraft}     sub="In progress" />
        <KPICard label="Published"    value={totalPublished} sub="This month" />
        <KPICard label="Needs Review" value={totalReview}    sub="Awaiting approval" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Platform filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setFilterPlatform('all')}
            style={{
              padding: '6px 14px',
              borderRadius: 99,
              cursor: 'pointer',
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              background: filterPlatform === 'all' ? C.green : C.white,
              color: filterPlatform === 'all' ? C.white : C.slate,
              border: filterPlatform === 'all' ? `1px solid ${C.green}` : '1px solid #EBEBEB',
            }}
          >
            All
          </button>
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterPlatform(p.id)}
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                cursor: 'pointer',
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 600,
                background: filterPlatform === p.id ? p.color : C.white,
                color: filterPlatform === p.id ? C.white : C.slate,
                border: filterPlatform === p.id ? `1px solid ${p.color}` : '1px solid #EBEBEB',
              }}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {['all', ...Object.keys(STATUS_COLORS)].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '6px 12px',
                borderRadius: 99,
                cursor: 'pointer',
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 600,
                background: filterStatus === s ? C.green : 'transparent',
                color: filterStatus === s ? C.white : C.slate,
                border: filterStatus === s ? `1px solid ${C.green}` : '1px solid #EBEBEB',
              }}
            >
              {s === 'all' ? 'All Status' : s}
            </button>
          ))}
        </div>

        {/* View toggle + New */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
            {([['calendar', '⬛ Calendar'], ['list', '≡ List']] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '7px 14px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 600,
                  background: view === v ? C.green : 'transparent',
                  color: view === v ? C.white : C.slate,
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={() => setModal('new')}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + New Post
          </button>
        </div>
      </div>

      {/* Calendar view */}
      {view === 'calendar' && (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid #F3F3F3' }}>
            <button
              onClick={() => {
                const d = new Date(weekBase);
                d.setDate(d.getDate() - 7);
                setWeekBase(d);
              }}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', cursor: 'pointer', fontSize: 16, color: C.slate }}
            >
              ‹
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{weekLabel}</span>
            <button
              onClick={() => {
                const d = new Date(weekBase);
                d.setDate(d.getDate() + 7);
                setWeekBase(d);
              }}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', cursor: 'pointer', fontSize: 16, color: C.slate }}
            >
              ›
            </button>
          </div>

          {/* Day columns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #F3F3F3' }}>
            {weekDates.map((d, i) => {
              const isToday = formatDate(d) === '2026-05-04';
              return (
                <div key={i} style={{ padding: '10px 0 8px', textAlign: 'center', borderRight: i < 6 ? '1px solid #F3F3F3' : 'none' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{WEEK_DAYS[i]}</div>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: isToday ? C.green : 'transparent',
                      color: isToday ? C.white : '#1a1a1a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      margin: '4px auto 0',
                    }}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 280, alignItems: 'start' }}>
            {weekDates.map((d, i) => {
              const dayStr = formatDate(d);
              const dayPosts = filtered.filter((p) => p.date === dayStr);
              return (
                <div key={i} style={{ padding: '10px 8px', borderRight: i < 6 ? '1px solid #F3F3F3' : 'none', minHeight: 280 }}>
                  {dayPosts.map((p) => {
                    const plat = PLATFORMS.find((pl) => pl.id === p.platform);
                    const sc = STATUS_COLORS[p.status] ?? STATUS_COLORS.Draft;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setModal(p)}
                        style={{ background: C.seasalt, borderRadius: 8, padding: '8px 10px', marginBottom: 6, cursor: 'pointer', borderLeft: `3px solid ${plat?.color}`, transition: 'opacity .15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                      >
                        <div style={{ fontSize: 10, color: plat?.color, fontWeight: 700, marginBottom: 2 }}>{plat?.icon} {p.time}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.green, lineHeight: 1.3, marginBottom: 3 }}>{p.title}</div>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: sc.bg, color: sc.color }}>{p.status}</span>
                      </div>
                    );
                  })}
                  {dayPosts.length === 0 && (
                    <div
                      onClick={() => setModal('new')}
                      style={{ height: 36, border: '1.5px dashed #E0E0E0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DADADA', fontSize: 18, cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = C.green;
                        e.currentTarget.style.color = C.green;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#E0E0E0';
                        e.currentTarget.style.color = '#DADADA';
                      }}
                    >
                      +
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ background: C.white, borderRadius: 16, padding: '40px', textAlign: 'center', color: C.slate, fontSize: 14, border: '1px solid #EBEBEB' }}>
              No posts match your filters.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {filtered
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((p) => (
                <PostCard key={p.id} post={p} onClick={setModal} />
              ))}
          </div>
        </div>
      )}

      {modal && (
        <PostModal
          post={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
