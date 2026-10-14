import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLogin, googleLogout, useGoogleLogin } from "@react-oauth/google";
import { addToAllowlist, deletePhoto, fetchAllowlist, fetchLogins, fetchPhotos, fetchTrash, getDownloadUrl, importGooglePhotos, permanentlyDelete, recordLogin, removeFromAllowlist, uploadPhoto } from "./api";
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
          <img src="/logo.png" alt="MAZZterpix" className="logo-img" />
          <span className="logo-text">MAZZterpix</span>
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
  const topItems = [
    { id: "photos", icon: "perm_media", label: "Media" },
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
        {topItems.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`rail-item ${activeTab === id ? "active" : ""}`}
            onClick={() => onTabChange(id)}
          >
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className={`rail-item rail-item-trash ${activeTab === "trash" ? "active" : ""}`}
          onClick={() => onTabChange("trash")}
        >
          <Icon name="delete" /><span>Recycle Bin</span>
        </button>
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
function AdminPanel({ user }) {
  const [adminTab, setAdminTab] = useState("logins");
  const [logins, setLogins] = useState([]);
  const [loginsLoading, setLoginsLoading] = useState(true);
  const [allowlist, setAllowlist] = useState({ restricted: false, emails: [], owner: "" });
  const [accessLoading, setAccessLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLogins().then(setLogins).catch(() => {}).finally(() => setLoginsLoading(false));
    fetchAllowlist().then(setAllowlist).catch(() => {}).finally(() => setAccessLoading(false));
  }, []);

  const handleAdd = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setSaving(true);
    try {
      const res = await addToAllowlist(email);
      setAllowlist((a) => ({ ...a, restricted: true, emails: res.emails }));
      setNewEmail("");
    } catch (e) {
      alert(e.response?.data?.detail ?? e.message);
    } finally { setSaving(false); }
  };

  const handleRemove = async (email) => {
    setSaving(true);
    try {
      const res = await removeFromAllowlist(email);
      setAllowlist((a) => ({ ...a, emails: res.emails }));
    } catch (e) {
      alert(e.response?.data?.detail ?? e.message);
    } finally { setSaving(false); }
  };

  const isOwner = user?.email === allowlist.owner;

  return (
    <div className="admin-panel">
      <div className="admin-tabs">
        <button className={`admin-tab-btn ${adminTab === "logins" ? "active" : ""}`} onClick={() => setAdminTab("logins")}>
          <Icon name="history" /> Login History
        </button>
        <button className={`admin-tab-btn ${adminTab === "access" ? "active" : ""}`} onClick={() => setAdminTab("access")}>
          <Icon name="lock" /> Access Control
        </button>
      </div>

      {adminTab === "logins" && (
        <>
          {loginsLoading
            ? <div className="status-center"><div className="spinner" /></div>
            : logins.length === 0
              ? <p className="admin-empty">No login events recorded yet.</p>
              : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th></th><th>Name</th><th>Email</th><th>Time</th></tr></thead>
                    <tbody>
                      {logins.map((ev, i) => (
                        <tr key={i}>
                          <td>{ev.picture
                            ? <img src={ev.picture} alt={ev.name} className="admin-avatar" referrerPolicy="no-referrer" />
                            : <div className="admin-avatar-fallback">{ev.name?.[0]?.toUpperCase()}</div>}
                          </td>
                          <td className="admin-name">{ev.name}</td>
                          <td className="admin-email">{ev.email}</td>
                          <td className="admin-time">{new Date(ev.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </>
      )}

      {adminTab === "access" && (
        <div className="access-panel">
          <div className={`access-status ${allowlist.restricted ? "restricted" : "open"}`}>
            <Icon name={allowlist.restricted ? "lock" : "lock_open"} />
            {allowlist.restricted
              ? `Restricted — only ${allowlist.emails.length} approved email${allowlist.emails.length !== 1 ? "s" : ""} can access`
              : "Open — anyone with a Google account can access"}
          </div>

          {isOwner && (
            <div className="access-add-row">
              <input
                className="access-input"
                type="email"
                placeholder="Add email address…"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <button className="upload-btn" onClick={handleAdd} disabled={saving || !newEmail.trim()}>
                <Icon name="add" /> Add
              </button>
            </div>
          )}

          {accessLoading
            ? <div className="status-center"><div className="spinner" /></div>
            : allowlist.emails.length === 0
              ? <p className="admin-empty" style={{ marginTop: 12 }}>No emails added yet — app is open to all.</p>
              : (
                <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                  <table className="admin-table">
                    <thead><tr><th>Email</th><th>Role</th>{isOwner && <th></th>}</tr></thead>
                    <tbody>
                      {allowlist.emails.map((email) => (
                        <tr key={email}>
                          <td className="admin-email" style={{ color: "var(--text-bright)" }}>{email}</td>
                          <td>
                            <span className={`access-role ${email === allowlist.owner ? "owner" : "user"}`}>
                              {email === allowlist.owner ? "Owner" : "User"}
                            </span>
                          </td>
                          {isOwner && (
                            <td>
                              {email !== allowlist.owner && (
                                <button className="access-remove-btn" onClick={() => handleRemove(email)} disabled={saving}>
                                  <Icon name="delete" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

/* ── Google Photos logo icon ── */
function GooglePhotosLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
      <path fill="#FBBC04" d="M96 12a36 36 0 0 0-36 36v48h48V48a36 36 0 0 0-12-36z"/>
      <path fill="#4285F4" d="M180 96a36 36 0 0 0-36-36H96v48h48a36 36 0 0 0 36-12z"/>
      <path fill="#34A853" d="M96 180a36 36 0 0 0 36-36v-48H84v48a36 36 0 0 0 12 36z"/>
      <path fill="#EA4335" d="M12 96a36 36 0 0 0 36 36h48V84H48a36 36 0 0 0-36 12z"/>
    </svg>
  );
}

/* ── Google Photos Picker import ── */
const PICKER_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const PICKER_API = "https://photospicker.googleapis.com/v1";

function GooglePhotosImport({ onImportDone, existingFilenames }) {
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

            // 4. Fetch all selected items (paginated)
            const mediaItems = [];
            let pageToken = undefined;
            do {
              const qs = new URLSearchParams({ sessionId: session.id, pageSize: "100" });
              if (pageToken) qs.set("pageToken", pageToken);
              const itemsRes = await fetch(`${PICKER_API}/mediaItems?${qs}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const itemsBody = await itemsRes.json();
              console.log(`Picker page: ${(itemsBody.mediaItems ?? []).length} items, nextPageToken=${itemsBody.nextPageToken ?? "none"}`);
              mediaItems.push(...(itemsBody.mediaItems ?? []));
              pageToken = itemsBody.nextPageToken;
            } while (pageToken);

            if (!mediaItems.length) {
              alert("No photos were selected.");
              setPhase("idle");
              return;
            }

            // 5. Send to backend for S3 upload (skip already-uploaded filenames)
            const allPayload = mediaItems.map((item) => {
              const mf = item.mediaFile ?? item;
              return {
                url: (mf.baseUrl ?? mf.url) + "=d",
                filename: mf.filename ?? `import_${item.id}.jpg`,
                mimeType: mf.mimeType ?? "image/jpeg",
                access_token: accessToken,
              };
            });
            const payload = allPayload.filter((item) => !existingFilenames.has(item.filename));
            const skippedDupes = allPayload.length - payload.length;
            console.log(`Import: ${payload.length} new, ${skippedDupes} already uploaded`);

            if (!payload.length) {
              alert(`All ${allPayload.length} selected files are already in your library.`);
              setPhase("idle");
              return;
            }

            setPhase("importing");
            setProgress({ done: 0, total: payload.length });

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
    phase === "picking" ? "Waiting for selection…" :
    phase === "importing" ? `Importing ${progress.done}/${progress.total}…` :
    "Import from Google Photos";

  return (
    <button
      className="upload-btn gphotos-btn"
      onClick={() => { if (phase === "idle") login(); }}
      disabled={phase !== "idle"}
      title="Import from Google Photos"
    >
      <GooglePhotosLogo size={17} />
      {label}
    </button>
  );
}

/* ── Lightbox video with codec-error fallback ── */
function LightboxVideo({ src, filename, videoKey }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await getDownloadUrl(videoKey);
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch { alert("Download failed."); }
    finally { setDownloading(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <video
        src={src}
        controls
        autoPlay
        muted
        className="lightbox-video"
        onError={(e) => {
          const err = e.target.error;
          console.error("Video error code:", err?.code, "| message:", err?.message, "| src:", src.slice(0, 80));
        }}
      />
      <button className="upload-btn" style={{ opacity: 0.8, fontSize: 13 }} onClick={handleDownload} disabled={downloading}>
        <Icon name="download" /> {downloading ? "Downloading…" : "Download"}
      </button>
    </div>
  );
}

/* ── Delete modal ── */
function DeleteModal({ photo, onConfirm, onCancel, permanent = false }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon-wrap">
          <Icon name={permanent ? "delete_forever" : "delete"} className="modal-icon" />
        </div>
        <p className="modal-title">{permanent ? "Delete forever?" : "Move to Recycle Bin?"}</p>
        <img className="modal-thumb" src={photo.url} alt={photo.filename} />
        <p className="modal-filename">{photo.filename}</p>
        <p className="modal-warning">
          <Icon name="warning" className="warning-icon" />
          {permanent
            ? "This will permanently remove it from storage and cannot be undone."
            : "This item will be moved to the Recycle Bin. You can permanently delete it from there."}
        </p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm" onClick={onConfirm}>
            <Icon name={permanent ? "delete_forever" : "delete"} />
            {permanent ? "Delete Forever" : "Move to Bin"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Recycle Bin ── */
function RecycleBin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingPermDelete, setPendingPermDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await fetchTrash()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmPermDelete = async () => {
    await permanentlyDelete(pendingPermDelete.key);
    setPendingPermDelete(null);
    load();
  };

  if (loading) return <div className="status-center"><div className="spinner" /><p>Loading…</p></div>;

  return (
    <div>
      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon-wrap"><Icon name="delete" className="empty-icon" /></div>
          <p className="empty-title">Recycle Bin is empty</p>
          <p className="empty-sub">Items you remove from Media will appear here before being permanently deleted.</p>
        </div>
      ) : (
        <>
          <p className="trash-hint"><Icon name="info" style={{ fontSize: 15, verticalAlign: "middle" }} /> Items here are not permanently deleted yet.</p>
          <div className="photo-list">
            {items.map((p) => (
              <div key={p.key} className="photo-list-row">
                <div className="list-thumb-wrap">
                  {isVideo(p.filename)
                    ? <video src={p.url} muted playsInline preload="metadata" className="list-thumb" />
                    : <img src={p.url} alt={p.filename} className="list-thumb" loading="lazy" />}
                  {isVideo(p.filename) && <Icon name="play_circle" className="list-video-badge" />}
                </div>
                <div className="list-info">
                  <p className="list-filename">{p.filename}</p>
                  <p className="list-meta">
                    <Icon name="person" className="list-meta-icon" />{p.uploaded_by}
                    <span className="list-dot">·</span>
                    <Icon name="schedule" className="list-meta-icon" />
                    {new Date(p.last_modified).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    <span className="list-dot">·</span>
                    {(p.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  className="delete-btn list-delete-btn"
                  style={{ opacity: 1 }}
                  onClick={() => setPendingPermDelete(p)}
                  title="Delete permanently"
                >
                  <Icon name="delete_forever" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {pendingPermDelete && (
        <DeleteModal
          photo={pendingPermDelete}
          permanent
          onConfirm={confirmPermDelete}
          onCancel={() => setPendingPermDelete(null)}
        />
      )}
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
  const [mediaFilter, setMediaFilter] = useState("all"); // "all" | "photos" | "videos"
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const fileRef = useRef();

  const toggleSelectMode = () => {
    setSelectMode((s) => !s);
    setSelectedKeys(new Set());
  };

  const toggleKey = (key) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const confirmBulkDelete = async () => {
    await Promise.all([...selectedKeys].map((k) => deletePhoto(k)));
    setSelectedKeys(new Set());
    setSelectMode(false);
    loadPhotos();
  };

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


  const filtered = photos.filter((p) => {
    if (!p.filename.toLowerCase().includes(search.toLowerCase())) return false;
    if (mediaFilter === "photos") return !isVideo(p.filename);
    if (mediaFilter === "videos") return isVideo(p.filename);
    return true;
  });
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
          <img src="/logo.png" alt="MAZZterpix" className="logo-img" />
          <span className="logo-text">MAZZterpix</span>
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
          {activeTab === "photos" && (
            <button
              className={`upload-btn ${selectMode ? "select-mode-active" : ""}`}
              onClick={toggleSelectMode}
              title={selectMode ? "Cancel selection" : "Select multiple"}
              style={selectMode ? { background: "var(--accent)", color: "#fff" } : {}}
            >
              <Icon name={selectMode ? "close" : "checklist"} />
              {selectMode ? "Cancel" : "Select"}
            </button>
          )}
          <GooglePhotosImport
            onImportDone={loadPhotos}
            existingFilenames={new Set(photos.map((p) => p.original_filename).filter(Boolean))}
          />
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
          <main className="grid-area"><AdminPanel user={user} /></main>
        )}
        {activeTab === "trash" && (
          <main className="grid-area"><RecycleBin /></main>
        )}
        <main
          className={`grid-area ${dragOver ? "drag-over" : ""}`}
          style={activeTab !== "photos" ? { display: "none" } : {}}

          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="media-filter-bar">
            {[
              { id: "all",    icon: "perm_media",  label: "All"    },
              { id: "photos", icon: "image",        label: "Photos" },
              { id: "videos", icon: "videocam",     label: "Videos" },
            ].map(({ id, icon, label }) => (
              <button
                key={id}
                className={`media-filter-btn ${mediaFilter === id ? "active" : ""}`}
                onClick={() => setMediaFilter(id)}
              >
                <Icon name={icon} />{label}
              </button>
            ))}
          </div>

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
                      className={`photo-card ${isVideo(p.filename) ? "video-card" : ""} ${selectMode && selectedKeys.has(p.key) ? "selected" : ""}`}
                      onClick={() => selectMode ? toggleKey(p.key) : setSelected(p)}
                    >
                      {isVideo(p.filename) ? (
                        <video src={p.url} muted playsInline preload="metadata" />
                      ) : (
                        <img src={p.url} alt={p.filename} loading="lazy" />
                      )}
                      {selectMode ? (
                        <div className="card-select-overlay">
                          <div className={`select-check ${selectedKeys.has(p.key) ? "checked" : ""}`}>
                            {selectedKeys.has(p.key) && <Icon name="check" />}
                          </div>
                        </div>
                      ) : (
                        <div className="card-overlay">
                          <button
                            className="delete-btn"
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}
                            title="Delete"
                          >
                            <Icon name="delete" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="photo-list">
                  {items.map((p) => (
                    <div
                      key={p.key}
                      className={`photo-list-row ${selectMode && selectedKeys.has(p.key) ? "selected" : ""}`}
                      onClick={() => selectMode ? toggleKey(p.key) : setSelected(p)}
                    >
                      {selectMode && (
                        <div className={`select-check ${selectedKeys.has(p.key) ? "checked" : ""}`} style={{ marginRight: 10, flexShrink: 0 }}>
                          {selectedKeys.has(p.key) && <Icon name="check" />}
                        </div>
                      )}
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
                      {!selectMode && (
                        <button
                          className="delete-btn list-delete-btn"
                          onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}
                          title="Delete"
                        >
                          <Icon name="delete" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </main>

        {!loading && groups.length > 1 && activeTab === "photos" && activeTab !== "trash" && (
          <div className="date-scrubber">
            {groups.map(([label]) => (
              <span key={label} className="scrubber-tick">{label.split(" ").slice(-1)[0]}</span>
            ))}
          </div>
        )}
      </div>

      {/* Bulk delete action bar */}
      {selectMode && (
        <div className="bulk-action-bar">
          <span className="bulk-count">
            {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : "Tap items to select"}
          </span>
          <div className="bulk-actions">
            <button className="bulk-select-all" onClick={() => setSelectedKeys(new Set(filtered.map((p) => p.key)))}>
              <Icon name="select_all" /> Select all
            </button>
            <button
              className="modal-confirm"
              disabled={selectedKeys.size === 0}
              onClick={confirmBulkDelete}
            >
              <Icon name="delete" /> Move {selectedKeys.size > 0 ? selectedKeys.size : ""} to Bin
            </button>
          </div>
        </div>
      )}

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
              <LightboxVideo src={selected.url} filename={selected.filename} videoKey={selected.key} />
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
