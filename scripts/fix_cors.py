"""
Apply the CORS policy required for video streaming to the S3 bucket.
Run once:
  cd scripts
  python fix_cors.py
"""
import json
import os
import sys

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../backend/.env"))

REGION = os.getenv("AWS_REGION", "us-west-2")
BUCKET = os.getenv("S3_BUCKET_NAME", "cloudpix-photos")

s3 = boto3.client(
    "s3",
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)

CORS_CONFIG = {
    "CORSRules": [
        {
            "AllowedOrigins": ["*"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
            # Expose range headers so browsers can stream video
            "ExposeHeaders": ["Accept-Ranges", "Content-Range", "Content-Length", "ETag"],
            "MaxAgeSeconds": 3600,
        }
    ]
}

try:
    s3.put_bucket_cors(Bucket=BUCKET, CORSConfiguration=CORS_CONFIG)
    print(f"CORS applied to bucket '{BUCKET}'.")
    print(json.dumps(CORS_CONFIG, indent=2))
except ClientError as e:
    print(f"Error: {e}")
    sys.exit(1)
