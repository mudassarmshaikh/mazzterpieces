import os
import uuid
from typing import List

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="CloudPix API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "cloudpix-photos")

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


class PhotoItem(BaseModel):
    key: str
    url: str
    filename: str
    size: int
    last_modified: str


@app.get("/photos", response_model=List[PhotoItem])
def list_photos():
    try:
        response = s3.list_objects_v2(Bucket=BUCKET_NAME)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    photos = []
    for obj in response.get("Contents", []):
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": obj["Key"]},
            ExpiresIn=3600,
        )
        photos.append(
            PhotoItem(
                key=obj["Key"],
                url=url,
                filename=obj["Key"].split("/", 1)[-1],
                size=obj["Size"],
                last_modified=obj["LastModified"].isoformat(),
            )
        )
    return sorted(photos, key=lambda p: p.last_modified, reverse=True)


@app.post("/photos/upload")
async def upload_photo(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed.")

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
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


@app.delete("/photos/{key:path}")
def delete_photo(key: str):
    try:
        s3.delete_object(Bucket=BUCKET_NAME, Key=key)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"message": "Deleted successfully"}
