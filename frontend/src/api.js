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

export const recordLogin = () => api.post("/auth/login");

export const fetchLogins = () => api.get("/admin/logins").then((r) => r.data);

export const importGooglePhotos = (items) =>
  api.post("/google-photos/import", items).then((r) => r.data);
