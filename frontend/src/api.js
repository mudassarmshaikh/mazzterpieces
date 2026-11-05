import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
});

// Attach the Google ID token from localStorage before every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("gid_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const fetchPhotos = () => api.get("/photos").then((r) => r.data);

export const uploadPhoto = (file, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/photos/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  });
};

export const deletePhoto = (key) => api.delete(`/photos/${key}`);

export const getDownloadUrl = (key) => api.get(`/download/${key}`).then((r) => r.data.url);

export const fetchTrash = () => api.get("/trash").then((r) => r.data);
export const permanentlyDelete = (key) => api.delete(`/trash/${key}`);

export const recordLogin = () => api.post("/auth/login");

export const fetchLogins = () => api.get("/admin/logins").then((r) => r.data);

export const importGooglePhotos = (items) =>
  api.post("/google-photos/import", items).then((r) => r.data);

export const fetchAllowlist = () => api.get("/admin/allowlist").then((r) => r.data);
export const addToAllowlist = (email, grant) =>
  api.post(`/admin/allowlist/${encodeURIComponent(email)}`, grant).then((r) => r.data);
export const removeFromAllowlist = (email) => api.delete(`/admin/allowlist/${encodeURIComponent(email)}`).then((r) => r.data);

export const requestAccess = (message = "") =>
  api.post("/auth/request-access", { message }).then((r) => r.data);
export const fetchAccessRequests = () => api.get("/admin/access-requests").then((r) => r.data);
export const approveAccessRequest = (email, grant) =>
  api.post(`/admin/access-requests/${encodeURIComponent(email)}/approve`, grant).then((r) => r.data);
export const denyAccessRequest = (email) =>
  api.post(`/admin/access-requests/${encodeURIComponent(email)}/deny`).then((r) => r.data);
