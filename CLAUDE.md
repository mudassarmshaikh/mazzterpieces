# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CloudPix (branded "MAZZ-terpieces") is a personal photo/video cloud storage app with three components sharing a single FastAPI backend:

- **backend/** — Python FastAPI server (S3 storage, Google OAuth verification)
- **frontend/** — React SPA (Vite, no TypeScript)
- **Mobile/** — React Native app (Expo SDK 57, has its own CLAUDE.md)

All three clients authenticate via Google OAuth. The backend verifies Google ID tokens and scopes S3 storage per user (`photos/{user.sub}/`). Media is served via S3 presigned URLs (1-hour expiry).

## Development Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload          # runs on :8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # Vite dev server on :5173
npm run lint      # oxlint
npm run build     # production build to dist/
```

### Mobile
```bash
cd Mobile
npm install
npx expo start              # Expo dev server
npx expo start --android    # Android
npx expo start --ios        # iOS
```

### One-time S3 bucket setup
```bash
cd scripts
python setup_bucket.py      # reads creds from backend/.env
```

## Architecture Notes

- **Auth flow**: Frontend uses `@react-oauth/google` (GoogleLogin component + OneTap). The raw Google ID token JWT is stored in `localStorage` (`gid_token`) and sent as a Bearer token on every API call. The backend's `verify_token` dependency verifies it with `google.oauth2.id_token`. Mobile uses `@react-native-google-signin/google-signin` and stores the token in `expo-secure-store`.
- **S3 tenant isolation**: All uploads go to `photos/{google_sub}/` prefix. The delete endpoint enforces prefix ownership. The bucket blocks all public access; images are served only via presigned URLs.
- **Frontend is a single-file SPA**: Almost all UI logic lives in `App.jsx` — login, gallery grid, lightbox viewer, drag-and-drop upload, delete modal. The API layer is in `api.js` (axios with a request interceptor for auth).
- **CORS**: Backend allows `localhost:5173` and `localhost:5174`.
- **Environment variables**: Backend needs `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, `GOOGLE_CLIENT_ID` in `backend/.env`. Frontend needs `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`.
- **Allowed upload types**: images (jpeg, png, gif, webp) and videos (mp4, quicktime, avi, mkv, webm, m4v) — defined in `ALLOWED_TYPES` in `backend/main.py`.
- **Mobile API base URL**: Hardcoded to `10.0.2.2:8000` (Android emulator loopback); must be changed to LAN IP for physical devices.
