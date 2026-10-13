import json
import os
import uuid
from datetime import datetime, timezone
from typing import List

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
    return UserInfo(
        sub=info["sub"],
        email=info["email"],
        name=info.get("name", ""),
        picture=info.get("picture", ""),
    )


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
        photos.append(
            PhotoItem(
                key=obj["Key"],
                url=url,
                filename=obj["Key"].split("/")[-1],
                size=obj["Size"],
                last_modified=obj["LastModified"].isoformat(),
                uploaded_by=user.name,
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

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin"
    key = f"photos/{uuid.uuid4()}.{ext}"

    try:
        contents = await file.read()
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=key,
            Body=contents,
            ContentType=file.content_type,
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
        ext = item.filename.rsplit(".", 1)[-1] if "." in item.filename else "jpg"
        key = f"photos/{uuid.uuid4()}.{ext}"
        try:
            s3.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=resp.content,
                ContentType=mime,
            )
            print(f"[import] S3 OK key={key!r}")
            imported.append({"key": key, "filename": item.filename})
        except ClientError as e:
            print(f"[import] S3 FAILED: {e}")
            skipped.append({"filename": item.filename, "reason": str(e)})
    print(f"[import] done imported={len(imported)} skipped={len(skipped)}")
    return {"imported": len(imported), "items": imported, "skipped": skipped}


@app.delete("/photos/{key:path}")
def delete_photo(key: str, user: UserInfo = Depends(verify_token)):
    if not key.startswith("photos/"):
        raise HTTPException(status_code=403, detail="Invalid key.")
    try:
        s3.delete_object(Bucket=BUCKET_NAME, Key=key)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"message": "Deleted successfully"}
