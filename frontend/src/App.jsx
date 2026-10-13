import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLogin, googleLogout, useGoogleLogin } from "@react-oauth/google";
import { deletePhoto, fetchLogins, fetchPhotos, importGooglePhotos, recordLogin, uploadPhoto } from "./api";
import "./App.css";

const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]);
const isVideo = (filename) => VIDEO_EXTS.has(filename.split(".").pop().toLowerCase());

function Icon({ name, className = "" }) {
  return <span className={`material-symbols-rounded ${className}`}>{name}</span>;
}

/* ── Date grouping ── */
function groupByDate(photos) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 6 * 86400000);
  const groups = new Map();
  for (const p of photos) {
    const d = new Date(p.last_modified);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label;
    if (day >= today) label = "Today";
    else if (day >= yesterday) label = "Yesterday";
    else if (day >= weekAgo) label = "This week";
    else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  }
  return [...groups.entries()];
}

/* ── Login screen ── */
function LoginScreen({ onSuccess }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="MAZZ-terpieces" className="logo-img" />
          <span className="logo-text">MAZZ-terpieces</span>
        </div>
        <p className="login-tagline">Your personal media vault — sign in to continue.</p>
        <div className="login-divider" />
        <GoogleLogin
          onSuccess={onSuccess}
          onError={() => alert("Google sign-in failed. Please try again.")}
          shape="pill"
          size="large"
          text="signin_with"
          theme="filled_black"
          useOneTap
        />
        <p className="login-note">
          <Icon name="lock" className="login-lock-icon" />
          Your photos are private and only visible to you.
        </p>
      </div>
    </div>
  );
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const BAR_COLORS = ["#7c6cf8","#f87171","#34d399","#fbbf24","#60a5fa","#f472b6","#a78bfa"];

