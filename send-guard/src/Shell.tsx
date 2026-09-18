import type { Channel } from "./lib/types";
import { ME, type Person } from "./lib/seed";
import {
  Activity,
  Back,
  Chevron,
  Clock,
  Compose,
  Dms,
  Filter,
  Forward,
  Hash,
  Headphones,
  Help,
  Home,
  Later,
  Lock,
  Logo,
  More,
  Plus,
  Search,
  ShieldCheck,
} from "./Icons";

export const WORKSPACE = "Northwind";

export function Avatar({ person, size = 36, presence }: { person: Person; size?: number; presence?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }}>
      {person.initials}
      {presence && <span className="presence" />}
    </span>
  );
}

export function TopBar({ guardOpen, onToggleGuard }: { guardOpen: boolean; onToggleGuard: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn dim-btn" aria-label="Back">
          <Back />
        </button>
        <button className="icon-btn dim-btn" aria-label="Forward">
          <Forward />
        </button>
        <button className="icon-btn" aria-label="History">
          <Clock />
        </button>
      </div>
      <div className="search" role="search">
        <Search size={16} />
        <span>Search {WORKSPACE}</span>
        <span className="search-filter">
          <Filter size={15} />
        </span>
      </div>
      <div className="topbar-right">
        <button className={`icon-btn guard-toggle ${guardOpen ? "on" : ""}`} onClick={onToggleGuard} title="Send Guard">
          <ShieldCheck />
        </button>
        <button className="icon-btn" aria-label="Help">
          <Help />
        </button>
        <Avatar person={ME} size={26} presence />
      </div>
    </header>
  );
}

export function Rail() {
  const items: Array<{ label: string; icon: React.ReactNode; active?: boolean; badge?: boolean }> = [
    { label: "Home", icon: <Home />, active: true },
    { label: "DMs", icon: <Dms />, badge: true },
    { label: "Activity", icon: <Activity /> },
    { label: "Later", icon: <Later /> },
    { label: "More", icon: <More /> },
  ];
  return (
    <nav className="rail">
      <div className="rail-logo">
        <Logo size={36} />
      </div>
      {items.map((it) => (
        <button key={it.label} className={`rail-item ${it.active ? "active" : ""}`}>
          <span className="rail-icon">
            {it.icon}
            {it.badge && <span className="rail-badge" />}
          </span>
          <span className="rail-label">{it.label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <button className="rail-plus">
        <Plus />
      </button>
      <div className="rail-avatar">
        <Avatar person={ME} size={36} presence />
      </div>
    </nav>
  );
}

interface SidebarProps {
  channels: Channel[];
  dms: Array<{ channel: Channel; person: Person }>;
  activeId: string;
  unread: Set<string>;
  onSelect: (id: string) => void;
  disabled: boolean;
}

export function Sidebar({ channels, dms, activeId, unread, onSelect, disabled }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="ws-name">
          {WORKSPACE} <Chevron size={16} />
        </button>
        <button className="icon-btn compose-btn" aria-label="New message">
          <Compose size={18} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <ul className="side-list side-quick">
          <li className="side-item">
            <Dms size={18} /> <span>Threads</span>
          </li>
          <li className="side-item">
            <Headphones size={18} /> <span>Huddles</span>
          </li>
          <li className="side-item">
            <Later size={18} /> <span>Drafts &amp; sent</span>
          </li>
        </ul>

        <div className="side-section">
          <button className="side-section-head">
            <Chevron size={14} className="caret" /> Channels
          </button>
          <ul className="side-list">
            {channels.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    className={`side-item ${active ? "active" : ""} ${unread.has(c.id) ? "unread" : ""}`}
                    onClick={() => onSelect(c.id)}
                    disabled={disabled}
                  >
                    {c.private ? <Lock size={16} /> : <Hash size={16} />}
                    <span className="side-name">{c.name.replace(/^#/, "")}</span>
                    {c.shared && <span className="shared-pill">Acme</span>}
                  </button>
                </li>
              );
            })}
            <li>
              <button className="side-item side-add">
                <span className="side-plus">
                  <Plus size={14} />
                </span>
                <span>Add channels</span>
              </button>
            </li>
          </ul>
        </div>

        <div className="side-section">
          <button className="side-section-head">
            <Chevron size={14} className="caret" /> Direct messages
          </button>
          <ul className="side-list">
            {dms.map(({ channel, person }) => {
              const active = channel.id === activeId;
              return (
                <li key={channel.id}>
                  <button className={`side-item ${active ? "active" : ""}`} onClick={() => onSelect(channel.id)} disabled={disabled}>
                    <Avatar person={person} size={20} presence />
                    <span className="side-name">{person.name}</span>
                    {person.external && <span className="shared-pill">Acme</span>}
                  </button>
                </li>
              );
            })}
            <li>
              <button className="side-item">
                <Avatar person={ME} size={20} presence />
                <span className="side-name">
                  {ME.name} <span className="you">you</span>
                </span>
              </button>
            </li>
            <li>
              <button className="side-item side-add">
                <span className="side-plus">
                  <Plus size={14} />
                </span>
                <span>Add teammates</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  );
}
