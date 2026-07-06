import { useCallback, useEffect, useRef, useState } from "react";
import { deletePhoto, fetchPhotos, uploadPhoto } from "./api";
import "./App.css";

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos(await fetchPhotos());
    } catch {
      alert("Could not load photos. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const handleFiles = async (files) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploading(true);
    for (const file of images) {
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

  const handleDelete = async (photo) => {
    if (!confirm(`Delete "${photo.filename}"?`)) return;
    await deletePhoto(photo.key);
    if (selected?.key === photo.key) setSelected(null);
    loadPhotos();
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">&#9729; CloudPix</span>
        <button className="upload-btn" onClick={() => fileRef.current.click()} disabled={uploading}>
          {uploading ? `Uploading… ${progress}%` : "+ Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </header>

      <main
        className={`grid-area ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {loading && <p className="status">Loading photos…</p>}
        {!loading && photos.length === 0 && (
          <div className="empty">
            <p>No photos yet.</p>
            <p>Drag images here or click <strong>+ Upload</strong>.</p>
          </div>
        )}
        <div className="photo-grid">
          {photos.map((p) => (
            <div key={p.key} className="photo-card" onClick={() => setSelected(p)}>
              <img src={p.url} alt={p.filename} loading="lazy" />
              <button
                className="delete-btn"
                onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                title="Delete"
              >&#x2715;</button>
            </div>
          ))}
        </div>
      </main>

      {selected && (
        <div className="lightbox" onClick={() => setSelected(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={selected.url} alt={selected.filename} />
            <div className="lightbox-info">
              <span>{selected.filename}</span>
              <span>{(selected.size / 1024).toFixed(1)} KB</span>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
