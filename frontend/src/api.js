import axios from "axios";

const api = axios.create({ baseURL: "http://localhost:8000" });

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
