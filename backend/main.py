import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import requests as http_requests

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="MAZZ-terpieces API")

_default_origins = "http://localhost:5173,http://localhost:5174"
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

AWS_REGION = os.getenv("AWS_REGION", "us-west-2")
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "cloudpix-photos")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "")

ALLOWLIST_KEY = "admin/allowlist.json"
_allowlist_cache: Optional[List[str]] = None   # None = not yet loaded
_allowlist_cache_time: float = 0
_ALLOWLIST_TTL = 60  # seconds


def _read_allowlist() -> Optional[List[str]]:
    """Returns None (open access) if the file doesn't exist, or a list of allowed emails."""
    global _allowlist_cache, _allowlist_cache_time
    now = time.time()
    if _allowlist_cache_time and now - _allowlist_cache_time < _ALLOWLIST_TTL:
        return _allowlist_cache
    try:
        body = s3.get_object(Bucket=BUCKET_NAME, Key=ALLOWLIST_KEY)["Body"].read()
        _allowlist_cache = json.loads(body)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            _allowlist_cache = None  # file absent = open access
        else:
            return _allowlist_cache  # S3 error — keep stale cache
    _allowlist_cache_time = now
    return _allowlist_cache


def _write_allowlist(emails: List[str]) -> None:
    global _allowlist_cache, _allowlist_cache_time
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=ALLOWLIST_KEY,
        Body=json.dumps(sorted(set(emails))),
        ContentType="application/json",
    )
    _allowlist_cache = sorted(set(emails))
    _allowlist_cache_time = time.time()

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/webm", "video/x-m4v",
}

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/webm", "video/x-m4v",
}


def transcode_to_h264(data: bytes, input_ext: str = "mp4") -> bytes:
    """Re-encode any video to H.264/AAC MP4 so it plays in all browsers."""
    inp = tempfile.NamedTemporaryFile(suffix=f".{input_ext}", delete=False)
    out_path = inp.name + "_h264.mp4"
    try:
        inp.write(data)
        inp.close()
        subprocess.run(
            [
                FFMPEG, "-y", "-i", inp.name,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                out_path,
            ],
            check=True,
            capture_output=True,
        )
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(inp.name)
        if os.path.exists(out_path):
            os.unlink(out_path)


bearer = HTTPBearer()


class UserInfo(BaseModel):
    sub: str
    email: str
    name: str
    picture: str


class LoginEvent(BaseModel):
    sub: str
    email: str
    name: str
    picture: str
    timestamp: str