/* ── Nav rail ── */
function NavRail({ photos, activeTab, onTabChange }) {
  const items = [
    { id: "photos", icon: "photo_library", label: "Photos" },
    { id: "admin", icon: "admin_panel_settings", label: "Admin" },
  ];

  // Aggregate bytes per user
  const byUser = {};
  for (const p of photos) {
    byUser[p.uploaded_by] = (byUser[p.uploaded_by] ?? 0) + (p.size ?? 0);
  }
  const users = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
  const maxLog = users.length ? Math.log10(users[0][1] + 1) : 1;

  return (
    <aside className="nav-rail">
      <nav className="rail-nav">
        {items.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`rail-item ${activeTab === id ? "active" : ""}`}
            onClick={() => onTabChange(id)}
          >
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="rail-storage">
        <p className="storage-label">Storage by user</p>
        {users.length === 0 && <p className="storage-detail" style={{ marginTop: 6 }}>No data</p>}
        {users.map(([name, bytes], i) => {
          const logPct = maxLog > 0 ? (Math.log10(bytes + 1) / maxLog) * 100 : 0;
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={name} className="storage-user-row">
              <div className="storage-user-header">
                <span className="storage-user-name" title={name}>{name}</span>
                <span className="storage-user-size">{fmtBytes(bytes)}</span>
              </div>
              <div className="storage-bar-track">
                <div className="storage-bar-fill" style={{ width: `${logPct}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Admin panel ── */
function AdminPanel() {
  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogins()
      .then(setLogins)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="status-center"><div className="spinner" /><p>Loading…</p></div>;

  return (
    <div className="admin-panel">
      <h2 className="admin-title">Login History</h2>
      {logins.length === 0 ? (
        <p className="admin-empty">No login events recorded yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Email</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logins.map((ev, i) => (
                <tr key={i}>
                  <td>
                    {ev.picture
                      ? <img src={ev.picture} alt={ev.name} className="admin-avatar" referrerPolicy="no-referrer" />
                      : <div className="admin-avatar-fallback">{ev.name?.[0]?.toUpperCase()}</div>
                    }
                  </td>
                  <td className="admin-name">{ev.name}</td>
                  <td className="admin-email">{ev.email}</td>
                  <td className="admin-time">
                    {new Date(ev.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── User menu ── */
function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="user-menu-wrap">
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} title={user.name}>
        {user.picture
          ? <img className="avatar-img" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
          : <div className="avatar-fallback">{user.name?.[0]?.toUpperCase() ?? "?"}</div>
        }
      </button>
      {open && (
        <div className="user-dropdown" onClick={() => setOpen(false)}>
          <div className="dropdown-profile">
            {user.picture
              ? <img className="dropdown-avatar" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              : <div className="avatar-fallback dropdown-avatar">{user.name?.[0]?.toUpperCase()}</div>
            }
            <div>
              <p className="dropdown-name">{user.name}</p>
              <p className="dropdown-email">{user.email}</p>
            </div>
          </div>
          <div className="dropdown-divider" />
          <button className="dropdown-signout" onClick={onSignOut}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Google Photos Picker import ── */
const PICKER_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const PICKER_API = "https://photospicker.googleapis.com/v1";

function GooglePhotosImport({ onImportDone }) {
  const [phase, setPhase] = useState("idle"); // idle | picking | importing
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const pollRef = useRef(null);

  const startSession = async (accessToken) => {
    setPhase("picking");
    // Open blank popup synchronously before any async work — browsers block
    // popups opened from async callbacks, but allow navigating an already-open one.
    const popup = window.open("", "gpicker", "width=900,height=650");
    try {
      // 1. Create picker session
      const sessionRes = await fetch(`${PICKER_API}/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const session = await sessionRes.json();
      console.log("Picker session response:", session);

      if (!session.pickerUri) {
        popup?.close();
        alert(`Google Photos Picker error: ${JSON.stringify(session)}\n\nMake sure the "Photos Picker API" is enabled in Google Cloud Console.`);
        setPhase("idle");
        return;
      }

      // 2. Navigate the already-open popup to the picker URL
      popup.location.href = session.pickerUri;

      // 3. Poll until user finishes selecting
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${PICKER_API}/sessions/${session.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const updated = await pollRes.json();
          if (updated.mediaItemsSet) {
            clearInterval(pollRef.current);
            popup?.close();

            // 4. Fetch selected items
            const itemsRes = await fetch(`${PICKER_API}/mediaItems?sessionId=${session.id}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const itemsBody = await itemsRes.json();
            console.log("Picker mediaItems response:", itemsBody);
            const mediaItems = itemsBody.mediaItems ?? [];

            if (!mediaItems.length) {
              alert("No photos were selected.");
              setPhase("idle");
              return;
            }

            // 5. Send to backend for S3 upload
            setPhase("importing");
            setProgress({ done: 0, total: mediaItems.length });

            const payload = mediaItems.map((item) => {
              const mf = item.mediaFile ?? item;
              return {
                url: (mf.baseUrl ?? mf.url) + "=d",
                filename: mf.filename ?? `import_${item.id}.jpg`,
                mimeType: mf.mimeType ?? "image/jpeg",
                access_token: accessToken,
              };
            });
            console.log("Import payload:", payload);

            try {
              for (let i = 0; i < payload.length; i += 5) {
                const result = await importGooglePhotos(payload.slice(i, i + 5));
                console.log("Import result:", JSON.stringify(result));
                setProgress({ done: Math.min(i + 5, payload.length), total: payload.length });
              }
              setPhase("idle");
              onImportDone();
            } catch (err) {
              console.error("Import failed:", err);
              alert(`Import failed: ${err.response?.data?.detail ?? err.message}`);
              setPhase("idle");
            }
          }
        } catch { /* keep polling */ }
      }, 2500);
    } catch {
      setPhase("idle");
    }
  };

  const login = useGoogleLogin({
    scope: PICKER_SCOPE,
    onSuccess: (tok) => startSession(tok.access_token),
    onError: () => setPhase("idle"),
  });

  useEffect(() => () => clearInterval(pollRef.current), []);

  const label =
    phase === "picking" ? "Waiting…" :
    phase === "importing" ? `${progress.done}/${progress.total}` :
    "Google Photos";

  return (
    <button
      className="upload-btn gphotos-btn"
      onClick={() => { if (phase === "idle") login(); }}
      disabled={phase !== "idle"}
      title="Import from Google Photos"
    >
      <Icon name="photo_library" />
      {label}
    </button>
  );
}

/* ── Delete modal ── */
function DeleteModal({ photo, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon-wrap">
          <Icon name="delete_forever" className="modal-icon" />
        </div>
        <p className="modal-title">Delete this item?</p>
        <img className="modal-thumb" src={photo.url} alt={photo.filename} />
        <p className="modal-filename">{photo.filename}</p>
        <p className="modal-warning">
          <Icon name="warning" className="warning-icon" />
          This will permanently remove it from S3 and cannot be undone.
        </p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm" onClick={onConfirm}>
            <Icon name="delete" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main app ── */
export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gid_user") || "null"); }
    catch { return null; }
  });
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [activeTab, setActiveTab] = useState("photos");
  const fileRef = useRef();

  /* ── Auth ── */
  const handleLoginSuccess = (credentialResponse) => {
    const token = credentialResponse.credential;
    // Decode the JWT payload (no signature verification needed here — backend verifies)
    const payload = JSON.parse(atob(token.split(".")[1]));
    const userInfo = {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
    localStorage.setItem("gid_token", token);
    localStorage.setItem("gid_user", JSON.stringify(userInfo));
    setUser(userInfo);
    recordLogin().catch(() => {});
  };

  const handleSignOut = () => {
    googleLogout();
    localStorage.removeItem("gid_token");
    localStorage.removeItem("gid_user");
    setUser(null);
    setPhotos([]);
  };

  /* ── Photos ── */
  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try { setPhotos(await fetchPhotos()); }
    catch { alert("Could not load photos. Check that the backend is running."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (user) loadPhotos();
  }, [user, loadPhotos]);

  const handleFiles = async (files) => {
    const media = [...files].filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (!media.length) return;
    setUploading(true);
    for (const file of media) {
      await uploadPhoto(file, setProgress).catch(() => alert(`Failed to upload ${file.name}`));
    }
    setUploading(false);
    setProgress(0);
    loadPhotos();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const confirmDelete = async () => {
    await deletePhoto(pendingDelete.key);
    if (selected?.key === pendingDelete.key) setSelected(null);
    setPendingDelete(null);
    loadPhotos();
  };


  const filtered = photos.filter((p) =>
    p.filename.toLowerCase().includes(search.toLowerCase())
  );
  const groups = groupByDate(filtered);
  const selectedIndex = selected ? filtered.findIndex((p) => p.key === selected.key) : -1;
  const goNext = () => selectedIndex < filtered.length - 1 && setSelected(filtered[selectedIndex + 1]);
  const goPrev = () => selectedIndex > 0 && setSelected(filtered[selectedIndex - 1]);

  /* ── Not signed in ── */
  if (!user) return <LoginScreen onSuccess={handleLoginSuccess} />;

  return (
    <div className="app">
      {/* Top app bar */}
      <header className="topbar">
        <div className="topbar-logo">
          <img src="/logo.png" alt="MAZZ-terpieces" className="logo-img" />
          <span className="logo-text">MAZZ-terpieces</span>
        </div>

        <div className="search-wrap">
          <Icon name="search" className="search-icon" />
          <input
            className="search-input"
            type="text"
            placeholder="Search photos, videos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>
              <Icon name="close" />
            </button>
          )}
        </div>

        <div className="topbar-actions">
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid view"
            >
              <Icon name="grid_view" />
            </button>
            <button
              className={`view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <Icon name="view_list" />
            </button>
          </div>
          <GooglePhotosImport onImportDone={loadPhotos} />
          <button
            className="upload-btn"
            onClick={() => fileRef.current.click()}
            disabled={uploading}
          >
            <Icon name="add_photo_alternate" />
            {uploading ? `${progress}%` : "Upload"}
          </button>
          <UserMenu user={user} onSignOut={handleSignOut} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </header>

      <div className="body-row">
        <NavRail photos={photos} activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "admin" && (
          <main className="grid-area"><AdminPanel /></main>
        )}
        <main
          className={`grid-area ${dragOver ? "drag-over" : ""}`}
          style={activeTab !== "photos" ? { display: "none" } : {}}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="drop-overlay">
              <Icon name="cloud_upload" className="drop-icon" />
              <p>Drop to upload</p>
            </div>
          )}

          {loading && (
            <div className="status-center">
              <div className="spinner" />
              <p>Loading…</p>
            </div>
          )}

          {!loading && photos.length === 0 && (
            <div className="empty">
              <div className="empty-icon-wrap">
                <Icon name="add_photo_alternate" className="empty-icon" />
              </div>
              <p className="empty-title">No photos yet</p>
              <p className="empty-sub">Drag images or videos here, or click <strong>Upload</strong>.</p>
              <button className="upload-btn" onClick={() => fileRef.current.click()}>
                <Icon name="upload" /> Upload your first photo
              </button>
            </div>
          )}

          {!loading && filtered.length === 0 && photos.length > 0 && (
            <div className="empty">
              <Icon name="search_off" className="empty-icon" style={{ fontSize: 48 }} />
              <p className="empty-title">No results for "{search}"</p>
            </div>
          )}

          {!loading && groups.map(([label, items]) => (
            <section key={label} className="date-group">
              <h2 className="date-label">{label}</h2>
              {viewMode === "grid" ? (
                <div className="photo-grid">
                  {items.map((p) => (
                    <div
                      key={p.key}
                      className={`photo-card ${isVideo(p.filename) ? "video-card" : ""}`}
                      onClick={() => setSelected(p)}
                    >
                      {isVideo(p.filename) ? (
                        <video src={p.url} muted playsInline preload="metadata" />
                      ) : (
                        <img src={p.url} alt={p.filename} loading="lazy" />
                      )}
                      <div className="card-overlay">
                        <button
                          className="delete-btn"
                          onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}
                          title="Delete"
                        >
                          <Icon name="delete" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="photo-list">
                  {items.map((p) => (
                    <div key={p.key} className="photo-list-row" onClick={() => setSelected(p)}>
                      <div className="list-thumb-wrap">
                        {isVideo(p.filename) ? (
                          <video src={p.url} muted playsInline preload="metadata" className="list-thumb" />
                        ) : (
                          <img src={p.url} alt={p.filename} className="list-thumb" loading="lazy" />
                        )}
                        {isVideo(p.filename) && <Icon name="play_circle" className="list-video-badge" />}
                      </div>
                      <div className="list-info">
                        <p className="list-filename">{p.filename}</p>
                        <p className="list-meta">
                          <Icon name="person" className="list-meta-icon" />
                          {p.uploaded_by}
                          <span className="list-dot">·</span>
                          <Icon name="schedule" className="list-meta-icon" />
                          {new Date(p.last_modified).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                          <span className="list-dot">·</span>
                          {(p.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        className="delete-btn list-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}
                        title="Delete"
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </main>

        {!loading && groups.length > 1 && (
          <div className="date-scrubber">
            {groups.map(([label]) => (
              <span key={label} className="scrubber-tick">{label.split(" ").slice(-1)[0]}</span>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selected && (
        <div className="lightbox" onClick={() => setSelected(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setSelected(null)}>
              <Icon name="close" />
            </button>
            {selectedIndex > 0 && (
              <button className="lightbox-prev" onClick={goPrev}>
                <Icon name="chevron_left" />
              </button>
            )}
            {selectedIndex < filtered.length - 1 && (
              <button className="lightbox-next" onClick={goNext}>
                <Icon name="chevron_right" />
              </button>
            )}
            {isVideo(selected.filename) ? (
              <video src={selected.url} controls autoPlay className="lightbox-video" />
            ) : (
              <img src={selected.url} alt={selected.filename} />
            )}
            <div className="lightbox-info">
              <div className="lightbox-meta">
                <Icon name={isVideo(selected.filename) ? "videocam" : "image"} className="meta-icon" />
                <span className="lightbox-filename">{selected.filename}</span>
                <span className="lightbox-size">{(selected.size / 1024).toFixed(1)} KB</span>
              </div>
              <div className="lightbox-actions">
                <button className="lightbox-delete" onClick={() => { setSelected(null); setPendingDelete(selected); }}>
                  <Icon name="delete" /> Delete
                </button>
                <button className="lightbox-close-btn" onClick={() => setSelected(null)}>
                  <Icon name="close" /> Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <DeleteModal
          photo={pendingDelete}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
