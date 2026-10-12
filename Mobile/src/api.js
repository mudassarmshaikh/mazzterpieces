import * as SecureStore from "expo-secure-store";

const BASE_URL = "https://mazzterpieces.us-west-2.elasticbeanstalk.com";

async function authHeaders() {
  const token = await SecureStore.getItemAsync("gid_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchPhotos() {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/photos`, { headers });
  if (!res.ok) throw new Error(`fetchPhotos ${res.status}`);
  return res.json();
}

export async function uploadPhoto(uri, filename, mimeType, onProgress) {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("file", { uri, name: filename, type: mimeType });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/photos/upload`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`upload ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

export async function deletePhoto(key) {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/photos/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`deletePhoto ${res.status}`);
  return res.json();
}