class PhotoItem(BaseModel):
    key: str
    url: str
    filename: str
    original_filename: str = ""
    size: int
    last_modified: str
    uploaded_by: str


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> UserInfo:
    """Verify Google ID token and return basic user info."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured on server.")
    try:
        info = id_token.verify_oauth2_token(
            credentials.credentials,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    user = UserInfo(
        sub=info["sub"],
        email=info["email"],
        name=info.get("name", ""),
        picture=info.get("picture", ""),
    )
    # Allowlist check: owner always passes; others blocked if list exists and they're not on it
    if user.email != OWNER_EMAIL:
        allowlist = _read_allowlist()
        if allowlist is not None and user.email not in allowlist:
            raise HTTPException(status_code=403, detail="Access denied. You are not on the access list.")
    return user


@app.get("/auth/me", response_model=UserInfo)
def get_me(user: UserInfo = Depends(verify_token)):
    return user


@app.post("/auth/login")
def record_login(user: UserInfo = Depends(verify_token)):
    """Record a login event to S3."""
    event = {
        "sub": user.sub,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    safe_ts = event["timestamp"].replace(":", "-")
    key = f"logs/logins/{safe_ts}_{user.sub}.json"
    try:
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=key,
            Body=json.dumps(event),
            ContentType="application/json",
        )
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"message": "Login recorded"}


@app.get("/admin/logins", response_model=List[LoginEvent])
def list_logins(user: UserInfo = Depends(verify_token)):
    """Return all login events, newest first."""
    try:
        response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix="logs/logins/")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    events = []
    for obj in response.get("Contents", []):
        if obj["Key"].endswith("/"):
            continue
        try:
            body = s3.get_object(Bucket=BUCKET_NAME, Key=obj["Key"])["Body"].read()
            events.append(LoginEvent(**json.loads(body)))
        except Exception:
            continue

    return sorted(events, key=lambda e: e.timestamp, reverse=True)


@app.get("/admin/allowlist")
def get_allowlist(user: UserInfo = Depends(verify_token)):
    allowlist = _read_allowlist()
    return {
        "restricted": allowlist is not None,
        "emails": allowlist or [],
        "owner": OWNER_EMAIL,
    }


@app.post("/admin/allowlist/{email:path}")
def add_to_allowlist(email: str, user: UserInfo = Depends(verify_token)):
    if user.email != OWNER_EMAIL:
        raise HTTPException(status_code=403, detail="Only the owner can manage access.")
    emails = list(_read_allowlist() or [])
    if email not in emails:
        emails.append(email)
    _write_allowlist(emails)
    return {"emails": sorted(set(emails))}


@app.delete("/admin/allowlist/{email:path}")
def remove_from_allowlist(email: str, user: UserInfo = Depends(verify_token)):
    if user.email != OWNER_EMAIL:
        raise HTTPException(status_code=403, detail="Only the owner can manage access.")
    if email == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot remove the owner.")
    emails = [e for e in (_read_allowlist() or []) if e != email]
    _write_allowlist(emails)
    return {"emails": emails}


@app.get("/photos", response_model=List[PhotoItem])
def list_photos(user: UserInfo = Depends(verify_token)):
    try:
        response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix="photos/")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    photos = []
    for obj in response.get("Contents", []):
        if obj["Key"].endswith("/"):
            continue
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": obj["Key"]},
            ExpiresIn=3600,
        )
        # Read the uploader stored at upload time; fall back to current user for old photos
        try:
            head = s3.head_object(Bucket=BUCKET_NAME, Key=obj["Key"])
            meta = head.get("Metadata", {})
            uploader = meta.get("uploader-name") or user.name
            original_filename = meta.get("original-filename", "")
        except ClientError:
            uploader = user.name
            original_filename = ""
        photos.append(
            PhotoItem(
                key=obj["Key"],
                url=url,
                filename=obj["Key"].split("/")[-1],
                original_filename=original_filename,
                size=obj["Size"],
                last_modified=obj["LastModified"].isoformat(),
                uploaded_by=uploader,
            )
        )
    return sorted(photos, key=lambda p: p.last_modified, reverse=True)


@app.post("/photos/upload")
async def upload_photo(
    file: UploadFile = File(...),
    user: UserInfo = Depends(verify_token),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="File type not supported.")

    contents = await file.read()
    content_type = file.content_type

    if content_type in VIDEO_TYPES:
        ext_in = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "mp4"
        try:
            contents = transcode_to_h264(contents, ext_in)
            content_type = "video/mp4"
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=422, detail=f"Video transcoding failed: {e.stderr.decode()[-300:]}")

    ext = "mp4" if content_type == "video/mp4" else (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin")
    key = f"photos/{uuid.uuid4()}.{ext}"

    try:
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=key,
            Body=contents,
            ContentType=content_type,
            Metadata={
                "uploader-email": user.email,
                "uploader-name": user.name,
                "original-filename": file.filename,
            },
        )
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"key": key, "filename": file.filename, "message": "Upload successful"}


class ImportItem(BaseModel):
    url: str
    filename: str
    mimeType: str
    access_token: str = ""


GOOGLE_PHOTOS_ALLOWED = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif", "image/tiff", "image/bmp",
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/webm", "video/x-m4v",
}

@app.post("/google-photos/import")
def import_google_photos(
    items: List[ImportItem],
    user: UserInfo = Depends(verify_token),
):
    """Download selected Google Photos and save them to S3."""
    imported = []
    skipped = []
    print(f"[import] received {len(items)} item(s)")
    for item in items:
        mime = item.mimeType.split(";")[0].strip().lower()
        print(f"[import] file={item.filename!r} mime={mime!r} url={item.url[:80]!r}")
        if mime not in GOOGLE_PHOTOS_ALLOWED:
            reason = f"unsupported type: {mime}"
            print(f"[import] SKIP {reason}")
            skipped.append({"filename": item.filename, "reason": reason})
            continue
        try:
            dl_headers = {"Authorization": f"Bearer {item.access_token}"} if item.access_token else {}
            resp = http_requests.get(item.url, timeout=60, allow_redirects=True, headers=dl_headers)
            print(f"[import] download status={resp.status_code} content-type={resp.headers.get('content-type')} size={len(resp.content)}")
            resp.raise_for_status()
        except http_requests.RequestException as e:
            print(f"[import] download FAILED: {e}")
            skipped.append({"filename": item.filename, "reason": str(e)})
            continue
        body = resp.content
        out_mime = mime
        if mime.startswith("video/"):
            ext_in = item.filename.rsplit(".", 1)[-1] if "." in item.filename else "mp4"
            try:
                body = transcode_to_h264(body, ext_in)
                out_mime = "video/mp4"
                print(f"[import] transcoded to H.264 size={len(body)}")
            except subprocess.CalledProcessError as e:
                print(f"[import] transcode failed: {e.stderr.decode()[-200:]}")
                skipped.append({"filename": item.filename, "reason": "transcoding failed"})
                continue

        ext = "mp4" if out_mime == "video/mp4" else (item.filename.rsplit(".", 1)[-1] if "." in item.filename else "jpg")
        key = f"photos/{uuid.uuid4()}.{ext}"
        try:
            s3.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=body,
                ContentType=out_mime,
                Metadata={
                    "uploader-email": user.email,
                    "uploader-name": user.name,
                    "original-filename": item.filename,
                },
            )
            print(f"[import] S3 OK key={key!r}")
            imported.append({"key": key, "filename": item.filename})
        except ClientError as e:
            print(f"[import] S3 FAILED: {e}")
            skipped.append({"filename": item.filename, "reason": str(e)})
    print(f"[import] done imported={len(imported)} skipped={len(skipped)}")
    return {"imported": len(imported), "items": imported, "skipped": skipped}


@app.get("/download/{key:path}")
def download_file(key: str, user: UserInfo = Depends(verify_token)):
    """Return a presigned URL that forces browser download (Content-Disposition: attachment)."""
    if not (key.startswith("photos/") or key.startswith("trash/")):
        raise HTTPException(status_code=403, detail="Invalid key.")
    filename = key.split("/")[-1]
    url = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": BUCKET_NAME,
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{filename}"',
        },
        ExpiresIn=300,
    )
    return {"url": url}


@app.delete("/photos/{key:path}")
def delete_photo(key: str, user: UserInfo = Depends(verify_token)):
    """Move a photo to the recycle bin (trash/ prefix)."""
    if not key.startswith("photos/"):
        raise HTTPException(status_code=403, detail="Invalid key.")
    trash_key = "trash/" + key[len("photos/"):]
    try:
        s3.copy_object(
            Bucket=BUCKET_NAME,
            CopySource={"Bucket": BUCKET_NAME, "Key": key},
            Key=trash_key,
            MetadataDirective="COPY",
        )
        s3.delete_object(Bucket=BUCKET_NAME, Key=key)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"message": "Moved to recycle bin", "trash_key": trash_key}


@app.get("/trash", response_model=List[PhotoItem])
def list_trash(user: UserInfo = Depends(verify_token)):
    """List items in the recycle bin."""
    try:
        response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix="trash/")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    items = []
    for obj in response.get("Contents", []):
        if obj["Key"].endswith("/"):
            continue
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": obj["Key"]},
            ExpiresIn=3600,
        )
        try:
            head = s3.head_object(Bucket=BUCKET_NAME, Key=obj["Key"])
            uploader = head.get("Metadata", {}).get("uploader-name", "Unknown")
        except ClientError:
            uploader = "Unknown"
        items.append(PhotoItem(
            key=obj["Key"],
            url=url,
            filename=obj["Key"].split("/")[-1],
            size=obj["Size"],
            last_modified=obj["LastModified"].isoformat(),
            uploaded_by=uploader,
        ))
    return sorted(items, key=lambda p: p.last_modified, reverse=True)


@app.delete("/trash/{key:path}")
def permanently_delete(key: str, user: UserInfo = Depends(verify_token)):
    """Permanently delete an item from the recycle bin."""
    if not key.startswith("trash/"):
        raise HTTPException(status_code=403, detail="Invalid key.")
    try:
        s3.delete_object(Bucket=BUCKET_NAME, Key=key)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"message": "Permanently deleted"}
